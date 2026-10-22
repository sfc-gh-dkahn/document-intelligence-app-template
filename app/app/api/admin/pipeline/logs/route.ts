import { querySnowflake } from "@/lib/snowflake"
import { DB } from "@/lib/db"
import { NextRequest } from "next/server"
import { requireAdmin, clampInt, serverError } from "@/lib/api-utils"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied

  try {
    const { searchParams } = new URL(req.url)
    const statusParam = searchParams.get("status")
    const status = statusParam && ["PENDING", "PROCESSING", "COMPLETE", "FAILED", "ABANDONED"].includes(statusParam) ? statusParam : ""
    const limit = clampInt(searchParams.get("limit"), 10, 200)
    const offset = clampInt(searchParams.get("offset"), 0, 100000)

    const where = status ? `WHERE r.ingestion_status = '${status}'` : ""

    const rows = await querySnowflake(`
      SELECT
        r.registry_id,
        r.file_path,
        r.file_format,
        r.source_folder,
        r.src_document_type,
        r.ingestion_status,
        r.processing_version,
        r.processing_attempts,
        r.last_error,
        r.error_stage,
        r.first_seen_at,
        r.processing_started_at,
        r.processing_completed_at,
        r.updated_at,
        p.parse_status,
        p.parse_mode,
        p.page_count,
        c.primary_document_type AS ai_document_type,
        c.confidence_score,
        c.needs_review,
        da.party_name,
        da.line_of_business
      FROM ${DB}.DATA.ingestion_registry r
      LEFT JOIN ${DB}.DATA.parsed_documents p
        ON r.file_path = p.file_path AND r.processing_version = p.processing_version
      LEFT JOIN ${DB}.DATA.classified_documents c
        ON r.file_path = c.file_path AND r.processing_version = c.processing_version
      LEFT JOIN ${DB}.DATA.document_attributes da
        ON r.file_path = da.file_path AND r.processing_version = da.processing_version
      ${where}
      ORDER BY r.updated_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `, { callersRights: true })

    const countRows = await querySnowflake(`
      SELECT COUNT(*) AS total FROM ${DB}.DATA.ingestion_registry r ${where}
    `, { callersRights: true })

    return Response.json({
      rows,
      total: countRows[0]?.TOTAL ?? countRows[0]?.total ?? 0,
      limit,
      offset,
    })
  } catch (e) {
    console.error("[pipeline/logs]", e)
    return serverError(e)
  }
}
