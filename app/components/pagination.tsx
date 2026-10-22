interface PaginationProps {
  offset: number
  limit: number
  total: number
  onChange: (newOffset: number) => void
  noun?: string
}

export function Pagination({ offset, limit, total, onChange, noun = "items" }: PaginationProps) {
  if (total <= limit) return null
  return (
    <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100">
      <p className="text-xs text-slate-500">
        Showing {offset + 1}–{Math.min(offset + limit, total)} of {total.toLocaleString()} {noun}
      </p>
      <div className="flex gap-1">
        <button
          className="px-3 py-1 text-xs rounded border border-slate-200 hover:bg-slate-50 disabled:opacity-30 transition-colors"
          disabled={offset === 0}
          onClick={() => onChange(Math.max(0, offset - limit))}
        >
          Previous
        </button>
        <button
          className="px-3 py-1 text-xs rounded border border-slate-200 hover:bg-slate-50 disabled:opacity-30 transition-colors"
          disabled={offset + limit >= total}
          onClick={() => onChange(offset + limit)}
        >
          Next
        </button>
      </div>
    </div>
  )
}
