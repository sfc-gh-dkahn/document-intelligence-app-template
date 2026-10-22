"use client"

import { useState } from "react"
import { FileText, ChevronUp, ChevronDown, ArrowUpDown } from "lucide-react"

export interface MatchEntry {
  page: number | null
  snippet: string
  score?: number
}

interface MatchNavigatorProps {
  matches: MatchEntry[]
  activeIndex: number
  onSelect: (index: number) => void
  query?: string
}

type SortMode = "relevance" | "page"

function highlightQuery(text: string, query?: string) {
  if (!query?.trim()) return text
  const words = query.trim().split(/\s+/).filter(w => w.length > 2)
  if (!words.length) return text
  const regex = new RegExp(`(${words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi")
  const parts = text.split(regex)
  return parts.map((part, i) =>
    regex.test(part)
      ? <mark key={i} className="bg-amber-200 dark:bg-amber-700/50 text-inherit rounded-sm px-0.5">{part}</mark>
      : part
  )
}

export function MatchNavigator({ matches, activeIndex, onSelect, query }: MatchNavigatorProps) {
  const [sortMode, setSortMode] = useState<SortMode>("relevance")
  const [expanded, setExpanded] = useState<Set<number>>(new Set())

  const uniquePages = new Set(matches.map(m => m.page).filter((p): p is number => p != null))

  // Build sorted indices mapping
  const sortedIndices = matches.map((_, i) => i)
  if (sortMode === "page") {
    sortedIndices.sort((a, b) => {
      const pa = matches[a].page ?? 9999
      const pb = matches[b].page ?? 9999
      return pa - pb
    })
  }

  // Map from display position to original index
  const displayToOriginal = sortedIndices
  const originalToDisplay = new Map(sortedIndices.map((orig, disp) => [orig, disp]))
  const activeDisplayIdx = originalToDisplay.get(activeIndex) ?? 0

  function toggleExpand(displayIdx: number) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(displayIdx)) next.delete(displayIdx)
      else next.add(displayIdx)
      return next
    })
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-3 py-2.5 border-b border-slate-200 dark:border-slate-600 shrink-0">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">
            {matches.length} match{matches.length !== 1 ? "es" : ""}
            {uniquePages.size > 0 && (
              <span className="text-slate-400 dark:text-slate-400 font-normal">
                {" "}across {uniquePages.size} page{uniquePages.size !== 1 ? "s" : ""}
              </span>
            )}
          </p>
          <button
            onClick={() => setSortMode(s => s === "relevance" ? "page" : "relevance")}
            className="flex items-center gap-1 text-[10px] text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
            title={`Sort by ${sortMode === "relevance" ? "page order" : "relevance"}`}
          >
            <ArrowUpDown size={10} />
            {sortMode === "relevance" ? "By relevance" : "By page"}
          </button>
        </div>
      </div>

      {/* Navigation buttons */}
      <div className="flex items-center gap-1 px-3 py-1.5 border-b border-slate-100 dark:border-slate-700 shrink-0">
        <button
          onClick={() => {
            const prevDisp = Math.max(0, activeDisplayIdx - 1)
            onSelect(displayToOriginal[prevDisp])
          }}
          disabled={activeDisplayIdx <= 0}
          className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-30 text-slate-500"
          title="Previous match (↑ or k)"
        >
          <ChevronUp size={14} />
        </button>
        <span className="text-[10px] text-slate-500 dark:text-slate-400 flex-1 text-center">
          {activeDisplayIdx + 1} / {matches.length}
        </span>
        <button
          onClick={() => {
            const nextDisp = Math.min(matches.length - 1, activeDisplayIdx + 1)
            onSelect(displayToOriginal[nextDisp])
          }}
          disabled={activeDisplayIdx >= matches.length - 1}
          className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-30 text-slate-500"
          title="Next match (↓ or j)"
        >
          <ChevronDown size={14} />
        </button>
      </div>

      {/* Match list */}
      <div className="flex-1 overflow-y-auto">
        {sortedIndices.map((origIdx, displayIdx) => {
          const match = matches[origIdx]
          const isActive = origIdx === activeIndex
          const isExpanded = expanded.has(displayIdx)
          const snippetText = match.snippet

          return (
            <div
              key={origIdx}
              className={`border-b border-slate-50 dark:border-slate-700 transition-colors ${
                isActive
                  ? "bg-amber-50 dark:bg-amber-900/20 border-l-2 border-l-amber-400"
                  : "hover:bg-slate-50 dark:hover:bg-slate-700/50 border-l-2 border-l-transparent"
              }`}
            >
              <button
                onClick={() => onSelect(origIdx)}
                className="w-full text-left px-3 py-2.5"
              >
                <div className="flex items-center gap-1.5 mb-1">
                  <FileText size={10} className="text-slate-400 shrink-0" />
                  {match.page != null ? (
                    <span className="text-[10px] font-semibold text-slate-600 dark:text-slate-300">
                      Page {match.page + 1}
                    </span>
                  ) : (
                    <span className="text-[10px] text-slate-400">Page unknown</span>
                  )}
                  {/* Relevance bar */}
                  {match.score != null && (
                    <div className="flex-1 flex items-center gap-1 ml-2">
                      <div className="h-1 flex-1 max-w-16 bg-slate-200 dark:bg-slate-600 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${Math.round(match.score * 100)}%`,
                            background: "var(--brand-primary)",
                          }}
                        />
                      </div>
                      <span className="text-[9px] text-slate-400">{Math.round(match.score * 100)}%</span>
                    </div>
                  )}
                </div>
                <p className={`text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed ${isExpanded ? "" : "line-clamp-3"}`}>
                  {highlightQuery(isExpanded ? snippetText : snippetText.slice(0, 200), query)}
                  {!isExpanded && snippetText.length > 200 ? "…" : ""}
                </p>
              </button>
              {/* Expand/collapse toggle */}
              {snippetText.length > 200 && (
                <button
                  onClick={(e) => { e.stopPropagation(); toggleExpand(displayIdx) }}
                  className="px-3 pb-2 text-[10px] text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 font-medium"
                >
                  {isExpanded ? "Show less" : "Show more"}
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
