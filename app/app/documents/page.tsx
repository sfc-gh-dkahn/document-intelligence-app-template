"use client"

import { useEffect, useState, useCallback } from "react"
import { useSearchParams } from "next/navigation"
import { FileText, RefreshCw, Download } from "lucide-react"
import { showToast } from "@/components/toast"
import { Spinner } from "@/components/spinner"
import { useDocumentPreview, DocLoadingIndicator } from "@/components/doc-download"
import { PageHeader } from "@/components/page-header"
import { Pagination } from "@/components/pagination"
import { ConfidenceBadge } from "@/components/confidence-badge"
import { FilterSelect } from "@/components/filter-select"
import { lobBadgeClass, statusBadgeClass } from "@/components/badge-utils"
import Link from "next/link"
import { FIELD_LABELS } from "@/lib/field-labels"

function encodeDocId(filePath: string): string {
  return btoa(filePath).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

interface Doc {
  FILE_PATH?: string; SRC_FILE_ID?: string; SOURCE_FOLDER?: string
  DOCUMENT_TYPE?: string; PARTY_NAME?: string; ISSUER_NAME?: string
  LINE_OF_BUSINESS?: string; DOC_SUBTYPE?: string; FILE_FORMAT?: string
  DOC_STATUS?: string; CLASSIFICATION_CONFIDENCE?: number; NEEDS_REVIEW?: boolean
  START_DATE?: string; END_DATE?: string; REFERENCE_NUMBER?: string; CASE_NUMBER?: string; SRC_REFERENCE_NUMBER?: string
  SRC_CASE_NUMBER?: string; PAGE_COUNT?: number; PROCESSING_COMPLETED_AT?: string
  DOC_SUMMARY?: string; PII_DETECTED?: boolean
}



export default function DocumentsPage() {
  const searchParams = useSearchParams()
  const { open: openDoc, loading: docLoading, ModalComponent: DocModal } = useDocumentPreview()
  const [docs, setDocs]           = useState<Doc[]>([])
  const [total, setTotal]         = useState(0)
  const [offset, setOffset]       = useState(0)
  const LIMIT = 50
  const [loading, setLoading]     = useState(true)
  const [selected, setSelected]   = useState<Doc | null>(null)
  const [fDocType, setFDocType]   = useState(searchParams.get("docType") ?? "")
  const [fLob, setFLob]           = useState(searchParams.get("lob") ?? "")
  const [fStatus, setFStatus]     = useState(searchParams.get("status") ?? "")
  const [fSearch, setFSearch]     = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [fReview, setFReview]     = useState(false)
  const [correction, setCorr]     = useState<{ field: string; value: string } | null>(null)
  const [docTypeOpts, setDocTypeOpts] = useState<string[]>([])
  const [lobOpts, setLobOpts]     = useState<string[]>([])
  const [statusOpts, setStatusOpts] = useState<string[]>([])
  const [checkedPaths, setCheckedPaths] = useState<Set<string>>(new Set())
  const [batchAction, setBatchAction] = useState("")
  const [batchProcessing, setBatchProcessing] = useState(false)
  // Load dynamic filter options from actual data
  useEffect(() => {
    fetch("/api/filters")
      .then(r => r.json())
      .then((d: { docTypes?: string[]; lobs?: string[]; statuses?: string[] }) => {
        if (d.docTypes?.length) setDocTypeOpts(d.docTypes)
        if (d.lobs?.length) setLobOpts(d.lobs)
        if (d.statuses?.length) setStatusOpts(d.statuses)
      })
      .catch(() => {})
  }, [])

  // Debounce text search (500ms)
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(fSearch), 500)
    return () => clearTimeout(t)
  }, [fSearch])

  const loadDocs = useCallback(async () => {
    setLoading(true)
    const p = new URLSearchParams({ limit: String(LIMIT), offset: String(offset) })
    if (fDocType) p.set("docType", fDocType)
    if (fLob)     p.set("lob", fLob)
    if (fStatus)  p.set("status", fStatus)
    if (debouncedSearch) p.set("search", debouncedSearch)
    if (fReview)  p.set("review", "true")
    try {
      const res = await fetch(`/api/documents?${p}`)
      const data = await res.json()
      if (!res.ok) {
        showToast(data.error ?? "Failed to load documents", "error")
      } else if (data.rows) {
        setDocs(data.rows)
        setTotal(data.total ?? 0)
      } else if (Array.isArray(data)) {
        setDocs(data)
        setTotal(data.length)
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Network error", "error")
    } finally {
      setLoading(false)
    }
  }, [fDocType, fLob, fStatus, debouncedSearch, fReview, offset, LIMIT])

  useEffect(() => { loadDocs() }, [loadDocs])

  // Reset to page 1 when filters change
  useEffect(() => { setOffset(0) }, [fDocType, fLob, fStatus, debouncedSearch, fReview])



  return (
    <div className="max-w-7xl mx-auto">
      {DocModal}
      <DocLoadingIndicator loading={docLoading} />
      <PageHeader title="Document Browser" icon={FileText}>
        <button className="sf-btn-secondary flex items-center gap-1.5" onClick={() => {
          const params = new URLSearchParams({ format: "csv" })
          if (fDocType) params.set("doc_type", fDocType)
          if (fLob) params.set("lob", fLob)
          if (fStatus) params.set("status", fStatus)
          window.open(`/api/documents/export?${params.toString()}`, "_blank")
        }}>
          <Download size={13} /> Export CSV
        </button>
        <button className="sf-btn-secondary flex items-center gap-1.5" onClick={loadDocs} disabled={loading}>
          {loading ? <Spinner size={13} /> : <RefreshCw size={13} />} Refresh
        </button>
      </PageHeader>

      {/* Filters */}
      <div className="sf-card p-3 mb-4 flex flex-wrap gap-2 items-center">
        <FilterSelect value={fDocType} onChange={setFDocType} options={docTypeOpts} allLabel="All Document Types" />
        <FilterSelect value={fLob} onChange={setFLob} options={lobOpts} allLabel="All LOBs" />
        <FilterSelect value={fStatus} onChange={setFStatus} options={statusOpts} allLabel="All Statuses" />
        <input
          type="text"
          placeholder="Search party, issuer, reference #, content..."
          className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 text-slate-600 w-64 placeholder:text-slate-400"
          value={fSearch}
          onChange={e => setFSearch(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") loadDocs() }}
        />
        <label className="flex items-center gap-1.5 text-sm text-slate-600 cursor-pointer">
          <input type="checkbox" checked={fReview} onChange={e => setFReview(e.target.checked)} className="rounded" />
          Needs Review Only
        </label>
        <span className="text-xs text-slate-400 ml-auto">
          {loading ? <><Spinner size={12} className="inline" /> Loading…</> : `${total.toLocaleString()} documents`}
        </span>
      </div>

      <div className="flex gap-4">
        {/* Table */}
        <div className={`flex-1 sf-card overflow-hidden ${selected ? "max-w-[55%]" : ""}`}>
          {loading ? (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="px-2 py-2.5 w-8"><div className="h-3 w-3 bg-slate-200 rounded" /></th>
                    {["Type",FIELD_LABELS.party_name,"LOB","Format","Status","Conf",FIELD_LABELS.start_date,FIELD_LABELS.end_date,FIELD_LABELS.reference_number].map(h => (
                      <th key={h} className="text-left px-3 py-2.5 text-slate-500 font-semibold whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i} className="border-b border-slate-50 animate-pulse">
                      <td className="px-2 py-2.5"><div className="h-3 w-3 bg-slate-200 rounded" /></td>
                      <td className="px-3 py-2.5"><div className="h-3 bg-slate-200 rounded w-24" /></td>
                      <td className="px-3 py-2.5"><div className="h-3 bg-slate-200 rounded w-28" /></td>
                      <td className="px-3 py-2.5"><div className="h-3 bg-slate-200 rounded w-14" /></td>
                      <td className="px-3 py-2.5"><div className="h-3 bg-slate-200 rounded w-10" /></td>
                      <td className="px-3 py-2.5"><div className="h-3 bg-slate-200 rounded w-12" /></td>
                      <td className="px-3 py-2.5"><div className="h-3 bg-slate-200 rounded w-8" /></td>
                      <td className="px-3 py-2.5"><div className="h-3 bg-slate-200 rounded w-16" /></td>
                      <td className="px-3 py-2.5"><div className="h-3 bg-slate-200 rounded w-16" /></td>
                      <td className="px-3 py-2.5"><div className="h-3 bg-slate-200 rounded w-20" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="px-2 py-2.5 w-8">
                      <input type="checkbox" className="rounded border-slate-300"
                        checked={docs.length > 0 && docs.every(d => checkedPaths.has(d.FILE_PATH ?? ""))}
                        onChange={e => {
                          if (e.target.checked) setCheckedPaths(new Set(docs.map(d => d.FILE_PATH ?? "")))
                          else setCheckedPaths(new Set())
                        }} />
                    </th>
                    {["Type",FIELD_LABELS.party_name,"LOB","Format","Status","Conf",FIELD_LABELS.start_date,FIELD_LABELS.end_date,FIELD_LABELS.reference_number].map(h => (
                      <th key={h} className="text-left px-3 py-2.5 text-slate-500 font-semibold whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {docs.map((doc, i) => (
                    <tr
                      key={doc.FILE_PATH ?? doc.SRC_FILE_ID ?? i}
                      className={`border-b border-slate-50 cursor-pointer hover:bg-[var(--brand-pale)] transition-colors ${selected?.FILE_PATH === doc.FILE_PATH ? "bg-[var(--brand-light)]" : ""} ${doc.NEEDS_REVIEW ? "bg-amber-50/40" : ""}`}
                      onClick={() => setSelected(doc.FILE_PATH === selected?.FILE_PATH ? null : doc)}
                    >
                      <td className="px-2 py-2" onClick={e => e.stopPropagation()}>
                        <input type="checkbox" className="rounded border-slate-300"
                          checked={checkedPaths.has(doc.FILE_PATH ?? "")}
                          onChange={e => {
                            const next = new Set(checkedPaths)
                            if (e.target.checked) next.add(doc.FILE_PATH ?? "")
                            else next.delete(doc.FILE_PATH ?? "")
                            setCheckedPaths(next)
                          }} />
                      </td>
                      <td className="px-3 py-2 font-medium text-slate-700 max-w-[140px] truncate">
                          <Link
                            href={`/documents/detail?id=${encodeDocId(doc.FILE_PATH ?? "")}`}
                            className="text-[var(--brand-primary)] hover:brightness-125 hover:underline"
                            onClick={e => e.stopPropagation()}
                          >
                            {doc.DOCUMENT_TYPE}
                          </Link>
                      </td>
                      <td className="px-3 py-2 text-slate-600 max-w-[120px] truncate">{doc.PARTY_NAME ?? "—"}</td>
                      <td className="px-3 py-2">
                        <span className={lobBadgeClass(doc.LINE_OF_BUSINESS ?? "")}>
                          {doc.LINE_OF_BUSINESS ?? "—"}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-slate-500">{doc.FILE_FORMAT}</td>
                      <td className="px-3 py-2">
                        <span className={statusBadgeClass(doc.DOC_STATUS ?? "")}>
                          {doc.DOC_STATUS ?? "—"}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <ConfidenceBadge score={doc.CLASSIFICATION_CONFIDENCE} />
                      </td>
                      <td className="px-3 py-2 text-slate-500">{doc.START_DATE?.slice(0, 10) ?? "—"}</td>
                      <td className="px-3 py-2 text-slate-500">{doc.END_DATE?.slice(0, 10) ?? "—"}</td>
                      <td className="px-3 py-2 text-slate-500 font-mono">{doc.REFERENCE_NUMBER ?? doc.SRC_REFERENCE_NUMBER ?? "—"}</td>
                    </tr>
                  ))}
                  {docs.length === 0 && (
                    <tr><td colSpan={10} className="px-4 py-8 text-center text-slate-400">
                      <p className="mb-1">No documents match the current filters</p>
                      <p className="text-xs">Try selecting a different document type or clearing all filters</p>
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
          {/* Pagination */}
          {!loading && <Pagination offset={offset} limit={LIMIT} total={total} onChange={setOffset} noun="documents" />}
        </div>

        {/* Detail Panel */}
        {selected && (
          <div className="w-80 sf-card p-5 space-y-3 shrink-0 overflow-y-auto max-h-[calc(100vh-12rem)]">
            <div className="flex items-start justify-between gap-2">
              <h3 className="font-semibold text-slate-800 text-sm leading-snug">{selected.DOCUMENT_TYPE}</h3>
              <button className="text-slate-400 hover:text-slate-600" onClick={() => setSelected(null)}>✕</button>
            </div>

            {selected.NEEDS_REVIEW && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-700">
                ⚠️ Several possible document types — check the type
              </div>
            )}

            {selected.PII_DETECTED && (
              <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs text-red-700">
                🛡️ PII detected — contains sensitive personal information
              </div>
            )}

            <div className="space-y-1.5 text-xs">
              {[
                [FIELD_LABELS.party_name, selected.PARTY_NAME],
                [FIELD_LABELS.issuer_name, selected.ISSUER_NAME],
                ["LOB", selected.LINE_OF_BUSINESS],
                [FIELD_LABELS.doc_subtype, selected.DOC_SUBTYPE],
                [FIELD_LABELS.reference_number, selected.REFERENCE_NUMBER ?? selected.SRC_REFERENCE_NUMBER],
                [FIELD_LABELS.case_number, selected.CASE_NUMBER ?? selected.SRC_CASE_NUMBER],
                [FIELD_LABELS.start_date, selected.START_DATE?.slice(0,10)],
                [FIELD_LABELS.end_date, selected.END_DATE?.slice(0,10)],
                ["Status", selected.DOC_STATUS],
                ["Pages", String(selected.PAGE_COUNT ?? "—")],
                ["Format", selected.FILE_FORMAT],
                [FIELD_LABELS.src_file_id, selected.SRC_FILE_ID],
                ["Confidence", selected.CLASSIFICATION_CONFIDENCE ? `${(selected.CLASSIFICATION_CONFIDENCE * 100).toFixed(0)}%` : "—"],
              ].map(([label, val]) => val ? (
                <div key={label} className="flex gap-2">
                  <span className="text-slate-400 w-24 shrink-0">{label}</span>
                  <span className="text-slate-700 font-medium break-all">{val}</span>
                </div>
              ) : null)}
            </div>

            {selected.DOC_SUMMARY && (
              <div className="bg-slate-50 rounded-lg p-3 text-xs text-slate-600 leading-relaxed">
                {selected.DOC_SUMMARY}
              </div>
            )}

            {/* View Document */}
            {selected.FILE_PATH && (
              <button
                onClick={() => openDoc(selected.FILE_PATH!)}
                className="w-full sf-btn-primary text-xs py-2 flex items-center justify-center gap-1.5"
              >
                <FileText size={13} /> View Document
              </button>
            )}

            {/* Attribute correction */}
            <div className="border-t border-slate-100 pt-3">
              <p className="text-xs font-semibold text-slate-500 mb-2 flex items-center gap-1">
                <FileText size={11} /> Correct an Attribute
              </p>
              <select
                className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 mb-2"
                value={correction?.field ?? ""}
                onChange={e => setCorr(e.target.value ? { field: e.target.value, value: "" } : null)}
              >
                <option value="">Select field to correct…</option>
                {Object.entries(selected)
                  .filter(([k, v]) => {
                    const skip = ["FILE_PATH", "FILE_FORMAT", "PAGE_COUNT", "CLASSIFICATION_CONFIDENCE", "PII_DETECTED", "DOC_SUMMARY", "PROCESSING_COMPLETED_AT", "SOURCE_FOLDER"]
                    if (skip.includes(k)) return false
                    if (k.startsWith("_") || k === "file_path") return false
                    return typeof v === "string" || v === null || v === undefined
                  })
                  .map(([k, v]) => {
                    const label = k.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())
                    const currentVal = v ? String(v) : "—"
                    return (
                      <option key={k} value={k}>{label} ({currentVal.length > 30 ? currentVal.slice(0, 30) + "…" : currentVal})</option>
                    )
                  })
                }
              </select>
              {correction && (
                <>
                  <div className="text-[10px] text-slate-400 mb-1 px-1">
                    Current: {String(selected[correction.field as keyof typeof selected] ?? "—")}
                  </div>
                  <input
                    className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 mb-2"
                    placeholder="Corrected value"
                    value={correction.value}
                    onChange={e => setCorr(c => c ? { ...c, value: e.target.value } : null)}
                  />
                  <button
                    className="sf-btn-primary w-full text-xs py-1.5"
                    onClick={async () => {
                      if (!correction.value) return
                      const originalValue = String(selected[correction.field as keyof typeof selected] ?? "")
                      const res = await fetch("/api/corrections", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          filePath: selected.FILE_PATH,
                          fieldName: correction.field,
                          originalValue,
                          correctedValue: correction.value,
                        }),
                      })
                      const data = await res.json()
                      setCorr(null)
                      if (data.ok) {
                        showToast("Correction submitted for admin review", "success")
                      } else {
                        showToast(`Error: ${data.error ?? "Submission failed"}`, "error")
                      }
                    }}
                  >
                    Submit Correction
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Batch Action Bar */}
      {checkedPaths.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-white border border-slate-200 shadow-xl rounded-xl px-5 py-3 flex items-center gap-4 z-50">
          <span className="text-sm font-semibold text-slate-700">{checkedPaths.size} selected</span>
          <select value={batchAction} onChange={e => setBatchAction(e.target.value)} className="sf-input text-xs py-1.5">
            <option value="">Choose action…</option>
            <option value="archive">Archive Selected</option>
          </select>
          <button
            disabled={!batchAction || batchProcessing}
            className="sf-btn-primary text-xs disabled:opacity-50"
            onClick={async () => {
              if (!batchAction) return
              if (!confirm(`Archive ${checkedPaths.size} documents?`)) return
              setBatchProcessing(true)
              try {
                if (batchAction === "archive") {
                  for (const fp of checkedPaths) {
                    await fetch("/api/admin/lifecycle", {
                      method: "POST", headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ action: "archive", filePath: fp })
                    })
                  }
                  showToast(`${checkedPaths.size} documents archived`, "success")
                }
                setCheckedPaths(new Set())
                setBatchAction("")
                loadDocs()
              } catch { showToast("Batch action failed", "error") }
              finally { setBatchProcessing(false) }
            }}
          >
            {batchProcessing ? "Processing…" : "Apply"}
          </button>
          <button className="text-xs text-slate-500 hover:text-slate-700" onClick={() => setCheckedPaths(new Set())}>
            Clear
          </button>
        </div>
      )}
    </div>
  )
}
