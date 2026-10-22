"use client"

import { FIELD_LABELS } from "@/lib/field-labels"
import { useState, useEffect, useCallback, Suspense } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import { DocFileLink, useDocumentPreview, DocLoadingIndicator } from "@/components/doc-download"
import {
  Search, ChevronDown, ChevronUp, ThumbsUp, ThumbsDown,
  Bookmark, BookmarkCheck, Save, Check, X, ChevronLeft, ChevronRight, ExternalLink
} from "lucide-react"
import { PageHeader } from "@/components/page-header"
import { showToast } from "@/components/toast"
import { Spinner } from "@/components/spinner"
import { lobBadgeClass, statusBadgeClass } from "@/components/badge-utils"
import { MatchNavigator, type MatchEntry } from "./_components/match-navigator"
import { InlineDocViewer } from "./_components/inline-doc-viewer"
import Link from "next/link"
import { encodeDocId } from "@/lib/doc-utils"

interface SearchResult {
  document_type?: string; party_name?: string; line_of_business?: string
  doc_subtype?: string; doc_status?: string
  doc_summary?: string; file_path?: string; src_file_id?: string
  start_date?: string; end_date?: string; reference_date?: string
  primary_amount?: string; total_amount?: string
  key_terms?: string; file_format?: string
  reference_number?: string; case_number?: string
  src_reference_number?: string; src_case_number?: string
  issuer_name?: string
  classification_confidence?: number
  match_snippets?: string[]
  match_pages?: (number | null)[]
  match_scores?: number[]
  match_page?: number
  match_count?: number
}

interface FilterOptions {
  statuses: string[]; formats: string[]; lobs: string[]; docTypes: string[]
}



const FALLBACK_SUGGESTIONS = [
  { label: "Documents", q: "recent documents" },
  { label: "Action Required", q: "documents requiring action" },
  { label: "Expiring Soon", q: "expiration renewal upcoming" },
  { label: "Certificates", q: "certificate" },
]

const STATIC_FORMATS  = ["PDF", "TIFF", "DOCX", "JPEG", "PNG"]
const STATIC_STATUSES: string[] = []
const STATIC_LOBS: string[]     = []

function SkeletonRow() {
  return (
    <tr className="animate-pulse">
      <td className="px-3 py-3"><div className="h-3 bg-slate-200 rounded w-28" /></td>
      <td className="px-3 py-3"><div className="h-3 bg-slate-200 rounded w-32" /></td>
      <td className="px-3 py-3"><div className="h-3 bg-slate-200 rounded w-16" /></td>
      <td className="px-3 py-3"><div className="h-3 bg-slate-200 rounded w-14" /></td>
      <td className="px-3 py-3"><div className="h-3 bg-slate-200 rounded w-20" /></td>
      <td className="px-3 py-3"><div className="h-3 bg-slate-200 rounded w-12" /></td>
    </tr>
  )
}

