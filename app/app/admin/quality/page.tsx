"use client"

import { useState, useEffect } from "react"
import { CheckSquare, RefreshCw, ThumbsUp, ThumbsDown, CheckCircle, XCircle, BarChart3 } from "lucide-react"
import { PageHeader } from "@/components/page-header"
import { showToast } from "@/components/toast"
import { StatCard, StatGrid } from "@/components/stat-card"
import { DocFileLink, useDocumentPreview, DocLoadingIndicator } from "@/components/doc-download"
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts"

interface Correction {
  OVERRIDE_ID?: string; FILE_PATH?: string; FIELD_NAME?: string
  ORIGINAL_VALUE?: string; CORRECTED_VALUE?: string; SUBMITTED_BY?: string; SUBMITTED_AT?: string
}
interface FeedbackRow {
  FEEDBACK_ID?: string; FILE_PATH?: string; FEEDBACK_TYPE?: string
  QUERY_TEXT?: string; SUBMITTED_BY?: string; SUBMITTED_AT?: string
}
interface FieldAccRow {
  FIELD_NAME?: string; field_name?: string
  CORRECTION_COUNT?: number; correction_count?: number
  APPROVED_COUNT?: number; approved_count?: number
}
interface LobAccRow {
  LOB?: string; lob?: string
  DOC_TYPE?: string; doc_type?: string
  DOC_COUNT?: number; doc_count?: number
  AVG_CONFIDENCE?: number; avg_confidence?: number
}
interface QualityData {
  avgConfidence: number; lowConfPct: number
  lowConfCount: number; docCount: number; docTypeCount: number
  corrections: Correction[]; feedback: FeedbackRow[]
  fieldAccuracy: FieldAccRow[]; lobAccuracy: LobAccRow[]
}

