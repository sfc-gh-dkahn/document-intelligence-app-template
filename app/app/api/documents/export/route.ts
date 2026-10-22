/**
 * GET /api/documents/export?format=csv
 *
 * Exports filtered document data as CSV. Applies user's LOB/docType entitlements.
 * Streams the response to avoid holding large result sets in memory.
 */
import { querySnowflake } from "@/lib/snowflake"
import { DB } from "@/lib/db"
import { NextRequest } from "next/server"
import { requireUser, escSql, serverError } from "@/lib/api-utils"
import { getUserEntitlements } from "@/lib/entitlements"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const denied = await requireUser()
  if (denied) return denied

  const userRows = await querySnowflake(`SELECT CURRENT_USER() AS u`, { callersRights: true })
  const userName = String((userRows[0] as Record<string, unknown>).U ?? (userRows[0] as Record<string, unknown>).u ?? "")
  const entitlements = await getUserEntitlements(userName)

  if (!entitlements.canDownload) {
    return Response.json({ error: "Export permission denied by your role" }, { status: 403 })
  }

  const lob = req.nextUrl.searchParams.get("lob")
  const docType = req.nextUrl.searchParams.get("doc_type")
  const status = req.nextUrl.searchParams.get("status")

  try {
    let where = "WHERE 1=1"
    // RAP on document_catalog enforces LOB/docType filtering via caller's rights
    if (lob && lob !== "all") where += ` AND line_of_business = '${escSql(lob)}'`
    if (docType && docType !== "all") where += ` AND document_type = '${escSql(docType)}'`
    if (status && status !== "all") where += ` AND doc_status = '${escSql(status)}'`

    const rows = await querySnowflake(`
      SELECT file_path, document_type, line_of_business,
             doc_status, classification_confidence, processing_completed_at
      FROM ${DB}.APP.v_document_catalog
      ${where}
      ORDER BY processing_completed_at DESC
      LIMIT 5000
    `, { callersRights: true })

    const headers = ["file_path", "document_type", "line_of_business", "doc_status", "classification_confidence", "processing_completed_at"]
    const encoder = new TextEncoder()

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(headers.join(",") + "\n"))
        for (const row of rows) {
          const r = row as Record<string, unknown>
          const values = headers.map(h => {
            const v = String(r[h.toUpperCase()] ?? r[h] ?? "")
            return v.includes(",") || v.includes('"') ? `"${v.replace(/"/g, '""')}"` : v
          })
          controller.enqueue(encoder.encode(values.join(",") + "\n"))
        }
        controller.close()
      },
    })

    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="documents_export_${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    })
  } catch (e) {
    return serverError(e)
  }
}
