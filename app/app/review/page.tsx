"use client"

import { useEffect, useState, useCallback, useRef } from "react"
import { RefreshCw, CheckCircle, SkipForward, ArrowRight, Shield, ChevronDown, Search } from "lucide-react"
import { showToast } from "@/components/toast"
import { encodeDocId } from "@/lib/doc-utils"
import { Spinner } from "@/components/spinner"
import { useRole } from "@/hooks/use-role"
import { PageHeader } from "@/components/page-header"
import { TabBar } from "@/components/tab-bar"
import { Pagination } from "@/components/pagination"
import { ConfidenceBadge } from "@/components/confidence-badge"
import { EmptyState } from "@/components/empty-state"
import { FilterSelect } from "@/components/filter-select"
import Link from "next/link"
import { FIELD_LABELS } from "@/lib/field-labels"

type ReviewStatus = "pending" | "approved" | "skipped" | "all"

interface ReviewDoc {
  FILE_PATH?: string; file_path?: string
  FILE_NAME?: string; file_name?: string
  PRIMARY_DOCUMENT_TYPE?: string; primary_document_type?: string
  CONFIDENCE_SCORE?: number; confidence_score?: number
  LINE_OF_BUSINESS?: string; line_of_business?: string
  PARTY_NAME?: string; party_name?: string
  REFERENCE_NUMBER?: string; reference_number?: string
  CASE_NUMBER?: string; case_number?: string
  ISSUER_NAME?: string; issuer_name?: string
  SOURCE_FOLDER?: string; source_folder?: string
  REVIEW_STATUS?: string; review_status?: string
  REVIEWED_BY?: string; reviewed_by?: string
  REVIEW_REASON?: string; review_reason?: string
  ALL_DOCUMENT_TYPES?: string | string[]; all_document_types?: string | string[]
}

function gv<T>(row: Record<string, unknown>, upper: string, lower: string, fallback: T): T {
  const v = row[upper] ?? row[lower]
  return (v !== undefined && v !== null ? v : fallback) as T
}



