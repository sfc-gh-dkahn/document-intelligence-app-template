"use client"

import { useState, useEffect } from "react"
import { Bell, Plus, Trash2, RefreshCw, ToggleLeft, ToggleRight } from "lucide-react"
import { PageHeader } from "@/components/page-header"
import { showToast } from "@/components/toast"
import { EmptyState } from "@/components/empty-state"

interface NotifRule {
  ID?: string; CHANNEL_TYPE?: string; ENDPOINT?: string
  EVENT_TYPES?: string[]; THRESHOLD_VALUE?: number; IS_ACTIVE?: boolean; CREATED_AT?: string
}

// Pipeline event types — matches TELEMETRY.pipeline_events.event_type values
const EVENT_TYPE_OPTIONS = [
  "INGEST", "PARSE", "CLASSIFY", "EXTRACT", "ALERT",
  "ARCHIVE", "PURGE", "OVERRIDE", "FEEDBACK", "DOWNLOAD"
]

export default function NotificationsPage() {
  const [rules, setRules] = useState<NotifRule[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ channelType: "webhook", endpoint: "", eventTypes: ["ALERT"], thresholdValue: "0" })

  async function load() {
    setLoading(true)
    try {
      const res = await fetch("/api/admin/notifications")
      const data = await res.json()
      if (data.rules) setRules(data.rules)
    } catch { showToast("Failed to load", "error") }
    finally { setLoading(false) }
  }

  async function addRule() {
    if (!form.endpoint.trim()) { showToast("Endpoint required", "error"); return }
    if (form.channelType === "webhook") {
      try { new URL(form.endpoint) } catch { showToast("Invalid URL format", "error"); return }
    } else if (form.channelType === "email") {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.endpoint)) { showToast("Invalid email format", "error"); return }
    }
    const res = await fetch("/api/admin/notifications", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form)
    })
    if (res.ok) { setShowForm(false); setForm({ channelType: "webhook", endpoint: "", eventTypes: ["ALERT"], thresholdValue: "0" }); load() }
    else { const d = await res.json(); showToast(d.error ?? "Failed", "error") }
  }

  async function deleteRule(id: string) {
    if (!confirm("Delete this notification rule?")) return
    await fetch(`/api/admin/notifications?id=${encodeURIComponent(id)}`, { method: "DELETE" })
    load()
  }

  async function toggleRule(id: string, active: boolean) {
    await fetch("/api/admin/notifications", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, isActive: !active })
    })
    load()
  }

  useEffect(() => { load() }, [])

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <PageHeader title="Notification Rules" icon={Bell}>
        <button className="sf-btn-primary text-xs flex items-center gap-1" onClick={() => setShowForm(!showForm)}>
          <Plus size={12} /> Add Rule
        </button>
        <button className="sf-btn-secondary flex items-center gap-1.5" onClick={load}>
          <RefreshCw size={13} /> Refresh
        </button>
      </PageHeader>

      <p className="text-sm text-slate-500">
        Configure alert rules to notify external systems when pipeline events or thresholds are triggered.
      </p>

      {/* Add form */}
      {showForm && (
        <div className="sf-card p-4 space-y-3 border-2 border-[var(--brand-primary)]">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-500 block mb-1">Channel</label>
              <select value={form.channelType} onChange={e => setForm({ ...form, channelType: e.target.value })} className="sf-input text-xs w-full">
                <option value="webhook">Webhook (HTTP POST)</option>
                <option value="email">Email (Snowflake Integration)</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-500 block mb-1">Endpoint / Address</label>
              <input value={form.endpoint} onChange={e => setForm({ ...form, endpoint: e.target.value })}
                placeholder={form.channelType === "webhook" ? "https://hooks.example.com/..." : "alerts@company.com"}
                className="sf-input text-xs w-full" />
            </div>
          </div>
          <div>
            <label className="text-xs text-slate-500 block mb-1">Event Types</label>
            <div className="flex flex-wrap gap-1.5">
              {EVENT_TYPE_OPTIONS.map(et => (
                <label key={et} className="flex items-center gap-1 text-xs cursor-pointer">
                  <input type="checkbox" checked={form.eventTypes.includes(et)}
                    onChange={e => {
                      const next = e.target.checked ? [...form.eventTypes, et] : form.eventTypes.filter(x => x !== et)
                      setForm({ ...form, eventTypes: next })
                    }} className="rounded border-slate-300" />
                  {et}
                </label>
              ))}
            </div>
          </div>
          <div className="flex items-end gap-3">
            <div>
              <label className="text-xs text-slate-500 block mb-1">Threshold (0 = all events)</label>
              <input type="number" value={form.thresholdValue} onChange={e => setForm({ ...form, thresholdValue: e.target.value })}
                className="sf-input text-xs w-24" min={0} />
            </div>
            <button onClick={addRule} className="sf-btn-primary text-xs">Save Rule</button>
            <button onClick={() => setShowForm(false)} className="sf-btn-secondary text-xs">Cancel</button>
          </div>
        </div>
      )}

      {/* Rules list */}
      {loading ? (
        <div className="sf-card p-8 text-center text-slate-400">Loading…</div>
      ) : rules.length === 0 ? (
        <EmptyState icon={Bell} message="No notification rules configured" sub={'Click "Add Rule" to create one.'} />
      ) : (
        <div className="sf-card overflow-hidden divide-y divide-slate-100">
          {rules.map(r => {
            const id = String(r.ID ?? "")
            const active = Boolean(r.IS_ACTIVE)
            const evTypes: string[] = Array.isArray(r.EVENT_TYPES) ? r.EVENT_TYPES
              : typeof r.EVENT_TYPES === "string" ? JSON.parse(r.EVENT_TYPES) : []
            return (
              <div key={id} className={`px-4 py-3 flex items-center gap-3 ${!active ? "opacity-50" : ""}`}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-slate-700 uppercase">{String(r.CHANNEL_TYPE ?? "")}</span>
                    <span className="text-xs text-slate-500 truncate">{String(r.ENDPOINT ?? "")}</span>
                  </div>
                  <div className="flex gap-1 mt-1 flex-wrap">
                    {evTypes.map((et, i) => (
                      <span key={i} className="text-[10px] bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded">{String(et)}</span>
                    ))}
                  </div>
                </div>
                <button onClick={() => toggleRule(id, active)} className="p-1 rounded hover:bg-slate-100">
                  {active ? <ToggleRight size={18} className="text-green-600" /> : <ToggleLeft size={18} className="text-slate-400" />}
                </button>
                <button onClick={() => deleteRule(id)} className="p-1 rounded hover:bg-red-50 text-slate-400 hover:text-red-500">
                  <Trash2 size={14} />
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
