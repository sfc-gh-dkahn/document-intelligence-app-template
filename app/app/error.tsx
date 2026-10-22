"use client"

import { AlertCircle, RefreshCw, Home } from "lucide-react"
import Link from "next/link"

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="min-h-[60vh] flex items-center justify-center p-6">
      <div className="sf-card p-10 text-center max-w-md w-full">
        <div className="w-14 h-14 rounded-2xl bg-red-50 flex items-center justify-center mx-auto mb-4">
          <AlertCircle size={28} className="text-red-500" />
        </div>
        <h2 className="text-lg font-bold text-slate-800 mb-2">Something went wrong</h2>
        <p className="text-sm text-slate-500 mb-1">{error.message || "An unexpected error occurred."}</p>
        {error.digest && (
          <p className="text-[10px] font-mono text-slate-300 mb-5">Error ID: {error.digest}</p>
        )}
        <div className="flex gap-2 justify-center mt-5">
          <button
            className="sf-btn-primary flex items-center gap-1.5"
            onClick={reset}
          >
            <RefreshCw size={13} /> Try Again
          </button>
          <Link href="/" className="sf-btn-secondary flex items-center gap-1.5">
            <Home size={13} /> Go Home
          </Link>
        </div>
      </div>
    </div>
  )
}
