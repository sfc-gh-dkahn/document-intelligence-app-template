interface FilterSelectProps {
  value: string
  onChange: (value: string) => void
  options: string[]
  allLabel?: string
  className?: string
}

export function FilterSelect({ value, onChange, options, allLabel = "All", className }: FilterSelectProps) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className={`text-sm border border-slate-200 rounded-lg px-3 py-1.5 text-slate-600 ${className ?? ""}`}
    >
      <option value="">{allLabel}</option>
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  )
}
