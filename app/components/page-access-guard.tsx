"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Lock } from "lucide-react"
import { useRole } from "@/hooks/use-role"
import { pageForPath } from "@/lib/app-pages"

/**
 * Blocks a page whose tab is unchecked for the user's role (User Management →
 * Roles → App Pages), so hiding a tab also stops direct URL access.
 * Routes not in lib/app-pages.ts are not gated. Fails open while roles load or
 * when no entitlements are returned, matching the sidebar.
 */
export function PageAccessGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { loading, entitlements } = useRole()
  const page = pageForPath(pathname)

  if (loading || !entitlements || !page || entitlements.menuAccess.includes(page.key)) {
    return <>{children}</>
  }

  return (
    <div className="sf-card p-10 text-center max-w-md mx-auto mt-10">
      <div className="w-12 h-12 rounded-xl bg-slate-100 flex items-center justify-center mx-auto mb-4">
        <Lock size={20} className="text-slate-500" />
      </div>
      <h2 className="font-semibold text-slate-800 mb-2">{page.label} is not available for your role</h2>
      <p className="text-sm text-slate-500 mb-5">Ask an administrator to turn it on in User Management.</p>
      <Link href="/" className="text-sm font-medium text-blue-600 hover:underline">Back to Overview</Link>
    </div>
  )
}
