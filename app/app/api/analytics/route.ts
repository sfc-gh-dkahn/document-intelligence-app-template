import { querySnowflake } from "@/lib/snowflake"
import { DB } from "@/lib/db"
import { requireUser, serverError } from "@/lib/api-utils"

export const dynamic = "force-dynamic"

export async function GET() {
  const denied = await requireUser()
  if (denied) return denied
  try {
    const [byType, byLob, byStatus, totalRow] = await Promise.all([
      querySnowflake(`
        SELECT document_type AS name, COUNT(*) AS value
        FROM ${DB}.APP.v_document_catalog
        WHERE document_type IS NOT NULL
        GROUP BY 1 ORDER BY 2 DESC LIMIT 12
      `, { callersRights: true }),
      querySnowflake(`
        SELECT COALESCE(line_of_business,'Unknown') AS name, COUNT(*) AS value
        FROM ${DB}.APP.v_document_catalog
        GROUP BY 1 ORDER BY 2 DESC LIMIT 10
      `, { callersRights: true }),
      querySnowflake(`
        SELECT COALESCE(doc_status,'unknown') AS name, COUNT(*) AS value
        FROM ${DB}.APP.v_document_catalog
        GROUP BY 1 ORDER BY 2 DESC
        LIMIT 50
      `, { callersRights: true }),
      querySnowflake(`
        SELECT COUNT(*) AS total,
               COUNT(DISTINCT line_of_business) AS lobs
        FROM ${DB}.APP.v_document_catalog
      `, { callersRights: true }),
    ])
    const norm = (rows: Record<string, unknown>[]) =>
      rows.map(r => ({ name: String(r.NAME ?? r.name ?? ""), value: Number(r.VALUE ?? r.value ?? 0) }))
    const total = Number((totalRow[0] as Record<string, unknown>)?.TOTAL ?? (totalRow[0] as Record<string, unknown>)?.total ?? 0)
    const lobs = Number((totalRow[0] as Record<string, unknown>)?.LOBS ?? (totalRow[0] as Record<string, unknown>)?.lobs ?? 0)
    return Response.json({ byType: norm(byType), byLob: norm(byLob), byStatus: norm(byStatus), total, lobs })
  } catch (e) {
    console.error(new Date().toISOString(), "[analytics] error", e)
    return serverError(e)
  }
}
