"use client"

import { useState, useEffect, useCallback } from "react"
import { Shield, RefreshCw, Download } from "lucide-react"
import { PageHeader } from "@/components/page-header"
import { showToast } from "@/components/toast"
import { StatCard, StatGrid } from "@/components/stat-card"

interface AuditEvent {
  EVENT_ID?: string; EVENT_TYPE?: string; EVENT_TIME?: string
  EVENT_USER?: string; FILE_PATH?: string; STAGE?: string
}
interface AuditSummary { EVENT_TYPE?: string; EVENT_COUNT?: number; UNIQUE_USERS?: number }

export default function AuditDashboardPage() {
  const [events, setEvents] = useState<AuditEvent[]>([])
  const [summary, setSummary] = useState<AuditSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [days, setDays] = useState(30)
  const [eventType, setEventType] = useState("")
  const [user, setUser] = useState("")

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ days: String(days) })
      if (eventType) params.set("eventType", eventType)
      if (user) params.set("user", user)
      const res = await fetch(`/api/admin/audit?${params}`)
      const data = await res.json()
      if (!res.ok) { showToast(data.error ?? "Failed to load audit data", "error"); return }
      setEvents(data.events ?? [])
      setSummary(data.summary ?? [])
    } catch { showToast("Network error", "error") }
    finally { setLoading(false) }
  }, [days, eventType, user])

  useEffect(() => { load() }, [load])

  function exportCsv() {
    const header = "Timestamp,User,Event Type,File Path\n"
    const rows = events.map(e =>
      `"${e.EVENT_TIME ?? ""}","${e.EVENT_USER ?? ""}","${e.EVENT_TYPE ?? ""}","${e.FILE_PATH ?? ""}"`
    ).join("\n")
    const blob = new Blob([header + rows], { type: "text/csv" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a"); a.href = url; a.download = "audit_log.csv"; a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      <PageHeader title="Audit Log" icon={Shield}>
        <button className="sf-btn-secondary flex items-center gap-1.5" onClick={exportCsv}>
          <Download size={13} /> Export CSV
        </button>
        <button className="sf-btn-secondary flex items-center gap-1.5" onClick={load}>
          <RefreshCw size={13} /> Refresh
        </button>
      </PageHeader>

      {/* Filters */}
      <div className="sf-card p-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="text-xs text-slate-500 block mb-1">Time Range</label>
          <select value={days} onChange={e => setDays(Number(e.target.value))} className="sf-input text-xs py-1.5">
            <option value={7}>Last 7 days</option>
            <option value={14}>Last 14 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-slate-500 block mb-1">Event Type</label>
          <select value={eventType} onChange={e => setEventType(e.target.value)} className="sf-input text-xs py-1.5">
            <option value="">All</option>
            {summary.map(s => (
              <option key={String(s.EVENT_TYPE)} value={String(s.EVENT_TYPE)}>{String(s.EVENT_TYPE)}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs text-slate-500 block mb-1">User</label>
          <input value={user} onChange={e => setUser(e.target.value)} placeholder="Filter by user…"
            className="sf-input text-xs py-1.5 w-40" />
        </div>
        {loading && <RefreshCw size={14} className="animate-spin text-slate-400" />}
      </div>

      {/* Summary Cards */}
      <StatGrid cols={4}>
        {summary.slice(0, 4).map(s => (
          <StatCard
            key={String(s.EVENT_TYPE)}
            label={String(s.EVENT_TYPE ?? "")}
            value={String(Number(s.EVENT_COUNT ?? 0))}
            sub={`${Number(s.UNIQUE_USERS ?? 0)} users`}
          />
        ))}
      </StatGrid>

      {/* Events Table */}
      <div className="sf-card overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 bg-slate-50">
          <h2 className="text-sm font-semibold text-slate-700">
            Events ({loading ? "…" : events.length})
          </h2>
        </div>
        {loading ? (
          <div className="p-8 text-center text-slate-400">Loading…</div>
        ) : events.length === 0 ? (
          <div className="p-8 text-center text-slate-400 text-sm">No events match your filters</div>
        ) : (
          <div className="max-h-[500px] overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50/50 border-b border-slate-100 sticky top-0">
                <tr>
                  {["Timestamp","User","Event Type","File"].map(h => (
                    <th key={h} className="text-left px-3 py-2 text-slate-500 font-semibold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {events.map((e, i) => (
                  <tr key={String(e.EVENT_ID ?? i)} className="border-b border-slate-50 hover:bg-slate-50/50">
                    <td className="px-3 py-2 text-slate-500 whitespace-nowrap">
                      {String(e.EVENT_TIME ?? "").replace("T", " ").slice(0, 19)}
                    </td>
                    <td className="px-3 py-2 font-medium text-slate-700">{String(e.EVENT_USER ?? "")}</td>
                    <td className="px-3 py-2">
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-50 text-blue-700">
                        {String(e.EVENT_TYPE ?? "")}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-slate-500 max-w-[200px] truncate" title={String(e.FILE_PATH ?? "")}>
                      {String(e.FILE_PATH ?? "").split("/").pop() ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