function SearchPage() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const { open: openDoc, loading: docLoading, ModalComponent: DocModal } = useDocumentPreview()

  const [query, setQuery]       = useState(searchParams.get("q") ?? "")
  const [results, setResults]   = useState<SearchResult[]>([])
  const [loading, setLoading]   = useState(false)
  const [elapsed, setElapsed]   = useState(0)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [feedback, setFeedback]   = useState<Record<number, "up" | "down">>({})
  const [bookmarked, setBookmarked] = useState<Set<string>>(new Set())
  const [savingSearch, setSavingSearch] = useState(false)
  const [saveSearchOpen, setSaveSearchOpen] = useState(false)
  const [saveSearchName, setSaveSearchName] = useState("")
  const [saveVisibility, setSaveVisibility] = useState<"personal" | "role" | "global">("personal")
  const [saveRole, setSaveRole] = useState("")
  const [filterOpts, setFilterOpts] = useState<FilterOptions>({
    statuses: STATIC_STATUSES, formats: STATIC_FORMATS, lobs: STATIC_LOBS, docTypes: [],
  })
  const [suggestions, setSuggestions] = useState(FALLBACK_SUGGESTIONS)

  useEffect(() => {
    // Fetch dynamic filter options (LOBs, doc types, etc.) from the database
    fetch("/api/filters")
      .then(r => r.json())
      .then(d => {
        if (d.lobs?.length || d.docTypes?.length) {
          setFilterOpts(prev => ({
            ...prev,
            lobs: d.lobs?.length ? d.lobs : prev.lobs,
            docTypes: d.docTypes?.length ? d.docTypes : prev.docTypes,
            statuses: d.statuses?.length ? d.statuses : prev.statuses,
            formats: d.formats?.length ? d.formats : prev.formats,
          }))
        }
      })
      .catch(() => {})

    fetch("/api/suggestions")
      .then(r => r.json())
      .then(d => {
        if (d.suggestions?.length) {
          setSuggestions(d.suggestions.map((s: { label: string; query: string }) => ({ label: s.label, q: s.query })))
        }
      })
      .catch(() => {})
  }, [])

  // Pagination
  const [page, setPage] = useState(0)
  const pageSize = 20

  // Filters
  const [fDocType, setFDocType] = useState(searchParams.get("docType") ?? "")
  const [fLob, setFLob]         = useState(searchParams.get("lob")     ?? "")
  const [fStatus, setFStatus]   = useState(searchParams.get("status")  ?? "")
  const [fFormat, setFFormat]   = useState(searchParams.get("format")  ?? "")
  const [limit, setLimit]       = useState(50)
  const [scopeId, setScopeId]   = useState(searchParams.get("scope") ?? "")
  const scopeFileName = scopeId ? (() => { try { return atob(scopeId.replace(/-/g, "+").replace(/_/g, "/")).split("/").pop() ?? "" } catch { return "" } })() : ""

  // Detail panel
  const [selectedDoc, setSelectedDoc] = useState<SearchResult | null>(null)
  const [sortCol, setSortCol] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc")

  // Scoped match navigation
  const [activeMatchIdx, setActiveMatchIdx] = useState(0)

  // Build structured matches when in scoped mode
  const scopedMatches: MatchEntry[] = scopeId && results.length > 0
    ? (results[0]?.match_snippets ?? []).map((snippet, i) => ({
        page: results[0]?.match_pages?.[i] ?? null,
        snippet,
        score: results[0]?.match_scores?.[i] ?? undefined,
      }))
    : []
  const scopedFilePath = scopeId && results.length > 0 ? results[0]?.file_path ?? "" : ""
  const decodedScopeFilePath = scopeId ? (() => { try { return atob(scopeId.replace(/-/g, "+").replace(/_/g, "/")) } catch { return "" } })() : ""

  // Keyboard navigation for scoped match viewer
  useEffect(() => {
    if (!scopeId || scopedMatches.length === 0) return
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.key === "ArrowDown" || e.key === "j") {
        e.preventDefault()
        setActiveMatchIdx(i => Math.min(scopedMatches.length - 1, i + 1))
      } else if (e.key === "ArrowUp" || e.key === "k") {
        e.preventDefault()
        setActiveMatchIdx(i => Math.max(0, i - 1))
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [scopeId, scopedMatches.length])

  useEffect(() => {
    // Filters already fetched by the first useEffect — only load bookmarks and initial query here
    fetch("/api/bookmarks")
      .then(r => r.json())
      .then((d: { bookmarks?: { file_path?: string }[] }) => {
        if (d.bookmarks?.length) {
          setBookmarked(new Set(d.bookmarks.map(b => b.file_path ?? "").filter(Boolean)))
        }
      })
      .catch(() => {})
    const initialQ = searchParams.get("q")
    if (initialQ?.trim()) runSearch(initialQ)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Auto-search when scoped to a single document (debounced on typing)
  useEffect(() => {
    if (!scopeId || !query.trim()) return
    const timer = setTimeout(() => runSearch(query), 400)
    return () => clearTimeout(timer)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, scopeId])

  const runSearch = useCallback(async (q = query) => {
    if (!q.trim()) return
    setLoading(true)
    setSaveSearchOpen(false)
    setPage(0)
    setSelectedDoc(null)
    setActiveMatchIdx(0)
    setSortCol(null)
    setSortDir("asc")
    const t0 = Date.now()
    const params = new URLSearchParams({ q, limit: String(limit) })
    if (fLob)     params.set("lob", fLob)
    if (fDocType) params.set("docType", fDocType)
    if (fStatus)  params.set("status", fStatus)
    if (fFormat)  params.set("format", fFormat)
    if (scopeId)  params.set("scope", scopeId)
    try {
      const res = await fetch(`/api/search?${params}`)
      const data = await res.json()
      if (!res.ok) {
        showToast(data.error ?? "Search failed — please try again", "error")
        setResults([])
      } else {
        setResults(Array.isArray(data) ? data : [])
      }
      setElapsed(Date.now() - t0)
      const urlParams = new URLSearchParams({ q })
      if (fLob) urlParams.set("lob", fLob)
      if (fDocType) urlParams.set("docType", fDocType)
      if (fStatus) urlParams.set("status", fStatus)
      if (fFormat) urlParams.set("format", fFormat)
      window.history.replaceState(null, "", `/search?${urlParams}`)
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Search request failed", "error")
      setResults([])
    } finally {
      setLoading(false)
    }
  }, [query, limit, fDocType, fLob, fStatus, fFormat, scopeId])

  async function submitFeedback(i: number, type: "thumbs_up" | "thumbs_down") {
    const doc = results[i]
    setFeedback(f => ({ ...f, [i]: type === "thumbs_up" ? "up" : "down" }))
    try {
      await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filePath: doc.file_path,
          feedbackType: type,
          queryText: query,
          documentType: doc.document_type,
        }),
      })
    } catch {}
  }

  async function toggleBookmark(doc: SearchResult) {
    const path = doc.file_path ?? ""
    if (!path) return
    const isBookmarked = bookmarked.has(path)
    const newSet = new Set(bookmarked)
    if (isBookmarked) {
      newSet.delete(path)
      setBookmarked(newSet)
      try {
        const res = await fetch(`/api/bookmarks?file_path=${encodeURIComponent(path)}`, { method: "DELETE" })
        if (!res.ok) { newSet.add(path); setBookmarked(new Set(newSet)); showToast("Failed to remove bookmark", "error"); return }
        showToast("Bookmark removed", "info")
      } catch { newSet.add(path); setBookmarked(new Set(newSet)); showToast("Network error", "error") }
    } else {
      newSet.add(path)
      setBookmarked(newSet)
      try {
        const res = await fetch("/api/bookmarks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filePath: path, irFileId: doc.src_file_id, documentType: doc.document_type, partyName: doc.party_name }),
        })
        if (!res.ok) { newSet.delete(path); setBookmarked(new Set(newSet)); showToast("Failed to bookmark", "error"); return }
        showToast("Document bookmarked", "success")
      } catch { newSet.delete(path); setBookmarked(new Set(newSet)); showToast("Network error", "error") }
    }
  }

  async function saveSearch() {
    if (!saveSearchName.trim() || !query.trim()) return
    setSavingSearch(true)
    try {
      const res = await fetch("/api/saved", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: saveSearchName, queryText: query,
          filtersJson: JSON.stringify({ docType: fDocType, lob: fLob, status: fStatus, format: fFormat }),
          visibility: saveVisibility, sharedRole: saveVisibility === "role" ? saveRole : undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) { showToast(`Save failed: ${data.error ?? "Unknown error"}`, "error") }
      else { showToast(`Search "${saveSearchName}" saved`, "success"); setSaveSearchOpen(false); setSaveSearchName("") }
    } catch (err) { showToast(err instanceof Error ? err.message : "Save failed", "error") }
    finally { setSavingSearch(false) }
  }

  // Sort results
  const sortedResults = (() => {
    if (!sortCol) return results
    const sorted = [...results].sort((a, b) => {
      let av = "", bv = ""
      if (sortCol === "document_type") { av = a.document_type ?? ""; bv = b.document_type ?? "" }
      else if (sortCol === "party") { av = a.party_name || a.issuer_name || ""; bv = b.party_name || b.issuer_name || "" }
      else if (sortCol === "lob") { av = a.line_of_business ?? ""; bv = b.line_of_business ?? "" }
      else if (sortCol === "status") { av = a.doc_status ?? ""; bv = b.doc_status ?? "" }
      return av.localeCompare(bv)
    })
    return sortDir === "desc" ? sorted.reverse() : sorted
  })()

  // Paginated slice
  const pagedResults = sortedResults.slice(page * pageSize, (page + 1) * pageSize)
  const totalPages = Math.ceil(sortedResults.length / pageSize)

  return (
    <div className="flex gap-4 h-[calc(100vh-4rem)]">
      {DocModal}
      <DocLoadingIndicator loading={docLoading} />

      {/* Main content */}
      <div className={`flex-1 min-w-0 flex flex-col ${selectedDoc ? "max-w-[60%]" : ""}`}>
        <PageHeader title="Document Search" icon={Search} />

        {/* Scope banner */}
        {scopeId && scopeFileName && (
          <div className="flex items-center gap-2 px-3 py-2 mb-3 bg-amber-50 border border-amber-200 rounded-lg text-xs">
            <span className="text-amber-700">Searching within: <span className="font-semibold">{scopeFileName}</span></span>
            {!loading && scopedMatches.length > 0 && (
              <span className="px-1.5 py-0.5 rounded-full bg-amber-200 text-amber-800 text-[10px] font-semibold">
                {scopedMatches.length} match{scopedMatches.length !== 1 ? "es" : ""}
              </span>
            )}
            <button onClick={() => { setScopeId(""); setResults([]) }} className="ml-auto text-amber-600 hover:text-amber-800 font-medium flex items-center gap-1">
              <X size={11} /> Clear scope
            </button>
          </div>
        )}

        {/* Search bar */}
        <div className="sf-card p-4 space-y-3 mb-3 shrink-0">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                className="w-full pl-9 pr-3 py-2.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:border-transparent"
                style={{ "--tw-ring-color": "var(--brand-primary)" } as React.CSSProperties}
                placeholder="e.g. contracts with automatic renewal"
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={e => e.key === "Enter" && runSearch()}
                autoFocus
              />
            </div>
            <button className="sf-btn-primary px-5 flex items-center gap-1.5" onClick={() => runSearch()} disabled={loading}>
              {loading ? <><Spinner size={14} /> Searching</> : "Search"}
            </button>
            <button className="sf-btn-secondary flex items-center gap-1" onClick={() => setFiltersOpen(f => !f)}>
              Filters {filtersOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
            {query.trim() && (
              <div className="relative">
                <button
                  className="sf-btn-secondary flex items-center gap-1.5 text-xs py-2"
                  onClick={() => { setSaveSearchOpen(o => !o); setSaveSearchName(query.slice(0,40)) }}
                  title="Save this search"
                ><Save size={14} /></button>
                {saveSearchOpen && (
                  <div className="absolute right-0 top-full mt-1.5 bg-white border border-slate-200 rounded-xl shadow-lg p-3 z-20 w-72">
                    <p className="text-xs font-semibold text-slate-700 mb-2">Save this search</p>
                    <input className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 mb-2" placeholder="Search name" value={saveSearchName} onChange={e => setSaveSearchName(e.target.value)} onKeyDown={e => e.key === "Enter" && saveSearch()} autoFocus />
                    <div className="mb-2">
                      <label className="text-[10px] text-slate-500 mb-1 block">Visibility</label>
                      <div className="flex gap-1">
                        {(["personal", "role", "global"] as const).map(v => (
                          <button key={v} className={`flex-1 text-[10px] py-1 rounded-md border ${saveVisibility === v ? "border-blue-400 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-500 hover:bg-slate-50"}`} onClick={() => setSaveVisibility(v)}>
                            {v === "personal" ? "Just Me" : v === "role" ? "My Role" : "Everyone"}
                          </button>
                        ))}
                      </div>
                    </div>
                    {saveVisibility === "role" && (
                      <input className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 mb-2" placeholder="Role name" value={saveRole} onChange={e => setSaveRole(e.target.value)} />
                    )}
                    <div className="flex gap-1.5">
                      <button className="sf-btn-primary flex-1 text-xs py-1.5 flex items-center justify-center gap-1 disabled:opacity-50" disabled={savingSearch || !saveSearchName.trim() || (saveVisibility === "role" && !saveRole.trim())} onClick={saveSearch}><Check size={11} /> Save</button>
                      <button className="sf-btn-secondary text-xs py-1.5 px-2" onClick={() => setSaveSearchOpen(false)}><X size={11} /></button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {filtersOpen && (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2 pt-1">
              <select className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 text-slate-600" value={fLob} onChange={e => setFLob(e.target.value)}>
                <option value="">LOB: All</option>
                {filterOpts.lobs.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
              <select className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 text-slate-600" value={fDocType} onChange={e => setFDocType(e.target.value)}>
                <option value="">Doc Type: All</option>
                {filterOpts.docTypes.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
              <select className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 text-slate-600" value={fFormat} onChange={e => setFFormat(e.target.value)}>
                <option value="">Format: All</option>
                {filterOpts.formats.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
              <select className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 text-slate-600" value={fStatus} onChange={e => setFStatus(e.target.value)}>
                <option value="">Status: All</option>
                {filterOpts.statuses.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
              <select className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 text-slate-600" value={limit} onChange={e => setLimit(+e.target.value)}>
                {[10,20,50,100].map(n => <option key={n} value={n}>{n} max results</option>)}
              </select>
            </div>
          )}
        </div>

        {/* Results: scoped doc viewer OR standard table */}
        {scopeId ? (
          <div className="sf-card flex-1 overflow-hidden flex flex-col lg:flex-row">
            {/* Match navigator sidebar — only when matches exist */}
            {scopedMatches.length > 0 && (
              <div className="w-full lg:w-64 shrink-0 border-b lg:border-b-0 lg:border-r border-slate-200 dark:border-slate-600 overflow-hidden flex flex-col max-h-48 lg:max-h-none">
                <MatchNavigator
                  matches={scopedMatches}
                  activeIndex={activeMatchIdx}
                  onSelect={setActiveMatchIdx}
                  query={query}
                />
              </div>
            )}
            {/* Inline document viewer — always shown when scoped */}
            <div className="flex-1 min-w-0">
              <InlineDocViewer
                filePath={scopedFilePath || decodedScopeFilePath}
                page={scopedMatches[activeMatchIdx]?.page}
                highlightTerms={query.trim().split(/\s+/).filter(w => w.length > 2)}
              />
            </div>
          </div>
        ) : loading ? (
          <div className="sf-card flex-1 overflow-hidden">
            <table className="w-full text-xs">
              <thead><tr className="bg-slate-50 border-b border-slate-200 text-left">
                <th className="px-3 py-2.5 font-semibold text-slate-600">Document Type</th>
                <th className="px-3 py-2.5 font-semibold text-slate-600">{FIELD_LABELS.party_name}</th>
                <th className="px-3 py-2.5 font-semibold text-slate-600">LOB</th>
                <th className="px-3 py-2.5 font-semibold text-slate-600">Status</th>
                <th className="px-3 py-2.5 font-semibold text-slate-600">Match</th>
                <th className="px-3 py-2.5 font-semibold text-slate-600">Actions</th>
              </tr></thead>
              <tbody>{Array.from({ length: 8 }).map((_, i) => <SkeletonRow key={i} />)}</tbody>
            </table>
          </div>
        ) : results.length > 0 ? (
          <div className="sf-card flex-1 overflow-auto flex flex-col">
            {/* Results header */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-slate-100 shrink-0">
              <p className="text-xs text-slate-500">
                {results.length} match{results.length !== 1 ? "es" : ""} · {elapsed}ms
                <span className="ml-1 text-slate-400" title="Ranked by Cortex Search">ⓘ</span>
              </p>
              {totalPages > 1 && (
                <div className="flex items-center gap-2">
                  <button disabled={page === 0} onClick={() => setPage(p => p - 1)} className="p-1 rounded hover:bg-slate-100 disabled:opacity-30"><ChevronLeft size={14} /></button>
                  <span className="text-xs text-slate-600">Page {page + 1} of {totalPages}</span>
                  <button disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)} className="p-1 rounded hover:bg-slate-100 disabled:opacity-30"><ChevronRight size={14} /></button>
                </div>
              )}
            </div>

            <div className="flex-1 overflow-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-slate-50 z-10"><tr className="border-b border-slate-200 text-left">
                  {[
                    { key: "document_type", label: "Document Type" },
                    { key: "party", label: FIELD_LABELS.party_name },
                    { key: "lob", label: "LOB" },
                    { key: "status", label: "Status" },
                  ].map(col => (
                    <th key={col.key}
                      className="px-3 py-2.5 font-semibold text-slate-600 cursor-pointer select-none hover:text-slate-900 transition-colors"
                      onClick={() => {
                        if (sortCol === col.key) setSortDir(d => d === "asc" ? "desc" : "asc")
                        else { setSortCol(col.key); setSortDir("asc") }
                        setPage(0)
                      }}
                    >
                      <span className="inline-flex items-center gap-1">
                        {col.label}
                        {sortCol === col.key && (
                          <span className="text-[10px]">{sortDir === "asc" ? "▲" : "▼"}</span>
                        )}
                      </span>
                    </th>
                  ))}
                  <th className="px-3 py-2.5 font-semibold text-slate-600">Match</th>
                  <th className="px-3 py-2.5 font-semibold text-slate-600 w-24">Actions</th>
                </tr></thead>
                <tbody>
                  {pagedResults.map((doc, idx) => {
                    const globalIdx = page * pageSize + idx
                    const isSelected = selectedDoc?.file_path === doc.file_path && selectedDoc?.src_file_id === doc.src_file_id
                    return (
                      <tr
                        key={doc.src_file_id ?? doc.file_path ?? globalIdx}
                        className={`border-b border-slate-50 cursor-pointer transition-colors ${isSelected ? "bg-blue-50" : "hover:bg-slate-50"}`}
                        onMouseEnter={() => setSelectedDoc(doc)}
                        onClick={() => {
                          const id = encodeDocId(doc.file_path ?? "")
                          router.push(`/documents/detail?id=${id}&from=search`)
                        }}
                      >
                        <td className="px-3 py-2.5">
                          <span className="font-medium text-slate-800">{doc.document_type ?? "Document"}</span>
                          {doc.file_format && (
                            <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">{doc.file_format}</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-slate-700 max-w-[180px] truncate">
                          {doc.party_name || doc.issuer_name || (doc.file_path?.split("/").pop() ?? "—")}
                        </td>
                        <td className="px-3 py-2.5">
                          {doc.line_of_business ? (
                            <span className={lobBadgeClass(doc.line_of_business)}>
                              {doc.line_of_business}
                            </span>
                          ) : "—"}
                        </td>
                        <td className="px-3 py-2.5">
                          {doc.doc_status ? (
                            <span className={statusBadgeClass(doc.doc_status)}>
                              {doc.doc_status}
                            </span>
                          ) : "—"}
                        </td>
                        <td className="px-3 py-2.5 text-slate-500 max-w-[200px] truncate">
                          {doc.match_snippets?.[0]?.slice(0, 60) ?? doc.doc_summary?.slice(0, 60) ?? "—"}
                        </td>
                        <td className="px-3 py-2.5" onClick={e => e.stopPropagation()}>
                          <div className="flex gap-0.5">
                            <button
                              className={`p-1 rounded transition-colors ${feedback[globalIdx] === "up" ? "bg-green-100 text-green-600" : "hover:bg-slate-100 text-slate-400"}`}
                              onClick={() => submitFeedback(globalIdx, "thumbs_up")}
                              title="Relevant"
                            ><ThumbsUp size={12} /></button>
                            <button
                              className={`p-1 rounded transition-colors ${feedback[globalIdx] === "down" ? "bg-red-100 text-red-600" : "hover:bg-slate-100 text-slate-400"}`}
                              onClick={() => submitFeedback(globalIdx, "thumbs_down")}
                              title="Not relevant"
                            ><ThumbsDown size={12} /></button>
                            <button
                              className={`p-1 rounded transition-colors ${bookmarked.has(doc.file_path ?? "") ? "text-amber-500 bg-amber-50" : "hover:bg-slate-100 text-slate-400"}`}
                              onClick={() => toggleBookmark(doc)}
                              title="Bookmark"
                            >
                              {bookmarked.has(doc.file_path ?? "") ? <BookmarkCheck size={12} /> : <Bookmark size={12} />}
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Bottom pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-3 py-2 border-t border-slate-100 shrink-0">
                <span className="text-xs text-slate-500">
                  Showing {page * pageSize + 1}–{Math.min((page + 1) * pageSize, results.length)} of {results.length}
                </span>
                <div className="flex items-center gap-2">
                  <button disabled={page === 0} onClick={() => setPage(p => p - 1)} className="sf-btn-secondary text-xs py-1 px-2 disabled:opacity-30"><ChevronLeft size={12} /></button>
                  <button disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)} className="sf-btn-secondary text-xs py-1 px-2 disabled:opacity-30"><ChevronRight size={12} /></button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="sf-card p-5 flex-1">
            {query.trim() ? (
              <div className="text-center py-8">
                <Search size={32} className="text-slate-200 mx-auto mb-2" />
                <p className="text-slate-500 text-sm font-medium mb-1">No results found</p>
                <p className="text-xs text-slate-400">Try broadening your query or adjusting the filters above.</p>
              </div>
            ) : (
              <>
                <p className="text-sm text-slate-500 mb-3">Suggested searches:</p>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                  {suggestions.map(({ label, q }) => (
                    <button
                      key={label}
                      className="text-left text-sm px-3 py-2 rounded-lg border border-slate-200 text-slate-600 transition-all hover:border-[var(--brand-primary)] hover:bg-[var(--brand-pale)] hover:text-[var(--brand-dark)]"
                      onClick={() => { setQuery(q); runSearch(q) }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Detail side panel */}
      {selectedDoc && (
        <div className="w-[40%] max-w-md sf-card overflow-auto shrink-0">
          <div className="p-4 border-b border-slate-100 flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-800">Document Details</h2>
            <button className="p-1 rounded hover:bg-slate-100 text-slate-400" onClick={() => setSelectedDoc(null)}><X size={14} /></button>
          </div>
          <div className="p-4 space-y-4">
            {/* Type header */}
            <div>
              <p className="text-lg font-semibold text-slate-800">{selectedDoc.document_type ?? "Document"}</p>
              <div className="flex gap-1.5 mt-1 flex-wrap">
                {selectedDoc.line_of_business && <span className={lobBadgeClass(selectedDoc.line_of_business)}>{selectedDoc.line_of_business}</span>}
                {selectedDoc.doc_status && <span className={statusBadgeClass(selectedDoc.doc_status)}>{selectedDoc.doc_status}</span>}
                {selectedDoc.file_format && <span className="sf-badge bg-slate-100 text-slate-600">{selectedDoc.file_format}</span>}
              </div>
            </div>

            {/* Match snippet */}
            {selectedDoc.match_snippets && selectedDoc.match_snippets.length > 0 && (
              <div className="bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                <p className="text-[10px] font-semibold text-amber-700 mb-0.5">
                  Matched on {selectedDoc.match_count ?? 1} page{(selectedDoc.match_count ?? 1) > 1 ? "s" : ""}
                </p>
                <p className="text-xs text-slate-700 italic">
                  &ldquo;{selectedDoc.match_snippets[0].slice(0, 300)}{(selectedDoc.match_snippets[0]?.length ?? 0) > 300 ? "…" : ""}&rdquo;
                </p>
              </div>
            )}

            {/* Metadata grid */}
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
              {[
                [FIELD_LABELS.party_name,       selectedDoc.party_name],
                [FIELD_LABELS.issuer_name,       selectedDoc.issuer_name],
                [FIELD_LABELS.doc_subtype, selectedDoc.doc_subtype],
                [FIELD_LABELS.start_date,     selectedDoc.start_date],
                [FIELD_LABELS.end_date,    selectedDoc.end_date],
                [FIELD_LABELS.primary_amount, selectedDoc.primary_amount],
                [FIELD_LABELS.total_amount,     selectedDoc.total_amount],
                [FIELD_LABELS.reference_number,      selectedDoc.reference_number ?? selectedDoc.src_reference_number],
                [FIELD_LABELS.case_number,       selectedDoc.case_number ?? selectedDoc.src_case_number],
                [FIELD_LABELS.src_file_id,    selectedDoc.src_file_id],
                ["Confidence",    selectedDoc.classification_confidence != null ? `${Math.round(selectedDoc.classification_confidence * 100)}%` : undefined],
              ].filter(([, v]) => v).map(([label, val]) => (
                <div key={label as string}>
                  <span className="text-slate-400">{label}: </span>
                  <span className="text-slate-700 font-medium">{val}</span>
                </div>
              ))}
            </div>

            {/* Summary */}
            {selectedDoc.doc_summary && (
              <div className="text-xs">
                <span className="text-slate-400 font-medium">Summary: </span>
                <span className="text-slate-700">{selectedDoc.doc_summary}</span>
              </div>
            )}

            {/* Additional snippets */}
            {selectedDoc.match_snippets && selectedDoc.match_snippets.length > 1 && (
              <div className="text-xs">
                <span className="text-slate-400 font-medium">Other matching excerpts:</span>
                <ul className="mt-1 space-y-1">
                  {selectedDoc.match_snippets.slice(1, 4).map((s, si) => (
                    <li key={si} className="text-slate-600 italic pl-2 border-l-2 border-amber-200">
                      &ldquo;{s.slice(0, 200)}{s.length > 200 ? "…" : ""}&rdquo;
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* File link + view detail */}
            {selectedDoc.file_path && (
              <div className="space-y-2 pt-2 border-t border-slate-100">
                <DocFileLink filePath={selectedDoc.file_path} className="text-[10px] truncate block" onOpen={openDoc} />
                <Link
                  href={`/documents/detail?id=${encodeDocId(selectedDoc.file_path ?? "")}&from=search`}
                  className="inline-flex items-center gap-1 text-xs font-medium hover:underline"
                  style={{ color: "var(--brand-primary)" }}
                >
                  <ExternalLink size={11} /> Open full detail
                </Link>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default function SearchPageWrapper() {
  return (
    <Suspense fallback={
      <div className="sf-card p-10 text-center">
        <div className="animate-pulse space-y-3">
          <div className="h-4 bg-slate-200 rounded w-48 mx-auto" />
          <div className="h-10 bg-slate-100 rounded w-full" />
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-8 bg-slate-100 rounded" />)}
          </div>
        </div>
      </div>
    }>
      <SearchPage />
    </Suspense>
  )
}
