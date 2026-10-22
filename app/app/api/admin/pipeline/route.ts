import { querySnowflake } from "@/lib/snowflake"
import { DB } from "@/lib/db"
import { NextRequest } from "next/server"
import { requireAdmin, escSql, escIdent, badRequest, serverError } from "@/lib/api-utils"
import { logAudit } from "@/lib/audit"

export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied

  try {
    const body = await req.json()
    const { action } = body as Record<string, string>

    // Run a pipeline step manually
    if (action === "run_step") {
      const { step } = body as Record<string, string>
      const validSteps: Record<string, string> = {
        register: `CALL ${DB}.DATA.sp_register_new_files()`,
        parse: `CALL ${DB}.DATA.sp_parse_pending_documents()`,
        classify: `CALL ${DB}.DATA.sp_classify_parsed_documents()`,
        extract: `CALL ${DB}.DATA.sp_extract_document_attributes()`,
        metrics: `CALL ${DB}.DATA.sp_emit_pipeline_metrics()`,
      }
      if (!step || !validSteps[step]) {
        return badRequest(`Invalid step. Valid: ${Object.keys(validSteps).join(", ")}`)
      }
      const rows = await querySnowflake(validSteps[step])
      const result = rows[0] ? Object.values(rows[0])[0] : "OK"
      logAudit({ eventType: "ADMIN", stageName: step, status: "SUCCESS", metadata: { action: "run_step", result } })
      return Response.json({ ok: true, step, result })
    }

    // Suspend a task (owner's rights — needs EXECUTE TASK on account)
    if (action === "suspend_task") {
      const { taskName } = body as Record<string, string>
      if (!taskName) return badRequest("taskName required")
      const safe = escIdent(taskName)
      if (!safe || safe.length > 128) return badRequest("Invalid task name")
      await querySnowflake(`ALTER TASK ${DB}.DATA.${safe} SUSPEND`)
      logAudit({ eventType: "ADMIN", status: "SUCCESS", metadata: { action: "suspend_task", task: taskName } })
      return Response.json({ ok: true, taskName, state: "suspended" })
    }

    // Resume a task (owner's rights — needs EXECUTE TASK on account)
    if (action === "resume_task") {
      const { taskName } = body as Record<string, string>
      if (!taskName) return badRequest("taskName required")
      const safe = escIdent(taskName)
      if (!safe || safe.length > 128) return badRequest("Invalid task name")
      await querySnowflake(`ALTER TASK ${DB}.DATA.${safe} RESUME`)
      logAudit({ eventType: "ADMIN", status: "SUCCESS", metadata: { action: "resume_task", task: taskName } })
      return Response.json({ ok: true, taskName, state: "started" })
    }

    // Bulk reprocess
    if (action === "bulk_reprocess") {
      const { folder, fileFormat } = body as Record<string, string>
      const folderParam = folder ? `'${escSql(folder)}'` : "NULL"
      const formatParam = fileFormat ? `'${escSql(fileFormat)}'` : "NULL"
      const rows = await querySnowflake(
        `CALL ${DB}.DATA.sp_bulk_reprocess(${folderParam}, ${formatParam}, FALSE)`,
        { callersRights: true }
      )
      const result = rows[0] ? Object.values(rows[0])[0] : "OK"
      return Response.json({ ok: true, result })
    }

    // Preview bulk reprocess count (no actual reprocess)
    if (action === "preview_reprocess") {
      const folder = body.folder as string | undefined
      const fileFormat = body.fileFormat as string | undefined
      const folderClause = folder ? ` AND source_folder = '${escSql(folder)}'` : ""
      const formatClause = fileFormat ? ` AND file_format = '${escSql(fileFormat)}'` : ""
      const countRows = await querySnowflake(`
        SELECT COUNT(*) AS cnt
        FROM ${DB}.DATA.ingestion_registry
        WHERE processing_version = (
          SELECT MAX(r2.processing_version)
          FROM ${DB}.DATA.ingestion_registry r2
          WHERE r2.file_path = ${DB}.DATA.ingestion_registry.file_path
        )
        AND ingestion_status = 'COMPLETE'
        ${folderClause}${formatClause}
      `, { callersRights: true })
      const count = Number((countRows[0] as Record<string, unknown>).CNT ?? (countRows[0] as Record<string, unknown>).cnt ?? 0)
      return Response.json({ ok: true, count })
    }

    // Refresh stage directory — dynamically from ingestion_stages config
    if (action === "refresh_stage") {
      const stages = await querySnowflake(
        `SELECT stage_name FROM ${DB}.ADMIN.ingestion_stages WHERE is_active = TRUE`,
        { callersRights: true }
      )
      let refreshed = 0
      for (const row of stages) {
        const name = String((row as Record<string, unknown>).STAGE_NAME ?? (row as Record<string, unknown>).stage_name ?? "")
        if (name) {
          try {
            const safeName = escIdent(name.split(".").pop() ?? "")
            if (!safeName) continue
            await querySnowflake(`ALTER STAGE ${DB}.DATA.${safeName} REFRESH`, { callersRights: true })
            refreshed++
          } catch { /* stage may not support refresh */ }
        }
      }
      return Response.json({ ok: true, result: `Refreshed ${refreshed} stage(s)` })
    }

    return badRequest("Unknown action")
  } catch (e) {
    return serverError(e)
  }
}
