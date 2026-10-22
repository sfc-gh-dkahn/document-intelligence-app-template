/**
 * Review Queue API — entitlement-scoped by LOB and document type.
 *
 * Users only see documents where:
 * - line_of_business is in their lobAccess
 * - primary_document_type is in their docTypeAccess
 *
 * GET ?status=pending|approved|skipped|all&limit&offset
 * POST { filePath, action: "approve" | "skip" }
 * GET ?action=count — returns pending/approved/skipped counts for badge
 */
import { querySnowflake } from "@/lib/snowflake"
import { DB } from "@/lib/db"
import { NextRequest } from "next/server"
import { requireUser, escSql, escLike, clampInt, badRequest, serverError } from "@/lib/api-utils"

export const dynamic = "force-dynamic"

async function getUser(): Promise<string> {
  const rows = await querySnowflake(`SELECT CURRENT_USER() AS u`, { callersRights: true })
  return String((rows[0] as Record<string, unknown>).U ?? (rows[0] as Record<string, unknown>).u ?? "")
}

export async function GET(req: NextRequest) {
  const denied = await requireUser()
  if (denied) return denied

  // Badge count endpoint
  if (req.nextUrl.searchParams.get("action") === "count") {
    try {
      const rows = await querySnowflake(`
        SELECT
          SUM(CASE WHEN ov.override_status IS NULL THEN 1 ELSE 0 END) AS pending_count,
          SUM(CASE WHEN ov.corrected_value = 'APPROVED' THEN 1 ELSE 0 END) AS approved_count,
          SUM(CASE WHEN ov.corrected_value = 'SKIPPED' THEN 1 ELSE 0 END) AS skipped_count
        FROM ${DB}.DATA.classified_documents cd
        JOIN ${DB}.APP.v_document_catalog dc ON cd.file_path = dc.file_path
        LEFT JOIN ${DB}.ADMIN.extraction_overrides ov
          ON cd.file_path = ov.file_path AND ov.field_name = '__review_status__'
        WHERE cd.needs_review = TRUE
          AND dc.ingestion_status = 'COMPLETE'
      `, { callersRights: true })

      const r = rows[0] as Record<string, unknown>
      return Response.json({
        pending: Number(r.PENDING_COUNT ?? r.pending_count ?? 0),
        approved: Number(r.APPROVED_COUNT ?? r.approved_count ?? 0),
        skipped: Number(r.SKIPPED_COUNT ?? r.skipped_count ?? 0),
      })
    } catch (e) {
      return Response.json({ pending: 0, approved: 0, skipped: 0 })
    }
  }

  const status = req.nextUrl.searchParams.get("status") ?? "pending"
  const limit = clampInt(req.nextUrl.searchParams.get("limit") ?? "20", 1, 100)
  const offset = clampInt(req.nextUrl.searchParams.get("offset") ?? "0", 0, 100000)
  const lobFilter = req.nextUrl.searchParams.get("lob") ?? ""
  const docTypeFilter = req.nextUrl.searchParams.get("docType") ?? ""
  const searchFilter = req.nextUrl.searchParams.get("search") ?? ""

  // Build status filter
  let statusFilter = ""
  if (status === "pending") {
    statusFilter = "AND ov.override_status IS NULL"
  } else if (status === "approved") {
    statusFilter = "AND ov.corrected_value = 'APPROVED'"
  } else if (status === "skipped") {
    statusFilter = "AND ov.corrected_value = 'SKIPPED'"
  }
  // "all" = no extra filter

  // Build optional filters
  let extraFilters = ""
  if (lobFilter) extraFilters += ` AND dc.line_of_business = '${escSql(lobFilter)}'`
  if (docTypeFilter) extraFilters += ` AND cd.primary_document_type = '${escSql(docTypeFilter)}'`
  if (searchFilter) {
    const s = escLike(searchFilter)
    extraFilters += ` AND (dc.party_name ILIKE '%${s}%' OR dc.reference_number ILIKE '%${s}%' OR dc.case_number ILIKE '%${s}%' OR cd.file_path ILIKE '%${s}%')`
  }

  try {
    const countRows = await querySnowflake(`
      SELECT COUNT(*) AS total
      FROM ${DB}.DATA.classified_documents cd
      JOIN ${DB}.APP.v_document_catalog dc ON cd.file_path = dc.file_path
      LEFT JOIN ${DB}.ADMIN.extraction_overrides ov
        ON cd.file_path = ov.file_path AND ov.field_name = '__review_status__'
      WHERE cd.needs_review = TRUE
        AND dc.ingestion_status = 'COMPLETE'
        ${statusFilter}
        ${extraFilters}
    `, { callersRights: true })
    const total = Number((countRows[0] as Record<string, unknown>).TOTAL ?? (countRows[0] as Record<string, unknown>).total ?? 0)

    const rows = await querySnowflake(`
      SELECT
        cd.file_path,
        cd.primary_document_type,
        cd.confidence_score,
        cd.source_folder,
        dc.line_of_business,
        dc.party_name,
        dc.reference_number,
        dc.case_number,
        dc.issuer_name,
        dc.start_date,
        dc.ingestion_status,
        ov.corrected_value AS review_status,
        ov.submitted_by AS reviewed_by,
        ov.submitted_at AS reviewed_at,
        cd.all_document_types,
        CASE
          WHEN cd.confidence_score < 0.5 THEN 'Very low confidence (' || ROUND(cd.confidence_score * 100) || '%) — AI was uncertain about the document type'
          WHEN cd.confidence_score < 0.75 AND ARRAY_SIZE(cd.all_document_types) > 1 THEN 'Low confidence (' || ROUND(cd.confidence_score * 100) || '%) with ' || ARRAY_SIZE(cd.all_document_types) || ' competing classifications'
          WHEN cd.confidence_score < 0.75 THEN 'Low confidence (' || ROUND(cd.confidence_score * 100) || '%) — below the auto-approve threshold'
          WHEN ARRAY_SIZE(cd.all_document_types) > 2 THEN 'Multiple possible types detected (' || ARRAY_SIZE(cd.all_document_types) || ' candidates) despite reasonable confidence'
          WHEN cd.classification_match = FALSE AND cd.src_document_type IS NOT NULL THEN 'AI classification differs from source system document type ("' || cd.src_document_type || '")'
          ELSE 'Flagged for manual verification'
        END AS review_reason
      FROM ${DB}.DATA.classified_documents cd
      JOIN ${DB}.APP.v_document_catalog dc ON cd.file_path = dc.file_path
      LEFT JOIN ${DB}.ADMIN.extraction_overrides ov
        ON cd.file_path = ov.file_path AND ov.field_name = '__review_status__'
      WHERE cd.needs_review = TRUE
        AND dc.ingestion_status = 'COMPLETE'
        ${statusFilter}
        ${extraFilters}
      ORDER BY cd.confidence_score ASC NULLS LAST
      LIMIT ${limit} OFFSET ${offset}
    `, { callersRights: true })

    return Response.json({ rows, total, limit, offset, status })
  } catch (e) {
    return serverError(e)
  }
}

