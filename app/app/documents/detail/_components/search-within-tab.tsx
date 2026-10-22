"use client"

import { useState, useEffect, useCallback } from "react"
import { Search, Loader2 } from "lucide-react"
import { MatchNavigator, type MatchEntry } from "@/app/search/_components/match-navigator"
import { InlineDocViewer } from "@/app/search/_components/inline-doc-viewer"

interface SearchResult {
  match_snippets?: string[]
  match_pages?: (number | null)[]
  match_scores?: number[]
  match_count?: number
}

interface SearchWithinTabProps {
  filePath: string
  encodedId: string
}

export function SearchWithinTab({ filePath, encodedId }: SearchWithinTabProps) {
  const [query, setQuery] = useState("")
  const [loading, setLoading] = useState(false)
  const [matches, setMatches] = useState<MatchEntry[]>([])
  const [activeMatchIdx, setActiveMatchIdx] = useState(0)

  const runSearch = useCallback(async (q: string) => {
    if (!q.trim()) { setMatches([]); return }
    setLoading(true)
    try {
      const params = new URLSearchParams({ q, scope: encodedId, limit: "20" })
      const res = await fetch(`/api/search?${params}`)
      const data = await res.json()
      if (Array.isArray(data) && data.length > 0) {
        const result: SearchResult = data[0]
        const entries: MatchEntry[] = (result.match_snippets ?? []).map((snippet, i) => ({
          page: result.match_pages?.[i] ?? null,
          snippet,
          score: result.match_scores?.[i] ?? undefined,
        }))
        setMatches(entries)
        setActiveMatchIdx(0)
      } else {
        setMatches([])
      }
    } catch {
      setMatches([])
    } finally {
      setLoading(false)
    }
  }, [encodedId])

  // Auto-search debounced
  useEffect(() => {
    if (!query.trim()) { setMatches([]); return }
    const timer = setTimeout(() => runSearch(query), 400)
    return () => clearTimeout(timer)
  }, [query, runSearch])

  // Keyboard navigation
  useEffect(() => {
    if (matches.length === 0) return
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return
      if (e.key === "ArrowDown" || e.key === "j") {
        e.preventDefault()
        setActiveMatchIdx(i => Math.min(matches.length - 1, i + 1))
      } else if (e.key === "ArrowUp" || e.key === "k") {
        e.preventDefault()
        setActiveMatchIdx(i => Math.max(0, i - 1))
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [matches.length])

  const highlightTerms = query.trim().split(/\s+/).filter(w => w.length > 2)

  return (
    <div className="flex flex-col h-[calc(100vh-14rem)]">
      {/* Search bar */}
      <div className="flex items-center gap-2 mb-3">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:border-transparent"
            style={{ "--tw-ring-color": "var(--brand-primary)" } as React.CSSProperties}
            placeholder="Search within this document..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            autoFocus
          />
        </div>
        {loading && <Loader2 size={16} className="animate-spin text-slate-400" />}
        {matches.length > 0 && (
          <span className="text-xs text-slate-500 shrink-0">
            {matches.length} match{matches.length !== 1 ? "es" : ""}
          </span>
        )}
      </div>

      {/* Content: match navigator + PDF viewer */}
      <div className="sf-card flex-1 overflow-hidden flex flex-col lg:flex-row">
        {/* Match navigator — only when matches exist */}
        {matches.length > 0 && (
          <div className="w-full lg:w-64 shrink-0 border-b lg:border-b-0 lg:border-r border-slate-200 dark:border-slate-600 overflow-hidden flex flex-col max-h-48 lg:max-h-none">
            <MatchNavigator
              matches={matches}
              activeIndex={activeMatchIdx}
              onSelect={setActiveMatchIdx}
              query={query}
            />
          </div>
        )}
        {/* PDF viewer — always shown */}
        <div className="flex-1 min-w-0">
          <InlineDocViewer
            filePath={filePath}
            page={matches[activeMatchIdx]?.page}
            highlightTerms={highlightTerms}
          />
        </div>
      </div>
    </div>
  )
}
