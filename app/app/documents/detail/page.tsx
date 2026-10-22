"use client"

import { FIELD_LABELS } from "@/lib/field-labels"
import { useEffect, useState, useCallback, Suspense } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import {
  ArrowLeft, FileText, Clock, Users, AlignLeft, Pencil, Check, X,
  ExternalLink, CheckCircle, AlertCircle, RefreshCw, Archive, Trash2, Highlighter, Bookmark
} from "lucide-react"
import { showToast } from "@/components/toast"
import { useDocumentPreview, DocLoadingIndicator } from "@/components/doc-download"
import { useRole } from "@/hooks/use-role"
import { SearchWithinTab } from "./_components/search-within-tab"
import Link from "next/link"
import { encodeDocId } from "@/lib/doc-utils"

type Tab = "viewer" | "history" | "related" | "text"

const EDITABLE_FIELDS = [
  { key: "PARTY_NAME", label: FIELD_LABELS.party_name },
  { key: "ISSUER_NAME", label: FIELD_LABELS.issuer_name },
  { key: "DOCUMENT_TYPE", label: "Document Type" },
  { key: "REFERENCE_NUMBER", label: FIELD_LABELS.reference_number },
  { key: "CASE_NUMBER", label: FIELD_LABELS.case_number },
  { key: "LINE_OF_BUSINESS", label: "Line of Business" },
  { key: "DOC_SUBTYPE", label: FIELD_LABELS.doc_subtype },
  { key: "DOC_STATUS", label: "Status" },
  { key: "START_DATE", label: FIELD_LABELS.start_date },
  { key: "END_DATE", label: FIELD_LABELS.end_date },
  { key: "REFERENCE_DATE", label: FIELD_LABELS.reference_date },
]

const READONLY_FIELDS = [
  { key: "COUNTERPARTY_NAME", label: FIELD_LABELS.counterparty_name },
  { key: "PRIMARY_AMOUNT", label: FIELD_LABELS.primary_amount },
  { key: "TOTAL_AMOUNT", label: FIELD_LABELS.total_amount },
  { key: "SECONDARY_AMOUNT", label: FIELD_LABELS.secondary_amount },
  { key: "DOC_SUMMARY", label: "Summary" },
  { key: "KEY_TERMS", label: FIELD_LABELS.key_terms },
  { key: "ACTION_REQUIRED", label: "Action Required" },
]

// Highlight categories for extracted values
const HIGHLIGHT_CATEGORIES: { keys: string[]; label: string; bg: string; text: string; border: string }[] = [
  { keys: ["REFERENCE_NUMBER", "CASE_NUMBER"], label: "Identifiers", bg: "bg-blue-100", text: "text-blue-800", border: "border-blue-200" },
  { keys: ["PARTY_NAME", "ISSUER_NAME", "COUNTERPARTY_NAME"], label: "Parties", bg: "bg-green-100", text: "text-green-800", border: "border-green-200" },
  { keys: ["START_DATE", "END_DATE", "REFERENCE_DATE", "EVENT_DATE", "DOCUMENT_DATE"], label: "Dates", bg: "bg-purple-100", text: "text-purple-800", border: "border-purple-200" },
  { keys: ["PRIMARY_AMOUNT", "TOTAL_AMOUNT", "SECONDARY_AMOUNT"], label: "Monetary", bg: "bg-amber-100", text: "text-amber-800", border: "border-amber-200" },
  { keys: ["DOCUMENT_TYPE", "LINE_OF_BUSINESS", "DOC_SUBTYPE"], label: "Classification", bg: "bg-teal-100", text: "text-teal-800", border: "border-teal-200" },
]

function getHighlightStyle(fieldKey: string): { bg: string; text: string } {
  for (const cat of HIGHLIGHT_CATEGORIES) {
    if (cat.keys.includes(fieldKey)) return { bg: cat.bg, text: cat.text }
  }
  return { bg: "bg-slate-100", text: "text-slate-700" }
}

