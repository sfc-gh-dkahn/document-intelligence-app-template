"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { Search, Bookmark, Trash2, Play, Copy, Clock } from "lucide-react"
import { PageHeader } from "@/components/page-header"
import Link from "next/link"
import { showToast } from "@/components/toast"
import { DocFileLink, useDocumentPreview, DocLoadingIndicator } from "@/components/doc-download"
import { EmptyState } from "@/components/empty-state"
import { TabBar } from "@/components/tab-bar"
import { encodeDocId } from "@/lib/doc-utils"

interface SavedSearch {
  SEARCH_ID?: string; SEARCH_NAME?: string; QUERY_TEXT?: string
  FILTERS_JSON?: string; CREATED_AT?: string; LAST_RUN_AT?: string
}
interface BookmarkedDoc {
  BOOKMARK_ID?: string; FILE_PATH?: string; SRC_FILE_ID?: string
  DOCUMENT_TYPE?: string; PARTY_NAME?: string; PERSONAL_NOTE?: string; CREATED_AT?: string
}

export default function SavedPage() {
  const router = useRouter()
  const { open: openDoc, loading: docLoading, ModalComponent: DocModal } = useDocumentPreview()
  const [searches, setSearches]   = useState<SavedSearch[]>([])
  const [bookmarks, setBookmarks] = useState<BookmarkedDoc[]>([])
  const [loading, setLoading]     = useState(true)
  const [activeTab, setActiveTab] = useState<"searches" | "bookmarks">("searches")

  async function load() {
    setLoading(true)
    try {
      const res = await fetch("/api/saved")
      const data = await res.json()
      if (!res.ok) {
        showToast(data.error ?? "Failed to load saved items", "error")
      } else {
        setSearches(data.searches ?? [])
        setBookmarks(data.bookmarks ?? [])
      }
    } finally {
      setLoading(false)
    }
  }

  async function deleteSearch(id: string) {
    try {
      const res = await fetch(`/api/saved?id=${encodeURIComponent(id)}`, { method: "DELETE" })
      const d = await res.json()
      if (d.ok) {
        setSearches(s => s.filter(x => (x.SEARCH_ID ?? (x as Record<string,unknown>)["search_id"]) !== id))
      } else {
        showToast(`Delete failed: ${d.error}`, "error")
      }
    } catch {
      showToast("Delete failed — network error", "error")
    }
  }

  async function deleteBookmark(filePath: string) {
    try {
      const res = await fetch(`/api/bookmarks?file_path=${encodeURIComponent(filePath)}`, { method: "DELETE" })
      const d = await res.json()
      if (d.ok) {
        setBookmarks(b => b.filter(x => (x.FILE_PATH ?? (x as Record<string,unknown>)["file_path"]) !== filePath))
      } else {
        showToast(`Remove failed: ${d.error}`, "error")
      }
    } catch {
      showToast("Remove failed — network error", "error")
    }
  }

  function copySearchLink(query: string) {
    const url = `${window.location.origin}/search?q=${encodeURIComponent(query)}`
    navigator.clipboard.writeText(url).then(
      () => showToast("Link copied to clipboard", "success"),
      () => showToast("Copy failed — select the URL manually", "error")
    )
  }

  useEffect(() => { load() }, [])

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      {DocModal}
      <DocLoadingIndicator loading={docLoading} />
      <PageHeader title="Saved Searches & Bookmarks" icon={Bookmark} />

      <TabBar
        tabs={[
          { id: "searches", label: "Saved Searches", count: searches.length },
          { id: "bookmarks", label: "Bookmarks", count: bookmarks.length },
        ]}
        active={activeTab}
        onChange={(id) => setActiveTab(id as "searches" | "bookmarks")}
      />

      {loading ? (
        <div className="sf-card p-10 text-center text-slate-400">Loading…</div>
      ) : activeTab === "searches" ? (
        searches.length === 0 ? (
          <EmptyState icon={Search} message="No saved searches yet" sub='Go to Document Search and click "Save Search" to save a query here.' />
        ) : (
          <div className="space-y-2">
            {searches.map((s, i) => {
              const id       = String(s.SEARCH_ID ?? (s as Record<string,unknown>)["search_id"] ?? i)
              const name     = String(s.SEARCH_NAME    ?? (s as Record<string,unknown>)["search_name"] ?? "Unnamed")
              const query    = String(s.QUERY_TEXT     ?? (s as Record<string,unknown>)["query_text"] ?? "")
              const created  = String(s.CREATED_AT     ?? (s as Record<string,unknown>)["created_at"] ?? "")
              return (
                <div key={id} className="sf-card p-4 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-slate-800 text-sm">{name}</p>
                    <p className="text-xs text-slate-500 truncate mt-0.5">"{query}"</p>
                    {created && (
                      <p className="text-[10px] text-slate-400 mt-1 flex items-center gap-1">
                        <Clock size={10} /> {created.slice(0, 10)}
                      </p>
                    )}
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Link
                      href={(() => {
                        const params = new URLSearchParams({ q: query })
                        try {
                          const f = JSON.parse(s.FILTERS_JSON ?? "{}")
                          if (f.folder)  params.set("folder",  f.folder)
                          if (f.lob)     params.set("lob",     f.lob)
                          if (f.docType) params.set("docType", f.docType)
                          if (f.status)  params.set("status",  f.status)
                          if (f.format)  params.set("format",  f.format)
                        } catch { /* invalid JSON — ignore filters */ }
                        return `/search?${params}`
                      })()}
                      className="p-1.5 rounded-lg hover:bg-green-50 text-slate-400 hover:text-green-600 transition-colors"
                      title="Run search"
                    >
                      <Play size={14} />
                    </Link>
                    <button
                      className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 transition-colors"
                      title="Copy link"
                      onClick={() => copySearchLink(query)}
                    >
                      <Copy size={14} />
                    </button>
                    <button
                      className="p-1.5 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500 transition-colors"
                      title="Delete"
                      onClick={() => deleteSearch(id)}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )
      ) : (
        bookmarks.length === 0 ? (
          <EmptyState icon={Bookmark} message="No bookmarks yet" sub="Click the bookmark icon on any search result to save a document here." />
        ) : (
          <div className="space-y-2">
            {bookmarks.map((b, i) => {
              const filePath = String(b.FILE_PATH   ?? (b as Record<string,unknown>)["file_path"] ?? "")
              const docType  = String(b.DOCUMENT_TYPE ?? (b as Record<string,unknown>)["document_type"] ?? "Document")
              const party  = String(b.PARTY_NAME  ?? (b as Record<string,unknown>)["party_name"] ?? "")
              const note     = String(b.PERSONAL_NOTE ?? (b as Record<string,unknown>)["personal_note"] ?? "")
              const created  = String(b.CREATED_AT    ?? (b as Record<string,unknown>)["created_at"] ?? "")
              return (
                <div key={i} className="sf-card p-4 flex items-start gap-3 cursor-pointer hover:border-[var(--brand-border)] transition-colors"
                  onClick={() => router.push(`/documents/detail?id=${encodeDocId(filePath)}`)}
                >
                  <Bookmark size={16} style={{ color: "var(--brand-primary)" }} className="shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-slate-800 text-sm">{docType}</p>
                    {party && <p className="text-xs text-slate-600">{party}</p>}
                    {note    && <p className="text-xs text-slate-500 italic mt-1">"{note}"</p>}
                    {created && <p className="text-[10px] text-slate-400 mt-1">{created.slice(0, 10)}</p>}
                    {filePath && <span onClick={e => e.stopPropagation()}><DocFileLink filePath={filePath} className="text-[10px] mt-1 truncate block" onOpen={openDoc} /></span>}
                  </div>
                  <button
                    className="p-1.5 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500 transition-colors shrink-0"
                    title="Remove bookmark"
                    onClick={(e) => { e.stopPropagation(); deleteBookmark(filePath) }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              )
            })}
          </div>
        )
      )}
    </div>
  )
}