export default function ReviewQueuePage() {
  const { entitlements } = useRole()
  const [docs, setDocs] = useState<ReviewDoc[]>([])
  const [total, setTotal] = useState(0)
  const [counts, setCounts] = useState({ pending: 0, approved: 0, skipped: 0 })
  const [status, setStatus] = useState<ReviewStatus>("pending")
  const [loading, setLoading] = useState(true)
  const [offset, setOffset] = useState(0)
  const [actioning, setActioning] = useState<string | null>(null)
  const [correctingFile, setCorrectingFile] = useState<string | null>(null)
  const [fLob, setFLob] = useState("")
  const [fDocType, setFDocType] = useState("")
  const [fSearch, setFSearch] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [lobOpts, setLobOpts] = useState<string[]>([])
  const [docTypeOpts, setDocTypeOpts] = useState<string[]>([])
  const correctRef = useRef<HTMLDivElement>(null)
  const LIMIT = 20

  const loadCounts = useCallback(async () => {
    try {
      const res = await fetch("/api/review?action=count")
      const data = await res.json()
      setCounts(data)
    } catch { /* non-critical */ }
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ status, limit: String(LIMIT), offset: String(offset) })
      if (fLob) params.set("lob", fLob)
      if (fDocType) params.set("docType", fDocType)
      if (debouncedSearch) params.set("search", debouncedSearch)
      const res = await fetch(`/api/review?${params}`)
      const data = await res.json()
      setDocs(data.rows ?? [])
      setTotal(data.total ?? 0)
    } catch { showToast("Failed to load review queue", "error") }
    finally { setLoading(false) }
  }, [status, offset, fLob, fDocType, debouncedSearch])

  useEffect(() => { loadCounts() }, [loadCounts])
  useEffect(() => { setOffset(0) }, [status, fLob, fDocType, debouncedSearch])
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(fSearch), 400)
    return () => clearTimeout(t)
  }, [fSearch])
  useEffect(() => { load() }, [load])

  // Load filter options from the filters API
  useEffect(() => {
    fetch("/api/filters").then(r => r.json()).then(d => {
      setLobOpts(d.lobs ?? [])
      setDocTypeOpts(d.docTypes ?? [])
    }).catch(() => {})
  }, [])

  // Close correction dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (correctRef.current && !correctRef.current.contains(e.target as Node)) {
        setCorrectingFile(null)
      }
    }
    document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [])

  async function handleCorrect(filePath: string, correctedType: string) {
    setActioning(filePath)
    try {
      const res = await fetch("/api/corrections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filePath,
          fieldName: "document_type",
          originalValue: docs.find(d => gv(d as Record<string, unknown>, "FILE_PATH", "file_path", "") === filePath)
            ? gv(docs.find(d => gv(d as Record<string, unknown>, "FILE_PATH", "file_path", "") === filePath) as Record<string, unknown>, "PRIMARY_DOCUMENT_TYPE", "primary_document_type", "")
            : "",
          correctedValue: correctedType,
        }),
      })
      if (!res.ok) { showToast("Correction failed", "error"); return }
      showToast(`Corrected to: ${correctedType}`, "success")
      setCorrectingFile(null)
      // Mark as reviewed
      await fetch("/api/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filePath, action: "approve" }),
      })
      setDocs(prev => prev.filter(d => gv(d as Record<string, unknown>, "FILE_PATH", "file_path", "") !== filePath))
      setTotal(prev => Math.max(0, prev - 1))
      setCounts(prev => ({ ...prev, pending: Math.max(0, prev.pending - 1), approved: prev.approved + 1 }))
    } catch { showToast("Network error", "error") }
    finally { setActioning(null) }
  }

  async function handleAction(filePath: string, action: "approve" | "skip") {
    setActioning(filePath)
    try {
      const res = await fetch("/api/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filePath, action }),
      })
      if (!res.ok) { showToast("Action failed", "error"); return }
      showToast(action === "approve" ? "Classification approved" : "Document skipped", "success")
      setDocs(prev => prev.filter(d => gv(d as Record<string, unknown>, "FILE_PATH", "file_path", "") !== filePath))
      setTotal(prev => Math.max(0, prev - 1))
      setCounts(prev => ({
        ...prev,
        pending: Math.max(0, prev.pending - 1),
        [action === "approve" ? "approved" : "skipped"]: prev[action === "approve" ? "approved" : "skipped"] + 1,
      }))
    } catch { showToast("Network error", "error") }
    finally { setActioning(null) }
  }

  const lobScope = entitlements?.lobAccess.includes("*")
    ? "All LOBs"
    : (entitlements?.lobAccess ?? []).join(", ")

  const docScope = entitlements?.docTypeAccess.includes("*")
    ? "All document types"
    : (entitlements?.docTypeAccess ?? []).slice(0, 3).join(", ") + ((entitlements?.docTypeAccess.length ?? 0) > 3 ? "…" : "")

  const TABS: { id: ReviewStatus; label: string; count?: number }[] = [
    { id: "pending", label: "Pending", count: counts.pending },
    { id: "approved", label: "Approved", count: counts.approved },
    { id: "skipped", label: "Skipped", count: counts.skipped },
    { id: "all", label: "All" },
  ]

  return (
    <div className="max-w-5xl mx-auto">
      {/* Header */}
      <PageHeader title="Review Queue" icon={Shield} subtitle={`Scope: ${lobScope} · ${docScope}`}>
        <button onClick={() => { load(); loadCounts() }} disabled={loading} className="sf-btn-secondary text-xs flex items-center gap-1.5 disabled:opacity-50">
          {loading ? <Spinner size={12} /> : <RefreshCw size={12} />} Refresh
        </button>
      </PageHeader>

      {/* Progress bar */}
      {(counts.pending + counts.approved + counts.skipped) > 0 && (
        <div className="sf-card p-4 mb-4 mt-4">
          <div className="flex items-center justify-between text-xs text-slate-600 mb-2">
            <span>{counts.pending} pending · {counts.approved} approved · {counts.skipped} skipped</span>
            <span className="font-medium text-green-600">
              {Math.round(((counts.approved + counts.skipped) / (counts.pending + counts.approved + counts.skipped)) * 100)}% complete
            </span>
          </div>
          <div className="h-2 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden flex">
            {counts.approved > 0 && (
              <div className="h-full bg-green-500 transition-all" style={{ width: `${(counts.approved / (counts.pending + counts.approved + counts.skipped)) * 100}%` }} />
            )}
            {counts.skipped > 0 && (
              <div className="h-full bg-slate-400 transition-all" style={{ width: `${(counts.skipped / (counts.pending + counts.approved + counts.skipped)) * 100}%` }} />
            )}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="sf-card p-3 mb-4 flex flex-wrap gap-2 items-center">
        <FilterSelect value={fLob} onChange={setFLob} options={lobOpts} allLabel="All LOBs" />
        <FilterSelect value={fDocType} onChange={setFDocType} options={docTypeOpts} allLabel="All Classifications" />
        <div className="relative flex-1 min-w-[180px]">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search party, reference #, case #..."
            className="w-full text-sm border border-slate-200 rounded-lg pl-8 pr-3 py-1.5 text-slate-600 placeholder:text-slate-400"
            value={fSearch}
            onChange={e => setFSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Status tabs */}
      <TabBar tabs={TABS} active={status} onChange={id => setStatus(id as ReviewStatus)} />

      {/* Cards */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="sf-card p-4 animate-pulse">
              <div className="h-4 bg-slate-200 rounded w-48 mb-3" />
              <div className="h-3 bg-slate-100 rounded w-full mb-2" />
              <div className="h-3 bg-slate-100 rounded w-2/3" />
            </div>
          ))}
        </div>
      ) : docs.length === 0 ? (
        <EmptyState
          icon={CheckCircle}
          message={status === "pending" ? "No documents pending review" : `No ${status} documents`}
          sub={status === "pending" ? `Within your assigned lines of business (${lobScope})` : "Try another status filter above"}
        />
      ) : (
        <div className="space-y-3">
          {docs.map((doc, i) => {
            const r = doc as Record<string, unknown>
            const fp = gv(r, "FILE_PATH", "file_path", "")
            const fn = (fp as string).split("/").pop() ?? (fp as string)
            const docType = gv(r, "PRIMARY_DOCUMENT_TYPE", "primary_document_type", "")
            const confidence = Number(gv(r, "CONFIDENCE_SCORE", "confidence_score", 0))
            const lob = gv(r, "LINE_OF_BUSINESS", "line_of_business", "")
            const folder = gv(r, "SOURCE_FOLDER", "source_folder", "")
            const party = gv(r, "PARTY_NAME", "party_name", "")
            const refNo = gv(r, "REFERENCE_NUMBER", "reference_number", "")
            const caseNo = gv(r, "CASE_NUMBER", "case_number", "")
            const reviewStatus = gv(r, "REVIEW_STATUS", "review_status", null)
            const reviewReason = gv(r, "REVIEW_REASON", "review_reason", "") as string
            const allTypes = gv(r, "ALL_DOCUMENT_TYPES", "all_document_types", "") as string | string[]
            const competingTypes = (Array.isArray(allTypes) ? allTypes : String(allTypes).split(",").map(s => s.trim())).filter(t => t && t !== docType)
            const isActioning = actioning === fp

            return (
              <div key={i} className={`sf-card p-4 ${reviewStatus === "APPROVED" ? "border-green-200" : reviewStatus === "SKIPPED" ? "opacity-60" : ""}`}>
                <div className="flex items-start gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <p className="text-sm font-semibold text-slate-800 truncate max-w-xs">{fn as string}</p>
                      {docType && <span className="text-[10px] font-semibold bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">{docType as string}</span>}
                      {lob && <span className="text-[10px] font-medium bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">{lob as string}</span>}
                      {folder && <span className="text-[10px] text-slate-400">{folder as string}</span>}
                    </div>
                    <ConfidenceBadge score={confidence} variant="bar" />
                    {reviewReason && (
                      <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-100 rounded-md px-2.5 py-1.5 mt-2">
                        <span className="font-semibold">Review reason:</span> {reviewReason}
                      </p>
                    )}
                    {competingTypes.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        <span className="text-[10px] text-slate-400">Also considered:</span>
                        {competingTypes.map(t => (
                          <span key={t} className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">{t}</span>
                        ))}
                      </div>
                    )}
                    <div className="flex gap-4 mt-2 text-xs text-slate-500">
                      {party && <span>{FIELD_LABELS.party_name}: <span className="font-medium text-slate-700">{party as string}</span></span>}
                      {refNo && <span>{FIELD_LABELS.reference_number}: <span className="font-medium text-slate-700">{refNo as string}</span></span>}
                      {caseNo && <span>{FIELD_LABELS.case_number}: <span className="font-medium text-slate-700">{caseNo as string}</span></span>}
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {reviewStatus === "APPROVED" ? (
                      <span className="text-[10px] font-semibold text-green-600 bg-green-50 px-2.5 py-1.5 rounded-lg">Approved</span>
                    ) : reviewStatus === "SKIPPED" ? (
                      <span className="text-[10px] font-semibold text-slate-500 bg-slate-100 px-2.5 py-1.5 rounded-lg">Skipped</span>
                    ) : (
                      <>
                        <button
                          onClick={() => handleAction(fp as string, "approve")}
                          disabled={isActioning}
                          className="flex items-center gap-1 text-[10px] font-semibold text-green-700 bg-green-50 hover:bg-green-100 px-2.5 py-1.5 rounded-lg transition-colors border border-green-200"
                        >
                          <CheckCircle size={11} /> Approve
                        </button>
                        <button
                          onClick={() => handleAction(fp as string, "skip")}
                          disabled={isActioning}
                          className="flex items-center gap-1 text-[10px] font-medium text-slate-600 bg-slate-50 hover:bg-slate-100 px-2.5 py-1.5 rounded-lg transition-colors border border-slate-200"
                        >
                          <SkipForward size={11} /> Skip
                        </button>
                        <div className="relative" ref={correctingFile === fp ? correctRef : undefined}>
                          <button
                            onClick={() => setCorrectingFile(correctingFile === fp ? null : fp as string)}
                            disabled={isActioning}
                            className="flex items-center gap-1 text-[10px] font-medium text-amber-700 bg-amber-50 hover:bg-amber-100 px-2.5 py-1.5 rounded-lg transition-colors border border-amber-200"
                          >
                            <ArrowRight size={11} /> Correct <ChevronDown size={9} />
                          </button>
                          {correctingFile === fp && (
                            <div className="absolute right-0 top-full mt-1 z-20 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-lg shadow-lg p-1.5 min-w-[200px]">
                              <p className="text-[9px] text-slate-400 font-medium uppercase tracking-wide px-2 py-1">Select correct type:</p>
                              {competingTypes.map(t => (
                                <button
                                  key={t}
                                  onClick={() => handleCorrect(fp as string, t)}
                                  className="w-full text-left text-[11px] text-slate-700 hover:bg-blue-50 hover:text-blue-700 px-2 py-1.5 rounded transition-colors"
                                >
                                  {t}
                                </button>
                              ))}
                              {competingTypes.length === 0 && (
                                <p className="text-[10px] text-slate-400 px-2 py-1">No alternatives from classifier. Use detail page to manually set the correct type.</p>
                              )}
                              <div className="border-t border-slate-100 mt-1 pt-1">
                                <Link
                                  href={`/documents/detail?id=${encodeDocId(fp as string)}&from=review`}
                                  className="block text-[10px] text-slate-500 hover:text-slate-700 px-2 py-1.5 rounded"
                                >
                                  Open detail for manual correction…
                                </Link>
                              </div>
                            </div>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Pagination */}
      <div className="mt-4">
        <Pagination offset={offset} limit={LIMIT} total={total} onChange={setOffset} noun="documents" />
      </div>
    </div>
  )
}
