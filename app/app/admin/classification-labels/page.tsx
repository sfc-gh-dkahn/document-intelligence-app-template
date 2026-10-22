"use client"

import { useState, useEffect } from "react"
import { Tags, Plus, Trash2, RefreshCw, Pencil, FolderPlus, X } from "lucide-react"
import { PageHeader } from "@/components/page-header"
import { showToast } from "@/components/toast"
import { EmptyState } from "@/components/empty-state"

interface LabelRow {
  LABEL?: string; CATEGORY?: string; SORT_ORDER?: number; IS_ACTIVE?: boolean
  label?: string; category?: string; sort_order?: number; is_active?: boolean
}

export default function ClassificationLabelsPage() {
  const [labels, setLabels] = useState<LabelRow[]>([])
  const [loading, setLoading] = useState(true)
  const [newLabel, setNewLabel] = useState("")
  const [newCategory, setNewCategory] = useState("")
  const [addingCategory, setAddingCategory] = useState(false)
  const [newCategoryName, setNewCategoryName] = useState("")
  const [editingCategory, setEditingCategory] = useState<string | null>(null)
  const [editCategoryName, setEditCategoryName] = useState("")

  async function load() {
    setLoading(true)
    try {
      const res = await fetch("/api/admin/classification-labels")
      const data = await res.json()
      if (data.labels) setLabels(data.labels)
    } catch { showToast("Failed to load labels", "error") }
    finally { setLoading(false) }
  }

  async function addLabel() {
    if (!newLabel.trim()) return
    if (!newCategory) { showToast("Select a category", "error"); return }
    const res = await fetch("/api/admin/classification-labels", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: newLabel.trim(), category: newCategory })
    })
    if (res.ok) { setNewLabel(""); load() }
    else { const d = await res.json(); showToast(d.error ?? "Failed to add", "error") }
  }

  async function deleteLabel(label: string) {
    if (!confirm(`Remove "${label}" from classification labels?`)) return
    await fetch(`/api/admin/classification-labels?label=${encodeURIComponent(label)}`, { method: "DELETE" })
    load()
  }

  async function toggleLabel(label: string, currentActive: boolean) {
    setLabels(prev => prev.map(l => {
      const name = String(l.LABEL ?? l.label ?? "")
      if (name !== label) return l
      return { ...l, IS_ACTIVE: !currentActive, is_active: !currentActive }
    }))
    const res = await fetch("/api/admin/classification-labels", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label, isActive: !currentActive })
    })
    if (!res.ok) {
      setLabels(prev => prev.map(l => {
        const name = String(l.LABEL ?? l.label ?? "")
        if (name !== label) return l
        return { ...l, IS_ACTIVE: currentActive, is_active: currentActive }
      }))
      showToast("Failed to update label", "error")
    }
  }

  async function addCategory() {
    if (!newCategoryName.trim()) return
    // Just add a placeholder label to create the category — user will add real labels after
    // Actually, we just set the dropdown to the new category name — it exists once a label is added
    setNewCategory(newCategoryName.trim())
    setAddingCategory(false)
    setNewCategoryName("")
    showToast(`Category "${newCategoryName.trim()}" ready — add a label to create it`, "info")
  }

  async function renameCategory(oldName: string) {
    if (!editCategoryName.trim() || editCategoryName.trim() === oldName) {
      setEditingCategory(null); return
    }
    const res = await fetch("/api/admin/classification-labels", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "rename_category", oldName, newName: editCategoryName.trim() })
    })
    if (res.ok) { showToast(`Renamed to "${editCategoryName.trim()}"`, "success"); load() }
    else showToast("Rename failed", "error")
    setEditingCategory(null)
  }

  async function deleteCategory(category: string) {
    const count = labels.filter(l => String(l.CATEGORY ?? l.category) === category).length
    if (!confirm(`Delete category "${category}" and its ${count} label(s)? This cannot be undone.`)) return
    const res = await fetch("/api/admin/classification-labels", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete_category", category })
    })
    if (res.ok) { showToast(`Category "${category}" deleted`, "success"); load() }
    else showToast("Delete failed", "error")
  }

  useEffect(() => { load() }, [])

  const categories = [...new Set(labels.map(l => String(l.CATEGORY ?? l.category ?? "General")))].sort()

  // Set default category from existing ones
  useEffect(() => {
    if (!newCategory && categories.length > 0) setNewCategory(categories[0])
  }, [categories.length])

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <PageHeader title="Classification Labels" icon={Tags}>
        <button className="sf-btn-secondary flex items-center gap-1.5" onClick={load}>
          <RefreshCw size={13} /> Refresh
        </button>
      </PageHeader>

      <p className="text-sm text-slate-500">
        Manage document type labels and categories used by the AI classification pipeline. Disabled labels will not be used for new classifications.
      </p>

      {/* Add new label */}
      <div className="sf-card p-4 flex items-end gap-3">
        <div className="flex-1">
          <label className="text-xs text-slate-500 block mb-1">Label Name</label>
          <input value={newLabel} onChange={e => setNewLabel(e.target.value)}
            placeholder="e.g. Invoice, Contract Amendment" className="sf-input text-xs w-full"
            onKeyDown={e => e.key === "Enter" && addLabel()} />
        </div>
        <div>
          <label className="text-xs text-slate-500 block mb-1">Category</label>
          <div className="flex gap-1">
            <select value={newCategory} onChange={e => setNewCategory(e.target.value)} className="sf-input text-xs">
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
              {newCategory && !categories.includes(newCategory) && (
                <option value={newCategory}>{newCategory} (new)</option>
              )}
            </select>
            <button onClick={() => setAddingCategory(true)} className="p-1.5 rounded border border-slate-200 hover:bg-slate-50 text-slate-500 hover:text-blue-600" title="New Category">
              <FolderPlus size={14} />
            </button>
          </div>
        </div>
        <button onClick={addLabel} className="sf-btn-primary text-xs flex items-center gap-1">
          <Plus size={12} /> Add
        </button>
      </div>

      {/* Add category inline form */}
      {addingCategory && (
        <div className="sf-card p-3 flex items-center gap-2 border-blue-200 bg-blue-50/30">
          <FolderPlus size={14} className="text-blue-600" />
          <input value={newCategoryName} onChange={e => setNewCategoryName(e.target.value)}
            placeholder="New category name…" className="sf-input text-xs flex-1"
            autoFocus onKeyDown={e => e.key === "Enter" && addCategory()} />
          <button onClick={addCategory} className="sf-btn-primary text-xs py-1 px-3">Create</button>
          <button onClick={() => { setAddingCategory(false); setNewCategoryName("") }} className="p-1 text-slate-400 hover:text-slate-600"><X size={14} /></button>
        </div>
      )}

      {/* Labels by category */}
      {loading ? (
        <div className="sf-card p-8 text-center text-slate-400">Loading…</div>
      ) : labels.length === 0 ? (
        <EmptyState icon={Tags} message="No classification labels configured" sub="Add labels above or run the DDL migration to seed defaults." />
      ) : (
        categories.map(cat => {
          const catLabels = labels.filter(l => String(l.CATEGORY ?? l.category) === cat)
          return (
          <div key={cat} className="sf-card overflow-hidden">
            <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
              {editingCategory === cat ? (
                <div className="flex items-center gap-2">
                  <input value={editCategoryName} onChange={e => setEditCategoryName(e.target.value)}
                    className="sf-input text-xs w-40" autoFocus
                    onKeyDown={e => { if (e.key === "Enter") renameCategory(cat); if (e.key === "Escape") setEditingCategory(null) }} />
                  <button onClick={() => renameCategory(cat)} className="text-[10px] text-blue-600 font-medium">Save</button>
                  <button onClick={() => setEditingCategory(null)} className="text-[10px] text-slate-400">Cancel</button>
                </div>
              ) : (
                <h3 className="text-xs font-semibold text-slate-600">{cat} ({catLabels.length})</h3>
              )}
              {editingCategory !== cat && (
                <div className="flex items-center gap-1">
                  <button onClick={() => { setEditingCategory(cat); setEditCategoryName(cat) }}
                    className="p-1 rounded hover:bg-slate-200 text-slate-400 hover:text-slate-600" title="Rename category">
                    <Pencil size={11} />
                  </button>
                  <button onClick={() => deleteCategory(cat)}
                    className="p-1 rounded hover:bg-red-50 text-slate-400 hover:text-red-500" title="Delete category">
                    <Trash2 size={11} />
                  </button>
                </div>
              )}
            </div>
            <div className="divide-y divide-slate-50">
              {catLabels.map(l => {
                const name = String(l.LABEL ?? l.label ?? "")
                const active = Boolean(l.IS_ACTIVE ?? l.is_active)
                return (
                  <div key={name} className={`flex items-center justify-between px-4 py-2 ${!active ? "opacity-50" : ""}`}>
                    <span className="text-sm text-slate-700">{name}</span>
                    <div className="flex items-center gap-2">
                      <button onClick={() => toggleLabel(name, active)}
                        role="switch" aria-checked={active}
                        aria-label={`${name} ${active ? "enabled" : "disabled"}`}
                        className="relative inline-flex h-5 w-9 items-center rounded-full transition-colors duration-200 ease-in-out focus:outline-none"
                        style={{ backgroundColor: active ? '#22c55e' : '#cbd5e1' }}
                        title={active ? "Disable" : "Enable"}>
                        <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-sm transition-transform duration-200 ease-in-out ${active ? 'translate-x-[18px]' : 'translate-x-[3px]'}`} />
                      </button>
                      <button onClick={() => deleteLabel(name)}
                        className="p-1 rounded hover:bg-red-50 text-slate-400 hover:text-red-500" title="Delete">
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )})
      )}
    </div>
  )
}
