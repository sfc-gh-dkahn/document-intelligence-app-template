export default function Loading() {
  return (
    <div className="max-w-5xl mx-auto space-y-4 animate-pulse">
      <div className="h-8 bg-slate-100 rounded w-48" />
      <div className="sf-card p-6 space-y-3">
        <div className="h-4 bg-slate-100 rounded w-full" />
        <div className="h-4 bg-slate-100 rounded w-3/4" />
        <div className="h-4 bg-slate-100 rounded w-1/2" />
      </div>
      <div className="sf-card p-6 space-y-3">
        <div className="h-4 bg-slate-100 rounded w-full" />
        <div className="h-4 bg-slate-100 rounded w-2/3" />
      </div>
    </div>
  )
}
