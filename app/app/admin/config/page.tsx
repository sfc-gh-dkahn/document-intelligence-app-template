"use client"

import { useState, useEffect } from "react"
import { Settings, RefreshCw, Save, CheckCircle, Lock } from "lucide-react"
import { PageHeader } from "@/components/page-header"
import { showToast } from "@/components/toast"

interface ConfigRow {
  CONFIG_KEY?: string; CONFIG_VALUE?: string; CONFIG_TYPE?: string
  DESCRIPTION?: string; UPDATED_AT?: string; UPDATED_BY?: string
}

const GROUPS: Record<string, string[]> = {
  "Pipeline Settings":    ["pipeline_enabled","batch_size","max_retries","reprocess_after_days","max_processing_attempts","pipeline_target_lag_minutes"],
  "AI Models":            ["cortex_model","extraction_model","agent_model","search_embedding_model"],
  "Quality & Alerts":     ["confidence_threshold","classify_confidence_threshold","alert_email","admin_email","cost_alert_multiplier","error_rate_threshold_pct"],
}

// Keys that should be read-only (cannot be changed without rebuilding dependent services)
const LOCKED_KEYS = new Set(["search_embedding_model"])

export default function AdminConfigPage() {
  const [config, setConfig]   = useState<Record<string, ConfigRow>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving]   = useState<string | null>(null)
  const [saved, setSaved]     = useState<string | null>(null)
  const [edits, setEdits]     = useState<Record<string, string>>({})
  const [dropdownOptions, setDropdownOptions] = useState<Record<string, string[]>>({})

  async function load() {
    setLoading(true)
    try {
      const res = await fetch("/api/config")
      const data = await res.json()
      if (!res.ok) {
        showToast(data.error ?? "Failed to load config", "error")
        return
      }
      const rows: ConfigRow[] = Array.isArray(data) ? data : []
      const m: Record<string, ConfigRow> = {}
      rows.forEach(r => {
        const k = String(r.CONFIG_KEY ?? (r as Record<string,unknown>)["config_key"] ?? "")
        if (k) m[k] = r
      })
      setConfig(m)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  useEffect(() => {
    fetch("/api/models")
      .then(r => r.json())
      .then(data => { if (!data.error) setDropdownOptions(data) })
      .catch(() => {})
  }, [])

  async function saveKey(key: string) {
    const value = edits[key] ?? getValue(key)
    setSaving(key)
    try {
      const res = await fetch("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, value }),
      })
      const d = await res.json()
      if (!res.ok) {
        showToast(d.error ?? "Save failed", "error")
        return
      }
      setSaved(key)
      setTimeout(() => setSaved(null), 2000)
      // Update local config
      setConfig(c => ({ ...c, [key]: { ...c[key], CONFIG_VALUE: value } }))
    } finally {
      setSaving(null)
    }
  }

  function getValue(key: string) {
    const row = config[key]
    return String(row?.CONFIG_VALUE ?? (row as Record<string,unknown>)?.["config_value"] ?? "")
  }

  function getType(key: string) {
    const row = config[key]
    return String(row?.CONFIG_TYPE ?? (row as Record<string,unknown>)?.["config_type"] ?? "STRING")
  }

  function getDesc(key: string) {
    const row = config[key]
    return String(row?.DESCRIPTION ?? (row as Record<string,unknown>)?.["description"] ?? "")
  }

  function renderInput(key: string) {
    const type  = getType(key).toUpperCase()
    const value = edits[key] ?? getValue(key)

    // Locked keys — display as read-only with lock icon
    if (LOCKED_KEYS.has(key)) {
      return (
        <div className="flex items-center gap-1.5 text-sm text-slate-500 bg-slate-100 border border-slate-200 rounded-lg px-2 py-1.5 w-44" title="Cannot change after search index creation">
          <Lock size={11} className="shrink-0 text-slate-400" />
          <span className="truncate">{value}</span>
        </div>
      )
    }

    // Dropdown for keys with dynamic model options
    if (dropdownOptions[key]?.length) {
      const opts = dropdownOptions[key]
      const withCurrent = value && !opts.includes(value) ? [value, ...opts] : opts
      return (
        <select
          className="text-sm border border-slate-200 rounded-lg px-2 py-1.5 w-44"
          value={value}
          onChange={e => setEdits(ed => ({ ...ed, [key]: e.target.value }))}
        >
          {withCurrent.map(opt => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      )
    }

    // Toggle for booleans
    if (type === "BOOLEAN") {
      return (
        <select
          className="text-sm border border-slate-200 rounded-lg px-2 py-1.5 w-24"
          value={value}
          onChange={e => setEdits(ed => ({ ...ed, [key]: e.target.value }))}
        >
          <option value="true">Enabled</option>
          <option value="false">Disabled</option>
        </select>
      )
    }

    // Number input for integers/floats
    if (type === "INTEGER" || type === "FLOAT") {
      return (
        <input
          type="number"
          step={type === "FLOAT" ? "0.05" : "1"}
          className="text-sm border border-slate-200 rounded-lg px-2 py-1.5 w-24 text-right"
          value={value}
          onChange={e => setEdits(ed => ({ ...ed, [key]: e.target.value }))}
        />
      )
    }

    // Default text input
    return (
      <input
        type="text"
        className="text-sm border border-slate-200 rounded-lg px-2 py-1.5 w-44 text-right"
        value={value}
        onChange={e => setEdits(ed => ({ ...ed, [key]: e.target.value }))}
      />
    )
  }

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      <PageHeader title="System Configuration" icon={Settings}>
        <button className="sf-btn-secondary flex items-center gap-1.5" onClick={load}>
          <RefreshCw size={13} /> Reload
        </button>
      </PageHeader>

      {loading ? (
        <div className="sf-card p-10 text-center text-slate-400">Loading configuration…</div>
      ) : (
        <>
          {Object.entries(GROUPS).map(([groupName, keys]) => (
            <div key={groupName} className="sf-card overflow-hidden">
              <div className="px-5 py-3 border-b border-slate-100 bg-slate-50">
                <h2 className="font-semibold text-slate-700 text-sm">{groupName}</h2>
              </div>
              <div className="divide-y divide-slate-50">
                {keys.filter(k => config[k]).map(key => (
                  <div key={key} className="flex items-center gap-3 px-5 py-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-700 font-mono">{key}</p>
                    <p className="text-xs text-slate-400 mt-0.5">{getDesc(key)}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {renderInput(key)}
                    <button
                      className="sf-btn-primary py-1 px-3 flex items-center gap-1 text-xs disabled:opacity-50"
                      disabled={saving === key || edits[key] === undefined}
                      onClick={() => saveKey(key)}
                    >
                      {saved === key ? (
                        <><CheckCircle size={12} /> Saved</>
                      ) : (
                        <><Save size={12} /> Save</>
                      )}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
        {/* Catch-all: keys returned by API not in any GROUPS entry */}
        {(() => {
          const knownKeys = Object.values(GROUPS).flat()
          const otherKeys = Object.keys(config).filter(k => !knownKeys.includes(k))
          if (otherKeys.length === 0) return null
          return (
            <div className="sf-card overflow-hidden">
              <div className="px-5 py-3 border-b border-slate-100 bg-slate-50">
                <h2 className="font-semibold text-slate-700 text-sm">Other</h2>
              </div>
              <div className="divide-y divide-slate-50">
                {otherKeys.map(key => (
                  <div key={key} className="flex items-center gap-3 px-5 py-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-700 font-mono">{key}</p>
                      <p className="text-xs text-slate-400 mt-0.5">{getDesc(key)}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {renderInput(key)}
                      <button
                        className="sf-btn-primary py-1 px-3 flex items-center gap-1 text-xs disabled:opacity-50"
                        disabled={saving === key || !edits[key]}
                        onClick={() => saveKey(key)}
                      >
                        {saved === key ? <><CheckCircle size={11}/> Saved</> : <><Save size={11}/> Save</>}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )
        })()}
        </>
      )}
    </div>
  )
}
