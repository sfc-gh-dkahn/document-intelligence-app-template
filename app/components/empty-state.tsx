import { type LucideIcon, Inbox } from "lucide-react"

interface EmptyStateProps {
  icon?: LucideIcon
  message: string
  sub?: string
}

export function EmptyState({ icon: Icon = Inbox, message, sub }: EmptyStateProps) {
  return (
    <div className="sf-card p-10 text-center">
      <Icon size={32} className="mx-auto mb-3 text-slate-300" />
      <p className="font-medium text-slate-600 mb-1">{message}</p>
      {sub && <p className="text-xs text-slate-400">{sub}</p>}
    </div>
  )
}
