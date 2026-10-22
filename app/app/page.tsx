import { querySnowflake } from "@/lib/snowflake"
import { DB } from "@/lib/db"
import { FileText, AlertCircle, Search, MessageSquare, Lock, FolderOpen, Bookmark, ClipboardCheck } from "lucide-react"

import Link from "next/link"
import { OverviewAnalytics } from "@/components/overview-analytics"

export const dynamic = "force-dynamic"

async function getStats(): Promise<{ data: Record<string, number>; error: boolean }> {
  try {
    const rows = await querySnowflake(`
      WITH latest AS (
        SELECT *,
          ROW_NUMBER() OVER (PARTITION BY file_path ORDER BY processing_version DESC) AS rn
        FROM ${DB}.DATA.ingestion_registry
      )
      SELECT
        COUNT(*) AS total_docs,
        SUM(CASE WHEN ingestion_status = 'PENDING'    THEN 1 ELSE 0 END) AS pending,
        SUM(CASE WHEN ingestion_status = 'FAILED'     THEN 1 ELSE 0 END) AS failed,
        SUM(CASE WHEN ingestion_status = 'COMPLETE'   THEN 1 ELSE 0 END) AS complete
      FROM latest WHERE rn = 1
    `, { callersRights: true })
    return { data: (rows[0] ?? { TOTAL_DOCS: 0, PENDING: 0, FAILED: 0, COMPLETE: 0 }) as Record<string, number>, error: false }
  } catch {
    return { data: { TOTAL_DOCS: 0, PENDING: 0, FAILED: 0, COMPLETE: 0 }, error: true }
  }
}

async function getRecentDocs(): Promise<{ data: Record<string, string>[]; error: boolean }> {
  try {
    const rows = await querySnowflake(`
      SELECT document_type, party_name, source_folder, file_format,
             processing_completed_at
      FROM ${DB}.APP.v_document_catalog
      ORDER BY processing_completed_at DESC NULLS LAST
      LIMIT 8
    `, { callersRights: true })
    return { data: rows as Record<string, string>[], error: false }
  } catch {
    return { data: [], error: true }
  }
}

const FALLBACK_QUESTIONS = [
  "What document types are in the system?",
  "How many documents have been processed this month?",
  "Show me documents that require action",
  "Which documents expire in the next 60 days?",
]

