interface ConfidenceBadgeProps {
  score: number | undefined | null
  variant?: "text" | "bar" | "pill"
}

function getColor(score: number) {
  if (score >= 0.75) return { bg: "bg-green-50", bar: "bg-green-500", text: "text-green-600", dark: "dark:bg-slate-600" }
  if (score >= 0.5) return { bg: "bg-amber-50", bar: "bg-amber-500", text: "text-amber-500", dark: "dark:bg-slate-600" }
  return { bg: "bg-red-50", bar: "bg-red-500", text: "text-red-500", dark: "dark:bg-slate-600" }
}

export function ConfidenceBadge({ score, variant = "text" }: ConfidenceBadgeProps) {
  if (score == null) return <span className="text-slate-400">—</span>

  const pct = Math.round(score * 100)
  const c = getColor(score)

  if (variant === "bar") {
    return (
      <div className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg ${c.bg}`}>
        <div className={`flex-1 bg-slate-200 ${c.dark} rounded-full h-1.5 overflow-hidden`}>
          <div className={`h-full rounded-full ${c.bar}`} style={{ width: `${pct}%` }} />
        </div>
        <span className={`text-[10px] font-bold tabular-nums ${c.text}`}>{pct}%</span>
      </div>
    )
  }

  if (variant === "pill") {
    return (
      <span className={`sf-badge ${c.bg} ${c.text}`}>{pct}%</span>
    )
  }

  // variant === "text"
  return <span className={`font-semibold ${c.text}`}>{pct}%</span>
}
