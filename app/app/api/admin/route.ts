import { querySnowflake } from "@/lib/snowflake"
import { DB } from "@/lib/db"
import { NextRequest } from "next/server"
import { requireAdmin, escSql, serverError } from "@/lib/api-utils"

export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    const body = await req.json()
    const { action } = body as Record<string, string>

    // Force reprocess a single document
    if (action === "force_reprocess") {
      const { filePath, reason } = body as Record<string, string>
      if (!filePath) return Response.json({ error: "filePath required" }, { status: 400 })
      await querySnowflake(
        `CALL ${DB}.DATA.sp_force_reprocess('${escSql(filePath)}','${escSql(reason ?? "Admin reprocess")}')`,
        { callersRights: true }
      )
      return Response.json({ ok: true })
    }

    // Approve a human correction override
    if (action === "approve_override") {
      const { overrideId } = body as Record<string, string>
      if (!overrideId) return Response.json({ error: "overrideId required" }, { status: 400 })
      await querySnowflake(
        `CALL ${DB}.ADMIN.sp_approve_override('${escSql(overrideId)}')`,
        { callersRights: true }
      )
      return Response.json({ ok: true })
    }

    // Reject a correction override
    if (action === "reject_override") {
      const { overrideId } = body as Record<string, string>
      if (!overrideId) return Response.json({ error: "overrideId required" }, { status: 400 })
      await querySnowflake(
        `UPDATE ${DB}.ADMIN.extraction_overrides
         SET override_status = 'REJECTED', approved_by = CURRENT_USER(), approved_at = CURRENT_TIMESTAMP()
         WHERE override_id = '${escSql(overrideId)}' AND override_status = 'PENDING'`,
        { callersRights: true }
      )
      return Response.json({ ok: true })
    }

    // Submit a user-facing attribute correction (from Document Browser page)
    if (action === "submit_correction") {
      const { filePath, fieldName, originalValue, correctedValue } = body as Record<string, string>
      if (!filePath || !fieldName || correctedValue === undefined) {
        return Response.json({ error: "filePath, fieldName and correctedValue required" }, { status: 400 })
      }
      await querySnowflake(
        `INSERT INTO ${DB}.ADMIN.extraction_overrides
           (file_path, processing_version, field_name, original_value, corrected_value, submitted_by, override_status)
         VALUES (
           '${escSql(filePath)}',
           1,
           '${escSql(fieldName)}',
           '${escSql(originalValue ?? "")}',
           '${escSql(correctedValue)}',
           CURRENT_USER(),
           'PENDING'
         )`,
        { callersRights: true }
      )
      return Response.json({ ok: true })
    }

    return Response.json({ error: "Unknown action" }, { status: 400 })
  } catch (e) {
    console.error(new Date().toISOString(), "[admin] error", e)
    return serverError(e)
  }
}
