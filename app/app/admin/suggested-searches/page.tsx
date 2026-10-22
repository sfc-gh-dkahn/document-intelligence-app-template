"use client"

import { useState, useEffect } from "react"
import { Search, Plus, Trash2, RefreshCw, Pencil, X, Check } from "lucide-react"
import { PageHeader } from "@/components/page-header"
import { showToast } from "@/components/toast"
import { EmptyState } from "@/components/empty-state"

interface SearchRow {
  SEARCH_ID?: number; LOB_CODE?: string; LABEL?: string; QUERY?: string; IS_ACTIVE?: boolean; SORT_ORDER?: number
  search_id?: number; lob_code?: string; label?: string; query?: string; is_active?: boolean; sort_order?: number
}

function val(row: SearchRow, field: "search_id" | "lob_code" | "label" | "query") {
  return String(row[field.toUpperCase() as keyof SearchRow] ?? row[field] ?? "")
}
function isActive(row: SearchRow) {
  return Boolean(row.IS_ACTIVE ?? row.is_active)
}

export default function SuggestedSearchesPage() {
  const [searches, setSearches] = useState<SearchRow[]>([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [newLob, setNewLob] = useState("*")
  const [newLabel, setNewLabel] = useState("")
  const [newQuery, setNewQuery] = useState("")
  const [editing, setEditing] = useState<number | null>(null)
  const [editLob, setEditLob] = useState("")
  const [editLabel, setEditLabel] = useState("")
  const [editQuery, setEditQuery] = useState("")

  async function load() {
    setLoading(true)
    try {
      const res = await fetch("/api/admin/suggested-searches")
      const data = await res.json()
      if (data.searches) setSearches(data.searches)
    } catch { showToast("Failed to load", "error") }
    finally { setLoading(false) }
  }

  async function addSearch() {
    if (!newLabel.trim() || !newQuery.trim()) { showToast("Label and query are required", "error"); return }
    const res = await fetch("/api/admin/suggested-searches", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lobCode: newLob.trim(), label: newLabel.trim(), query: newQuery.trim() })
    })
    if (res.ok) {
      setNewLob("*"); setNewLabel(""); setNewQuery(""); setAdding(false)
      showToast("Suggestion created", "success"); load()
    } else {
      const d = await res.json(); showToast(d.error ?? "Failed to create", "error")
    }
  }

  async function toggleSearch(id: number, currentActive: boolean) {
    setSearches(prev => prev.map(s => Number(val(s, "search_id")) !== id ? s : { ...s, IS_ACTIVE: !currentActive, is_active: !currentActive }))
    const res = await fetch("/api/admin/suggested-searches", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ searchId: id, isActive: !currentActive })
    })
    if (!res.ok) {
      setSearches(prev => prev.map(s => Number(val(s, "search_id")) !== id ? s : { ...s, IS_ACTIVE: currentActive, is_active: currentActive }))
      showToast("Failed to update", "error")
    }
  }

  async function saveSearch(id: number) {
    if (!editLabel.trim() || !editQuery.trim()) { setEditing(null); return }
    const res = await fetch("/api/admin/suggested-searches", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ searchId: id, lobCode: editLob.trim(), label: editLabel.trim(), query: editQuery.trim() })
    })
    if (res.ok) { showToast("Updated", "success"); load() }
    else showToast("Update failed", "error")
    setEditing(null)
  }

  async function deleteSearch(id: number, label: string) {
    if (!confirm(`Delete "${label}"?`)) return
    const res = await fetch(`/api/admin/suggested-searches?id=${id}`, { method: "DELETE" })
    if (res.ok) { showToast("Deleted", "success"); load() }
    else showToast("Delete failed", "error")
  }

  useEffect(() => { load() }, [])

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      <PageHeader title="Suggested Searches" icon={Search}>
        <button className="sf-btn-secondary flex items-center gap-1.5" onClick={load}>
          <RefreshCw size={13} /> Refresh
        </button>
        <button className="sf-btn-primary flex items-center gap-1.5" onClick={() => setAdding(true)}>
          <Plus size={13} /> Add Suggestion
        </button>
      </PageHeader>

      <p className="text-sm text-slate-500">
        Configure search suggestions shown to users on the Search, Chat, and Home pages. Suggestions are filtered by the user&apos;s LOB access.
        Use <code className="text-xs bg-slate-100 px-1 rounded">*</code> for suggestions visible to all users.
      </p>

      {adding && (
        <div className="sf-card p-4 space-y-3 border-blue-200 bg-blue-50/30">
          <div className="flex items-center gap-2 text-sm font-medium text-blue-700">
            <Plus size={14} /> New Suggested Search
          </div>
          <div className="grid grid-cols-4 gap-3">
            <div>
              <label className="text-xs text-slate-500 block mb-1">LOB Code</label>
              <input value={newLob} onChange={e => setNewLob(e.target.value)}
                placeholder="* or FIN, LEG..." className="sf-input text-xs w-full" />
            </div>
            <div>
              <label className="text-xs text-slate-500 block mb-1">Label</label>
              <input value={newLabel} onChange={e => setNewLabel(e.target.value)}
                placeholder="e.g. Recent Documents" className="sf-input text-xs w-full" autoFocus />
            </div>
            <div className="col-span-2">
              <label className="text-xs text-slate-500 block mb-1">Search Query</label>
              <input value={newQuery} onChange={e => setNewQuery(e.target.value)}
                placeholder="e.g. contracts expiring this quarter" className="sf-input text-xs w-full"
                onKeyDown={e => e.key === "Enter" && addSearch()} />
            </div>
          </div>
          <div className="flex items-center gap-2 pt-1">
            <button onClick={addSearch} className="sf-btn-primary text-xs flex items-center gap-1">
              <Check size={12} /> Create
            </button>
            <button onClick={() => { setAdding(false); setNewLob("*"); setNewLabel(""); setNewQuery("") }}
              className="sf-btn-secondary text-xs flex items-center gap-1">
              <X size={12} /> Cancel
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="sf-card p-8 text-center text-slate-400">Loading...</div>
      ) : searches.length === 0 ? (
        <EmptyState icon={Search} message="No suggested searches configured" sub="Click &ldquo;Add Suggestion&rdquo; to create one." />
      ) : (
        <div className="sf-card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100">
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500">LOB</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500">Label</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500">Query</th>
                <th className="text-center px-4 py-2.5 text-xs font-semibold text-slate-500">Active</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-slate-500">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {searches.map(row => {
                const id = Number(val(row, "search_id"))
                const lob = val(row, "lob_code")
                const label = val(row, "label")
                const query = val(row, "query")
                const active = isActive(row)
                const isEditing = editing === id

                return (
                  <tr key={id} className={!active ? "opacity-50" : ""}>
                    <td className="px-4 py-2.5 font-mono text-xs text-slate-600">
                      {isEditing ? (
                        <input value={editLob} onChange={e => setEditLob(e.target.value)}
                          className="sf-input text-xs w-16" />
                      ) : (
                        <span className={lob === "*" ? "text-blue-600 font-semibold" : ""}>{lob}</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      {isEditing ? (
                        <input value={editLabel} onChange={e => setEditLabel(e.target.value)}
                          className="sf-input text-xs w-full" autoFocus
                          onKeyDown={e => { if (e.key === "Enter") saveSearch(id); if (e.key === "Escape") setEditing(null) }} />
                      ) : (
                        <span className="text-slate-700">{label}</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      {isEditing ? (
                        <input value={editQuery} onChange={e => setEditQuery(e.target.value)}
                          className="sf-input text-xs w-full"
                          onKeyDown={e => { if (e.key === "Enter") saveSearch(id); if (e.key === "Escape") setEditing(null) }} />
                      ) : (
                        <span className="text-xs text-slate-500 max-w-[300px] truncate block">{query}</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <button onClick={() => toggleSearch(id, active)}
                        role="switch" aria-checked={active}
                        className="relative inline-flex h-5 w-9 items-center rounded-full transition-colors duration-200 ease-in-out focus:outline-none"
                        style={{ backgroundColor: active ? '#22c55e' : '#cbd5e1' }}>
                        <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-sm transition-transform duration-200 ease-in-out ${active ? 'translate-x-[18px]' : 'translate-x-[3px]'}`} />
                      </button>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {isEditing ? (
                          <>
                            <button onClick={() => saveSearch(id)} className="p-1 rounded hover:bg-green-50 text-green-600" title="Save">
                              <Check size={13} />
                            </button>
                            <button onClick={() => setEditing(null)} className="p-1 rounded hover:bg-slate-100 text-slate-400" title="Cancel">
                              <X size={13} />
                            </button>
                          </>
                        ) : (
                          <>
                            <button onClick={() => { setEditing(id); setEditLob(lob); setEditLabel(label); setEditQuery(query) }}
                              className="p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-600" title="Edit">
                              <Pencil size={13} />
                            </button>
                            <button onClick={() => deleteSearch(id, label)}
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
