"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { Activity, Play, Pause, Upload, RefreshCw, AlertTriangle, CheckCircle, Clock, XCircle, Filter, FileText } from "lucide-react"
import { PageHeader } from "@/components/page-header"
import { showToast } from "@/components/toast"
import { StatCard, StatGrid } from "@/components/stat-card"
import { Spinner } from "@/components/spinner"
import { FIELD_LABELS } from "@/lib/field-labels"

type Tab = "overview" | "run" | "logs" | "reprocess" | "upload" | "stages"

interface HealthData {
  PENDING_COUNT?: number; PROCESSING_COUNT?: number; COMPLETE_COUNT?: number; FAILED_COUNT?: number;
  ABANDONED_COUNT?: number; TOTAL_REGISTERED?: number; MAX_QUEUE_AGE_MINUTES?: number;
  pending_count?: number; processing_count?: number; complete_count?: number; failed_count?: number;
}

interface TaskRow {
  name?: string; state?: string; schedule?: string; warehouse?: string;
}

interface LogRow {
  FILE_PATH?: string; FILE_FORMAT?: string; SOURCE_FOLDER?: string; INGESTION_STATUS?: string;
  PROCESSING_ATTEMPTS?: number; LAST_ERROR?: string; ERROR_STAGE?: string;
  FIRST_SEEN_AT?: string; PROCESSING_COMPLETED_AT?: string; AI_DOCUMENT_TYPE?: string;
  CONFIDENCE_SCORE?: number; PARTY_NAME?: string; LINE_OF_BUSINESS?: string;
  file_path?: string; ingestion_status?: string; last_error?: string;
}