export async function POST(req: NextRequest) {
  const denied = await requireUser()
  if (denied) return denied

  try {
    const body = await req.json()
    const { filePath, action } = body

    if (!filePath) return badRequest("filePath is required")
    if (!["approve", "skip"].includes(action)) return badRequest("action must be 'approve' or 'skip'")

    const correctedValue = action === "approve" ? "APPROVED" : "SKIPPED"
    const userName = await getUser()

    await querySnowflake(`
      MERGE INTO ${DB}.ADMIN.extraction_overrides AS tgt
      USING (SELECT '${escSql(filePath)}' AS fp,
                    COALESCE((SELECT MAX(processing_version) FROM ${DB}.APP.v_document_catalog
                              WHERE file_path = '${escSql(filePath)}'), 1) AS pv) AS src
        ON tgt.file_path = src.fp AND tgt.field_name = '__review_status__'
      WHEN MATCHED THEN UPDATE SET
        corrected_value = '${correctedValue}',
        processing_version = src.pv,
        override_status = 'PENDING',
        submitted_by = '${escSql(userName)}',
        submitted_at = CURRENT_TIMESTAMP()
      WHEN NOT MATCHED THEN INSERT (file_path, field_name, original_value, corrected_value, override_status, submitted_by, processing_version)
      VALUES ('${escSql(filePath)}', '__review_status__', 'PENDING_REVIEW', '${correctedValue}', 'PENDING', '${escSql(userName)}', src.pv)
    `, { callersRights: true })

    return Response.json({ ok: true, filePath, action })
  } catch (e) {
    return serverError(e)
  }
}
