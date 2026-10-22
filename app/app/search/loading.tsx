export default function Loading() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="h-8 bg-slate-200 rounded w-48" />
      <div className="sf-card p-6">
        <div className="h-4 bg-slate-100 rounded w-full mb-3" />
        <div className="h-4 bg-slate-100 rounded w-3/4 mb-3" />
        <div className="h-4 bg-slate-100 rounded w-1/2" />
      </div>
    </div>
  )
}
