export default function Loading() {
  return (
    <div className="max-w-6xl mx-auto space-y-6 animate-pulse">
      {/* Hero skeleton */}
      <div className="rounded-2xl h-28 bg-slate-200" />
      {/* KPI skeleton */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="sf-card h-20 bg-slate-100" />
        ))}
      </div>
      {/* Content skeleton */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="sf-card h-48 bg-slate-100" />
        <div className="sf-card h-48 bg-slate-100" />
      </div>
    </div>
  )
}
