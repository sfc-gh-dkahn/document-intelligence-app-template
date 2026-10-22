"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useState, useEffect } from "react"
import { THEME } from "@/theme.config"
import { useRole } from "@/hooks/use-role"
import { APP_PAGES, SECTION_LABELS, type PageSection } from "@/lib/app-pages"
import {
  Home, Search, FolderOpen, Bookmark,
  Settings, Activity, DollarSign, ClipboardList, CheckSquare, Shield, Users, Code, ClipboardCheck, HelpCircle, Tags, Bell, Bot, Briefcase,
  type LucideIcon,
} from "lucide-react"

// Pages, labels and order come from lib/app-pages.ts (shared with the role editor
// and the page guard). Only icons and hover text live here.
const ICONS: Record<string, LucideIcon> = {
  dashboard: Home, documents: FolderOpen, search: Search, review: ClipboardCheck, chat: Bot,
  saved: Bookmark, help: HelpCircle,
  "admin:pipeline": Activity, "admin:registry": ClipboardList, "admin:quality": CheckSquare, "admin:cost": DollarSign,
  "admin:extraction": Code, "admin:labels": Tags, "admin:lobs": Briefcase, "admin:suggested-searches": Search,
  "admin:notifications": Bell, "admin:config": Settings, "admin:audit": Shield, "admin:users": Users,
}

const HOVER: Record<string, string> = {
  dashboard: "Summary of your documents",
  documents: "Filter by type, LOB, status",
  search: "Find documents by content",
  chat: "Ask about documents & data",
}

const pagesIn = (section: PageSection) => APP_PAGES.filter(p => p.section === section)
const navItems = pagesIn("main")
const adminGroups: PageSection[] = ["operations", "ai", "management"]
const adminItems = adminGroups.flatMap(pagesIn)

function isActive(href: string, pathname: string, from: string) {
  if (href === "/") return pathname === "/"
  // Detail pages live under /documents; credit the tab the user came from
  if (pathname.startsWith("/documents/detail") && from) {
    if (href === `/${from}`) return true
    if (href === "/documents") return false
  }
  return pathname === href || pathname.startsWith(href + "/")
}

export function AppSidebar() {
  const pathname = usePathname()
  const [from, setFrom] = useState("")
  useEffect(() => {
    setFrom(new URLSearchParams(window.location.search).get("from") ?? "")
  }, [pathname])
  const { isAdmin, loading, entitlements } = useRole()
  const [reviewPending, setReviewPending] = useState(0)

  // Fetch review queue pending count for badge
  useEffect(() => {
    if (!loading) {
      fetch("/api/review?action=count")
        .then(r => r.json())
        .then(d => setReviewPending(Number(d.pending ?? 0)))
        .catch(() => {})
    }
  }, [loading])

  // Filter nav items by user's menu entitlements (applies to all roles including admin)
  const visibleNavItems = navItems.filter(item => {
    if (loading) return true // show all while loading
    if (!entitlements) return true // no entitlements = show all (fail-open for UI)
    return entitlements.menuAccess.includes(item.key)
  })

  return (
    <aside className="w-60 bg-white border-r border-slate-200 flex flex-col shrink-0">
      {/* Brand */}
      <div className="px-5 py-4 border-b border-slate-100">
        <div className="flex items-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={THEME.logoUrl} alt={THEME.appName} className="w-7 h-7" />
          <div>
            <p className="font-bold text-sm leading-tight" style={{ color: "var(--brand-primary)" }}>
              {THEME.appName}
            </p>
            <p className="text-[10px] text-slate-400 leading-tight">{THEME.appSubtitle}</p>
          </div>
        </div>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {visibleNavItems.map(({ href, label, key }) => {
          const Icon = ICONS[key] ?? Home
          return (
            <Link
              key={href}
              href={href}
              prefetch={false}
              className={`nav-link ${isActive(href, pathname, from) ? "active" : ""}`}
              title={HOVER[key]}
            >
              <Icon size={16} />
              <span className="flex-1 truncate">{label}</span>
              {key === "review" && reviewPending > 0 && (
                <span className="ml-auto text-[9px] font-bold bg-amber-500 text-white px-1.5 py-0.5 rounded-full">
                  {reviewPending}
                </span>
              )}
            </Link>
          )
        })}

        {/* Admin section — filtered by entitlement role menu_access */}
        {!loading && (() => {
          const visibleAdminItems = adminItems.filter(item => {
            if (!entitlements) return isAdmin // fallback: use Snowflake role check
            return entitlements.menuAccess.includes(item.key)
          })
          if (visibleAdminItems.length === 0) return null
          return (
            <>
              <div className="pt-4 pb-1 px-3">
                <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Shield size={11} /> Admin
                </p>
              </div>
              {adminGroups.map(g => {
                const items = visibleAdminItems.filter(i => i.section === g)
                if (items.length === 0) return null
                return (
                  <div key={g}>
                    {g !== "operations" && (
                      <p className="text-[9px] text-slate-400 uppercase tracking-wider px-3 pt-2 pb-0.5">{SECTION_LABELS[g]}</p>
                    )}
                    {items.map(({ href, label, key }) => {
                      const Icon = ICONS[key] ?? Settings
                      return (
                        <Link
                          key={href}
                          href={href}
                          prefetch={false}
                          className={`nav-link ${isActive(href, pathname, from) ? "active" : ""}`}
                        >
                          <Icon size={16} />
                          {label}
                        </Link>
                      )
                    })}
                  </div>
                )
              })}
            </>
          )
        })()}

        {/* Placeholder while loading roles */}
        {loading && (
          <div className="pt-4 animate-pulse space-y-1">
            {[1, 2].map(i => (
              <div key={i} className="h-8 bg-slate-100 rounded-lg mx-1" />
            ))}
          </div>
        )}
      </nav>
    </aside>
  )
}
