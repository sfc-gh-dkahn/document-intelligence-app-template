"use client"

import { useState, useRef, useEffect } from "react"
import { useRole } from "@/hooks/use-role"
import { LogOut, Clock, Palette, ChevronDown } from "lucide-react"

const TIMEZONES = [
  { value: "America/New_York", label: "Eastern (ET)" },
  { value: "America/Chicago", label: "Central (CT)" },
  { value: "America/Denver", label: "Mountain (MT)" },
  { value: "America/Los_Angeles", label: "Pacific (PT)" },
  { value: "America/Phoenix", label: "Arizona (MST)" },
  { value: "UTC", label: "UTC" },
  { value: "Europe/London", label: "London (GMT/BST)" },
]

const THEMES = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
]

export function AppHeader() {
  const { userName, isAdmin, loading, appRole, entitlements } = useRole()
  const [menuOpen, setMenuOpen] = useState(false)
  const [timezone, setTimezone] = useState("America/New_York")
  const [theme, setTheme] = useState("light")
  const menuRef = useRef<HTMLDivElement>(null)

  const initials = userName
    ? userName.split(/[._-]/).map(s => s[0]?.toUpperCase() ?? "").join("").slice(0, 2) || "U"
    : "U"

  // Load saved preferences from localStorage and apply theme
  useEffect(() => {
    const savedTz = localStorage.getItem("doc_intel_timezone")
    const savedTheme = localStorage.getItem("doc_intel_theme")
    if (savedTz) setTimezone(savedTz)
    if (savedTheme) {
      setTheme(savedTheme)
      applyTheme(savedTheme)
    }
    // Listen for system theme changes
    const mq = window.matchMedia("(prefers-color-scheme: dark)")
    const handler = () => { if ((savedTheme ?? theme) === "system") applyTheme("system") }
    mq.addEventListener("change", handler)
    return () => mq.removeEventListener("change", handler)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    if (menuOpen) document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [menuOpen])

  function handleTimezoneChange(tz: string) {
    setTimezone(tz)
    localStorage.setItem("doc_intel_timezone", tz)
  }

  function handleThemeChange(t: string) {
    setTheme(t)
    localStorage.setItem("doc_intel_theme", t)
    applyTheme(t)
  }

  function applyTheme(t: string) {
    const root = document.documentElement
    if (t === "dark") {
      root.classList.add("dark")
    } else if (t === "system") {
      const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches
      root.classList.toggle("dark", prefersDark)
    } else {
      root.classList.remove("dark")
    }
  }

  function handleLogout() {
    // Snowflake's own ingress logout endpoint — closes the browser's
    // Snowflake session so the next visit requires re-authentication.
    // Clearing document.cookie doesn't work here: the Snowflake session
    // cookie is HttpOnly and invisible to JavaScript.
    window.location.href = "/sfc-endpoint/logout"
  }

  const roleName = entitlements?.roleName ?? (appRole === "admin" ? "Administrator" : "User")

  return (
    <header className="h-12 bg-white border-b border-slate-200 flex items-center px-6 shrink-0 gap-3">
      <div className="flex-1" />

      {/* Admin badge */}
      {!loading && isAdmin && (
        <span
          className="text-[10px] font-bold px-2 py-0.5 rounded-full text-white"
          style={{ background: "var(--brand-dark)" }}
        >
          ADMIN
        </span>
      )}

      {/* User avatar + dropdown */}
      <div className="relative" ref={menuRef}>
        <button
          onClick={() => setMenuOpen(o => !o)}
          className="flex items-center gap-1.5 p-1 rounded-lg hover:bg-slate-100 transition-colors"
          title={userName}
        >
          <div
            className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold"
            style={{ background: "var(--brand-primary)" }}
          >
            {loading ? "…" : initials}
          </div>
          <ChevronDown size={12} className={`text-slate-400 transition-transform ${menuOpen ? "rotate-180" : ""}`} />
        </button>

        {/* Dropdown menu */}
        {menuOpen && (
          <div className="absolute right-0 top-full mt-2 w-64 bg-white border border-slate-200 rounded-xl shadow-lg z-50 overflow-hidden">
            {/* User info header */}
            <div className="px-4 py-3 border-b border-slate-100 bg-slate-50">
              <p className="text-sm font-medium text-slate-800">{userName || "Unknown"}</p>
              <p className="text-[11px] text-slate-500">{roleName}</p>
            </div>

            {/* Timezone */}
            <div className="px-4 py-3 border-b border-slate-100">
              <label className="flex items-center gap-2 text-xs font-medium text-slate-600 mb-1.5">
                <Clock size={12} /> Timezone
              </label>
              <select
                value={timezone}
                onChange={e => handleTimezoneChange(e.target.value)}
                className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white"
              >
                {TIMEZONES.map(tz => (
                  <option key={tz.value} value={tz.value}>{tz.label}</option>
                ))}
              </select>
            </div>

            {/* Theme */}
            <div className="px-4 py-3 border-b border-slate-100">
              <label className="flex items-center gap-2 text-xs font-medium text-slate-600 mb-1.5">
                <Palette size={12} /> Theme
              </label>
              <div className="flex gap-1.5">
                {THEMES.map(t => (
                  <button
                    key={t.value}
                    onClick={() => handleThemeChange(t.value)}
                    className={`flex-1 text-[11px] py-1.5 rounded-md border transition-all ${
                      theme === t.value
                        ? "border-blue-300 bg-blue-50 text-blue-700 font-medium"
                        : "border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50"
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Logout */}
            <button
              onClick={handleLogout}
              className="w-full px-4 py-2.5 text-left text-xs text-red-600 hover:bg-red-50 flex items-center gap-2 font-medium transition-colors"
            >
              <LogOut size={12} /> Sign Out
            </button>
          </div>
        )}
      </div>
    </header>
  )
}
