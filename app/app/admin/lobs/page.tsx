"use client"

import { useState, useEffect } from "react"
import { Briefcase, Plus, Trash2, RefreshCw, Pencil, X, Check } from "lucide-react"
import { PageHeader } from "@/components/page-header"
import { showToast } from "@/components/toast"
import { EmptyState } from "@/components/empty-state"

interface LobRow {
  LOB_CODE?: string; LOB_NAME?: string; DESCRIPTION?: string; IS_ACTIVE?: boolean; SORT_ORDER?: number
  lob_code?: string; lob_name?: string; description?: string; is_active?: boolean; sort_order?: number
}

function val(row: LobRow, field: "lob_code" | "lob_name" | "description") {
  return String(row[field.toUpperCase() as keyof LobRow] ?? row[field] ?? "")
}
function isActive(row: LobRow) {
  return Boolean(row.IS_ACTIVE ?? row.is_active)
}

export default function LobsPage() {
  const [lobs, setLobs] = useState<LobRow[]>([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [newCode, setNewCode] = useState("")
  const [newName, setNewName] = useState("")
  const [newDesc, setNewDesc] = useState("")
  const [editing, setEditing] = useState<string | null>(null)
  const [editName, setEditName] = useState("")
  const [editDesc, setEditDesc] = useState("")

  async function load() {
    setLoading(true)
    try {
      const res = await fetch("/api/admin/lobs")
      const data = await res.json()
      if (data.lobs) setLobs(data.lobs)
    } catch { showToast("Failed to load LOBs", "error") }
    finally { setLoading(false) }
  }

  async function addLob() {
    if (!newCode.trim() || !newName.trim()) { showToast("Code and name are required", "error"); return }
    const res = await fetch("/api/admin/lobs", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lobCode: newCode.trim(), lobName: newName.trim(), description: newDesc.trim() })
    })
    if (res.ok) {
      setNewCode(""); setNewName(""); setNewDesc(""); setAdding(false)
      showToast(`LOB "${newCode.trim()}" created`, "success"); load()
    } else {
      const d = await res.json(); showToast(d.error ?? "Failed to create", "error")
    }
  }

  async function toggleLob(code: string, currentActive: boolean) {
    setLobs(prev => prev.map(l => val(l, "lob_code") !== code ? l : { ...l, IS_ACTIVE: !currentActive, is_active: !currentActive }))
    const res = await fetch("/api/admin/lobs", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lobCode: code, isActive: !currentActive })
    })
    if (!res.ok) {
      setLobs(prev => prev.map(l => val(l, "lob_code") !== code ? l : { ...l, IS_ACTIVE: currentActive, is_active: currentActive }))
      showToast("Failed to update", "error")
    }
  }

  async function saveLob(code: string) {
    if (!editName.trim()) { setEditing(null); return }
    const res = await fetch("/api/admin/lobs", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lobCode: code, lobName: editName.trim(), description: editDesc.trim() })
    })
    if (res.ok) { showToast("Updated", "success"); load() }
    else showToast("Update failed", "error")
    setEditing(null)
  }

  async function deleteLob(code: string) {
    if (!confirm(`Delete LOB "${code}"? This cannot be undone.`)) return
    const res = await fetch(`/api/admin/lobs?lob_code=${encodeURIComponent(code)}`, { method: "DELETE" })
    if (res.ok) { showToast(`LOB "${code}" deleted`, "success"); load() }
    else showToast("Delete failed", "error")
  }

  useEffect(() => { load() }, [])

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <PageHeader title="Lines of Business" icon={Briefcase}>
        <button className="sf-btn-secondary flex items-center gap-1.5" onClick={load}>
          <RefreshCw size={13} /> Refresh
        </button>
        <button className="sf-btn-primary flex items-center gap-1.5" onClick={() => setAdding(true)}>
          <Plus size={13} /> Add LOB
        </button>
      </PageHeader>

      <p className="text-sm text-slate-500">
        Configure lines of business used by the AI classification pipeline. Disabled LOBs will not be available for new document classification.
      </p>

      {/* Add LOB form */}
      {adding && (
        <div className="sf-card p-4 space-y-3 border-blue-200 bg-blue-50/30">
          <div className="flex items-center gap-2 text-sm font-medium text-blue-700">
            <Plus size={14} /> New Line of Business
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-slate-500 block mb-1">LOB Code</label>
              <input value={newCode} onChange={e => setNewCode(e.target.value)}
                placeholder="e.g. WC" className="sf-input text-xs w-full" autoFocus />
            </div>
            <div>
              <label className="text-xs text-slate-500 block mb-1">Display Name</label>
              <input value={newName} onChange={e => setNewName(e.target.value)}
                placeholder="e.g. Workers Compensation" className="sf-input text-xs w-full" />
            </div>
            <div>
              <label className="text-xs text-slate-500 block mb-1">Description</label>
              <input value={newDesc} onChange={e => setNewDesc(e.target.value)}
                placeholder="Optional description" className="sf-input text-xs w-full"
                onKeyDown={e => e.key === "Enter" && addLob()} />
            </div>
          </div>
          <div className="flex items-center gap-2 pt-1">
            <button onClick={addLob} className="sf-btn-primary text-xs flex items-center gap-1">
              <Check size={12} /> Create
            </button>
            <button onClick={() => { setAdding(false); setNewCode(""); setNewName(""); setNewDesc("") }}
              className="sf-btn-secondary text-xs flex items-center gap-1">
              <X size={12} /> Cancel
            </button>
          </div>
        </div>
      )}

      {/* LOB list */}
      {loading ? (
        <div className="sf-card p-8 text-center text-slate-400">Loading…</div>
      ) : lobs.length === 0 ? (
        <EmptyState icon={Briefcase} message="No lines of business configured" sub="Click &ldquo;Add LOB&rdquo; to create one." />
      ) : (
        <div className="sf-card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100">
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500">Code</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500">Name</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500">Description</th>
                <th className="text-center px-4 py-2.5 text-xs font-semibold text-slate-500">Active</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-slate-500">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {lobs.map(lob => {
                const code = val(lob, "lob_code")
                const name = val(lob, "lob_name")
                const desc = val(lob, "description")
                const active = isActive(lob)
                const isEditing = editing === code

                return (
                  <tr key={code} className={!active ? "opacity-50" : ""}>
                    <td className="px-4 py-2.5 font-mono text-xs text-slate-600">{code}</td>
                    <td className="px-4 py-2.5">
                      {isEditing ? (
                        <input value={editName} onChange={e => setEditName(e.target.value)}
                          className="sf-input text-xs w-full" autoFocus
                          onKeyDown={e => { if (e.key === "Enter") saveLob(code); if (e.key === "Escape") setEditing(null) }} />
                      ) : (
                        <span className="text-slate-700">{name}</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      {isEditing ? (
                        <input value={editDesc} onChange={e => setEditDesc(e.target.value)}
                          className="sf-input text-xs w-full"
                          onKeyDown={e => { if (e.key === "Enter") saveLob(code); if (e.key === "Escape") setEditing(null) }} />
                      ) : (
                        <span className="text-xs text-slate-500">{desc}</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <button onClick={() => toggleLob(code, active)}
                        role="switch" aria-checked={active}
                        aria-label={`${name} ${active ? "enabled" : "disabled"}`}
                        className="relative inline-flex h-5 w-9 items-center rounded-full transition-colors duration-200 ease-in-out focus:outline-none"
                        style={{ backgroundColor: active ? '#22c55e' : '#cbd5e1' }}
                        title={active ? "Disable" : "Enable"}>
                        <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-sm transition-transform duration-200 ease-in-out ${active ? 'translate-x-[18px]' : 'translate-x-[3px]'}`} />
                      </button>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {isEditing ? (
                          <>
                            <button onClick={() => saveLob(code)} className="p-1 rounded hover:bg-green-50 text-green-600" title="Save">
                              <Check size={13} />
                            </button>
                            <button onClick={() => setEditing(null)} className="p-1 rounded hover:bg-slate-100 text-slate-400" title="Cancel">
                              <X size={13} />
                            </button>
                          </>
                        ) : (
                          <>
                            <button onClick={() => { setEditing(code); setEditName(name); setEditDesc(desc) }}
                              className="p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-600" title="Edit">
                              <Pencil size={13} />
                            </button>
                            <button onClick={() => deleteLob(code)}
                              className="p-1 rounded hover:bg-red-50 text-slate-400 hover:text-red-500" title="Delete">
                              <Trash2 size={13} />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
