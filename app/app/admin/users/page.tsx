"use client"

import { useState, useEffect, useCallback } from "react"
import { Users, RefreshCw, Plus, Save, Trash2, Shield, X, Settings2, MapPin } from "lucide-react"
import { PageHeader } from "@/components/page-header"
import { showToast } from "@/components/toast"
import { useRole } from "@/hooks/use-role"
import { APP_PAGES, DEFAULT_PAGE_KEYS, SECTION_LABELS, type PageSection } from "@/lib/app-pages"

// --- Types ---
interface UserEntitlement {
  ID?: number; id?: number
  USER_NAME?: string; user_name?: string
  IS_ACTIVE?: boolean; is_active?: boolean
  ROLE_IDS?: number[]; role_ids?: number[]
  ROLE_NAMES?: string[]; role_names?: string[]
  CREATED_BY?: string; created_by?: string
}
interface EntitlementRole {
  ROLE_ID?: number; role_id?: number
  ROLE_NAME?: string; role_name?: string
  DESCRIPTION?: string; description?: string
  MENU_ACCESS?: string[]; menu_access?: string[]
  LOB_ACCESS?: string[]; lob_access?: string[]
  DOC_TYPE_ACCESS?: string[]; doc_type_access?: string[]
  CAN_DOWNLOAD?: boolean; can_download?: boolean
  MEMBER_COUNT?: number; member_count?: number
}
interface LobEntry {
  LOB_ID?: number; lob_id?: number
  LOB_CODE?: string; lob_code?: string
  LOB_NAME?: string; lob_name?: string
  DESCRIPTION?: string; description?: string
  IS_DEFAULT?: boolean; is_default?: boolean
  IS_ACTIVE?: boolean; is_active?: boolean
  SORT_ORDER?: number; sort_order?: number
}

// --- Constants ---
// App Pages checkboxes come from lib/app-pages.ts, the same list the sidebar renders.
const PAGE_SECTIONS = Object.keys(SECTION_LABELS) as PageSection[]
const KNOWN_PAGE_KEYS = new Set(APP_PAGES.map(p => p.key))
// The Administrator role always keeps User Management, so no one can lock admins out.
const ADMIN_ROLE_NAME = "Administrator"
const LOCKED_ADMIN_KEY = "admin:users"

// Doc type groups loaded dynamically from classification labels
const DOC_TYPE_GROUPS: Record<string, string[]> = {}

// --- Helpers ---
function gf<T>(row: Record<string, unknown>, upper: string, lower: string, fallback: T): T {
  const v = row[upper] ?? row[lower]
  return (v !== undefined && v !== null ? v : fallback) as T
}
function parseArr(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String)
  if (typeof v === "string") { try { return JSON.parse(v) } catch { return [] } }
  return []
}
function parseNumArr(v: unknown): number[] {
  if (Array.isArray(v)) return v.map(Number).filter(n => !isNaN(n) && n > 0)
  if (typeof v === "string") { try { return JSON.parse(v).map(Number).filter((n: number) => !isNaN(n) && n > 0) } catch { return [] } }
  return []
}

