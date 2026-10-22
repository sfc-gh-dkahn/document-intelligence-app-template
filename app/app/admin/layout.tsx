"use client"

import { AdminOnly } from "@/hooks/use-role"

/**
 * Shared layout for all /admin/* routes.
 * Wraps every admin page with the AdminOnly guard — if the user doesn't
 * have DOC_INTEL_ADMIN, they see an "Access Required" message instead.
 *
 * This pattern means individual admin pages don't need their own auth checks.
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AdminOnly>{children}</AdminOnly>
}
