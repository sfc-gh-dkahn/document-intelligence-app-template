"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { ClipboardList, RefreshCw, RotateCcw } from "lucide-react"
import { PageHeader } from "@/components/page-header"
import { showToast } from "@/components/toast"
import { Spinner } from "@/components/spinner"
import { DocFileLink, useDocumentPreview, DocLoadingIndicator } from "@/components/doc-download"
import { EmptyState } from "@/components/empty-state"
import { Pagination } from "@/components/pagination"

interface RegistryRow {
  REGISTRY_ID?: string; FILE_PATH?: string; FILE_FORMAT?: string
  SOURCE_FOLDER?: string; INGESTION_STATUS?: string; PROCESSING_VERSION?: number
  PROCESSING_ATTEMPTS?: number; FIRST_SEEN_AT?: string; PROCESSING_COMPLETED_AT?: string
  LAST_ERROR?: string; SRC_REFERENCE_NUMBER?: string
}

const STATUS_BADGE: Record<string, string> = {
  COMPLETE:   "badge-complete",
  PENDING:    "badge-pending",
  PROCESSING: "badge-open",
  FAILED:     "badge-failed",
  ABANDONED:  "badge-abandoned",
}
const FORMAT_BADGE: Record<string, string> = {
  PDF: "fmt-pdf", TIFF: "fmt-tiff", TIF: "fmt-tiff", DOCX: "fmt-docx", JPEG: "fmt-jpeg", PNG: "fmt-png",
}

const LIMIT = 50

