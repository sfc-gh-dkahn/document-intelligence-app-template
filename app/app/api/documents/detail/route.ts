/**
 * GET /api/documents/detail?id=<base64url file_path>
 */
import { querySnowflake } from "@/lib/snowflake"
import { DB } from "@/lib/db"
import { NextRequest } from "next/server"
import { requireUser, escSql, badRequest, serverError } from "@/lib/api-utils"

export const dynamic = "force-dynamic"

function decodeId(id: string): string {
  return Buffer.from(id.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8")
}

export async function GET(req: NextRequest) {
  const denied = await requireUser()
  if (denied) return denied

  const id = req.nextUrl.searchParams.get("id")
  if (!id) return badRequest("id parameter is required")

  const filePath = decodeId(id)
  if (!filePath) return badRequest("Invalid document ID")

  try {
    // Query through the RAP-protected view so entitlement filtering is enforced
    const rows = await querySnowflake(`
      SELECT *
      FROM ${DB}.APP.v_document_catalog
      WHERE file_path = '${escSql(filePath)}'
      LIMIT 1
    `, { callersRights: true })

    if (!rows || rows.length === 0) {
      return Response.json({ error: "Document not found or access denied" }, { status: 404 })
    }

    let pendingCorrections: string[] = []
    try {
      const corrRows = await querySnowflake(`
        SELECT field_name FROM ${DB}.ADMIN.extraction_overrides
        WHERE file_path = '${escSql(filePath)}' AND override_status = 'PENDING'
      `, { callersRights: true })
      pendingCorrections = corrRows.map((r: Record<string, unknown>) =>
        String(r.FIELD_NAME ?? r.field_name ?? "")
      )
    } catch { /* table may not exist */ }

    return Response.json({ document: rows[0], pendingCorrections })
  } catch (e) {
    return serverError(e)
  }
}