function buildHighlightedText(rawText: string, doc: Record<string, unknown>): React.ReactNode[] {
  // Collect all non-empty values with their field keys
  const allFields = [...EDITABLE_FIELDS, ...READONLY_FIELDS]
  const entries: { value: string; key: string; label: string }[] = []
  for (const f of allFields) {
    const v = String(doc[f.key] ?? doc[f.key.toLowerCase()] ?? "").trim()
    if (v && v.length >= 3 && v !== "—") entries.push({ value: v, key: f.key, label: f.label })
  }
  // Sort by length descending so longer matches take priority
  entries.sort((a, b) => b.value.length - a.value.length)

  if (entries.length === 0) return [rawText]

  // Build a regex that matches any extracted value (case-insensitive)
  const escaped = entries.map(e => e.value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  const regex = new RegExp(`(${escaped.join("|")})`, "gi")

  const parts = rawText.split(regex)
  return parts.map((part, i) => {
    // Check if this part matches any extracted value
    const matchEntry = entries.find(e => e.value.toLowerCase() === part.toLowerCase())
    if (matchEntry) {
      const style = getHighlightStyle(matchEntry.key)
      return (
        <mark key={i} className={`${style.bg} ${style.text} px-0.5 rounded-sm cursor-help`} title={matchEntry.label}>
          {part}
        </mark>
      )
    }
    return part
  })
}

function gv(obj: Record<string, unknown> | null, key: string): unknown {
  if (!obj) return null
  return obj[key] ?? obj[key.toLowerCase()] ?? null
}

function DocumentDetailContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const id = searchParams.get("id") ?? ""

  const [doc, setDoc] = useState<Record<string, unknown> | null>(null)
  const [pendingCorrections, setPendingCorrections] = useState<string[]>([])
  const [history, setHistory] = useState<Record<string, unknown>[]>([])
  const [related, setRelated] = useState<Record<string, unknown>[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>("viewer")
  const [editField, setEditField] = useState<string | null>(null)
  const [editValue, setEditValue] = useState("")
  const [saving, setSaving] = useState(false)
  const [highlightOn, setHighlightOn] = useState(true)
  const [actionBusy, setActionBusy] = useState(false)
  const [bookmarked, setBookmarked] = useState(false)

  const { open: openPreview, ModalComponent: DocModal, loading: docLoading } = useDocumentPreview()
  const { isAdmin } = useRole()

  async function handleArchive() {
    if (!confirm("Archive this document? It will be hidden from browse and search.")) return
    setActionBusy(true)
    const filePath = String((doc as Record<string, unknown>)?.FILE_PATH ?? "")
    const res = await fetch("/api/admin/lifecycle", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "archive", filePath })
    })
    setActionBusy(false)
    if (res.ok) { showToast("Document archived", "success"); router.back() }
    else showToast("Archive failed", "error")
  }

  async function handlePurge() {
    if (!confirm("PERMANENTLY DELETE this document and all related data? This cannot be undone.")) return
    if (!confirm("Are you absolutely sure? This will remove the file from the stage.")) return
    setActionBusy(true)
    const filePath = String((doc as Record<string, unknown>)?.FILE_PATH ?? "")
    const res = await fetch("/api/admin/lifecycle", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "purge", filePath, confirm: true })
    })
    setActionBusy(false)
    if (res.ok) { showToast("Document permanently purged", "success"); router.back() }
    else showToast("Purge failed", "error")
  }

  const loadDoc = useCallback(async () => {
    if (!id) return
    setLoading(true)
    try {
      const res = await fetch(`/api/documents/detail?id=${encodeURIComponent(id)}`)
      if (!res.ok) { showToast("Document not found", "error"); return }
      const data = await res.json()
      setDoc(data.document)
      setPendingCorrections(data.pendingCorrections ?? [])
    } catch { showToast("Failed to load document", "error") }
    finally { setLoading(false) }
  }, [id])

  const loadHistory = useCallback(async () => {
    if (!id) return
    try {
      const res = await fetch(`/api/documents/history?id=${encodeURIComponent(id)}`)
      const data = await res.json()
      setHistory(data.history ?? [])
    } catch { /* non-critical */ }
  }, [id])

  const loadRelated = useCallback(async () => {
    if (!id) return
    try {
      const res = await fetch(`/api/documents/related?id=${encodeURIComponent(id)}`)
      const data = await res.json()
      setRelated(data.related ?? [])
    } catch { /* non-critical */ }
  }, [id])

  useEffect(() => { loadDoc() }, [loadDoc])

  // Check if document is bookmarked
  useEffect(() => {
    if (!id) return
    fetch("/api/bookmarks?limit=200").then(r => r.json()).then(data => {
      const bm = data.bookmarks ?? []
      const match = bm.some((b: Record<string, unknown>) => {
        const fp = String(b.FILE_PATH ?? b.file_path ?? "")
        return fp === id
      })
      setBookmarked(match)
    }).catch(() => {})
  }, [id])
  useEffect(() => { if (tab === "history") loadHistory() }, [tab, loadHistory])
  useEffect(() => { if (tab === "related") loadRelated() }, [tab, loadRelated])

  function startEdit(fieldKey: string) {
    setEditField(fieldKey)
    setEditValue(String(gv(doc, fieldKey) ?? ""))
  }

  async function saveEdit() {
    if (!editField || !doc) return
    const fieldName = editField.toLowerCase()
    const originalValue = String(gv(doc, editField) ?? "")
    const filePath = String(gv(doc, "FILE_PATH") ?? "")
    if (editValue === originalValue) { setEditField(null); return }

    setSaving(true)
    try {
      const res = await fetch("/api/corrections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filePath, fieldName, originalValue, correctedValue: editValue }),
      })
      if (!res.ok) { showToast("Correction failed", "error"); return }
      showToast("Correction submitted", "success")
      setPendingCorrections(prev => [...prev, fieldName])
      setEditField(null)
    } catch { showToast("Network error", "error") }
    finally { setSaving(false) }
  }

  if (!id) {
    return <div className="sf-card p-10 text-center text-slate-500">No document selected.</div>
  }

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto animate-pulse space-y-4">
        <div className="h-8 bg-slate-200 rounded w-64" />
        <div className="sf-card p-6 space-y-3">
          <div className="h-5 bg-slate-100 rounded w-full" />
          <div className="h-5 bg-slate-100 rounded w-3/4" />
          <div className="h-5 bg-slate-100 rounded w-1/2" />
        </div>
      </div>
    )
  }

  if (!doc) {
    return (
      <div className="max-w-5xl mx-auto">
        <button onClick={() => router.back()} className="sf-btn-secondary text-xs flex items-center gap-1 mb-4">
          <ArrowLeft size={12} /> Back
        </button>
        <div className="sf-card p-10 text-center text-slate-500">Document not found or access denied.</div>
      </div>
    )
  }

  const fileName = String(gv(doc, "FILE_NAME") ?? gv(doc, "FILE_PATH") ?? "Unknown")
  const docType = String(gv(doc, "DOCUMENT_TYPE") ?? "")
  const confidence = Number(gv(doc, "CLASSIFICATION_CONFIDENCE") ?? 0)
  const lob = String(gv(doc, "LINE_OF_BUSINESS") ?? "")
  const status = String(gv(doc, "INGESTION_STATUS") ?? "")
  const filePath = String(gv(doc, "FILE_PATH") ?? "")
  const rawText = String(gv(doc, "FULL_TEXT") ?? "")
  const pageCount = Number(gv(doc, "PAGE_COUNT") ?? 0)

  const TABS: { id: Tab; label: string; icon: typeof FileText }[] = [
    { id: "viewer", label: "Document", icon: FileText },
    { id: "history", label: "History", icon: Clock },
    { id: "related", label: "Related", icon: Users },
    { id: "text", label: "Raw Text", icon: AlignLeft },
  ]

  return (
    <div className="max-w-5xl mx-auto">
      {DocModal}
      <DocLoadingIndicator loading={docLoading} />

      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <button onClick={() => router.back()} className="p-1.5 rounded-lg hover:bg-slate-100 text-blue-600 hover:text-blue-800 flex items-center gap-1 text-xs">
          <ArrowLeft size={16} /> Back
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-bold text-slate-800 truncate">{fileName}</h1>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            {docType && <span className="text-[10px] font-semibold bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">{docType}</span>}
            {lob && <span className="text-[10px] font-medium bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">{lob}</span>}
            <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
              confidence >= 0.8 ? "bg-green-100 text-green-700" :
              confidence >= 0.5 ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700"
            }`}>{(confidence * 100).toFixed(0)}% confidence</span>
            <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
              status === "COMPLETE" ? "bg-green-100 text-green-700" :
              status === "FAILED" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"
            }`}>{status}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={async () => {
              if (bookmarked) {
                const res = await fetch(`/api/bookmarks?file_path=${encodeURIComponent(filePath)}`, { method: "DELETE" })
                if (res.ok) { setBookmarked(false); showToast("Bookmark removed", "success") }
              } else {
                const res = await fetch("/api/bookmarks", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ filePath, documentType: docType, partyName: String(gv(doc, "PARTY_NAME") ?? "") }),
                })
                if (res.ok) { setBookmarked(true); showToast("Document saved", "success") }
              }
            }}
            className={`sf-btn-secondary text-xs flex items-center gap-1.5 ${bookmarked ? "text-[var(--brand-primary)] border-[var(--brand-primary)]" : ""}`}
          >
            <Bookmark size={12} fill={bookmarked ? "currentColor" : "none"} /> {bookmarked ? "Saved" : "Save"}
          </button>
          <button onClick={() => openPreview(filePath)} className="sf-btn-secondary text-xs flex items-center gap-1.5">
            <ExternalLink size={12} /> Preview
          </button>
          {isAdmin && (
            <>
              <button onClick={handleArchive} disabled={actionBusy} className="sf-btn-secondary text-xs flex items-center gap-1.5 text-amber-700 hover:bg-amber-50 disabled:opacity-50">
                <Archive size={12} /> Archive
              </button>
              <button onClick={handlePurge} disabled={actionBusy} className="sf-btn-secondary text-xs flex items-center gap-1.5 text-red-600 hover:bg-red-50 disabled:opacity-50">
                <Trash2 size={12} /> Purge
              </button>
            </>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-slate-200 mb-4">
        <div className="flex gap-0">
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium border-b-2 transition-colors ${
                tab === t.id ? "border-[var(--brand-primary)] text-[var(--brand-primary)]" : "border-transparent text-slate-500 hover:text-slate-700"
              }`}
            >
              <t.icon size={13} /> {t.label}
              {t.id === "related" && related.length > 0 && (
                <span className="bg-slate-100 text-slate-500 text-[9px] px-1.5 py-0.5 rounded-full">{related.length}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Document + Attributes Tab */}
      {tab === "viewer" && (
        <div className="flex flex-col lg:flex-row gap-4 h-[calc(100vh-14rem)]">
          {/* Left: document viewer with search */}
          <div className="flex-1 min-w-0 flex flex-col">
            <SearchWithinTab filePath={filePath} encodedId={id} />
          </div>
          {/* Right: attributes panel */}
          <div className="w-full lg:w-80 shrink-0 overflow-y-auto">
            <div className="sf-card p-4 space-y-3">
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Attributes</h3>
              {EDITABLE_FIELDS.map(field => {
                const value = String(gv(doc, field.key) ?? "")
                const isPending = pendingCorrections.includes(field.key.toLowerCase())
                const isEditing = editField === field.key
                return (
                  <div key={field.key} className="group">
                    <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">{field.label}</label>
                    {isEditing ? (
                      <div className="flex items-center gap-1 mt-0.5">
                        <input type="text" value={editValue} onChange={e => setEditValue(e.target.value)}
                          className="flex-1 px-2 py-1 text-xs border border-blue-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-200"
                          autoFocus onKeyDown={e => { if (e.key === "Enter") saveEdit(); if (e.key === "Escape") setEditField(null) }} />
                        <button onClick={saveEdit} disabled={saving} className="p-1 rounded text-green-600 hover:bg-green-50"><Check size={12} /></button>
                        <button onClick={() => setEditField(null)} className="p-1 rounded text-slate-400 hover:bg-slate-100"><X size={12} /></button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1 mt-0.5">
                        <p className="text-xs text-slate-800 flex-1 truncate">{value || <span className="text-slate-300 italic">—</span>}</p>
                        {isPending && <span className="text-[8px] font-semibold bg-amber-100 text-amber-700 px-1 py-0.5 rounded-full">Pending</span>}
                        <button onClick={() => startEdit(field.key)}
                          className="p-0.5 rounded text-slate-300 hover:text-blue-600 hover:bg-blue-50 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Pencil size={10} />
                        </button>
                      </div>
                    )}
                  </div>
                )
              })}
              {READONLY_FIELDS.map(field => (
                <div key={field.key}>
                  <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">{field.label}</label>
                  <p className="text-xs text-slate-800 mt-0.5 break-words">{String(gv(doc, field.key) ?? "") || <span className="text-slate-300 italic">—</span>}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* History Tab */}
      {tab === "history" && (
        <div className="sf-card p-5">
          {history.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-6">No processing history found.</p>
          ) : (
            <div className="space-y-3">
              {history.map((h, i) => {
                const ver = Number(gv(h, "PROCESSING_VERSION") ?? 0)
                const st = String(gv(h, "INGESTION_STATUS") ?? "")
                const started = String(gv(h, "PROCESSING_STARTED_AT") ?? "")
                const completed = String(gv(h, "PROCESSING_COMPLETED_AT") ?? "")
                const error = String(gv(h, "LAST_ERROR") ?? "")
                const errorStage = String(gv(h, "ERROR_STAGE") ?? "")
                const attempts = Number(gv(h, "PROCESSING_ATTEMPTS") ?? 0)
                return (
                  <div key={i} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${
                        st === "COMPLETE" ? "bg-green-100" : st === "FAILED" ? "bg-red-100" : "bg-amber-100"
                      }`}>
                        {st === "COMPLETE" ? <CheckCircle size={12} className="text-green-600" /> :
                         st === "FAILED" ? <AlertCircle size={12} className="text-red-600" /> :
                         <RefreshCw size={12} className="text-amber-600" />}
                      </div>
                      {i < history.length - 1 && <div className="w-px flex-1 bg-slate-200 mt-1" />}
                    </div>
                    <div className="pb-4 flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-slate-700">Version {ver}</span>
                        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
                          st === "COMPLETE" ? "bg-green-100 text-green-700" : st === "FAILED" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"
                        }`}>{st}</span>
                        {attempts > 1 && <span className="text-[10px] text-slate-400">{attempts} attempts</span>}
                      </div>
                      <div className="text-[11px] text-slate-500 mt-0.5">
                        {started && <span>Started: {new Date(started).toLocaleString()}</span>}
                        {completed && <span className="ml-3">Completed: {new Date(completed).toLocaleString()}</span>}
                      </div>
                      {error && (
                        <div className="mt-1 text-[11px] text-red-600 bg-red-50 px-2 py-1 rounded border border-red-100">
                          {errorStage && <span className="font-semibold">[{errorStage}]</span>} {error}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Related Tab */}
      {tab === "related" && (
        <div className="sf-card p-5">
          {related.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-6">No related documents found.</p>
          ) : (
            <table className="w-full text-xs">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr>
                  {["Document", "Type", FIELD_LABELS.party_name, "LOB", "Status"].map(h => (
                    <th key={h} className="text-left px-3 py-2 text-slate-500 font-semibold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {related.map((r, i) => {
                  const fp = String(gv(r, "FILE_PATH") ?? "")
                  const fn = String(gv(r, "FILE_NAME") ?? fp.split("/").pop() ?? "")
                  const dt = String(gv(r, "DOCUMENT_TYPE") ?? "")
                  const ins = String(gv(r, "PARTY_NAME") ?? "")
                  const lb = String(gv(r, "LINE_OF_BUSINESS") ?? "")
                  const st = String(gv(r, "INGESTION_STATUS") ?? "")
                  return (
                    <tr key={i} className="border-b border-slate-50 hover:bg-slate-50/50">
                      <td className="px-3 py-2">
                        <Link href={`/documents/detail?id=${encodeDocId(fp)}`} className="text-blue-600 hover:text-blue-800 font-medium truncate block max-w-[200px]">{fn}</Link>
                      </td>
                      <td className="px-3 py-2 text-slate-600">{dt}</td>
                      <td className="px-3 py-2 text-slate-600">{ins}</td>
                      <td className="px-3 py-2 text-slate-600">{lb}</td>
                      <td className="px-3 py-2">
                        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${st === "COMPLETE" ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"}`}>{st}</span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Raw Text Tab */}
      {tab === "text" && (
        <div className="sf-card p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="text-xs text-slate-500">
              {pageCount > 0 && <span>{pageCount} page{pageCount !== 1 ? "s" : ""} · </span>}
              Extracted text content
            </div>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-1.5 text-[10px] text-slate-600 cursor-pointer select-none">
                <input type="checkbox" checked={highlightOn} onChange={e => setHighlightOn(e.target.checked)}
                  className="w-3.5 h-3.5 rounded border-slate-300 text-[var(--brand-primary)] focus:ring-[var(--brand-primary)]" />
                <Highlighter size={11} />
                Highlight values
              </label>
              <button onClick={() => openPreview(filePath)} className="text-[10px] text-blue-600 hover:text-blue-800 font-medium">Preview Original</button>
            </div>
          </div>
          {/* Legend */}
          {highlightOn && rawText && (
            <div className="flex flex-wrap gap-2 mb-3">
              {HIGHLIGHT_CATEGORIES.map(cat => (
                <span key={cat.label} className={`text-[9px] font-medium px-2 py-0.5 rounded-full border ${cat.bg} ${cat.text} ${cat.border}`}>
                  {cat.label}
                </span>
              ))}
            </div>
          )}
          {rawText ? (
            <pre className="text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded-lg p-4 max-h-[60vh] overflow-y-auto whitespace-pre-wrap font-mono leading-relaxed">
              {highlightOn && doc ? buildHighlightedText(rawText, doc) : rawText}
            </pre>
          ) : (
            <p className="text-sm text-slate-400 text-center py-6">No parsed text available for this document.</p>
          )}
        </div>
      )}
    </div>
  )
}

export default function DocumentDetailPage() {
  return (
    <Suspense fallback={<div className="max-w-5xl mx-auto animate-pulse"><div className="h-8 bg-slate-200 rounded w-64" /></div>}>
      <DocumentDetailContent />
    </Suspense>
  )
}
