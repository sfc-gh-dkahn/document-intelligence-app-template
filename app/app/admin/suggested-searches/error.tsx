"use client"

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="sf-card p-10 text-center max-w-md mx-auto mt-10">
      <div className="w-12 h-12 rounded-xl bg-red-50 flex items-center justify-center mx-auto mb-4">
        <span className="text-2xl">⚠️</span>
      </div>
      <h2 className="font-semibold text-slate-800 mb-2">Something went wrong</h2>
      <p className="text-sm text-slate-500 mb-4">{error.message || "An unexpected error occurred."}</p>
      <button onClick={reset} className="sf-btn-secondary text-xs">Try again</button>
    </div>
  )
}
