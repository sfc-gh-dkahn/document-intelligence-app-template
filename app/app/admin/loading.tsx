export default function AdminLoading() {
  return (
    <div className="max-w-5xl mx-auto space-y-5 animate-pulse">
      <div className="h-7 bg-slate-200 rounded w-56" />
      <div className="sf-card p-5 space-y-3">
        <div className="h-4 bg-slate-100 rounded w-40" />
        <div className="h-32 bg-slate-50 rounded" />
      </div>
      <div className="sf-card p-5 space-y-3">
        <div className="h-4 bg-slate-100 rounded w-48" />
        <div className="h-48 bg-slate-50 rounded" />
      </div>
    </div>
  )
}
