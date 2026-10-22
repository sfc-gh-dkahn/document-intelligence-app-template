"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { Plus, Trash2, RefreshCw, Layers, Code, Globe, Tag, Zap, FlaskConical, Play, FileText, Check, Search, Upload, Pin, X, CheckCircle2, XCircle, ArrowUpDown } from "lucide-react"
import { PageHeader } from "@/components/page-header"
import { showToast } from "@/components/toast"
import { Spinner } from "@/components/spinner"

interface SchemaRow {
  SCHEMA_ID?: string; DOCUMENT_TYPE?: string; ATTRIBUTE_NAME?: string
  ATTRIBUTE_DESCRIPTION?: string; ATTRIBUTE_TYPE?: string
  IS_REQUIRED?: boolean; SORT_ORDER?: number; SCHEMA_TIER?: string
  MATCH_RULE?: Record<string, string>
}
type TierData = Record<string, Record<string, SchemaRow[]>>

const TIER_META: Record<string, { label: string; icon: typeof Globe; color: string }> = {
  COMMON:       { label: "Common", icon: Globe, color: "text-emerald-700 bg-emerald-50" },
  CATEGORY:     { label: "Category", icon: Tag, color: "text-blue-700 bg-blue-50" },
  LOB_SPECIFIC: { label: "LOB-Specific", icon: Zap, color: "text-purple-700 bg-purple-50" },
}
const ATTR_TYPES = ["VARCHAR", "DATE", "NUMBER", "VARIANT"]

