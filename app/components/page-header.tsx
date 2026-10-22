import { type LucideIcon } from "lucide-react"
import { type ReactNode } from "react"

interface PageHeaderProps {
  title: string
  icon?: LucideIcon
  subtitle?: string
  children?: ReactNode
}

export function PageHeader({ title, icon: Icon, subtitle, children }: PageHeaderProps) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <h1 className="text-xl font-bold text-slate-800 flex items-center gap-2">
          {Icon && <Icon size={18} style={{ color: "var(--brand-primary)" }} />}
          {title}
        </h1>
        {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
      </div>
      {children && <div className="flex items-center gap-2">{children}</div>}
    </div>
  )
}
