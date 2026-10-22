import { querySnowflake } from "@/lib/snowflake"
import { DB } from "@/lib/db"
import { requireAdmin, serverError } from "@/lib/api-utils"

export const dynamic = "force-dynamic"

export async function GET() {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    const [metrics, corrections, feedback, fieldAccuracy, lobAccuracy] = await Promise.all([
      querySnowflake(`
        SELECT 
          SUM(doc_count) AS total_docs,
          SUM(low_confidence_count) AS low_conf_count,
          ROUND(AVG(avg_confidence), 3) AS avg_confidence,
          CASE WHEN SUM(doc_count) > 0 
               THEN ROUND(SUM(low_confidence_count) * 100.0 / SUM(doc_count), 1)
               ELSE 0 END AS low_conf_pct,
          COUNT(DISTINCT primary_document_type) AS doc_type_count
        FROM ${DB}.TELEMETRY.v_quality_metrics
        WHERE date >= DATEADD('DAY', -7, CURRENT_DATE())
        ORDER BY date DESC
        LIMIT 1
      `, { callersRights: true }),
      querySnowflake(`
        SELECT override_id, file_path, field_name, original_value,
               corrected_value, submitted_by, submitted_at
        FROM ${DB}.ADMIN.extraction_overrides
        WHERE override_status = 'PENDING'
        ORDER BY submitted_at DESC
        LIMIT 100
      `, { callersRights: true }),
      querySnowflake(`
        SELECT feedback_id, file_path, feedback_type, query_text,
               submitted_by, submitted_at
        FROM ${DB}.ADMIN.search_feedback
        ORDER BY submitted_at DESC
        LIMIT 100
      `, { callersRights: true }),
      // Per-field correction rates (top 10 most-corrected fields)
      querySnowflake(`
        SELECT field_name, COUNT(*) AS correction_count,
               SUM(CASE WHEN override_status = 'APPROVED' THEN 1 ELSE 0 END) AS approved_count
        FROM ${DB}.ADMIN.extraction_overrides
        WHERE field_name != '__review_status__'
        GROUP BY field_name
        ORDER BY correction_count DESC
        LIMIT 10
      `, { callersRights: true }),
      // Per-LOB quality (avg confidence by line of business)
      querySnowflake(`
        SELECT dc.line_of_business AS lob,
               dc.document_type AS doc_type,
               COUNT(*) AS doc_count,
               ROUND(AVG(dc.classification_confidence), 3) AS avg_confidence
        FROM ${DB}.APP.v_document_catalog dc
        WHERE dc.line_of_business IS NOT NULL
        GROUP BY dc.line_of_business, dc.document_type
        ORDER BY dc.line_of_business, doc_count DESC
      `, { callersRights: true }),
    ])
    const m = (metrics[0] ?? {}) as Record<string, unknown>
    return Response.json({
      avgConfidence:    Number(m.AVG_CONFIDENCE    ?? m.avg_confidence    ?? 0),
      lowConfPct:       Number(m.LOW_CONF_PCT      ?? m.low_conf_pct      ?? 0),
      lowConfCount:     Number(m.LOW_CONF_COUNT    ?? m.low_conf_count    ?? 0),
      docCount:         Number(m.TOTAL_DOCS        ?? m.total_docs        ?? 0),
      docTypeCount:     Number(m.DOC_TYPE_COUNT    ?? m.doc_type_count    ?? 0),
      corrections,
      feedback,
      fieldAccuracy,
      lobAccuracy,
    })
  } catch (e) {
    console.error(new Date().toISOString(), "[quality] error", e)
    return serverError(e)
  }
}
