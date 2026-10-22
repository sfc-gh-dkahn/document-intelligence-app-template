import Link from "next/link"
import { FileQuestion, Home, Search } from "lucide-react"

export default function NotFound() {
  return (
    <div className="min-h-[60vh] flex items-center justify-center p-6">
      <div className="sf-card p-10 text-center max-w-md w-full">
        <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4"
             style={{ background: "var(--brand-light)" }}>
          <FileQuestion size={28} style={{ color: "var(--brand-dark)" }} />
        </div>
        <h2 className="text-lg font-bold text-slate-800 mb-2">Page Not Found</h2>
        <p className="text-sm text-slate-500 mb-6">
          The page you&apos;re looking for doesn&apos;t exist or has been moved.
        </p>
        <div className="flex gap-2 justify-center">
          <Link href="/" className="sf-btn-primary flex items-center gap-1.5">
            <Home size={13} /> Dashboard
          </Link>
          <Link href="/search" className="sf-btn-secondary flex items-center gap-1.5">
            <Search size={13} /> Search
          </Link>
        </div>
      </div>
    </div>
  )
}