// ============================================================================
// MAIN PAGE
// ============================================================================
export default function AdminUsersPage() {
  const [tab, setTab] = useState<"users" | "roles" | "lobs">("users")

  return (
    <div className="max-w-6xl mx-auto space-y-4">
      <PageHeader title="Access Management" icon={Users} />

      {/* Tab switcher */}
      <div className="flex gap-1 bg-slate-100 p-1 rounded-lg w-fit">
        {([["users", "Users", Users], ["roles", "Roles", Settings2], ["lobs", "Lines of Business", MapPin]] as const).map(([key, label, Icon]) => (
          <button
            key={key}
            onClick={() => setTab(key as "users" | "roles" | "lobs")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
              tab === key ? "bg-white shadow-sm text-slate-800" : "text-slate-500 hover:text-slate-700"
            }`}
          >
            <Icon size={13} /> {label}
          </button>
        ))}
      </div>

      {tab === "users" && <UsersTab />}
      {tab === "roles" && <RolesTab />}
      {tab === "lobs" && <LobsTab />}
    </div>
  )
}

// ============================================================================
// USERS TAB
// ============================================================================
function UsersTab() {
  const [entitlements, setEntitlements] = useState<UserEntitlement[]>([])
  const [roles, setRoles] = useState<EntitlementRole[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingUser, setEditingUser] = useState<string | null>(null)
  // Form state
  const [formUser, setFormUser] = useState("")
  const [manualEntry, setManualEntry] = useState(false)
  const [formRoleIds, setFormRoleIds] = useState<number[]>([])
  const [saving, setSaving] = useState(false)
  const [syncing, setSyncing] = useState(false)
  // Unregistered role members (for dropdown)
  const [unregistered, setUnregistered] = useState<{ userName: string; snowflakeRoles: string[] }[]>([])

  const { refreshAuth } = useRole()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [entRes, roleRes, unregRes] = await Promise.all([
        fetch("/api/admin/entitlements"),
        fetch("/api/admin/roles"),
        fetch("/api/admin/entitlements?action=unregistered"),
      ])
      const entData = await entRes.json()
      const roleData = await roleRes.json()
      const unregData = await unregRes.json()
      setEntitlements(entData.entitlements ?? [])
      setRoles(roleData.roles ?? [])
      setUnregistered(unregData.unregistered ?? [])
    } catch { showToast("Failed to load", "error") }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  function startAdd() {
    setEditingUser(null); setFormUser(""); setFormRoleIds([]); setManualEntry(false)
    setShowForm(true)
  }
  function startEdit(row: UserEntitlement) {
    const r = row as Record<string, unknown>
    setEditingUser(gf(r, "USER_NAME", "user_name", ""))
    setFormUser(gf(r, "USER_NAME", "user_name", ""))
    setFormRoleIds(parseNumArr(r.ROLE_IDS ?? r.role_ids))
    setShowForm(true)
  }

  async function handleSync() {
    setSyncing(true)
    try {
      const res = await fetch("/api/admin/entitlements", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sync" }),
      })
      const data = await res.json()
      if (data.synced > 0) {
        showToast(`${data.synced} new user(s) synced with Viewer role`, "success")
      } else {
        showToast("All role members already have entitlements", "success")
      }
      load()
    } catch { showToast("Sync failed", "error") }
    finally { setSyncing(false) }
  }

  async function handleSave() {
    const effectiveUser = formUser
    if (!effectiveUser.trim()) { showToast("Username required", "error"); return }
    if (formRoleIds.length === 0) { showToast("At least one role must be assigned", "error"); return }
    setSaving(true)
    try {
      const res = await fetch("/api/admin/entitlements", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userName: effectiveUser.trim().toUpperCase(),
          roleIds: formRoleIds,
          isActive: true,
        }),
      })
      if (!res.ok) { const d = await res.json(); showToast(d.error ?? "Save failed", "error"); return }
      showToast(`Saved entitlements for ${formUser.toUpperCase()}`, "success")
      setShowForm(false)
      load()
      // Refresh auth context so sidebar updates if admin changed their own roles
      refreshAuth()
    } catch (err) { showToast(err instanceof Error ? err.message : "Failed", "error") }
    finally { setSaving(false) }
  }

  async function handleDeactivate(userName: string) {
    if (!confirm(`Deactivate ${userName}? They will lose access to the application until reactivated.`)) return
    await fetch("/api/admin/entitlements", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userName }) })
    showToast(`Deactivated ${userName}`, "success"); load()
  }

  async function handleReactivate(userName: string) {
    // Reactivate with no roles — admin will need to assign roles
    await fetch("/api/admin/entitlements", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userName, roleIds: [], isActive: true }) })
    showToast(`Reactivated ${userName}`, "success"); load()
  }

  function toggleRole(roleId: number) {
    setFormRoleIds(prev =>
      prev.includes(roleId) ? prev.filter(id => id !== roleId) : [...prev, roleId]
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        {unregistered.length > 0 && !loading && (
          <p className="text-xs text-amber-600 bg-amber-50 px-3 py-1.5 rounded-lg border border-amber-200">
            {unregistered.length} Snowflake role member(s) not yet configured
          </p>
        )}
        {(unregistered.length === 0 || loading) && <div />}
        <div className="flex gap-2">
          <button className="sf-btn-secondary flex items-center gap-1.5 text-xs" onClick={handleSync} disabled={syncing}>
            <Users size={12} /> {syncing ? "Syncing…" : "Sync from Roles"}
          </button>
          <button className="sf-btn-secondary flex items-center gap-1.5 text-xs" onClick={load}><RefreshCw size={12} /> Refresh</button>
          <button className="sf-btn-primary flex items-center gap-1.5 text-xs" onClick={startAdd}><Plus size={12} /> Add User</button>
        </div>
      </div>

      {/* Add/Edit Form */}
      {showForm && (
        <div className="sf-card p-5 border-2 border-blue-200">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-slate-700 text-sm">{editingUser ? `Edit: ${editingUser}` : "Add User"}</h2>
            <button onClick={() => setShowForm(false)} className="text-slate-400 hover:text-slate-600"><X size={16} /></button>
          </div>
          <div className="grid grid-cols-1 gap-4">
            <div>
              <label className="text-xs font-semibold text-slate-600 block mb-1">Username</label>
              {editingUser ? (
                <input type="text" value={formUser} disabled
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm font-mono disabled:bg-slate-50" />
              ) : unregistered.length > 0 ? (
                <div className="space-y-2">
                  {!manualEntry ? (
                    <select
                      value={formUser}
                      onChange={e => {
                        if (e.target.value === "__manual__") {
                          setManualEntry(true)
                          setFormUser("")
                        } else {
                          setFormUser(e.target.value)
                        }
                      }}
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm font-mono bg-white"
                    >
                      <option value="">Select a role member...</option>
                      {unregistered.map(m => (
                        <option key={m.userName} value={m.userName}>
                          {m.userName} ({m.snowflakeRoles.join(", ")})
                        </option>
                      ))}
                      <option value="__manual__">Enter manually...</option>
                    </select>
                  ) : (
                    <div className="flex gap-2">
                      <input type="text" value={formUser} onChange={e => setFormUser(e.target.value.toUpperCase())}
                        placeholder="JSMITH" autoFocus
                        className="flex-1 px-3 py-2 rounded-lg border border-slate-200 text-sm font-mono" />
                      <button type="button" onClick={() => { setManualEntry(false); setFormUser("") }}
                        className="text-xs text-slate-500 hover:text-slate-700">Back</button>
                    </div>
                  )}
                </div>
              ) : (
                <input type="text" value={formUser} onChange={e => setFormUser(e.target.value.toUpperCase())}
                  placeholder="JSMITH"
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm font-mono" />
              )}
              <p className="text-[10px] text-slate-400 mt-1">
                {unregistered.length > 0
                  ? "Select from Snowflake role members, or enter a username manually."
                  : "All role members already configured. Enter a username to add manually."}
              </p>
            </div>
          </div>

          {/* Multi-role selection */}
          <div className="mt-4">
            <label className="text-xs font-semibold text-slate-600 block mb-2">
              Assigned Roles (access = union of all selected roles)
            </label>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {roles.map(role => {
                const id = Number(role.ROLE_ID ?? role.role_id ?? 0)
                const name = String(role.ROLE_NAME ?? role.role_name ?? "")
                const desc = String(role.DESCRIPTION ?? role.description ?? "")
                const isSelected = formRoleIds.includes(id)
                return (
                  <label
                    key={id}
                    className={`flex items-start gap-2.5 p-3 rounded-lg border cursor-pointer transition-all ${
                      isSelected
                        ? "border-blue-300 bg-blue-50"
                        : "border-slate-200 hover:border-slate-300 hover:bg-slate-50"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleRole(id)}
                      className="rounded mt-0.5"
                    />
                    <div className="min-w-0">
                      <p className={`text-xs font-semibold ${isSelected ? "text-blue-700" : "text-slate-700"}`}>{name}</p>
                      <p className="text-[10px] text-slate-500 truncate">{desc}</p>
                    </div>
                  </label>
                )
              })}
            </div>
            {formRoleIds.length === 0 && (
              <p className="text-[10px] text-amber-600 mt-1.5">At least one role must be selected.</p>
            )}
          </div>

          <div className="flex justify-end gap-2 mt-4 pt-4 border-t border-slate-100">
            <button className="sf-btn-secondary text-xs" onClick={() => setShowForm(false)}>Cancel</button>
            <button className="sf-btn-primary flex items-center gap-1.5 text-xs" onClick={handleSave} disabled={saving}>
              <Save size={12} /> {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      )}

      {/* User Table */}
      <div className="sf-card overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 bg-slate-50">
          <h2 className="font-semibold text-slate-700 text-sm">Users ({loading ? "…" : entitlements.length})</h2>
        </div>
        {loading ? (
          <div className="p-10 text-center text-slate-400">Loading…</div>
        ) : entitlements.length === 0 ? (
          <div className="p-8 text-center text-slate-400 text-sm">No users configured. Click &quot;Add User&quot; to get started.</div>
        ) : (
          <table className="w-full text-xs">
            <thead className="bg-slate-50/50 border-b border-slate-100">
              <tr>
                {["User", "Assigned Roles", "Status", "Actions"].map(h => (
                  <th key={h} className="text-left px-4 py-2.5 text-slate-500 font-semibold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {entitlements.map((row, i) => {
                const r = row as Record<string, unknown>
                const userName = gf(r, "USER_NAME", "user_name", "")
                const roleNames = parseArr(r.ROLE_NAMES ?? r.role_names).filter(n => n && n !== "null")
                const active = gf(r, "IS_ACTIVE", "is_active", true) as boolean

                return (
                  <tr key={i} className={`border-b border-slate-50 hover:bg-slate-50/50 ${!active ? "opacity-50" : ""}`}>
                    <td className="px-4 py-2.5 font-medium text-slate-800 font-mono">{userName}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex flex-wrap gap-1">
                        {roleNames.length > 0 ? roleNames.map(name => (
                          <span key={name} className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-medium bg-indigo-50 text-indigo-700 border border-indigo-100">
                            {name}
                          </span>
                        )) : (
                          <span className="text-slate-400 text-[10px]">No roles assigned</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-2.5"><span className={`text-[10px] font-medium ${active ? "text-green-600" : "text-red-500"}`}>{active ? "Active" : "Inactive"}</span></td>
                    <td className="px-4 py-2.5">
                      <div className="flex gap-1">
                        <button onClick={() => startEdit(row)} className="text-[10px] text-blue-600 hover:text-blue-800 font-medium px-2 py-1 rounded hover:bg-blue-50">Edit</button>
                        {active ? (
                          <button onClick={() => handleDeactivate(userName)} className="text-[10px] text-amber-600 hover:text-amber-800 font-medium px-2 py-1 rounded hover:bg-amber-50">Deactivate</button>
                        ) : (
                          <button onClick={() => handleReactivate(userName)} className="text-[10px] text-green-600 hover:text-green-800 font-medium px-2 py-1 rounded hover:bg-green-50">Reactivate</button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

// ============================================================================
// ROLES TAB
// ============================================================================
function RolesTab() {
  const { refreshAuth } = useRole()
  const [roles, setRoles] = useState<EntitlementRole[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingRole, setEditingRole] = useState<string | null>(null)
  // Reference data (loaded from DB, not hardcoded)
  const [lobCodes, setLobCodes] = useState<{ code: string; name: string }[]>([])
  const [docTypeGroups, setDocTypeGroups] = useState<Record<string, string[]>>(DOC_TYPE_GROUPS)
  // Form
  const [formName, setFormName] = useState("")
  const [formDesc, setFormDesc] = useState("")
  const [formMenu, setFormMenu] = useState<string[]>(DEFAULT_PAGE_KEYS)
  const [formLob, setFormLob] = useState<string[]>(["*"])
  const [formDoc, setFormDoc] = useState<string[]>(["*"])
  const [formDownload, setFormDownload] = useState(true)
  const [saving, setSaving] = useState(false)
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [rolesRes, lobsRes, labelsRes] = await Promise.all([
        fetch("/api/admin/roles"),
        fetch("/api/admin/lobs"),
        fetch("/api/admin/classification-labels"),
      ])
      const rolesData = await rolesRes.json()
      setRoles(rolesData.roles ?? [])

      // Load LOB reference data
      if (lobsRes.ok) {
        const lobsData = await lobsRes.json()
        const lobs = (lobsData.lobs ?? []).map((l: Record<string, unknown>) => ({
          code: String(l.LOB_CODE ?? l.lob_code ?? ""),
          name: String(l.LOB_NAME ?? l.lob_name ?? ""),
        })).filter((l: { code: string }) => l.code)
        if (lobs.length > 0) setLobCodes(lobs)
      }

      // Load classification labels grouped by category
      if (labelsRes.ok) {
        const labelsData = await labelsRes.json()
        const labels = labelsData.labels ?? []
        const groups: Record<string, string[]> = {}
        for (const l of labels) {
          const cat = String((l as Record<string, unknown>).CATEGORY ?? (l as Record<string, unknown>).category ?? "Other")
          const label = String((l as Record<string, unknown>).LABEL ?? (l as Record<string, unknown>).label ?? "")
          if (!label) continue
          if (!groups[cat]) groups[cat] = []
          groups[cat].push(label)
        }
        if (Object.keys(groups).length > 0) setDocTypeGroups(groups)
      }
    } catch (e) { console.error(e) }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  function startAdd() {
    setEditingRole(null); setFormName(""); setFormDesc("")
    setFormMenu(DEFAULT_PAGE_KEYS); setFormLob(["*"]); setFormDoc(["*"]); setFormDownload(true)
    setShowForm(true)
  }
  function startEdit(role: EntitlementRole) {
    const r = role as Record<string, unknown>
    setEditingRole(gf(r, "ROLE_NAME", "role_name", ""))
    setFormName(gf(r, "ROLE_NAME", "role_name", ""))
    setFormDesc(gf(r, "DESCRIPTION", "description", ""))
    // Keep only keys for pages that exist; saving then drops stale keys
    const menu = parseArr(r.MENU_ACCESS ?? r.menu_access)
    setFormMenu(menu.includes("*") ? DEFAULT_PAGE_KEYS : menu.filter(k => KNOWN_PAGE_KEYS.has(k)))
    setFormLob(parseArr(r.LOB_ACCESS ?? r.lob_access))
    setFormDoc(parseArr(r.DOC_TYPE_ACCESS ?? r.doc_type_access))
    setFormDownload(gf(r, "CAN_DOWNLOAD", "can_download", true) as boolean)
    setShowForm(true)
  }

  async function handleSave() {
    if (!formName.trim()) { showToast("Role name required", "error"); return }
    setSaving(true)
    try {
      const res = await fetch("/api/admin/roles", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roleName: formName.trim(), description: formDesc,
          menuAccess: formName.trim() === ADMIN_ROLE_NAME && !formMenu.includes(LOCKED_ADMIN_KEY) ? [...formMenu, LOCKED_ADMIN_KEY] : formMenu,
          lobAccess: formLob, docTypeAccess: formDoc, canDownload: formDownload }) })
      if (!res.ok) { const d = await res.json(); showToast(d.error ?? "Save failed", "error"); return }
      showToast(`Role "${formName}" saved`, "success"); setShowForm(false); load(); refreshAuth()
    } catch (err) { showToast(err instanceof Error ? err.message : "Failed", "error") }
    finally { setSaving(false) }
  }

  async function handleDelete(roleName: string) {
    if (!confirm(`Delete role "${roleName}"?`)) return
    await fetch("/api/admin/roles", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ roleName }) })
    showToast(`Deleted "${roleName}"`, "success"); load()
  }

  function toggleDocType(dt: string) {
    setFormDoc(prev => {
      const without = prev.filter(d => d !== "*")
      return without.includes(dt) ? without.filter(d => d !== dt) : [...without, dt]
    })
  }
  function toggleDocGroup(group: string) {
    const types = docTypeGroups[group] ?? []
    const currentWithout = formDoc.filter(d => d !== "*")
    const allSelected = types.every(t => currentWithout.includes(t))
    if (allSelected) {
      setFormDoc(currentWithout.filter(d => !types.includes(d)))
    } else {
      setFormDoc([...new Set([...currentWithout, ...types])])
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <div className="flex gap-2">
          <button className="sf-btn-secondary flex items-center gap-1.5 text-xs" onClick={load}><RefreshCw size={12} /> Refresh</button>
          <button className="sf-btn-primary flex items-center gap-1.5 text-xs" onClick={startAdd}><Plus size={12} /> Create Role</button>
        </div>
      </div>

      {/* Role Editor */}
      {showForm && (
        <div className="sf-card p-5 border-2 border-blue-200">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-slate-700 text-sm">{editingRole ? `Edit: ${editingRole}` : "Create Role"}</h2>
            <button onClick={() => setShowForm(false)} className="text-slate-400 hover:text-slate-600"><X size={16} /></button>
          </div>

          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="text-xs font-semibold text-slate-600 block mb-1">Role Name</label>
              <input type="text" value={formName} onChange={e => setFormName(e.target.value)}
                disabled={!!editingRole} placeholder="e.g. Finance Reviewer"
                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm disabled:bg-slate-50" />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-600 block mb-1">Description</label>
              <input type="text" value={formDesc} onChange={e => setFormDesc(e.target.value)}
                placeholder="Purpose of this role"
                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" />
            </div>
          </div>

          {/* App Pages: one checkbox per sidebar tab, grouped like the sidebar */}
          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold text-slate-600">App Pages</label>
              <span className="text-[10px] text-slate-500">{formMenu.length} of {APP_PAGES.length} visible</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {PAGE_SECTIONS.map(section => {
                const pages = APP_PAGES.filter(p => p.section === section)
                const keys = pages.map(p => p.key)
                const onCount = keys.filter(k => formMenu.includes(k)).length
                const isLocked = (key: string) => formName === ADMIN_ROLE_NAME && key === LOCKED_ADMIN_KEY
                const setAll = (on: boolean) => setFormMenu(prev => on
                  ? Array.from(new Set([...prev, ...keys]))
                  : prev.filter(k => !keys.includes(k) || isLocked(k)))
                return (
                  <div key={section} className="rounded-lg border border-slate-200 p-2.5">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                        {SECTION_LABELS[section]} <span className="normal-case font-normal">({onCount}/{keys.length})</span>
                      </span>
                      <button type="button" onClick={() => setAll(onCount < keys.length)}
                        className="text-[10px] text-blue-600 hover:text-blue-800 font-medium">
                        {onCount < keys.length ? "Select all" : "Clear"}
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {pages.map(p => (
                        <label key={p.key}
                          title={isLocked(p.key) ? "Administrator always keeps User Management" : p.href}
                          className={`flex items-center gap-1.5 text-xs bg-slate-50 px-2.5 py-1.5 rounded-lg border border-slate-200 ${isLocked(p.key) ? "opacity-60 cursor-not-allowed" : "cursor-pointer hover:bg-slate-100"}`}>
                          <input type="checkbox" checked={formMenu.includes(p.key) || isLocked(p.key)} disabled={isLocked(p.key)}
                            onChange={() => setFormMenu(prev => prev.includes(p.key) ? prev.filter(k => k !== p.key) : [...prev, p.key])} className="rounded" />
                          {p.label}
                        </label>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* LOB Access */}
          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold text-slate-600">LOB Access</label>
              <button onClick={() => setFormLob(formLob.includes("*") ? [] : ["*"])}
                className="text-[10px] text-blue-600 hover:text-blue-800 font-medium">
                {formLob.includes("*") ? "Select specific LOBs" : "Grant all LOBs"}
              </button>
            </div>
            {formLob.includes("*") ? (
              <div className="text-xs text-green-700 bg-green-50 px-3 py-2 rounded-lg border border-green-200">All lines of business (wildcard)</div>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {lobCodes.map(({ code, name }) => (
                  <label key={code} className="flex items-center gap-1 text-[11px] bg-slate-50 px-2 py-1 rounded border border-slate-200 cursor-pointer hover:bg-slate-100"
                    title={name}>
                    <input type="checkbox" checked={formLob.includes(code)}
                      onChange={() => setFormLob(prev => prev.includes(code) ? prev.filter(l => l !== code) : [...prev.filter(l => l !== "*"), code])} className="rounded w-3 h-3" />
                    {code}
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* Document Type Access (grouped) */}
          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold text-slate-600">Document Type Access</label>
              <button onClick={() => setFormDoc(formDoc.includes("*") ? [] : ["*"])}
                className="text-[10px] text-blue-600 hover:text-blue-800 font-medium">
                {formDoc.includes("*") ? "Select specific types" : "Grant all types"}
              </button>
            </div>
            {formDoc.includes("*") ? (
              <div className="text-xs text-green-700 bg-green-50 px-3 py-2 rounded-lg border border-green-200">All document types (wildcard)</div>
            ) : (
              <div className="space-y-1">
                {Object.entries(docTypeGroups).map(([group, types]) => {
                  const selectedCount = types.filter(t => formDoc.includes(t)).length
                  const isExpanded = expandedGroup === group
                  return (
                    <div key={group} className="border border-slate-200 rounded-lg overflow-hidden">
                      <button
                        className="w-full px-3 py-2 bg-slate-50 flex items-center justify-between text-xs hover:bg-slate-100"
                        onClick={() => setExpandedGroup(isExpanded ? null : group)}
                      >
                        <span className="font-medium text-slate-700">{group}</span>
                        <div className="flex items-center gap-2">
                          <span className={`text-[10px] ${selectedCount === types.length ? "text-green-600 font-medium" : selectedCount > 0 ? "text-blue-600" : "text-slate-400"}`}>
                            {selectedCount}/{types.length}
                          </span>
                          <button onClick={(e) => { e.stopPropagation(); toggleDocGroup(group) }}
                            className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                              selectedCount === types.length
                                ? "text-red-600 hover:text-red-800 bg-red-50 hover:bg-red-100"
                                : "text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100"
                            }`}>
                            {selectedCount === types.length ? "Remove all" : "Select all"}
                          </button>
                        </div>
                      </button>
                      {isExpanded && (
                        <div className="px-3 py-2 flex flex-wrap gap-1.5 border-t border-slate-100">
                          {types.map(dt => (
                            <label key={dt} className="flex items-center gap-1 text-[11px] bg-white px-2 py-1 rounded border border-slate-200 cursor-pointer hover:bg-slate-50">
                              <input type="checkbox" checked={formDoc.includes(dt)} onChange={() => toggleDocType(dt)} className="rounded w-3 h-3" />
                              {dt}
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Download permission */}
          <label className="flex items-center gap-2 text-xs mb-4">
            <input type="checkbox" checked={formDownload} onChange={e => setFormDownload(e.target.checked)} className="rounded" />
            <span className="font-medium text-slate-600">Allow document downloads</span>
          </label>

          <div className="flex justify-end gap-2 pt-4 border-t border-slate-100">
            <button className="sf-btn-secondary text-xs" onClick={() => setShowForm(false)}>Cancel</button>
            <button className="sf-btn-primary flex items-center gap-1.5 text-xs" onClick={handleSave} disabled={saving}>
              <Save size={12} /> {saving ? "Saving…" : "Save Role"}
            </button>
          </div>
        </div>
      )}

      {/* Roles Table */}
      <div className="sf-card overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 bg-slate-50">
          <h2 className="font-semibold text-slate-700 text-sm">Entitlement Roles ({loading ? "…" : roles.length})</h2>
        </div>
        {loading ? (
          <div className="p-10 text-center text-slate-400">Loading…</div>
        ) : roles.length === 0 ? (
          <div className="p-8 text-center text-slate-400 text-sm">No roles configured.</div>
        ) : (
          <table className="w-full text-xs">
            <thead className="bg-slate-50/50 border-b border-slate-100">
              <tr>
                {["Role", "Description", "Members", "Pages", "LOBs", "Doc Types", "Download", "Actions"].map(h => (
                  <th key={h} className="text-left px-4 py-2.5 text-slate-500 font-semibold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {roles.map((role, i) => {
                const r = role as Record<string, unknown>
                const name = gf(r, "ROLE_NAME", "role_name", "") as string
                const desc = gf(r, "DESCRIPTION", "description", "") as string
                const members = Number(gf(r, "MEMBER_COUNT", "member_count", 0))
                const menu = parseArr(r.MENU_ACCESS ?? r.menu_access)
                const lob = parseArr(r.LOB_ACCESS ?? r.lob_access)
                const doc = parseArr(r.DOC_TYPE_ACCESS ?? r.doc_type_access)
                const download = gf(r, "CAN_DOWNLOAD", "can_download", true)

                return (
                  <tr key={i} className="border-b border-slate-50 hover:bg-slate-50/50">
                    <td className="px-4 py-2.5 font-medium text-slate-800">{name}</td>
                    <td className="px-4 py-2.5 text-slate-500 max-w-[200px] truncate">{desc}</td>
                    <td className="px-4 py-2.5"><span className="bg-slate-100 px-2 py-0.5 rounded-full text-slate-600">{members}</span></td>
                    <td className="px-4 py-2.5 text-slate-600">{menu.includes("*") ? DEFAULT_PAGE_KEYS.length : menu.filter(k => KNOWN_PAGE_KEYS.has(k)).length}/{APP_PAGES.length}</td>
                    <td className="px-4 py-2.5 text-slate-600">{lob.includes("*") ? <span className="text-green-600">All</span> : lob.length}</td>
                    <td className="px-4 py-2.5 text-slate-600">{doc.includes("*") ? <span className="text-green-600">All</span> : doc.length}</td>
                    <td className="px-4 py-2.5">{download ? <span className="text-green-600 text-[10px]">Yes</span> : <span className="text-red-500 text-[10px]">No</span>}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex gap-1">
                        <button onClick={() => startEdit(role)} className="text-[10px] text-blue-600 hover:text-blue-800 font-medium px-2 py-1 rounded hover:bg-blue-50">Edit</button>
                        <button onClick={() => handleDelete(name)} className="text-[10px] text-red-500 hover:text-red-700 font-medium px-2 py-1 rounded hover:bg-red-50"><Trash2 size={10} /></button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

// ============================================================================
// LOBS TAB
// ============================================================================
function LobsTab() {
  const [lobs, setLobs] = useState<LobEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [formCode, setFormCode] = useState("")
  const [formName, setFormName] = useState("")
  const [formDesc, setFormDesc] = useState("")
  const [formDefault, setFormDefault] = useState(false)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/admin/lobs")
      const data = await res.json()
      setLobs(data.lobs ?? [])
    } catch { showToast("Failed to load LOBs", "error") }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  function startAdd() {
    setFormCode(""); setFormName(""); setFormDesc(""); setFormDefault(false); setShowForm(true)
  }
  function startEdit(lob: LobEntry) {
    const r = lob as Record<string, unknown>
    setFormCode(gf(r, "LOB_CODE", "lob_code", "") as string)
    setFormName(gf(r, "LOB_NAME", "lob_name", "") as string)
    setFormDesc(gf(r, "DESCRIPTION", "description", "") as string)
    setFormDefault(gf(r, "IS_DEFAULT", "is_default", false) as boolean)
    setShowForm(true)
  }

  async function handleSave() {
    if (!formCode.trim() || !formName.trim()) { showToast("Code and name required", "error"); return }
    setSaving(true)
    try {
      const res = await fetch("/api/admin/lobs", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lobCode: formCode.trim().toUpperCase(), lobName: formName.trim(), description: formDesc, isDefault: formDefault }) })
      if (!res.ok) { const d = await res.json(); showToast(d.error ?? "Save failed", "error"); return }
      showToast(`LOB "${formCode.toUpperCase()}" saved`, "success"); setShowForm(false); load()
    } catch (err) { showToast(err instanceof Error ? err.message : "Failed", "error") }
    finally { setSaving(false) }
  }

  async function handleDelete(lobCode: string) {
    if (!confirm(`Deactivate LOB "${lobCode}"?`)) return
    await fetch("/api/admin/lobs", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lobCode }) })
    showToast(`Deactivated "${lobCode}"`, "success"); load()
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <div className="flex gap-2">
          <button className="sf-btn-secondary flex items-center gap-1.5 text-xs" onClick={load}><RefreshCw size={12} /> Refresh</button>
          <button className="sf-btn-primary flex items-center gap-1.5 text-xs" onClick={startAdd}><Plus size={12} /> Add LOB</button>
        </div>
      </div>

      {showForm && (
        <div className="sf-card p-5 border-2 border-blue-200">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-slate-700 text-sm">{formCode ? `Edit: ${formCode}` : "Add Line of Business"}</h2>
            <button onClick={() => setShowForm(false)} className="text-slate-400 hover:text-slate-600"><X size={16} /></button>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="text-xs font-semibold text-slate-600 block mb-1">Code</label>
              <input type="text" value={formCode} onChange={e => setFormCode(e.target.value)}
                placeholder="CY" className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm font-mono uppercase" />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-600 block mb-1">Full Name</label>
              <input type="text" value={formName} onChange={e => setFormName(e.target.value)}
                placeholder="New LOB Name" className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-600 block mb-1">Description</label>
              <input type="text" value={formDesc} onChange={e => setFormDesc(e.target.value)}
                placeholder="Description of this LOB..." className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" />
            </div>
          </div>
          <label className="flex items-center gap-2 text-xs mt-3">
            <input type="checkbox" checked={formDefault} onChange={e => setFormDefault(e.target.checked)} className="rounded" />
            <span className="font-medium text-slate-600">Set as default LOB (assigned to unclassified documents)</span>
          </label>
          <div className="flex justify-end gap-2 mt-4 pt-4 border-t border-slate-100">
            <button className="sf-btn-secondary text-xs" onClick={() => setShowForm(false)}>Cancel</button>
            <button className="sf-btn-primary flex items-center gap-1.5 text-xs" onClick={handleSave} disabled={saving}>
              <Save size={12} /> {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      )}

      <div className="sf-card overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 bg-slate-50">
          <h2 className="font-semibold text-slate-700 text-sm">Lines of Business ({loading ? "…" : lobs.length})</h2>
        </div>
        {loading ? (
          <div className="p-10 text-center text-slate-400">Loading…</div>
        ) : (
          <table className="w-full text-xs">
            <thead className="bg-slate-50/50 border-b border-slate-100">
              <tr>
                {["Code", "Name", "Description", "Default", "Status", "Actions"].map(h => (
                  <th key={h} className="text-left px-4 py-2.5 text-slate-500 font-semibold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lobs.map((lob, i) => {
                const r = lob as Record<string, unknown>
                const code = gf(r, "LOB_CODE", "lob_code", "") as string
                const name = gf(r, "LOB_NAME", "lob_name", "") as string
                const desc = gf(r, "DESCRIPTION", "description", "") as string
                const isDefault = gf(r, "IS_DEFAULT", "is_default", false) as boolean
                const active = gf(r, "IS_ACTIVE", "is_active", true) as boolean
                return (
                  <tr key={i} className={`border-b border-slate-50 hover:bg-slate-50/50 ${!active ? "opacity-50" : ""}`}>
                    <td className="px-4 py-2.5 font-mono font-medium text-slate-800">{code}</td>
                    <td className="px-4 py-2.5 text-slate-700">{name}</td>
                    <td className="px-4 py-2.5 text-slate-500 max-w-[250px] truncate">{desc}</td>
                    <td className="px-4 py-2.5">{isDefault ? <span className="text-[10px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-semibold">DEFAULT</span> : ""}</td>
                    <td className="px-4 py-2.5"><span className={`text-[10px] font-medium ${active ? "text-green-600" : "text-red-500"}`}>{active ? "Active" : "Inactive"}</span></td>
                    <td className="px-4 py-2.5">
                      <div className="flex gap-1">
                        <button onClick={() => startEdit(lob)} className="text-[10px] text-blue-600 hover:text-blue-800 font-medium px-2 py-1 rounded hover:bg-blue-50">Edit</button>
                        {active && !isDefault && (
                          <button onClick={() => handleDelete(code)} className="text-[10px] text-red-500 hover:text-red-700 font-medium px-2 py-1 rounded hover:bg-red-50"><Trash2 size={10} /></button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
