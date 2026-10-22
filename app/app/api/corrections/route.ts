import { querySnowflake } from "@/lib/snowflake"
import { DB } from "@/lib/db"
import { NextRequest } from "next/server"
import { requireUser, escSql, serverError } from "@/lib/api-utils"
import { logAudit } from "@/lib/audit"

export const dynamic = "force-dynamic"

/**
 * POST /api/corrections — Submit a user-facing attribute correction.
 * Available to any authenticated user (not admin-only).
 */
export async function POST(req: NextRequest) {
  const denied = await requireUser()
  if (denied) return denied
  try {
    const { filePath, fieldName, originalValue, correctedValue } = await req.json()
    if (!filePath || !fieldName || correctedValue === undefined) {
      return Response.json({ error: "filePath, fieldName and correctedValue required" }, { status: 400 })
    }
    await querySnowflake(
      `INSERT INTO ${DB}.ADMIN.extraction_overrides
         (file_path, processing_version, field_name, original_value, corrected_value, submitted_by, override_status)
       SELECT
         '${escSql(filePath)}',
         COALESCE((SELECT MAX(processing_version) FROM ${DB}.APP.v_document_catalog
                   WHERE file_path = '${escSql(filePath)}'), 1),
         '${escSql(fieldName)}',
         '${escSql(originalValue ?? "")}',
         '${escSql(correctedValue)}',
         CURRENT_USER(),
         'PENDING'`,
      { callersRights: true }
    )
    logAudit({
      eventType: "OVERRIDE",
      filePath,
      status: "SUCCESS",
      metadata: { field: fieldName, original: originalValue, corrected: correctedValue },
    })
    return Response.json({ ok: true })
  } catch (e) {
    console.error(new Date().toISOString(), "[corrections] error", e)
    return serverError(e)
  }
}