export default function AdminRegistryPage() {
  const { open: openDoc, loading: docLoading, ModalComponent: DocModal } = useDocumentPreview()
  const [rows, setRows]       = useState<RegistryRow[]>([])
  const [total, setTotal]     = useState(0)
  const [loading, setLoading] = useState(true)
  const [offset, setOffset]   = useState(0)
  const [fStatus, setFStatus] = useState("")
  const [fFolder, setFFolder] = useState("")
  const [fSearch, setFSearch] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [debouncedFolder, setDebouncedFolder] = useState("")
  const [actionMsg, setActionMsg] = useState("")
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Debounce text inputs by 400ms
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(fSearch)
      setDebouncedFolder(fFolder)
    }, 400)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [fSearch, fFolder])

  const load = useCallback(async () => {
    setLoading(true)
    const p = new URLSearchParams({ limit: String(LIMIT), offset: String(offset) })
    if (fStatus) p.set("status", fStatus)
    if (debouncedFolder) p.set("folder", debouncedFolder)
    if (debouncedSearch) p.set("search", debouncedSearch)
    try {
      const res = await fetch(`/api/registry?${p}`)
      const data = await res.json()
      if (!res.ok) {
        showToast(data.error ?? "Failed to load registry", "error")
        return
      }
      setRows(data.rows ?? [])
      setTotal(data.total ?? 0)
    } finally {
      setLoading(false)
    }
  }, [offset, fStatus, debouncedFolder, debouncedSearch])

  useEffect(() => { load() }, [load])

  async function reprocess(filePath: string) {
    try {
      const res = await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "force_reprocess", filePath, reason: "Admin UI — manual reprocess" }),
      })
      const d = await res.json()
      if (!res.ok) {
        showToast(d.error ?? "Reprocess request failed", "error")
        return
      }
      setActionMsg(d.ok ? `Queued: ${filePath.split("/").pop()}` : `Error: ${d.error}`)
      setTimeout(() => setActionMsg(""), 4000)
      load()
    } catch {
      showToast("Network error — could not queue reprocess", "error")
    }
  }



  return (
    <div className="max-w-6xl mx-auto space-y-4">
      {DocModal}
      <DocLoadingIndicator loading={docLoading} />
      <PageHeader title="Ingestion Registry" icon={ClipboardList}>
        <button className="sf-btn-secondary flex items-center gap-1.5" onClick={load} disabled={loading}>
          {loading ? <Spinner size={13} /> : <RefreshCw size={13} />} Refresh
        </button>
      </PageHeader>

      {/* Filters */}
      <div className="sf-card p-3 flex flex-wrap gap-2 items-center">
        <select className="text-sm border border-slate-200 rounded-lg px-2 py-1.5 text-slate-600"
          value={fStatus} onChange={e => { setFStatus(e.target.value); setOffset(0) }}>
          <option value="">All Statuses</option>
          {["PENDING","PROCESSING","COMPLETE","FAILED","ABANDONED"].map(s => <option key={s}>{s}</option>)}
        </select>
        <input
          className="text-sm border border-slate-200 rounded-lg px-2 py-1.5 w-48"
          placeholder="Search file name…"
          value={fSearch}
          onChange={e => { setFSearch(e.target.value); setOffset(0) }}
        />
        <input
          className="text-sm border border-slate-200 rounded-lg px-2 py-1.5 w-36"
          placeholder="Filter folder"
          value={fFolder}
          onChange={e => { setFFolder(e.target.value); setOffset(0) }}
        />
        <span className="text-xs text-slate-400 ml-auto">
          {loading ? <><Spinner size={12} className="inline" /> Loading…</> : `${total.toLocaleString()} total documents`}
        </span>
        {actionMsg && (
          <span className="text-xs px-2 py-1 rounded-full bg-green-50 text-green-700">{actionMsg}</span>
        )}
      </div>

      <div className="sf-card overflow-hidden">
        {loading ? (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  {["File Path","Format","Folder","Status","Ver","Attempts","First Seen","Last Error"].map(h => (
                    <th key={h} className="text-left px-3 py-2.5 text-slate-500 font-semibold whitespace-nowrap">{h}</th>
                  ))}
                  <th className="px-3 py-2.5 text-slate-500 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i} className="border-b border-slate-50 animate-pulse">
                    <td className="px-3 py-2.5"><div className="h-3 bg-slate-200 rounded w-40" /></td>
                    <td className="px-3 py-2.5"><div className="h-3 bg-slate-200 rounded w-10" /></td>
                    <td className="px-3 py-2.5"><div className="h-3 bg-slate-200 rounded w-16" /></td>
                    <td className="px-3 py-2.5"><div className="h-3 bg-slate-200 rounded w-14" /></td>
                    <td className="px-3 py-2.5"><div className="h-3 bg-slate-200 rounded w-6" /></td>
                    <td className="px-3 py-2.5"><div className="h-3 bg-slate-200 rounded w-6" /></td>
                    <td className="px-3 py-2.5"><div className="h-3 bg-slate-200 rounded w-20" /></td>
                    <td className="px-3 py-2.5"><div className="h-3 bg-slate-200 rounded w-24" /></td>
                    <td className="px-3 py-2.5"><div className="h-3 bg-slate-200 rounded w-12" /></td>
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
                  {["File Path","Format","Folder","Status","Ver","Attempts","First Seen","Last Error"].map(h => (
                    <th key={h} className="text-left px-3 py-2.5 text-slate-500 font-semibold whitespace-nowrap">{h}</th>
                  ))}
                  <th className="px-3 py-2.5 text-slate-500 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => {
                  const rid    = String(row.REGISTRY_ID       ?? (row as Record<string,unknown>)["registry_id"]    ?? i)
                  const status = String(row.INGESTION_STATUS ?? (row as Record<string,unknown>)["ingestion_status"] ?? "")
                  const format = String(row.FILE_FORMAT      ?? (row as Record<string,unknown>)["file_format"]      ?? "")
                  const folder = String(row.SOURCE_FOLDER         ?? (row as Record<string,unknown>)["source_folder"]       ?? "")
                  const path   = String(row.FILE_PATH         ?? (row as Record<string,unknown>)["file_path"]       ?? "")
                  const err    = String(row.LAST_ERROR         ?? (row as Record<string,unknown>)["last_error"]     ?? "")
                  const seen   = String(row.FIRST_SEEN_AT      ?? (row as Record<string,unknown>)["first_seen_at"]  ?? "")
                  const ver    = Number(row.PROCESSING_VERSION ?? (row as Record<string,unknown>)["processing_version"] ?? 1)
                  const att    = Number(row.PROCESSING_ATTEMPTS ?? (row as Record<string,unknown>)["processing_attempts"] ?? 0)
                  return (
                    <tr key={rid} className="border-b border-slate-50 hover:bg-slate-50/50 transition-colors">
                      <td className="px-3 py-2 max-w-[200px] truncate">
                        <DocFileLink filePath={path} displayName={path.split("/").pop() ?? path} className="text-xs" onOpen={openDoc} />
                      </td>
                      <td className="px-3 py-2">
                        <span className={FORMAT_BADGE[format.toUpperCase()] ?? "sf-badge bg-slate-100 text-slate-600"}>
                          {format}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-slate-600">{folder || "—"}</td>
                      <td className="px-3 py-2">
                        <span className={STATUS_BADGE[status] ?? "sf-badge bg-slate-100 text-slate-600"}>{status}</span>
                      </td>
                      <td className="px-3 py-2 text-slate-500 text-center">{ver}</td>
                      <td className="px-3 py-2 text-slate-500 text-center">{att}</td>
                      <td className="px-3 py-2 text-slate-400 whitespace-nowrap">{seen.slice(0,10)}</td>
                      <td className="px-3 py-2 text-red-500 max-w-[180px] truncate" title={err}>{err || "—"}</td>
                      <td className="px-3 py-2">
                        <button
                          className="p-1 rounded hover:bg-blue-50 text-slate-400 hover:text-blue-600 transition-colors"
                          title={status === "FAILED" || status === "ABANDONED" ? "Reprocess" : `Reprocess (currently ${status})`}
                          onClick={() => {
                            // Only ask for confirmation if the doc isn't already failed/abandoned
                            if (status !== "FAILED" && status !== "ABANDONED") {
                              if (!window.confirm(`Force reprocess "${path.split("/").pop()}"?\nStatus: ${status} — this will re-queue the document.`)) return
                            }
                            reprocess(path)
                          }}
                        >
                          <RotateCcw size={13} />
                        </button>
                      </td>
                    </tr>
                  )
                })}
                {rows.length === 0 && (
                  <tr><td colSpan={9}><EmptyState icon={ClipboardList} message="No records match the current filters" /></td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        <Pagination offset={offset} limit={LIMIT} total={total} onChange={setOffset} noun="records" />
      </div>
    </div>
  )
}
