import { querySnowflake } from "@/lib/snowflake"
import { DB } from "@/lib/db"
import { NextRequest } from "next/server"
import { escSql, clampInt, requireUser, serverError, decodeHtmlEntities } from "@/lib/api-utils"


export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const denied = await requireUser()
  if (denied) return denied
  const { searchParams } = new URL(req.url)
  const folder  = searchParams.get("folder") ?? ""
  const docType = searchParams.get("docType") ?? ""
  const lob     = searchParams.get("lob") ?? ""
  const status  = searchParams.get("status") ?? ""
  const review  = searchParams.get("review") === "true"
  const limit   = clampInt(searchParams.get("limit"),  1, 200)
  const offset  = clampInt(searchParams.get("offset"), 0, 100000)

  const search  = searchParams.get("search") ?? ""


  const where = ["1=1"]
  if (folder)  where.push(`source_folder = '${escSql(folder)}'`)
  if (docType) where.push(`document_type = '${escSql(docType)}'`)
  if (lob)     where.push(`line_of_business = '${escSql(lob)}'`)
  if (status)  where.push(`doc_status = '${escSql(status)}'`)
  if (review)  where.push("needs_review = TRUE")
  if (search) {
    const safeSearch = escSql(search).replace(/%/g, '\\%').replace(/_/g, '\\_')
    where.push(`(
    party_name ILIKE '%${safeSearch}%'
    OR issuer_name ILIKE '%${safeSearch}%'
    OR reference_number ILIKE '%${safeSearch}%'
    OR case_number ILIKE '%${safeSearch}%'
    OR src_reference_number ILIKE '%${safeSearch}%'
    OR src_case_number ILIKE '%${safeSearch}%'
    OR doc_summary ILIKE '%${safeSearch}%'
    OR file_path ILIKE '%${safeSearch}%'
  )`)
  }

  // Data filtering is enforced by the Row Access Policy on document_catalog.
  // No app-level LOB/docType filtering needed — RAP handles it via caller's rights.
  const whereClause = where.join(" AND ")

  try {
    const [rows, countRows] = await Promise.all([
      querySnowflake(`
        SELECT file_path, src_file_id, source_folder, document_type, party_name,
               issuer_name, line_of_business, doc_subtype, file_format,
               doc_status, classification_confidence, needs_review,
               start_date, end_date, reference_number, case_number, src_reference_number, src_case_number,
               page_count, processing_completed_at, doc_summary
        FROM ${DB}.APP.v_document_catalog
        WHERE ${whereClause}
        ORDER BY processing_completed_at DESC NULLS LAST
        LIMIT ${limit} OFFSET ${offset}
      `, { callersRights: true }),
      querySnowflake(`
        SELECT COUNT(*) AS total
        FROM ${DB}.APP.v_document_catalog
        WHERE ${whereClause}
      `, { callersRights: true }),
    ])
    const total = Number((countRows[0] as Record<string, unknown>)?.TOTAL ?? 0)
    // Decode HTML entities in string fields (source data may contain &amp; etc.)
    const decoded = rows.map(r => {
      const row = r as Record<string, unknown>
      for (const key of ["LINE_OF_BUSINESS", "PARTY_NAME", "ISSUER_NAME", "DOCUMENT_TYPE", "DOC_SUBTYPE"]) {
        if (typeof row[key] === "string") row[key] = decodeHtmlEntities(row[key] as string)
      }
      return row
    })
    return Response.json({ rows: decoded, total, limit, offset })
  } catch (e) {
    console.error(new Date().toISOString(), "[documents] error", e)
    return serverError(e)
  }
}