export default function ExtractionSchemaPage() {
  const [pageTab, setPageTab] = useState<"schema" | "test">("schema")

  // Schema state
  const [tiers, setTiers] = useState<TierData>({})
  const [loading, setLoading] = useState(true)
  const [selectedTier, setSelectedTier] = useState("COMMON")
  const [selectedGroup, setSelectedGroup] = useState("Common")
  const [showAddForm, setShowAddForm] = useState(false)
  const [newAttr, setNewAttr] = useState({ name: "", description: "", type: "VARCHAR", tier: "CATEGORY", docType: "", matchCategory: "", matchLob: "" })

  // Test lab state
  const [stages, setStages] = useState<{ STAGE_NAME?: string; stage_name?: string }[]>([])
  const [testStage, setTestStage] = useState("")
  const [testFiles, setTestFiles] = useState<{ name: string; size: number }[]>([])
  const [testLoading, setTestLoading] = useState(false)
  const [testRunning, setTestRunning] = useState(false)
  const [testResults, setTestResults] = useState<Record<string, unknown>[] | null>(null)
  // Per-attribute test state
  const [attrTestTarget, setAttrTestTarget] = useState<{ name: string; desc: string } | null>(null)
  const [attrTestResult, setAttrTestResult] = useState<{ value: unknown; loading: boolean } | null>(null)
  // Test Lab filters
  const [fileSearch, setFileSearch] = useState("")
  const [filterLob, setFilterLob] = useState("")
  const [filterType, setFilterType] = useState("")
  // Upload state
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  // Pinned test list (persisted in localStorage)
  const [pinnedFiles, setPinnedFiles] = useState<{ name: string; stage: string }[]>(() => {
    if (typeof window === "undefined") return []
    try { return JSON.parse(localStorage.getItem("doc_intel_test_list") ?? "[]") } catch { return [] }
  })

  // Persist pinned list
  useEffect(() => {
    localStorage.setItem("doc_intel_test_list", JSON.stringify(pinnedFiles))
  }, [pinnedFiles])

  // LOB map loaded dynamically from admin config
  const [lobMap, setLobMap] = useState<Record<string, string>>({})
  useEffect(() => {
    fetch("/api/admin/lobs").then(r => r.json()).then(d => {
      const map: Record<string, string> = {}
      for (const r of (d.lobs ?? d ?? [])) {
        const code = String(r.LOB_CODE ?? r.lob_code ?? "")
        const name = String(r.LOB_NAME ?? r.lob_name ?? "")
        if (code && name) map[code] = name
      }
      setLobMap(map)
    }).catch(() => {})
  }, [])

  // LOB/Type parsing from filename pattern: NNNN-LOB-type-company-...
  function parseLob(filename: string): string {
    const parts = filename.split("-")
    if (parts.length >= 2) { const code = parts[1].toUpperCase(); if (lobMap[code]) return code }
    return ""
  }
  function parseDocType(filename: string): string {
    const parts = filename.split("-")
    if (parts.length >= 3) return parts[2].toLowerCase()
    return ""
  }

  // Filtered file list
  const filteredFiles = testFiles.filter(f => {
    const fn = f.name.split("/").pop() ?? f.name
    if (fileSearch && !fn.toLowerCase().includes(fileSearch.toLowerCase())) return false
    if (filterLob && parseLob(fn) !== filterLob) return false
    if (filterType && parseDocType(fn) !== filterType) return false
    return true
  })

  // Available LOBs and types from current file list
  const availableLobs = [...new Set(testFiles.map(f => parseLob(f.name.split("/").pop() ?? f.name)).filter(Boolean))].sort()
  const availableTypes = [...new Set(testFiles.map(f => parseDocType(f.name.split("/").pop() ?? f.name)).filter(Boolean))].sort()

  async function uploadFile(file: File) {
    if (!testStage) { showToast("Select a stage first", "error"); return }
    setUploading(true)
    try {
      const formData = new FormData()
      formData.append("file", file)
      formData.append("stage", testStage)
      const res = await fetch("/api/admin/upload", { method: "POST", body: formData })
      if (!res.ok) { const d = await res.json(); showToast(d.error ?? "Upload failed", "error"); return }
      showToast(`Uploaded ${file.name}`, "success")
      await loadTestFiles(testStage)
      // Auto-pin the uploaded file
      pinFile(file.name)
    } catch { showToast("Upload failed", "error") }
    finally { setUploading(false) }
  }

  function pinFile(fileName: string) {
    if (pinnedFiles.some(p => p.name === fileName && p.stage === testStage)) return
    setPinnedFiles(prev => [...prev, { name: fileName, stage: testStage }])
  }
  function unpinFile(idx: number) {
    setPinnedFiles(prev => prev.filter((_, i) => i !== idx))
  }

  async function load() {
    setLoading(true)
    try {
      const res = await fetch("/api/admin/extraction-schema")
      const data = await res.json()
      if (data.tiers) setTiers(data.tiers)
    } catch { showToast("Failed to load schemas", "error") }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])
  useEffect(() => {
    fetch("/api/admin/extraction-test?action=list_stages").then(r => r.json()).then(d => setStages(d.stages ?? [])).catch(() => {})
  }, [])

  useEffect(() => {
    const groups = Object.keys(tiers[selectedTier] ?? {})
    if (groups.length > 0 && !groups.includes(selectedGroup)) setSelectedGroup(groups[0])
  }, [selectedTier, tiers])

  async function addAttribute() {
    if (!newAttr.name || !newAttr.description) { showToast("Name and description required", "error"); return }
    const docType = newAttr.tier === "COMMON" ? "Common" : newAttr.docType
    if (!docType) { showToast("Group name required", "error"); return }
    const matchRule = newAttr.tier === "COMMON" ? null
      : newAttr.tier === "CATEGORY" ? { category: newAttr.matchCategory || docType }
      : { category: newAttr.matchCategory, lob: newAttr.matchLob }
    const res = await fetch("/api/admin/extraction-schema", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ documentType: docType, attributeName: newAttr.name, attributeDescription: newAttr.description, attributeType: newAttr.type, schemaTier: newAttr.tier, matchRule })
    })
    if (res.ok) { setShowAddForm(false); setNewAttr({ name: "", description: "", type: "VARCHAR", tier: "CATEGORY", docType: "", matchCategory: "", matchLob: "" }); load() }
    else { const d = await res.json(); showToast(d.error ?? "Failed", "error") }
  }

  async function deleteAttr(id: string) {
    if (!confirm("Remove this attribute?")) return
    await fetch(`/api/admin/extraction-schema?id=${encodeURIComponent(id)}`, { method: "DELETE" })
    load()
  }

  const loadTestFiles = useCallback(async (stageName: string) => {
    setTestLoading(true); setTestFiles([])
    try {
      const res = await fetch(`/api/admin/extraction-test?action=list_files&stage=${encodeURIComponent(stageName)}`)
      const data = await res.json()
      setTestFiles(data.files ?? [])
    } catch { showToast("Failed to list files", "error") }
    finally { setTestLoading(false) }
  }, [])

  async function runTest() {
    // Run pinned test list — each file carries its own stage
    if (pinnedFiles.length === 0) { showToast("Pin at least one file to the test list", "error"); return }
    // Group by stage for batch processing
    const stage = pinnedFiles[0]?.stage ?? testStage
    const filesToTest = pinnedFiles.map(p => p.name)
    if (!stage) { showToast("No stage available", "error"); return }
    setTestRunning(true); setTestResults(null)
    try {
      const res = await fetch("/api/admin/extraction-test", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(filesToTest.length === 1
          ? { filePath: filesToTest[0], stageName: stage, mode: "full" }
          : { files: filesToTest, stageName: stage }
        )
      })
      const data = await res.json()
      if (!res.ok) { showToast(data.error ?? "Test failed", "error"); return }
      // Normalize: single file returns { results: {...} }, multi returns { results: [...] }
      const r = data.results
      setTestResults(Array.isArray(r) ? r : [r])
    } catch { showToast("Network error", "error") }
    finally { setTestRunning(false) }
  }

  async function testAttribute(attrName: string, attrDesc: string) {
    if (pinnedFiles.length === 0) {
      showToast("Pin a file in the Test Lab first", "error")
      return
    }
    const filePath = pinnedFiles[0].name
    const stageName = pinnedFiles[0].stage
    setAttrTestTarget({ name: attrName, desc: attrDesc })
    setAttrTestResult({ value: undefined, loading: true })
    try {
      const res = await fetch("/api/admin/extraction-test", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "single_attr", stageName, filePath, attributeName: attrName, attributeDescription: attrDesc })
      })
      const data = await res.json()
      setAttrTestResult({ value: data.value, loading: false })
    } catch {
      setAttrTestResult({ value: "Error", loading: false })
    }
  }

  const currentGroups = tiers[selectedTier] ?? {}
  const groupNames = Object.keys(currentGroups)
  const currentAttrs = currentGroups[selectedGroup] ?? []

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      <PageHeader title="Extraction Schema" icon={Code}>
        {pageTab === "schema" && (
          <button className="sf-btn-primary text-xs flex items-center gap-1" onClick={() => setShowAddForm(!showAddForm)}>
            <Plus size={12} /> Add Attribute
          </button>
        )}
        <button className="sf-btn-secondary flex items-center gap-1.5" onClick={load}>
          <RefreshCw size={13} /> Reload
        </button>
      </PageHeader>

      {/* Tab bar */}
      <div className="border-b border-slate-200">
        <div className="flex gap-0">
          {([["schema", Layers, "Schema Configuration"], ["test", FlaskConical, "Test Lab"]] as const).map(([id, Icon, label]) => (
            <button key={id} onClick={() => setPageTab(id)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium border-b-2 transition-colors ${
                pageTab === id ? "border-[var(--brand-primary)] text-[var(--brand-primary)]" : "border-transparent text-slate-500 hover:text-slate-700"
              }`}>
              <Icon size={13} /> {label}
            </button>
          ))}
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* SCHEMA TAB */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {pageTab === "schema" && (
        <>
          <p className="text-sm text-slate-500">
            Three-tier extraction model. <strong>Common</strong> attributes apply to every document.
            <strong> Category</strong> attributes fire based on classification.
            <strong> LOB-Specific</strong> fire when both category and LOB match.
          </p>

          {pinnedFiles.length === 0 && (
            <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              <FlaskConical size={13} className="shrink-0" />
              <span>To test individual attributes, pin a file in the <strong>Test Lab</strong> tab first.</span>
            </div>
          )}

          {/* Tier Selector */}
          <div className="flex gap-2">
            {Object.entries(TIER_META).map(([key, { label, icon: Icon, color }]) => (
              <button key={key} onClick={() => setSelectedTier(key)}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                  selectedTier === key ? `${color} ring-2 ring-offset-1 ring-current` : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}>
                <Icon size={13} /> {label}
                <span className="ml-1 opacity-60">({Object.values(tiers[key] ?? {}).flat().length})</span>
              </button>
            ))}
          </div>

          {/* Add Form */}
          {showAddForm && (
            <div className="sf-card p-4 space-y-3 border-2 border-[var(--brand-primary)]">
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-xs text-slate-500 block mb-1">Tier</label>
                  <select value={newAttr.tier} onChange={e => setNewAttr({ ...newAttr, tier: e.target.value })} className="sf-input text-xs w-full">
                    <option value="COMMON">Common</option><option value="CATEGORY">Category</option><option value="LOB_SPECIFIC">LOB-Specific</option>
                  </select>
                </div>
                {newAttr.tier !== "COMMON" && (
                  <div>
                    <label className="text-xs text-slate-500 block mb-1">Group Name</label>
                    <input value={newAttr.docType} onChange={e => setNewAttr({ ...newAttr, docType: e.target.value })} placeholder="e.g. Contracts, Financial - Invoices" className="sf-input text-xs w-full" />
                  </div>
                )}
                {newAttr.tier !== "COMMON" && (
                  <div>
                    <label className="text-xs text-slate-500 block mb-1">Match Category</label>
                    <input value={newAttr.matchCategory} onChange={e => setNewAttr({ ...newAttr, matchCategory: e.target.value })} placeholder="e.g. Contracts, Financial" className="sf-input text-xs w-full" />
                  </div>
                )}
                {newAttr.tier === "LOB_SPECIFIC" && (
                  <div>
                    <label className="text-xs text-slate-500 block mb-1">Match LOB</label>
                    <input value={newAttr.matchLob} onChange={e => setNewAttr({ ...newAttr, matchLob: e.target.value })} placeholder="e.g. Finance, Legal" className="sf-input text-xs w-full" />
                  </div>
                )}
              </div>
              <div className="grid grid-cols-4 gap-3">
                <div><label className="text-xs text-slate-500 block mb-1">Attribute Name</label>
                  <input value={newAttr.name} onChange={e => setNewAttr({ ...newAttr, name: e.target.value })} placeholder="e.g. reserve_amount" className="sf-input text-xs w-full" /></div>
                <div className="col-span-2"><label className="text-xs text-slate-500 block mb-1">Description (AI prompt)</label>
                  <input value={newAttr.description} onChange={e => setNewAttr({ ...newAttr, description: e.target.value })} placeholder="What to extract" className="sf-input text-xs w-full" /></div>
                <div><label className="text-xs text-slate-500 block mb-1">Type</label>
                  <select value={newAttr.type} onChange={e => setNewAttr({ ...newAttr, type: e.target.value })} className="sf-input text-xs w-full">
                    {ATTR_TYPES.map(t => <option key={t}>{t}</option>)}
                  </select></div>
              </div>
              <div className="flex gap-2">
                <button onClick={addAttribute} className="sf-btn-primary text-xs">Save</button>
                <button onClick={() => setShowAddForm(false)} className="sf-btn-secondary text-xs">Cancel</button>
              </div>
            </div>
          )}

          {/* Schema content */}
          <div className="flex gap-4">
            <div className="w-52 shrink-0 sf-card overflow-hidden">
              <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-100">
                <h3 className="text-xs font-semibold text-slate-600">{TIER_META[selectedTier]?.label} Groups</h3>
              </div>
              {groupNames.length === 0 ? (
                <div className="p-4 text-xs text-slate-400">No groups</div>
              ) : groupNames.map(name => (
                <button key={name} onClick={() => setSelectedGroup(name)}
                  className={`w-full text-left px-4 py-2.5 text-xs flex items-center justify-between border-b border-slate-50 ${
                    selectedGroup === name ? "bg-[var(--brand-pale)] text-[var(--brand-primary)] font-semibold" : "text-slate-700 hover:bg-slate-50"
                  }`}>
                  <span className="truncate">{name}</span>
                  <span className="text-[10px] text-slate-400">{currentGroups[name]?.length ?? 0}</span>
                </button>
              ))}
              {currentAttrs[0]?.MATCH_RULE && (() => {
                const raw = currentAttrs[0].MATCH_RULE
                const rule: Record<string, string> = typeof raw === "string" ? (() => { try { return JSON.parse(raw) } catch { return {} } })() : (raw as Record<string, string>)
                return Object.keys(rule).length > 0 ? (
                <div className="p-3 border-t border-slate-100">
                  <h4 className="text-[10px] font-semibold text-slate-500 uppercase mb-1">Fires When</h4>
                  {Object.entries(rule).map(([k, v]) => (
                    <div key={k} className="text-xs"><span className="text-slate-500">{k}:</span> <span className="font-medium">{v}</span></div>
                  ))}
                </div>
              ) : null})()}
            </div>

            <div className="flex-1 sf-card overflow-hidden">
              <div className="px-5 py-3 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-700">{selectedGroup} — {currentAttrs.length} attributes</h2>
                <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${TIER_META[selectedTier]?.color ?? ""}`}>{TIER_META[selectedTier]?.label}</span>
              </div>
              {currentAttrs.length === 0 ? (
                <div className="p-8 text-center text-slate-400 text-sm">Select a group or add attributes</div>
              ) : (
                <table className="w-full text-xs">
                  <thead className="bg-slate-50/50 border-b border-slate-100">
                    <tr>{["#","Attribute","Description","Type",""].map(h => <th key={h} className="text-left px-3 py-2 text-slate-500 font-semibold">{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {currentAttrs.map((a, i) => (
                      <tr key={String(a.SCHEMA_ID ?? i)} className="border-b border-slate-50 hover:bg-slate-50/50">
                        <td className="px-3 py-2 text-slate-400 w-8">{i+1}</td>
                        <td className="px-3 py-2 font-mono text-[11px] font-medium text-slate-800">{String(a.ATTRIBUTE_NAME ?? "")}</td>
                        <td className="px-3 py-2 text-slate-600 max-w-[280px] truncate">{String(a.ATTRIBUTE_DESCRIPTION ?? "")}</td>
                        <td className="px-3 py-2"><span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-600">{String(a.ATTRIBUTE_TYPE ?? "VARCHAR")}</span></td>
                        <td className="px-3 py-2 w-16 flex gap-1">
                          <button onClick={() => testAttribute(String(a.ATTRIBUTE_NAME ?? ""), String(a.ATTRIBUTE_DESCRIPTION ?? ""))}
                            disabled={pinnedFiles.length === 0}
                            className={`p-1 rounded ${pinnedFiles.length === 0 ? "text-slate-200 cursor-not-allowed" : "hover:bg-blue-50 text-slate-300 hover:text-blue-500"}`}
                            title={pinnedFiles.length === 0 ? "Pin a file in Test Lab first" : "Test this attribute against pinned file"}>
                            <FlaskConical size={12} />
                          </button>
                          <button onClick={() => deleteAttr(String(a.SCHEMA_ID ?? ""))} className="p-1 rounded hover:bg-red-50 text-slate-300 hover:text-red-500"><Trash2 size={12} /></button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {/* Attribute test result inline */}
          {attrTestTarget && (
            <div className="sf-card p-3 border-2 border-blue-200 flex items-center gap-3">
              <FlaskConical size={14} className="text-blue-500 shrink-0" />
              <div className="flex-1 min-w-0">
                <span className="text-xs text-slate-500">Testing </span>
                <span className="text-xs font-mono font-semibold text-slate-800">{attrTestTarget.name}</span>
                {attrTestResult?.loading ? (
                  <span className="text-xs text-slate-400 ml-2">Extracting…</span>
                ) : attrTestResult ? (
                  <span className="text-xs ml-2">
                    <span className="text-slate-500">Result: </span>
                    <span className={`font-medium ${attrTestResult.value != null ? "text-green-700" : "text-slate-400 italic"}`}>
                      {attrTestResult.value != null ? String(attrTestResult.value) : "null (not found)"}
                    </span>
                  </span>
                ) : null}
              </div>
              <button onClick={() => { setAttrTestTarget(null); setAttrTestResult(null) }}
                className="text-xs text-slate-400 hover:text-slate-600 px-2">Dismiss</button>
            </div>
          )}
        </>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* TEST LAB TAB */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {pageTab === "test" && (
        <>
          <p className="text-sm text-slate-500">
            Select documents from a stage to test the pipeline: <strong>Parse → Classify → Detect LOB → Resolve Schema → Extract</strong>.
            Results are <strong>not saved</strong> to the pipeline.
          </p>

          {/* Stage picker + Upload + Run */}
          <div className="sf-card p-4 space-y-3">
            <div className="flex gap-3 items-end flex-wrap">
              <div className="w-72">
                <label className="text-xs text-slate-500 block mb-1">Stage</label>
                <select value={testStage} className="sf-input text-xs w-full"
                  onChange={e => { setTestStage(e.target.value); loadTestFiles(e.target.value) }}>
                  <option value="">Select a stage…</option>
                  {stages.map(s => { const n = String(s.STAGE_NAME ?? s.stage_name ?? ""); return <option key={n} value={n}>{n}</option> })}
                </select>
              </div>
              <input ref={fileInputRef} type="file" accept=".pdf,.tiff,.tif,.docx,.doc,.png,.jpg,.jpeg,.html,.txt"
                className="hidden" onChange={e => { if (e.target.files?.[0]) uploadFile(e.target.files[0]); e.target.value = "" }} />
              <button onClick={() => fileInputRef.current?.click()} disabled={!testStage || uploading}
                className="sf-btn-secondary text-xs flex items-center gap-1.5 disabled:opacity-50">
                {uploading ? <Spinner size={12} /> : <Upload size={12} />} {uploading ? "Uploading…" : "Upload File"}
              </button>
              <button onClick={runTest} disabled={pinnedFiles.length === 0 || testRunning}
                className="sf-btn-primary text-xs flex items-center gap-1.5 disabled:opacity-50">
                {testRunning ? <Spinner size={12} /> : <Play size={12} />} {testRunning ? "Running…" : `Run Pipeline (${pinnedFiles.length})`}
              </button>
            </div>

            {/* Pinned Test List */}
            {pinnedFiles.length > 0 && (
              <div className="border border-blue-200 bg-blue-50/50 rounded-lg overflow-hidden">
                <div className="px-3 py-2 border-b border-blue-100 flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-blue-700 flex items-center gap-1"><Pin size={10} /> Test List ({pinnedFiles.length} pinned)</span>
                  <button className="text-[10px] text-blue-600 hover:text-blue-800 font-medium"
                    onClick={() => setPinnedFiles([])}>Clear All</button>
                </div>
                <div className="divide-y divide-blue-50 max-h-24 overflow-y-auto">
                  {pinnedFiles.map((p, idx) => (
                    <div key={idx} className="flex items-center gap-2 px-3 py-1.5 text-xs">
                      <span className="flex-1 font-mono text-[11px] text-slate-700 truncate">{p.name.split("/").pop()}</span>
                      <span className="text-[9px] text-slate-400 truncate max-w-[120px]">{p.stage}</span>
                      <button onClick={() => unpinFile(idx)} className="p-0.5 hover:bg-red-100 rounded text-slate-400 hover:text-red-500">
                        <X size={10} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Search + Filter bar */}
            {testStage && (
              <div className="flex gap-2 items-center flex-wrap">
                <div className="relative flex-1 min-w-[180px]">
                  <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input value={fileSearch} onChange={e => setFileSearch(e.target.value)}
                    placeholder="Search files…" className="sf-input text-xs w-full pl-7" />
                </div>
                <select value={filterLob} onChange={e => setFilterLob(e.target.value)} className="sf-input text-xs">
                  <option value="">All LOBs</option>
                  {availableLobs.map(code => <option key={code} value={code}>{lobMap[code] ?? code}</option>)}
                </select>
                <select value={filterType} onChange={e => setFilterType(e.target.value)} className="sf-input text-xs">
                  <option value="">All Types</option>
                  {availableTypes.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            )}

            {/* File list — pin to add to test list */}
            {testStage && (
              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <div className="px-3 py-2 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
                  <span className="text-[11px] text-slate-500">{filteredFiles.length} of {testFiles.length} files</span>
                  <button className="text-[10px] text-blue-600 hover:text-blue-800 font-medium flex items-center gap-1"
                    onClick={() => { filteredFiles.forEach(f => pinFile(f.name)) }}>
                    <Pin size={9} /> Pin All Filtered
                  </button>
                </div>
                <div className="max-h-56 overflow-y-auto divide-y divide-slate-50">
                  {testLoading ? (
                    <div className="p-4 text-center text-xs text-slate-400">Loading files…</div>
                  ) : filteredFiles.length === 0 ? (
                    <div className="p-4 text-center text-xs text-slate-400">{testFiles.length === 0 ? "No files found on this stage" : "No files match filters"}</div>
                  ) : filteredFiles.map(f => {
                    const isPinned = pinnedFiles.some(p => p.name === f.name && p.stage === testStage)
                    return (
                    <div key={f.name} className="flex items-center gap-2 px-3 py-2 hover:bg-slate-50 text-xs group">
                      <button onClick={() => isPinned ? setPinnedFiles(prev => prev.filter(p => !(p.name === f.name && p.stage === testStage))) : pinFile(f.name)}
                        className={`p-0.5 rounded transition-colors ${isPinned ? "text-blue-600 bg-blue-100" : "text-slate-300 hover:text-blue-600 hover:bg-blue-50"}`}
                        title={isPinned ? "Unpin from test list" : "Pin to test list"}>
                        <Pin size={12} />
                      </button>
                      <span className="flex-1 font-mono text-[11px] text-slate-700 truncate">{f.name.split("/").pop()}</span>
                      <span className="text-[10px] text-slate-400">{(f.size / 1024).toFixed(0)} KB</span>
                    </div>
                  )})}
                </div>
              </div>
            )}
          </div>

          {/* Results */}
          {testResults && testResults.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-slate-700">{testResults.length} file{testResults.length !== 1 ? "s" : ""} processed</span>
                <span className="text-[10px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">Test mode — not saved</span>
              </div>

              {testResults.map((result, idx) => {
                const fp = String(result.filePath ?? result.file_path ?? `file-${idx}`)
                const fn = fp.split("/").pop() ?? fp
                const extraction = result.extraction as Record<string, unknown> | null
                const fieldTiers = (result.field_tiers ?? {}) as Record<string, { tier: string; group: string }>
                const error = String(result.error ?? "")
                return (
                  <details key={idx} open={testResults.length === 1} className="sf-card overflow-hidden">
                    <summary className="px-4 py-3 cursor-pointer hover:bg-slate-50 flex items-center gap-3">
                      <span className="text-xs font-mono font-medium text-slate-800 flex-1 truncate">{fn}</span>
                      {error ? (
                        <span className="text-[10px] bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-medium">{error}</span>
                      ) : (
                        <>
                          <span className="text-[10px] bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">{String(result.primary_label ?? "—")}</span>
                          <span className="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">{String(result.resolved_lob ?? "—")}</span>
                          <span className="text-[10px] text-slate-400">{String(result.schema_field_count ?? 0)} fields</span>
                        </>
                      )}
                    </summary>
                    {!error && (() => {
                      // AI_EXTRACT may return {error, response: {...fields}} — unwrap the response
                      let displayFields: Record<string, unknown> = {}
                      if (extraction) {
                        if ("response" in extraction && typeof extraction.response === "object" && extraction.response !== null) {
                          displayFields = extraction.response as Record<string, unknown>
                        } else if ("response" in extraction && typeof extraction.response === "string") {
                          try { displayFields = JSON.parse(extraction.response) } catch { displayFields = extraction }
                        } else {
                          displayFields = extraction
                        }
                      }
                      return (
                      <div className="border-t border-slate-100">
                        <div className="px-4 py-2 bg-slate-50 text-xs flex gap-4">
                          <span><strong>Category:</strong> {String(result.resolved_category ?? "—")}</span>
                          <span><strong>LOB:</strong> {String(result.resolved_lob ?? "—")}</span>
                          <span><strong>Fields:</strong> {Object.keys(displayFields).length}</span>
                        </div>
                        {Object.keys(displayFields).length > 0 ? (
                          <table className="w-full text-xs">
                            <thead className="bg-slate-50/50 border-b border-slate-100">
                              <tr>
                                <th className="w-6 px-2 py-2"></th>
                                <th className="text-left px-3 py-2 text-slate-500 font-semibold">Field</th>
                                <th className="text-left px-3 py-2 text-slate-500 font-semibold">Value</th>
                                <th className="text-left px-3 py-2 text-slate-500 font-semibold">Tier</th>
                              </tr>
                            </thead>
                            <tbody>
                              {Object.entries(displayFields)
                                .sort(([aKey, aVal], [bKey, bVal]) => {
                                  const aEmpty = aVal == null || aVal === "None" || aVal === ""
                                  const bEmpty = bVal == null || bVal === "None" || bVal === ""
                                  if (aEmpty !== bEmpty) return aEmpty ? 1 : -1
                                  return aKey.localeCompare(bKey)
                                })
                                .map(([key, value]) => {
                                const ti = fieldTiers[key]
                                const badge = TIER_META[ti?.tier ?? "COMMON"] ?? TIER_META.COMMON
                                const isEmpty = value == null || value === "None" || value === ""
                                return (
                                  <tr key={key} className="border-b border-slate-50">
                                    <td className="px-2 py-2 text-center">
                                      {isEmpty
                                        ? <XCircle className="w-3.5 h-3.5 text-red-300 inline-block" />
                                        : <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 inline-block" />}
                                    </td>
                                    <td className="px-3 py-2 font-mono text-slate-800 font-medium">{key}</td>
                                    <td className="px-3 py-2 text-slate-600">
                                      {isEmpty ? <span className="text-slate-300 italic text-[10px]">not found</span> : typeof value === "object" ? JSON.stringify(value) : String(value)}
                                    </td>
                                    <td className="px-3 py-2"><span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${badge.color}`}>{badge.label}{ti?.group ? ` · ${ti.group}` : ""}</span></td>
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>
                        ) : <div className="p-4 text-center text-slate-400 text-xs">No extraction results</div>}
                      </div>
                    )})()}
                  </details>
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  )
}
