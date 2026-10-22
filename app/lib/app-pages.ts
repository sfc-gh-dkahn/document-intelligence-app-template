/**
 * Single list of app pages. The sidebar, the role editor (User Management)
 * and the page guard all read from here, so a role's "App Pages" checkboxes
 * always match the tabs in the sidebar. Add a page here and it appears in all three.
 *
 * `key` is what is stored in ENTITLEMENT_ROLES.menu_access. No React here:
 * lib/entitlements.ts imports this on the server.
 */
export type PageSection = "main" | "operations" | "ai" | "management"

export interface AppPage {
  key: string
  href: string
  label: string
  section: PageSection
}

export const SECTION_LABELS: Record<PageSection, string> = {
  main: "Main",
  operations: "Operations",
  ai: "AI Config",
  management: "Management",
}

export const APP_PAGES: AppPage[] = [
  { key: "dashboard", href: "/",          label: "Overview",         section: "main" },
  { key: "documents", href: "/documents", label: "Document Browser", section: "main" },
  { key: "search",    href: "/search",    label: "Document Search",  section: "main" },
  { key: "review",    href: "/review",    label: "Review Queue",     section: "main" },
  { key: "chat",      href: "/chat",      label: "Doc Intelligence", section: "main" },
  { key: "saved",     href: "/saved",     label: "Saved Items",      section: "main" },
  { key: "help",      href: "/help",      label: "Help",             section: "main" },

  { key: "admin:pipeline", href: "/admin/pipeline", label: "Pipeline Management", section: "operations" },
  { key: "admin:registry", href: "/admin/registry", label: "Ingestion Registry",  section: "operations" },
  { key: "admin:quality",  href: "/admin/quality",  label: "Quality & Feedback",  section: "operations" },
  { key: "admin:cost",     href: "/admin/cost",     label: "Cost Dashboard",      section: "operations" },

  { key: "admin:extraction",         href: "/admin/extraction-schema",     label: "Extraction Schema",     section: "ai" },
  { key: "admin:labels",             href: "/admin/classification-labels", label: "Classification Labels", section: "ai" },
  { key: "admin:lobs",               href: "/admin/lobs",                  label: "Lines of Business",     section: "ai" },
  { key: "admin:suggested-searches", href: "/admin/suggested-searches",    label: "Suggested Searches",    section: "ai" },

  { key: "admin:notifications", href: "/admin/notifications", label: "Notifications",   section: "management" },
  { key: "admin:config",        href: "/admin/config",        label: "Configuration",   section: "management" },
  { key: "admin:audit",         href: "/admin/audit",         label: "Audit Log",       section: "management" },
  { key: "admin:users",         href: "/admin/users",         label: "User Management", section: "management" },
]

export const ADMIN_PAGE_KEYS = APP_PAGES.filter(p => p.key.startsWith("admin:")).map(p => p.key)

/** Non-admin pages: what a user with no role assignment, or a "*" role, sees. */
export const DEFAULT_PAGE_KEYS = APP_PAGES.filter(p => !p.key.startsWith("admin:")).map(p => p.key)

/**
 * The page that owns a path (longest href prefix wins), or null for routes not in the list.
 * Document detail is reached from Search, Review and the agent too, so it is not gated
 * here; the API still checks document-level access.
 */
export function pageForPath(pathname: string): AppPage | null {
  if (pathname.startsWith("/documents/detail")) return null
  let best: AppPage | null = null
  for (const p of APP_PAGES) {
    const match = p.href === "/" ? pathname === "/" : pathname === p.href || pathname.startsWith(p.href + "/")
    if (match && (!best || p.href.length > best.href.length)) best = p
  }
  return best
}