export default function PipelineManagementPage() {
  const [tab, setTab] = useState<Tab>("overview")
  const [health, setHealth] = useState<HealthData | null>(null)
  const [tasks, setTasks] = useState<TaskRow[]>([])
  const [logs, setLogs] = useState<LogRow[]>([])
  const [logsTotal, setLogsTotal] = useState(0)
  const [logFilter, setLogFilter] = useState("")
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState<string | null>(null)
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [reprocessPath, setReprocessPath] = useState("")
  const [registryDocs, setRegistryDocs] = useState<{ file_path: string; status: string; doc_type: string; lob: string }[]>([])
  const [registrySearch, setRegistrySearch] = useState("")
  const [registryLoading, setRegistryLoading] = useState(false)
  const [selectedReprocessFiles, setSelectedReprocessFiles] = useState<Set<string>>(new Set())
  const [reprocessFilterStatus, setReprocessFilterStatus] = useState("")
  const [reprocessFilterLob, setReprocessFilterLob] = useState("")
  const [reprocessFilterType, setReprocessFilterType] = useState("")
  const [healthError, setHealthError] = useState(false)

  const loadHealth = useCallback(async () => {
    try {
      const [hRes, tRes] = await Promise.all([
        fetch("/api/pipeline"), fetch("/api/tasks")
      ])
      if (hRes.ok) { setHealth(await hRes.json()); setHealthError(false) }
      else { setHealthError(true) }
      if (tRes.ok) {
        const d = await tRes.json()
        setTasks(d.tasks ?? [])
      }
    } catch { setHealthError(true) }
    setLoading(false)
  }, [])

  const loadLogs = useCallback(async () => {
    try {
      const params = new URLSearchParams()
      if (logFilter) params.set("status", logFilter)
      params.set("limit", "50")
      const res = await fetch(`/api/admin/pipeline/logs?${params}`)
      if (res.ok) {
        const d = await res.json()
        setLogs(d.rows ?? [])
        setLogsTotal(d.total ?? 0)
      }
    } catch { /* ignore */ }
  }, [logFilter])

  const loadRegistryDocs = useCallback(async () => {
    setRegistryLoading(true)
    try {
      const res = await fetch("/api/admin/pipeline/logs?limit=500")
      if (res.ok) {
        const d = await res.json()
        setRegistryDocs((d.rows ?? []).map((r: Record<string, unknown>) => ({
          file_path: String(r.FILE_PATH ?? r.file_path ?? ""),
          status: String(r.INGESTION_STATUS ?? r.ingestion_status ?? ""),
          doc_type: String(r.AI_DOCUMENT_TYPE ?? r.ai_document_type ?? ""),
          lob: String(r.LINE_OF_BUSINESS ?? r.line_of_business ?? ""),
        })))
      }
    } catch { /* ignore */ }
    setRegistryLoading(false)
  }, [])

  useEffect(() => { loadHealth() }, [loadHealth])
  useEffect(() => { if (tab === "logs") loadLogs() }, [tab, loadLogs])
  useEffect(() => { if (tab === "reprocess" && registryDocs.length === 0) loadRegistryDocs() }, [tab, loadRegistryDocs, registryDocs.length])

  const runStep = async (step: string) => {
    setRunning(step)
    try {
      const res = await fetch("/api/admin/pipeline", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "run_step", step })
      })
      const d = await res.json()
      if (d.ok) {
        showToast(`${step}: ${d.result}`, "success")
        loadHealth()
      } else {
        showToast(d.error || "Failed", "error")
      }
    } catch (e) { showToast("Network error", "error") }
    setRunning(null)
  }

  const toggleTask = async (taskName: string, currentState: string) => {
    const action = currentState === "started" ? "suspend_task" : "resume_task"
    try {
      const res = await fetch("/api/admin/pipeline", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, taskName })
      })
      const d = await res.json()
      if (d.ok) { showToast(`${taskName} ${d.state}`, "success"); loadHealth() }
      else showToast(d.error || "Failed", "error")
    } catch { showToast("Network error", "error") }
  }

  const handleUpload = async () => {
    if (!uploadFile) return
    setUploading(true)
    try {
      const form = new FormData()
      form.append("file", uploadFile)
      const res = await fetch("/api/admin/upload", { method: "POST", body: form })
      const d = await res.json()
      if (d.ok) {
        showToast(
          d.processing === "scheduled"
            ? `Uploaded: ${d.fileName} → queued for the next scheduled run`
            : `Uploaded: ${d.fileName} → processing started`,
          "success"
        )
        setUploadFile(null)
        loadHealth()
      } else {
        showToast(d.error || "Upload failed", "error")
      }
    } catch { showToast("Upload failed", "error") }
    setUploading(false)
  }

  const [bulkProgress, setBulkProgress] = useState<{ current: number; total: number } | null>(null)
  const bulkCancelRef = useRef(false)

  const handleBulkReprocess = async () => {
    const filtered = filteredRegistryDocs
    if (filtered.length === 0) { showToast("No documents match filters", "info"); return }
    if (!confirm(`Reprocess ${filtered.length} documents? This cannot be undone.`)) return
    let successCount = 0
    let failCount = 0
    const total = filtered.length
    let processed = 0
    bulkCancelRef.current = false
    setBulkProgress({ current: 0, total })
    for (const fp of filtered.map(d => d.file_path)) {
      if (bulkCancelRef.current) break
      try {
        const res = await fetch("/api/admin", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "force_reprocess", filePath: fp, reason: "Bulk reprocess via filters" })
        })
        const d = await res.json()
        if (d.ok) successCount++
        else failCount++
      } catch { failCount++ }
      processed++
      setBulkProgress({ current: processed, total })
    }
    setBulkProgress(null)
    if (bulkCancelRef.current) {
      showToast(`Cancelled. ${successCount} of ${processed} processed successfully`, "info")
    } else {
      showToast(`${successCount} document(s) queued for reprocessing${failCount > 0 ? `, ${failCount} failed` : ""}`, successCount > 0 ? "success" : "error")
    }
  }

  const filteredRegistryDocs = registryDocs.filter(d => {
    if (reprocessFilterStatus && d.status !== reprocessFilterStatus) return false
    if (reprocessFilterLob && d.lob !== reprocessFilterLob) return false
    if (reprocessFilterType && d.doc_type !== reprocessFilterType) return false
    if (registrySearch && !d.file_path.toLowerCase().includes(registrySearch.toLowerCase()) &&
        !d.doc_type.toLowerCase().includes(registrySearch.toLowerCase()) &&
        !d.lob.toLowerCase().includes(registrySearch.toLowerCase())) return false
    return true
  })

  const availableLobs = [...new Set(registryDocs.map(d => d.lob).filter(Boolean))].sort()
  const availableTypes = [...new Set(registryDocs.map(d => d.doc_type).filter(Boolean))].sort()

  const handleForceReprocess = async (paths?: string[]) => {
    const filesToReprocess = paths ?? (reprocessPath.trim() ? [reprocessPath.trim()] : Array.from(selectedReprocessFiles))
    if (filesToReprocess.length === 0) return
    let successCount = 0
    for (const fp of filesToReprocess) {
      try {
        const res = await fetch("/api/admin", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "force_reprocess", filePath: fp, reason: "Admin pipeline management" })
        })
        const d = await res.json()
        if (d.ok) successCount++
      } catch { /* continue */ }
    }
    if (successCount > 0) {
      showToast(`${successCount} document(s) queued for reprocessing`, "success")
      setReprocessPath(""); setSelectedReprocessFiles(new Set())
    } else {
      showToast("Reprocess failed", "error")
    }
  }

  const pending = health?.PENDING_COUNT ?? health?.pending_count ?? 0
  const processing = health?.PROCESSING_COUNT ?? health?.processing_count ?? 0
  const complete = health?.COMPLETE_COUNT ?? health?.complete_count ?? 0
  const failed = health?.FAILED_COUNT ?? health?.failed_count ?? 0
  const queueAge = health?.MAX_QUEUE_AGE_MINUTES ?? 0

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "overview", label: "Overview", icon: <Activity size={14} /> },
    { id: "upload", label: "Upload", icon: <Upload size={14} /> },
    { id: "stages", label: "Stages", icon: <Activity size={14} /> },
    { id: "run", label: "Run Pipeline", icon: <Play size={14} /> },
    { id: "logs", label: "Processing Logs", icon: <FileText size={14} /> },
    { id: "reprocess", label: "Reprocess", icon: <RefreshCw size={14} /> },
  ]

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      <PageHeader title="Pipeline Management" icon={Activity}>
        <button onClick={loadHealth} disabled={loading} className="text-sm flex items-center gap-1 px-3 py-1.5 border rounded hover:bg-slate-50 disabled:opacity-50">
          {loading ? <Spinner size={14} /> : <RefreshCw size={14} />} Refresh
        </button>
      </PageHeader>

      {/* Metrics Strip */}
      <StatGrid cols={4}>
        <StatCard label="Complete" value={String(complete)} color="text-green-600" />
        <StatCard label="Pending" value={String(pending)} color="text-amber-600" />
        <StatCard label="Processing" value={String(processing)} color="text-blue-600" />
        <StatCard label="Failed" value={String(failed)} color="text-red-600" />
      </StatGrid>

      {queueAge > 120 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-center gap-2 text-sm text-amber-800">
          <AlertTriangle size={16} /> Queue is {queueAge} minutes old. Pipeline may be stalled.
        </div>
      )}

      {/* Tab Bar */}
      <div className="flex gap-1 border-b">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === t.id ? "border-[var(--brand-primary)] text-[var(--brand-primary)]" : "border-transparent text-slate-500 hover:text-slate-700"
            }`}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="bg-white border rounded-lg p-5">
        {/* OVERVIEW TAB */}
        {tab === "overview" && (
          <div className="space-y-4">
            {healthError && (
              <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-800 text-xs">
                <AlertTriangle size={14} className="shrink-0" />
                <span>Unable to load pipeline health data. The connection may be down or the warehouse is suspended. <button onClick={loadHealth} className="underline font-medium">Retry</button></span>
              </div>
            )}
            <h2 className="font-semibold text-slate-700 flex items-center gap-2"><Activity size={16} /> Pipeline Tasks</h2>
            {loading ? (
              <div className="animate-pulse space-y-2">
                {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-8 bg-slate-100 rounded" />)}
              </div>
            ) :
             tasks.length === 0 ? (
              <p className="text-slate-500 text-sm">No tasks found. Tasks are created by sql/02_ingestion.sql.</p>
            ) : (
              <table className="w-full text-sm">
                <thead><tr className="border-b text-left text-slate-500">
                  <th className="py-2 px-2">Task</th><th className="py-2 px-2">State</th>
                  <th className="py-2 px-2">Schedule</th><th className="py-2 px-2">Action</th>
                </tr></thead>
                <tbody>
                  {tasks.map((t, i) => {
                    const name = String(t.name ?? "")
                    const state = String(t.state ?? "").toLowerCase()
                    return (
                      <tr key={i} className="border-b border-slate-50 hover:bg-slate-50/50">
                        <td className="py-2 px-2 font-mono text-xs">{name}</td>
                        <td className="py-2 px-2">
                          <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${
                            state === "started" ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-600"
                          }`}>
                            {state === "started" ? <Play size={10} /> : <Pause size={10} />} {state}
                          </span>
                        </td>
                        <td className="py-2 px-2 text-slate-500 text-xs">{String(t.schedule ?? "—")}</td>
                        <td className="py-2 px-2">
                          <button onClick={() => toggleTask(name, state)}
                            className="text-xs px-2 py-1 rounded border hover:bg-slate-50">
                            {state === "started" ? "Suspend" : "Resume"}
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* RUN PIPELINE TAB */}
        {tab === "run" && (
          <div className="space-y-4">
            <h2 className="font-semibold text-slate-700">Run Pipeline Steps</h2>
            <p className="text-sm text-slate-500">Execute each pipeline step manually. Steps run sequentially: Register → Parse → Classify → Extract.</p>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {[
                { id: "register", label: "Register Files", desc: "Scan stages for new documents" },
                { id: "parse", label: "Parse Documents", desc: "AI_PARSE_DOCUMENT on pending" },
                { id: "classify", label: "Classify", desc: "AI_CLASSIFY document types" },
                { id: "extract", label: "Extract", desc: "AI_EXTRACT attributes" },
              ].map(s => (
                <button key={s.id} onClick={() => runStep(s.id)} disabled={running !== null}
                  className="border rounded-lg p-4 text-left hover:bg-blue-50 hover:border-blue-200 disabled:opacity-50 transition-colors">
                  <div className="font-medium text-sm text-slate-700 flex items-center gap-2">
                    {running === s.id ? <RefreshCw size={14} className="animate-spin" /> : <Play size={14} />}
                    {s.label}
                  </div>
                  <div className="text-xs text-slate-500 mt-1">{s.desc}</div>
                </button>
              ))}
            </div>
            {running && <p className="text-sm text-blue-600 flex items-center gap-2"><RefreshCw size={14} className="animate-spin" /> Running {running}...</p>}
          </div>
        )}

        {/* PROCESSING LOGS TAB */}
        {tab === "logs" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-slate-700">Processing Logs ({logsTotal} total)</h2>
              <div className="flex items-center gap-2">
                <Filter size={14} className="text-slate-400" />
                <select value={logFilter} onChange={e => setLogFilter(e.target.value)}
                  className="text-sm border rounded px-2 py-1">
                  <option value="">All Statuses</option>
                  <option value="PENDING">Pending</option>
                  <option value="PROCESSING">Processing</option>
                  <option value="COMPLETE">Complete</option>
                  <option value="FAILED">Failed</option>
                  <option value="ABANDONED">Abandoned</option>
                </select>
                <button onClick={loadLogs} className="text-xs px-2 py-1 border rounded hover:bg-slate-50">Refresh</button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="border-b text-left text-slate-500">
                  <th className="py-2 px-2">File</th><th className="py-2 px-2">Status</th>
                  <th className="py-2 px-2">Folder</th><th className="py-2 px-2">Type</th>
                  <th className="py-2 px-2">{FIELD_LABELS.party_name}</th><th className="py-2 px-2">Error</th>
                </tr></thead>
                <tbody>
                  {logs.map((l, i) => {
                    const fp = String(l.FILE_PATH ?? l.file_path ?? "")
                    const status = String(l.INGESTION_STATUS ?? l.ingestion_status ?? "")
                    return (
                      <tr key={i} className="border-b border-slate-50 hover:bg-slate-50/50">
                        <td className="py-2 px-2 font-mono max-w-[180px] truncate" title={fp}>{fp.split("/").pop()}</td>
                        <td className="py-2 px-2">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                            status === "COMPLETE" ? "bg-green-100 text-green-700" :
                            status === "FAILED" ? "bg-red-100 text-red-700" :
                            status === "PROCESSING" ? "bg-blue-100 text-blue-700" :
                            "bg-slate-100 text-slate-600"
                          }`}>{status}</span>
                        </td>
                        <td className="py-2 px-2 text-slate-600">{String(l.SOURCE_FOLDER ?? "")}</td>
                        <td className="py-2 px-2 text-slate-600">{String(l.AI_DOCUMENT_TYPE ?? "")}</td>
                        <td className="py-2 px-2 text-slate-600 max-w-[120px] truncate">{String(l.PARTY_NAME ?? "")}</td>
                        <td className="py-2 px-2 text-red-600 max-w-[200px] truncate" title={String(l.LAST_ERROR ?? l.last_error ?? "")}>
                          {l.LAST_ERROR ?? l.last_error ?? ""}
                        </td>
                      </tr>
                    )
                  })}
                  {logs.length === 0 && <tr><td colSpan={6} className="py-8 text-center text-slate-400">No records found</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* REPROCESS TAB */}
        {tab === "reprocess" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-semibold text-slate-700">Reprocess Documents</h2>
                <p className="text-sm text-slate-500">Filter and select documents to reprocess, or reprocess all matching filters.</p>
              </div>
              <button onClick={loadRegistryDocs} disabled={registryLoading}
                className="text-xs px-3 py-1.5 border rounded hover:bg-slate-50 disabled:opacity-50 flex items-center gap-1">
                <RefreshCw size={12} className={registryLoading ? "animate-spin" : ""} />
                {registryLoading ? "Loading..." : "Refresh"}
              </button>
            </div>

            {/* Filters */}
            <div className="flex flex-wrap items-center gap-3">
              <input type="text" value={registrySearch} onChange={e => setRegistrySearch(e.target.value)}
                placeholder="Search filename..." className="flex-1 min-w-[200px] text-sm border rounded px-3 py-2" />
              <select value={reprocessFilterStatus} onChange={e => setReprocessFilterStatus(e.target.value)}
                className="text-sm border rounded px-3 py-2">
                <option value="">All Statuses</option>
                <option value="COMPLETE">Complete</option>
                <option value="FAILED">Failed</option>
                <option value="PENDING">Pending</option>
                <option value="PROCESSING">Processing</option>
              </select>
              <select value={reprocessFilterLob} onChange={e => setReprocessFilterLob(e.target.value)}
                className="text-sm border rounded px-3 py-2">
                <option value="">All LOBs</option>
                {availableLobs.map(l => <option key={l} value={l}>{l}</option>)}
              </select>
              <select value={reprocessFilterType} onChange={e => setReprocessFilterType(e.target.value)}
                className="text-sm border rounded px-3 py-2">
                <option value="">All Types</option>
                {availableTypes.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>

            {/* Document list */}
            <div className="border rounded-lg overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2 bg-slate-50 border-b text-xs text-slate-500">
                <span>{filteredRegistryDocs.length} documents{selectedReprocessFiles.size > 0 ? ` · ${selectedReprocessFiles.size} selected` : ""}</span>
                <div className="flex items-center gap-2">
                  <button onClick={() => setSelectedReprocessFiles(new Set(filteredRegistryDocs.map(d => d.file_path)))}
                    className="text-xs text-blue-600 hover:text-blue-800">Select All</button>
                  {selectedReprocessFiles.size > 0 && (
                    <button onClick={() => setSelectedReprocessFiles(new Set())}
                      className="text-xs text-slate-500 hover:text-slate-700">Clear</button>
                  )}
                </div>
              </div>
              {registryDocs.length > 0 ? (
                <div className="max-h-[300px] overflow-y-auto divide-y divide-slate-50">
                  {filteredRegistryDocs.slice(0, 200).map(d => (
                    <label key={d.file_path} className="flex items-center gap-3 px-3 py-2 hover:bg-slate-50 cursor-pointer text-xs">
                      <input type="checkbox" checked={selectedReprocessFiles.has(d.file_path)}
                        onChange={e => {
                          const next = new Set(selectedReprocessFiles)
                          e.target.checked ? next.add(d.file_path) : next.delete(d.file_path)
                          setSelectedReprocessFiles(next)
                        }} className="rounded" />
                      <span className="flex-1 font-mono text-[11px] text-slate-700 truncate">{d.file_path.split("/").pop()}</span>
                      {d.lob && <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-600">{d.lob}</span>}
                      {d.doc_type && <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 max-w-[160px] truncate">{d.doc_type}</span>}
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                        d.status === "COMPLETE" ? "bg-green-100 text-green-700" :
                        d.status === "FAILED" ? "bg-red-100 text-red-700" :
                        d.status === "PROCESSING" ? "bg-blue-100 text-blue-700" :
                        "bg-amber-100 text-amber-700"
                      }`}>{d.status}</span>
                    </label>
                  ))}
                  {filteredRegistryDocs.length === 0 && (
                    <p className="px-3 py-6 text-center text-xs text-slate-400">No documents match the current filters</p>
                  )}
                </div>
              ) : (
                <p className="px-3 py-6 text-center text-xs text-slate-400">
                  {registryLoading ? "Loading documents..." : "No documents loaded"}
                </p>
              )}
            </div>

            {/* Actions */}
            <div className="flex items-center gap-3">
              <input type="text" value={reprocessPath} onChange={e => setReprocessPath(e.target.value)}
                placeholder="Or type a file path manually..." className="flex-1 border rounded px-3 py-2 text-sm" />
              <button onClick={() => handleForceReprocess()} disabled={!reprocessPath.trim() && selectedReprocessFiles.size === 0}
                className="px-4 py-2 bg-[var(--brand-primary)] text-white rounded text-sm font-medium hover:opacity-90 disabled:opacity-50 whitespace-nowrap">
                Reprocess{selectedReprocessFiles.size > 0 ? ` Selected (${selectedReprocessFiles.size})` : ""}
              </button>
              <button onClick={bulkProgress ? () => { bulkCancelRef.current = true } : handleBulkReprocess}
                disabled={!bulkProgress && filteredRegistryDocs.length === 0}
                className={`px-4 py-2 text-white rounded text-sm font-medium hover:opacity-90 disabled:opacity-40 whitespace-nowrap ${bulkProgress ? "bg-red-500" : "bg-amber-500"}`}>
                {bulkProgress ? `Cancel (${bulkProgress.current}/${bulkProgress.total})` : `Reprocess All Filtered (${filteredRegistryDocs.length})`}
              </button>
            </div>
          </div>
        )}

        {/* UPLOAD TAB */}
        {tab === "upload" && (
          <div className="space-y-4">
            <h2 className="font-semibold text-slate-700">Upload Documents</h2>
            <p className="text-sm text-slate-500">Upload documents to the ingestion stage. They will be automatically registered and queued for processing.</p>

            <div
              className="border-2 border-dashed rounded-lg p-8 text-center hover:border-blue-300 transition-colors cursor-pointer"
              onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add("border-blue-400", "bg-blue-50") }}
              onDragLeave={e => { e.currentTarget.classList.remove("border-blue-400", "bg-blue-50") }}
              onDrop={e => {
                e.preventDefault()
                e.currentTarget.classList.remove("border-blue-400", "bg-blue-50")
                const f = e.dataTransfer.files[0]
                if (f) setUploadFile(f)
              }}
              onClick={() => document.getElementById("file-input")?.click()}
            >
              <Upload size={32} className="mx-auto text-slate-300 mb-2" />
              {uploadFile ? (
                <div>
                  <p className="font-medium text-slate-700">{uploadFile.name}</p>
                  <p className="text-xs text-slate-500">{(uploadFile.size / 1024).toFixed(1)} KB</p>
                </div>
              ) : (
                <div>
                  <p className="text-slate-600">Drop a file here or click to browse</p>
                  <p className="text-xs text-slate-400 mt-1">PDF, TIFF, DOCX, JPEG, PNG, HTML, TXT (max 50MB)</p>
                </div>
              )}
            </div>
            <input id="file-input" type="file" className="hidden"
              accept=".pdf,.tiff,.tif,.docx,.pptx,.jpg,.jpeg,.png,.html,.txt"
              onChange={e => { if (e.target.files?.[0]) setUploadFile(e.target.files[0]) }} />

            {uploadFile && (
              <button onClick={handleUpload} disabled={uploading}
                className="px-4 py-2 bg-[var(--brand-primary)] text-white rounded text-sm font-medium hover:opacity-90 disabled:opacity-50 flex items-center gap-2">
                {uploading ? <RefreshCw size={14} className="animate-spin" /> : <Upload size={14} />}
                {uploading ? "Uploading..." : "Upload and Register"}
              </button>
            )}
          </div>
        )}

        {/* STAGES TAB */}
        {tab === "stages" && <StagesPanel />}
      </div>
    </div>
  )
}

