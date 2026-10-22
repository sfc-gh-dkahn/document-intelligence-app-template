import { type ReactNode } from "react"

interface StatCardProps {
  label: string
  value: string
  sub?: string
  color?: string
}

export function StatCard({ label, value, sub, color }: StatCardProps) {
  return (
    <div className="sf-card p-4">
      <p className="text-xs text-slate-500 mb-0.5">{label}</p>
      <p className={`text-2xl font-bold ${color ?? "text-slate-800"}`}>{value}</p>
      {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
    </div>
  )
}

interface StatGridProps {
  cols?: 2 | 3 | 4
  children: ReactNode
}

const gridCols = {
  2: "grid-cols-2",
  3: "grid-cols-2 md:grid-cols-3",
  4: "grid-cols-2 md:grid-cols-4",
} as const

export function StatGrid({ cols = 4, children }: StatGridProps) {
  return <div className={`grid ${gridCols[cols]} gap-4`}>{children}</div>
}
