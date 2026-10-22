"use client"

import { useEffect } from "react"
import { AlertTriangle, RefreshCw } from "lucide-react"

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error("[admin] page error:", error)
  }, [error])

  return (
    <div className="flex items-center justify-center min-h-[50vh]">
      <div className="sf-card p-10 text-center max-w-md w-full">
        <div className="w-12 h-12 rounded-xl bg-red-50 flex items-center justify-center mx-auto mb-4">
          <AlertTriangle size={22} className="text-red-500" />
        </div>
        <h2 className="font-semibold text-slate-800 mb-2">Something went wrong</h2>
        <p className="text-sm text-slate-500 mb-1">
          An unexpected error occurred in this admin page.
        </p>
        {error.digest && (
          <p className="text-xs text-slate-400 font-mono mb-4">
            Error ID: {error.digest}
          </p>
        )}
        <button
          className="sf-btn-secondary flex items-center gap-1.5 mx-auto"
          onClick={reset}
        >
          <RefreshCw size={13} /> Try again
        </button>
      </div>
    </div>
  )
}