export default function AdminQualityPage() {
  const { open: openDoc, loading: docLoading, ModalComponent: DocModal } = useDocumentPreview()
  const [data, setData]     = useState<QualityData | null>(null)
  const [loading, setLoading] = useState(true)
  const [actionMsg, setActionMsg] = useState("")
  const [pendingAction, setPendingAction] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    try {
      const res = await fetch("/api/quality")
      const d = await res.json()
      if (!res.ok) {
        showToast(d.error ?? "Failed to load quality data", "error")
      } else {
        setData(d as QualityData)
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Network error", "error")
    } finally {
      setLoading(false)
    }
  }

  async function actOnCorrection(overrideId: string, action: "approve_override" | "reject_override") {
    setPendingAction(overrideId)
    try {
      const res = await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, overrideId }),
      })
      const d = await res.json()
      if (!res.ok) {
        showToast(d.error ?? "Action failed", "error")
        return
      }
      setActionMsg(d.ok ? `Correction ${action === "approve_override" ? "approved" : "rejected"}` : d.error)
      setTimeout(() => setActionMsg(""), 3000)
      load()
    } catch {
      showToast("Network error — action could not be completed", "error")
    } finally {
      setPendingAction(null)
    }
  }

  useEffect(() => { load() }, [])

  const pctDecimal = (v: number) => `${(v * 100).toFixed(1)}%`  // for 0-1 values
  const pctDirect = (v: number) => `${v.toFixed(1)}%`            // for already-percentage values
  const fmtId = (id?: string) => String(id ?? "").slice(0, 8)

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      {DocModal}
      <DocLoadingIndicator loading={docLoading} />
      <PageHeader title="Quality & Feedback" icon={CheckSquare}>
        {actionMsg && <span className="text-xs px-2 py-1 bg-green-50 text-green-700 rounded-full">{actionMsg}</span>}
        <button className="sf-btn-secondary flex items-center gap-1.5" onClick={load}>
          <RefreshCw size={13} /> Refresh
        </button>
      </PageHeader>

      {/* Quality KPIs */}
      <StatGrid cols={4}>
        <StatCard label="Avg Confidence" value={loading ? "—" : pctDecimal(data?.avgConfidence ?? 0)} color="text-green-800" />
        <StatCard label="Low Conf Docs" value={loading ? "—" : String(data?.lowConfCount ?? 0)} color="text-amber-700" />
        <StatCard label="Low Conf %" value={loading ? "—" : pctDirect(data?.lowConfPct ?? 0)} color="text-amber-700" />
        <StatCard label="Document Types" value={loading ? "—" : String(data?.docTypeCount ?? 0)} color="text-blue-800" />
      </StatGrid>

      {/* Quality Charts */}
      {!loading && data && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Per-Field Correction Rate */}
          <div className="sf-card p-4">
            <h3 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-1.5">
              <BarChart3 size={14} style={{ color: "var(--brand-primary)" }} /> Corrections by Field
            </h3>
            {data.fieldAccuracy.length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-6">No correction data yet</p>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={data.fieldAccuracy.map(r => ({
                  field: String(r.FIELD_NAME ?? r.field_name ?? "").replace(/_/g, " "),
                  corrections: Number(r.CORRECTION_COUNT ?? r.correction_count ?? 0),
                  approved: Number(r.APPROVED_COUNT ?? r.approved_count ?? 0),
                }))} layout="vertical" margin={{ left: 80, right: 12, top: 4, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis type="number" tick={{ fontSize: 10 }} />
                  <YAxis type="category" dataKey="field" tick={{ fontSize: 10 }} width={76} />
                  <Tooltip contentStyle={{ fontSize: 11 }} />
                  <Bar dataKey="corrections" fill="#f59e0b" name="Total Corrections" radius={[0,3,3,0]} />
                  <Bar dataKey="approved" fill="#10b981" name="Approved" radius={[0,3,3,0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Per-LOB Confidence */}
          <div className="sf-card p-4">
            <h3 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-1.5">
              <BarChart3 size={14} style={{ color: "var(--brand-primary)" }} /> Avg Confidence by LOB
            </h3>
            {data.lobAccuracy.length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-6">No LOB data yet</p>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={(() => {
                  const lobMap = new Map<string, { lob: string; confidence: number; count: number }>()
                  data.lobAccuracy.forEach(r => {
                    const lob = String(r.LOB ?? r.lob ?? "Unknown")
                    const existing = lobMap.get(lob)
                    const conf = Number(r.AVG_CONFIDENCE ?? r.avg_confidence ?? 0)
                    const cnt = Number(r.DOC_COUNT ?? r.doc_count ?? 0)
                    if (existing) {
                      const totalCount = existing.count + cnt
                      existing.confidence = (existing.confidence * existing.count + conf * cnt) / totalCount
                      existing.count = totalCount
                    } else {
                      lobMap.set(lob, { lob, confidence: conf, count: cnt })
                    }
                  })
                  return Array.from(lobMap.values()).map(v => ({
                    ...v, confidence: Math.round(v.confidence * 100)
                  }))
                })()} margin={{ left: 8, right: 12, top: 4, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="lob" tick={{ fontSize: 10 }} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} unit="%" />
                  <Tooltip contentStyle={{ fontSize: 11 }} formatter={(v) => `${v}%`} />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  <Bar dataKey="confidence" fill="#29B5E8" name="Avg Confidence %" radius={[3,3,0,0]} />
                  <Bar dataKey="count" fill="#11567a" name="Doc Count" radius={[3,3,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      )}

      {/* Pending Corrections */}
      <div className="sf-card overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
          <h2 className="font-semibold text-slate-700 text-sm">
            Pending Corrections ({loading ? "…" : (data?.corrections.length ?? 0)})
          </h2>
        </div>
        {loading ? (
          <div className="p-8 text-center text-slate-400">Loading…</div>
        ) : !data?.corrections.length ? (
          <div className="p-8 text-center text-slate-400 text-sm">No pending corrections — all caught up!</div>
        ) : (
          <table className="w-full text-xs">
            <thead className="bg-slate-50/50 border-b border-slate-100">
              <tr>
                {["File","Field","Original","Corrected","Submitted By","Date","Actions"].map(h => (
                  <th key={h} className="text-left px-3 py-2 text-slate-500 font-semibold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.corrections.map((c, i) => {
                const id = String(c.OVERRIDE_ID ?? (c as Record<string,unknown>)["override_id"] ?? i)
                return (
                  <tr key={id} className="border-b border-slate-50 hover:bg-slate-50/50">
                    <td className="px-3 py-2 max-w-[120px] truncate">
                      <DocFileLink filePath={String(c.FILE_PATH ?? "")} displayName={String(c.FILE_PATH ?? "").split("/").pop() ?? ""} className="text-xs" onOpen={openDoc} />
                    </td>
                    <td className="px-3 py-2 font-semibold text-slate-700">{String(c.FIELD_NAME ?? (c as Record<string,unknown>)["field_name"] ?? "")}</td>
                    <td className="px-3 py-2 text-red-600 line-through">{String(c.ORIGINAL_VALUE ?? (c as Record<string,unknown>)["original_value"] ?? "")}</td>
                    <td className="px-3 py-2 text-green-700 font-medium">{String(c.CORRECTED_VALUE ?? (c as Record<string,unknown>)["corrected_value"] ?? "")}</td>
                    <td className="px-3 py-2 text-slate-500">{String(c.SUBMITTED_BY ?? (c as Record<string,unknown>)["submitted_by"] ?? "")}</td>
                    <td className="px-3 py-2 text-slate-400">
                      {String(c.SUBMITTED_AT ?? (c as Record<string,unknown>)["submitted_at"] ?? "").slice(0,10)}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex gap-1">
                        <button
                          className="p-1 rounded hover:bg-green-50 text-slate-400 hover:text-green-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                          title="Approve correction"
                          disabled={pendingAction === id}
                          onClick={() => actOnCorrection(id, "approve_override")}
                        ><CheckCircle size={14} /></button>
                        <button
                          className="p-1 rounded hover:bg-red-50 text-slate-400 hover:text-red-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                          title="Reject correction"
                          disabled={pendingAction === id}
                          onClick={() => actOnCorrection(id, "reject_override")}
                        ><XCircle size={14} /></button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Feedback Log */}
      <div className="sf-card overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 bg-slate-50">
          <h2 className="font-semibold text-slate-700 text-sm">
            Recent User Feedback ({loading ? "…" : (data?.feedback.length ?? 0)})
          </h2>
        </div>
        {loading ? (
          <div className="p-8 text-center text-slate-400">Loading…</div>
        ) : !data?.feedback.length ? (
          <div className="p-8 text-center text-slate-400 text-sm">No feedback submitted yet</div>
        ) : (
          <table className="w-full text-xs">
            <thead className="bg-slate-50/50 border-b border-slate-100">
              <tr>
                {["Type","File","Query","User","Date"].map(h => (
                  <th key={h} className="text-left px-3 py-2 text-slate-500 font-semibold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.feedback.map((f, i) => {
                const type = String(f.FEEDBACK_TYPE ?? (f as Record<string,unknown>)["feedback_type"] ?? "")
                return (
                  <tr key={i} className="border-b border-slate-50">
                    <td className="px-3 py-2">
                      {type === "thumbs_up"
                        ? <ThumbsUp size={13} className="text-green-600" />
                        : <ThumbsDown size={13} className="text-red-500" />}
                    </td>
                    <td className="px-3 py-2 max-w-[140px] truncate">
                      <DocFileLink filePath={String(f.FILE_PATH ?? "")} displayName={String(f.FILE_PATH ?? "").split("/").pop() ?? ""} className="text-xs" onOpen={openDoc} />
                    </td>
                    <td className="px-3 py-2 text-slate-500 max-w-[200px] truncate"
                        title={String(f.QUERY_TEXT ?? "")}>
                      {f.QUERY_TEXT != null ? String(f.QUERY_TEXT) : String((f as Record<string,unknown>)["query_text"] ?? "—")}
                    </td>
                    <td className="px-3 py-2 text-slate-500">{String(f.SUBMITTED_BY ?? (f as Record<string,unknown>)["submitted_by"] ?? "")}</td>
                    <td className="px-3 py-2 text-slate-400">
                      {String(f.SUBMITTED_AT ?? (f as Record<string,unknown>)["submitted_at"] ?? "").slice(0,10)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
