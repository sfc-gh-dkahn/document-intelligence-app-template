import { querySnowflake } from "@/lib/snowflake"
import { DB } from "@/lib/db"
import { NextRequest } from "next/server"
import { escSql, requireAdmin, badRequest, serverError } from "@/lib/api-utils"

export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    const { action, filePath, confirm } = await req.json()
    if (!filePath) return badRequest("filePath is required")
    if (!["archive", "purge", "restore"].includes(action)) {
      return badRequest("action must be archive, purge, or restore")
    }

    const safePath = escSql(filePath)

    if (action === "archive") {
      const result = await querySnowflake(`
        UPDATE ${DB}.DATA.ingestion_registry
        SET ingestion_status = 'ARCHIVED'
        WHERE file_path = '${safePath}' AND ingestion_status != 'ARCHIVED'
      `, { callersRights: true })
      const affected = Number((result[0] as Record<string, unknown>)?.["number of rows updated"] ?? 0)
      if (affected === 0) {
        return Response.json({ error: "Document not found or already archived" }, { status: 404 })
      }
      await querySnowflake(`
        INSERT INTO ${DB}.TELEMETRY.pipeline_events (event_type, user_name, file_path, stage_name, status, metadata)
        SELECT 'ARCHIVE', CURRENT_USER(), '${safePath}', 'LIFECYCLE', 'SUCCESS', OBJECT_CONSTRUCT('action', 'archive')
      `, { callersRights: true })
      return Response.json({ ok: true, message: "Document archived" })
    }

    if (action === "restore") {
      await querySnowflake(`
        UPDATE ${DB}.DATA.ingestion_registry
        SET ingestion_status = 'COMPLETE'
        WHERE file_path = '${safePath}' AND ingestion_status = 'ARCHIVED'
      `, { callersRights: true })
      await querySnowflake(`
        INSERT INTO ${DB}.TELEMETRY.pipeline_events (event_type, user_name, file_path, stage_name, status, metadata)
        SELECT 'RESTORE', CURRENT_USER(), '${safePath}', 'LIFECYCLE', 'SUCCESS', OBJECT_CONSTRUCT('action', 'restore')
      `, { callersRights: true })
      return Response.json({ ok: true, message: "Document restored" })
    }

    // Purge — requires explicit confirmation
    if (action === "purge") {
      if (confirm !== true) return badRequest("confirm: true required for purge")
      // Delete from all tables referencing this file
      await querySnowflake(`
        DELETE FROM ${DB}.ADMIN.extraction_overrides WHERE file_path = '${safePath}'
      `, { callersRights: true })
      await querySnowflake(`
        DELETE FROM ${DB}.DATA.document_attributes WHERE file_path = '${safePath}'
      `, { callersRights: true })
      await querySnowflake(`
        DELETE FROM ${DB}.DATA.classified_documents WHERE file_path = '${safePath}'
      `, { callersRights: true })
      await querySnowflake(`
        DELETE FROM ${DB}.DATA.parsed_documents WHERE file_path = '${safePath}'
      `, { callersRights: true })
      await querySnowflake(`
        DELETE FROM ${DB}.DATA.ingestion_registry WHERE file_path = '${safePath}'
      `, { callersRights: true })
      // Remove from stage
      try {
        const stage = filePath.startsWith("@") ? filePath : `@${DB}.DATA.raw_documents/${filePath}`
        await querySnowflake(`REMOVE '${escSql(stage)}'`, { callersRights: true })
      } catch { /* stage file may already be gone */ }
      await querySnowflake(`
        INSERT INTO ${DB}.TELEMETRY.pipeline_events (event_type, user_name, file_path, stage_name, status, metadata)
        SELECT 'PURGE', CURRENT_USER(), '${safePath}', 'LIFECYCLE', 'SUCCESS', OBJECT_CONSTRUCT('action', 'purge')
      `, { callersRights: true })
      return Response.json({ ok: true, message: "Document permanently purged" })
    }

    return badRequest("Unknown action")
  } catch (e) {
    return serverError(e)
  }
}