export default async function HomePage() {
  let hasAccess = false
  try {
    const rows = await querySnowflake(
      `SELECT GREATEST(
         IS_ROLE_IN_SESSION('DOC_INTEL_USER')::INT,
         IS_ROLE_IN_SESSION('DOC_INTEL_ADMIN')::INT
       ) AS has_access`,
      { callersRights: true }
    )
    const r = rows[0] as Record<string, unknown>
    hasAccess = r.HAS_ACCESS === 1 || r.has_access === 1 ||
                r.HAS_ACCESS === true || r.has_access === true
  } catch { /* silently deny on error — fail closed */ }

  if (!hasAccess) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="sf-card p-10 text-center max-w-md">
          <div className="w-12 h-12 rounded-xl bg-slate-100 flex items-center justify-center mx-auto mb-4">
            <Lock size={22} className="text-slate-400" />
          </div>
          <h2 className="font-semibold text-slate-800 mb-2">Access Required</h2>
          <p className="text-sm text-slate-500">
            You do not have access to this application. Contact your Snowflake
            administrator to be granted the <code className="bg-slate-100 px-1 rounded">DOC_INTEL_USER</code> role.
          </p>
        </div>
      </div>
    )
  }

  const [statsResult, recentResult] = await Promise.all([getStats(), getRecentDocs()])
  const stats = statsResult.data
  const recentDocs = recentResult.data
  const dataError = statsResult.error || recentResult.error
  const totalDocs = (stats.TOTAL_DOCS ?? stats.total_docs ?? 0) as number

  let quickQuestions = FALLBACK_QUESTIONS
  try {
    const sugRows = await querySnowflake(`
      SELECT s.label, s.query
      FROM ${DB}.ADMIN.suggested_searches s
      WHERE s.is_active = TRUE
        AND (
          s.lob_code = '*'
          OR s.lob_code IN (
            SELECT f.value::VARCHAR
            FROM ${DB}.ADMIN.user_role_assignments a
            JOIN ${DB}.ADMIN.entitlement_roles r ON a.role_id = r.role_id AND r.is_active = TRUE
            , LATERAL FLATTEN(input => r.lob_access) f
            WHERE UPPER(a.user_name) = CURRENT_USER()
          )
          OR EXISTS (
            SELECT 1 FROM ${DB}.ADMIN.user_role_assignments a2
            JOIN ${DB}.ADMIN.entitlement_roles r2 ON a2.role_id = r2.role_id AND r2.is_active = TRUE
            , LATERAL FLATTEN(input => r2.lob_access) f2
            WHERE UPPER(a2.user_name) = CURRENT_USER() AND f2.value::VARCHAR = '*'
          )
        )
      ORDER BY s.lob_code, s.sort_order LIMIT 6
    `, { callersRights: true })
    if (sugRows.length > 0) {
      quickQuestions = sugRows.map(r => String((r as Record<string, unknown>).QUERY ?? (r as Record<string, unknown>).query ?? ""))
    }
  } catch { /* fall back to defaults */ }

  let isAdmin = false
  try {
    const adminCheck = await querySnowflake(
      `SELECT IS_ROLE_IN_SESSION('DOC_INTEL_ADMIN') AS is_admin`,
      { callersRights: true }
    )
    const ac = adminCheck[0] as Record<string, unknown>
    isAdmin = ac.IS_ADMIN === true || ac.is_admin === true || ac.IS_ADMIN === "true"
  } catch { /* non-critical */ }




  const folderColor: Record<string, string> = {}

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* First-run onboarding banner */}
      {isAdmin && totalDocs === 0 && (
        <div className="sf-card p-4 border-2 border-amber-200 bg-amber-50">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center shrink-0 mt-0.5">
              <span className="text-lg">🚀</span>
            </div>
            <div>
              <h3 className="font-semibold text-amber-900 text-sm mb-1">Getting Started</h3>
              <p className="text-xs text-amber-800 mb-2">
                No documents have been indexed yet. Upload documents to a stage and run the pipeline to get started.
              </p>
              <div className="flex gap-2">
                <Link href="/admin/pipeline" className="text-[11px] font-medium text-amber-700 bg-amber-100 px-2.5 py-1 rounded-md hover:bg-amber-200">
                  Go to Pipeline Management
                </Link>
                <Link href="/admin/users" className="text-[11px] font-medium text-amber-700 bg-amber-100 px-2.5 py-1 rounded-md hover:bg-amber-200">
                  Configure User Access
                </Link>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Data connectivity warning */}
      {dataError && (
        <div className="sf-card p-3 border border-red-200 bg-red-50 flex items-center gap-2">
          <AlertCircle size={16} className="text-red-500 shrink-0" />
          <span className="text-xs text-red-700">Unable to load some dashboard data. Metrics shown may be incomplete.</span>
        </div>
      )}

      {/* Hero */}
      <div className="rounded-2xl p-6 text-white" style={{ background: "linear-gradient(135deg, var(--brand-bg), var(--brand-dark))" }}>
        <h1 className="text-2xl font-bold mb-1">Document Intelligence</h1>
        <p className="text-blue-200 text-sm mb-4">Search, classify, and question your documents · Powered by Snowflake Cortex AI</p>
        <div className="flex gap-3 flex-wrap">
          <Link href="/documents" className="sf-btn-primary flex items-center gap-2">
            <FolderOpen size={15} /> Browse
          </Link>
          <Link href="/search" className="sf-btn-secondary flex items-center gap-2 !bg-white/10 !text-white hover:!bg-white/20 !border-white/20">
            <Search size={15} /> Search
          </Link>
          <Link href="/chat" className="sf-btn-secondary flex items-center gap-2 !bg-white/10 !text-white hover:!bg-white/20 !border-white/20">
            <MessageSquare size={15} /> Doc Intelligence
          </Link>
          <Link href="/saved" className="sf-btn-secondary flex items-center gap-2 !bg-white/10 !text-white hover:!bg-white/20 !border-white/20">
            <Bookmark size={15} /> Saved Items
          </Link>
          <Link href="/review" className="sf-btn-secondary flex items-center gap-2 !bg-white/10 !text-white hover:!bg-white/20 !border-white/20">
            <ClipboardCheck size={15} /> Review Queue
          </Link>
        </div>
      </div>

      {/* Portfolio Analytics */}
      <OverviewAnalytics />



      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Quick questions */}
        <div className="sf-card p-5">
          <h2 className="font-semibold text-slate-700 mb-3 flex items-center gap-2">
            <MessageSquare size={16} style={{ color: "var(--brand-primary)" }} /> Quick Questions
          </h2>
          <div className="space-y-2">
            {quickQuestions.map((q) => (
              <Link
                key={q}
                href={`/chat?q=${encodeURIComponent(q)}`}
                className="block text-sm text-slate-600 px-3 py-2 rounded-lg transition-colors border border-slate-200 hover:border-[var(--brand-border)] hover:bg-[var(--brand-pale)] hover:text-[var(--brand-dark)]"
              >
                💬 {q}
              </Link>
            ))}
          </div>
        </div>

        {/* Recent documents */}
        <div className="sf-card p-5">
          <h2 className="font-semibold text-slate-700 mb-3 flex items-center gap-2">
            <FileText size={16} style={{ color: "var(--brand-primary)" }} /> Recently Indexed
          </h2>
          {recentDocs.length === 0 ? (
            <div className="text-center py-6">
              <FileText size={32} className="text-slate-200 mx-auto mb-2" />
              <p className="text-sm text-slate-400">No documents indexed yet</p>
              <p className="text-xs text-slate-400 mt-1">Upload documents to get started</p>
            </div>
          ) : (
            <div className="space-y-2">
              {(recentDocs as Record<string, string>[]).map((doc, i) => (
                <div key={i} className="flex items-center gap-2 text-sm py-1.5 border-b border-slate-50 last:border-0">
                  <span className={folderColor[doc.SOURCE_FOLDER] ?? "sf-badge bg-slate-100 text-slate-600"}>
                    {doc.SOURCE_FOLDER}
                  </span>
                  <span className="flex-1 truncate text-slate-700">{doc.DOCUMENT_TYPE}</span>
                  <span className="text-xs text-slate-400 shrink-0">{doc.FILE_FORMAT}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

    </div>
  )
}
