interface Tab {
  id: string
  label: string
  count?: number
}

interface TabBarProps {
  tabs: Tab[]
  active: string
  onChange: (id: string) => void
}

export function TabBar({ tabs, active, onChange }: TabBarProps) {
  return (
    <div className="border-b border-slate-200 mb-4">
      <div className="flex gap-0">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => onChange(t.id)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium border-b-2 transition-colors ${
              active === t.id
                ? "border-[var(--brand-primary)] text-[var(--brand-primary)]"
                : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            {t.label}
            {t.count !== undefined && (
              <span className={`px-1.5 py-0.5 rounded-full text-[9px] font-bold ${
                active === t.id ? "bg-[var(--brand-primary)]/15 text-[var(--brand-primary)]"
                  : t.count > 0 ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-500"
              }`}>{t.count}</span>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}