/** Stage management panel — list, add, toggle, remove ingestion stages */
function StagesPanel() {
  const [stages, setStages] = useState<Record<string, unknown>[]>([])
  const [loading, setLoading] = useState(true)
  const [newStage, setNewStage] = useState("")
  const [newDesc, setNewDesc] = useState("")
  const [newPrefix, setNewPrefix] = useState("")
  const [adding, setAdding] = useState(false)
  const [available, setAvailable] = useState<{ name: string; type: string; comment: string }[]>([])
  const [discovering, setDiscovering] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const res = await fetch("/api/admin/stages")
      if (res.ok) setStages(await res.json())
    } catch { /* */ }
    setLoading(false)
  }

  async function discover() {
    setDiscovering(true)
    try {
      const res = await fetch("/api/admin/stages?action=discover")
      if (res.ok) {
        const data = await res.json()
        setAvailable(data.available ?? [])
        if ((data.available ?? []).length === 0) showToast("No unregistered stages found", "info")
      }
    } catch { showToast("Failed to discover stages", "error") }
    setDiscovering(false)
  }

  async function registerDiscovered(name: string, comment: string) {
    setAdding(true)
    try {
      const res = await fetch("/api/admin/stages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stageName: name, description: comment || `Stage ${name}`, pathPrefix: "" }),
      })
      if (res.ok) {
        showToast(`Stage ${name} registered`, "success")
        setAvailable(prev => prev.filter(s => s.name !== name))
        load()
      } else {
        const d = await res.json()
        showToast(d.error ?? "Failed", "error")
      }
    } catch { showToast("Network error", "error") }
    setAdding(false)
  }

  useEffect(() => { load() }, [])

  async function addStage() {
    if (!newStage.trim()) return
    setAdding(true)
    try {
      const res = await fetch("/api/admin/stages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stageName: newStage, description: newDesc, pathPrefix: newPrefix }),
      })
      const d = await res.json()
      if (res.ok) {
        showToast("Stage added", "success")
        setNewStage(""); setNewDesc(""); setNewPrefix("")
        load()
      } else {
        showToast(d.error ?? "Failed", "error")
      }
    } catch { showToast("Network error", "error") }
    setAdding(false)
  }

  async function toggleActive(stageName: string, isActive: boolean) {
    await fetch("/api/admin/stages", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stageName, isActive: !isActive }),
    })
    load()
  }

  async function removeStage(stageName: string) {
    if (!confirm(`Remove stage "${stageName}" from ingestion?`)) return
    await fetch(`/api/admin/stages?stage_name=${encodeURIComponent(stageName)}`, { method: "DELETE" })
    showToast("Stage removed", "info")
    load()
  }

  if (loading) return (
    <div className="p-6 animate-pulse space-y-3">
      <div className="h-5 bg-slate-200 rounded w-36" />
      {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-12 bg-slate-100 rounded" />)}
    </div>
  )

  return (
    <div className="space-y-4">
      <h2 className="font-semibold text-slate-700">Ingestion Stages</h2>
      <p className="text-sm text-slate-500">Configure which Snowflake stages are scanned for new documents. Each active stage is checked when the registration pipeline runs.</p>

      {/* Stage list */}
      <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg overflow-hidden">
        {stages.map((s) => {
          const name = String(s.STAGE_NAME ?? s.stage_name ?? "")
          const desc = String(s.DESCRIPTION ?? s.description ?? "")
          const prefix = String(s.PATH_PREFIX ?? s.path_prefix ?? "")
          const active = s.IS_ACTIVE === true || s.is_active === true
          return (
            <div key={name} className={`flex items-center gap-3 px-4 py-3 ${active ? "" : "opacity-50 bg-slate-50"}`}>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-mono font-medium text-slate-800 truncate">@{name}</p>
                <p className="text-xs text-slate-500">{desc || "No description"}{prefix ? ` (prefix: ${prefix})` : ""}</p>
              </div>
              <button
                className={`text-xs px-2 py-1 rounded ${active ? "bg-green-100 text-green-700" : "bg-slate-200 text-slate-500"}`}
                onClick={() => toggleActive(name, active)}
              >
                {active ? "Active" : "Paused"}
              </button>
              <button
                className="text-xs text-red-500 hover:text-red-700 px-2 py-1"
                onClick={() => removeStage(name)}
              >Remove</button>
            </div>
          )
        })}
        {stages.length === 0 && (
          <p className="px-4 py-6 text-center text-slate-400 text-sm">No stages configured</p>
        )}
      </div>

      {/* Add stage form */}
      <div className="sf-card p-4 space-y-2">
        <p className="text-xs font-semibold text-slate-600">Add New Stage</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          <input
            className="text-sm border border-slate-200 rounded-lg px-3 py-2"
            placeholder="Stage name (e.g. DOC_INTEL.DATA.doc_stage)"
            value={newStage}
            onChange={e => setNewStage(e.target.value)}
          />
          <input
            className="text-sm border border-slate-200 rounded-lg px-3 py-2"
            placeholder="Description"
            value={newDesc}
            onChange={e => setNewDesc(e.target.value)}
          />
          <input
            className="text-sm border border-slate-200 rounded-lg px-3 py-2"
            placeholder="Path prefix (optional)"
            value={newPrefix}
            onChange={e => setNewPrefix(e.target.value)}
          />
        </div>
        <button
          className="sf-btn-primary text-sm py-2 px-4"
          disabled={adding || !newStage.trim()}
          onClick={addStage}
        >
          {adding ? "Adding..." : "Add Stage"}
        </button>
      </div>

      {/* Discover available stages */}
      <div className="sf-card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-slate-600">Discover Available Stages</p>
            <p className="text-[11px] text-slate-400">Find stages in the database that aren't registered for ingestion yet</p>
          </div>
          <button
            className="sf-btn-secondary text-xs"
            onClick={discover}
            disabled={discovering}
          >
            {discovering ? "Scanning..." : "Scan Database"}
          </button>
        </div>
        {available.length > 0 && (
          <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg overflow-hidden">
            {available.map(s => (
              <div key={s.name} className="flex items-center gap-3 px-4 py-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-mono font-medium text-slate-800">@{s.name}</p>
                  {s.comment && <p className="text-xs text-slate-500">{s.comment}</p>}
                  {s.type && <span className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">{s.type}</span>}
                </div>
                <button
                  className="sf-btn-primary text-xs py-1.5 px-3"
                  onClick={() => registerDiscovered(s.name, s.comment)}
                  disabled={adding}
                >
                  Register
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
