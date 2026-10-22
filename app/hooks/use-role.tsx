"use client"

import { useState, useEffect, useCallback, createContext, useContext } from "react"

export interface EntitlementsInfo {
  menuAccess: string[]
  lobAccess: string[]
  docTypeAccess: string[]
  canDownload: boolean
  roleName: string | null
}

export interface RoleInfo {
  appRole:       "admin" | "user" | "none"
  userName:      string
  currentRole:   string
  account:       string
  isAdmin:       boolean
  loading:       boolean
  entitlements:  EntitlementsInfo | null
  error?:        string
  refreshAuth:   () => void
}

const DEFAULT_ROLE: RoleInfo = {
  appRole: "none",
  userName: "",
  currentRole: "",
  account: "",
  isAdmin: false,
  loading: true,
  entitlements: null,
  refreshAuth: () => {},
}

const RoleContext = createContext<RoleInfo>(DEFAULT_ROLE)

export function RoleProvider({ children }: { children: React.ReactNode }) {
  const [role, setRole] = useState<RoleInfo>(DEFAULT_ROLE)

  const fetchAuth = useCallback(() => {
    fetch("/api/auth")
      .then(r => r.json())
      .then((data: Partial<RoleInfo>) => {
        setRole(prev => ({ ...prev, ...data, loading: false }))
      })
      .catch(err => {
        setRole(prev => ({ ...prev, loading: false, error: String(err) }))
      })
  }, [])

  useEffect(() => { fetchAuth() }, [fetchAuth])

  // Expose refreshAuth so admin UI can trigger sidebar menu re-evaluation
  const refreshAuth = useCallback(() => {
    fetchAuth()
  }, [fetchAuth])

  const value: RoleInfo = { ...role, refreshAuth }

  return (
    <RoleContext.Provider value={value}>
      {children}
    </RoleContext.Provider>
  )
}

/** Hook to access the current user's role and entitlements. Must be inside RoleProvider. */
export function useRole(): RoleInfo {
  return useContext(RoleContext)
}

/** Check if a menu item key is accessible to the current user. */
export function useMenuAccess(key: string): boolean {
  const { entitlements, isAdmin, loading } = useRole()
  if (loading) return false
  if (isAdmin) return true
  if (!entitlements) return true // no entitlements loaded = show all (fail-open for UI)
  return entitlements.menuAccess.includes(key)
}

/**
 * Lightweight admin guard component — renders children only when admin role is confirmed.
 */
export function AdminOnly({
  children,
  fallback,
}: {
  children: React.ReactNode
  fallback?: React.ReactNode
}) {
  const { appRole, loading, error } = useRole()

  if (loading) {
    return (
      <div className="sf-card p-8 text-center animate-pulse">
        <div className="h-4 bg-slate-200 rounded w-48 mx-auto mb-2" />
        <div className="h-3 bg-slate-100 rounded w-32 mx-auto" />
      </div>
    )
  }

  if (appRole === "none" && error) {
    return (
      <div className="sf-card p-10 text-center max-w-md mx-auto mt-10">
        <div className="w-12 h-12 rounded-xl bg-amber-50 flex items-center justify-center mx-auto mb-4">
          <span className="text-2xl">⚠️</span>
        </div>
        <h2 className="font-semibold text-slate-800 mb-2">Unable to Verify Access</h2>
        <p className="text-sm text-slate-500 mb-2">
          Could not check your Snowflake role. This may be a temporary issue.
        </p>
        <p className="text-xs text-slate-400 font-mono bg-slate-50 p-2 rounded">{error}</p>
        <button
          className="sf-btn-secondary mt-4 text-xs"
          onClick={() => window.location.reload()}
        >Try again</button>
      </div>
    )
  }

  if (appRole !== "admin") {
    return fallback ?? (
      <div className="sf-card p-10 text-center max-w-md mx-auto mt-10">
        <div className="w-12 h-12 rounded-xl bg-red-50 flex items-center justify-center mx-auto mb-4">
          <span className="text-2xl">🔒</span>
        </div>
        <h2 className="font-semibold text-slate-800 mb-2">Admin Access Required</h2>
        <p className="text-sm text-slate-500">
          This page requires the <code className="bg-slate-100 px-1 rounded">DOC_INTEL_ADMIN</code> role.
          Contact your Snowflake administrator.
        </p>
      </div>
    )
  }

  return <>{children}</>
}
