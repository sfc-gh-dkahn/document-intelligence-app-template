"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import {
  BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, Tooltip,
  ResponsiveContainer, Legend
} from "recharts"
import { BarChart2, RefreshCw, Send, Bot } from "lucide-react"
import { showToast } from "@/components/toast"
import { Spinner } from "@/components/spinner"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { ResultChart } from "@/app/chat/_components/result-chart"
import { docRefMdComponents } from "@/lib/linkify-docs"

interface ChartData { name: string; value: number }
interface AnalyticsData {
  byType: ChartData[]; byLob: ChartData[]; byStatus: ChartData[]
  total?: number; lobs?: number
}
interface AgentMessage {
  content: string
  toolUsed?: string
  isError?: boolean
  resultSet?: { columns: string[]; rows: (string | number | null)[][]; title?: string }
}

const COLORS = ["#29B5E8","#11567F","#1A3A5C","#3B82F6","#0EA5E9","#2563EB","#7C3AED","#6D28D9"]

// Hash-based color assignment so any status value gets a consistent color
function statusColor(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0
  return COLORS[Math.abs(hash) % COLORS.length]
}

export function OverviewAnalytics() {
  const router = useRouter()
  const [data, setData] = useState<AnalyticsData | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [nlQuery, setNlQuery] = useState("")
  const [nlResponse, setNlResponse] = useState<AgentMessage | null>(null)
  const [nlLoading, setNlLoading] = useState(false)

  async function loadData() {
    setLoading(true)
    setLoadError(null)
    try {
      const res = await fetch("/api/analytics")
      const d = await res.json()
      if (!res.ok ||
          !Array.isArray(d?.byType) ||
          !Array.isArray(d?.byLob) ||
          !Array.isArray(d?.byStatus)) {
        setLoadError(d?.error ?? "Analytics failed to load")
      } else {
        setData(d as AnalyticsData)
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Network error")
    } finally {
      setLoading(false)
    }
  }

  async function runNlQuery() {
    if (!nlQuery.trim()) return
    setNlLoading(true)
    setNlResponse({ content: "" })
    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: nlQuery, history: [] }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        showToast(d.error ?? "Agent query failed", "error")
        setNlResponse({ content: d.error ?? "Request failed", isError: true })
        setNlLoading(false)
        return
      }

      if (!res.body) {
        setNlResponse({ content: "No response stream", isError: true })
        setNlLoading(false)
        return
      }

      setNlLoading(false) // streaming now

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""
      let content = ""
      let toolUsed: string | undefined
      let resultSet: AgentMessage["resultSet"] | undefined

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split("\n")
        buffer = lines.pop() ?? ""

        for (const line of lines) {
          if (!line.startsWith("data:")) continue
          const payload = line.slice(5).trim()
          if (payload === "[DONE]") continue
          try {
            const event = JSON.parse(payload)
            if (event.error) {
              setNlResponse({ content: "Agent unavailable — please try again.", isError: true })
              return
            }
            if (event.done) {
              toolUsed = event.toolUsed
              setNlResponse({ content, toolUsed, resultSet })
            } else if (event.delta) {
              const currentIsStatus = content.startsWith("_") && content.endsWith("_")
              if (currentIsStatus) content = ""
              content += event.delta
              toolUsed = event.toolUsed
              setNlResponse({ content, toolUsed, resultSet })
            } else if (event.resultSet) {
              resultSet = event.resultSet
              setNlResponse({ content, toolUsed, resultSet })
            } else if (event.status) {
              if (!content || (content.startsWith("_") && content.endsWith("_"))) {
                content = `_${event.status}_`
                toolUsed = event.toolUsed
                setNlResponse({ content, toolUsed, resultSet })
              }
            }
          } catch { /* skip parse errors */ }
        }
      }

      if (!content) {
        setNlResponse({ content: "No response from agent", isError: true })
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error"
      showToast(`Query failed: ${msg}`, "error")
      setNlResponse({ content: `Error: ${msg}`, isError: true })
      setNlLoading(false)
    }
  }

  useEffect(() => { loadData() }, [])

  const isStatus = nlResponse?.content.startsWith("_") && nlResponse?.content.endsWith("_") && !nlResponse?.content.slice(1, -1).includes("_")

  return (
    <div className="space-y-5">
      {/* Section header */}
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-slate-700 flex items-center gap-2">
          <BarChart2 size={18} style={{ color: "var(--brand-primary)" }} /> Portfolio Analytics
        </h2>
        <button className="sf-btn-secondary flex items-center gap-1.5 text-xs" onClick={loadData} disabled={loading}>
          {loading ? <Spinner size={12} /> : <RefreshCw size={12} />} Refresh
        </button>
      </div>

      {/* NL Query — same rendering as Doc Intelligence chat */}
      <div className="sf-card p-4">
        <div className="flex items-center gap-2 mb-1">
          <Bot size={15} className="text-[var(--brand-primary)]" />
          <h3 className="font-semibold text-slate-700 text-sm">Ask a Question</h3>
        </div>
        <p className="text-[10px] text-slate-400 mb-3 ml-[23px]">Powered by the Doc Intelligence Agent — ask about your portfolio</p>
        <div className="flex gap-2">
          <input
            className="flex-1 text-sm px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]"
            placeholder="e.g. How many documents were processed by month this year?"
            value={nlQuery}
            maxLength={2000}
            onChange={e => setNlQuery(e.target.value)}
            onKeyDown={e => e.key === "Enter" && !nlLoading && runNlQuery()}
            disabled={nlLoading}
          />
          <button className="sf-btn-primary flex items-center gap-1.5" onClick={runNlQuery} disabled={nlLoading || !nlQuery.trim()}>
            <Send size={13} /> {nlLoading ? "…" : "Ask"}
          </button>
        </div>
        {nlResponse && (
          <div className="mt-3">
            {nlResponse.toolUsed && (
              <div className="flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[var(--brand-light)] text-[var(--brand-dark)] w-fit mb-2">
                <BarChart2 size={10} /> via {nlResponse.toolUsed}
              </div>
            )}
            <div className={`px-4 py-3 rounded-2xl text-sm leading-relaxed ${
              nlResponse.isError
                ? "bg-red-50 border border-red-200 text-red-700 italic"
                : "bg-white border border-slate-200 text-slate-800 prose prose-sm prose-slate max-w-none"
            }`}>
              {nlResponse.isError ? (
                nlResponse.content
              ) : isStatus ? (
                <div className="flex items-center gap-2 text-slate-500 italic">
                  <svg className="animate-spin h-3.5 w-3.5 text-[var(--brand-primary)]" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  <span className="animate-pulse">{nlResponse.content.slice(1, -1)}</span>
                </div>
              ) : (
                <>
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={docRefMdComponents}>{nlResponse.content}</ReactMarkdown>
                  {nlResponse.resultSet && (
                    <ResultChart columns={nlResponse.resultSet.columns} rows={nlResponse.resultSet.rows} title={nlResponse.resultSet.title} />
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Charts */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="sf-card p-5 animate-pulse">
              <div className="h-4 bg-slate-200 rounded w-32 mb-4" />
              <div className="h-40 bg-slate-100 rounded" />
            </div>
          ))}
        </div>
      ) : loadError ? (
        <div className="sf-card p-8 text-center">
          <p className="text-slate-600 font-medium mb-1">Failed to load analytics</p>
          <p className="text-xs text-slate-400 mb-4 font-mono">{loadError}</p>
          <button className="sf-btn-primary text-sm" onClick={loadData}>Retry</button>
        </div>
      ) : data ? (
        <>
        <div className="grid grid-cols-3 gap-4">
          <div className="sf-card px-4 py-3">
            <p className="text-xs text-slate-400">Total Documents</p>
            <p className="text-2xl font-bold text-slate-800">{(data.total ?? 0).toLocaleString()}</p>
          </div>
          <div className="sf-card px-4 py-3">
            <p className="text-xs text-slate-400">Lines of Business</p>
            <p className="text-2xl font-bold text-slate-800">{data.lobs ?? 0}</p>
          </div>
          <div className="sf-card px-4 py-3">
            <p className="text-xs text-slate-400">Document Types</p>
            <p className="text-2xl font-bold text-slate-800">{data.byType.length}</p>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div className="sf-card p-5">
            <h3 className="font-semibold text-slate-700 mb-4 text-sm">Documents by Type</h3>
            {data.byType.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={data.byType.slice(0, 10)} layout="vertical" margin={{ left: 10 }}
                onClick={(e) => { if (e?.activeLabel) router.push(`/documents?docType=${encodeURIComponent(e.activeLabel)}`) }}
                style={{ cursor: "pointer" }}>
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={160} />
                <Tooltip />
                <Bar dataKey="value" fill="#29B5E8" radius={[0,4,4,0]} />
              </BarChart>
            </ResponsiveContainer>
            ) : <p className="text-sm text-slate-400 py-10 text-center">No document type data available</p>}
          </div>

          <div className="sf-card p-5">
            <h3 className="font-semibold text-slate-700 mb-4 text-sm">Line of Business</h3>
            {data.byLob.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie data={data.byLob} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={60} outerRadius={100}
                  onClick={(_, idx) => { const name = data.byLob[idx]?.name; if (name) router.push(`/documents?lob=${encodeURIComponent(name)}`) }}
                  style={{ cursor: "pointer" }}>
                  {data.byLob.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip />
                <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
            ) : <p className="text-sm text-slate-400 py-10 text-center">No line of business data available</p>}
          </div>

          <div className="sf-card p-5">
            <h3 className="font-semibold text-slate-700 mb-4 text-sm">Documents by Line of Business</h3>
            {data.byLob.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={data.byLob} margin={{ bottom: 5 }}
                onClick={(e) => { if (e?.activeLabel) router.push(`/documents?lob=${encodeURIComponent(e.activeLabel)}`) }}
                style={{ cursor: "pointer" }}>
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="value" radius={[4,4,0,0]}>
                  {data.byLob.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            ) : <p className="text-sm text-slate-400 py-10 text-center">No data available</p>}
          </div>

          <div className="sf-card p-5">
            <h3 className="font-semibold text-slate-700 mb-4 text-sm">Document Status</h3>
            {data.byStatus.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={data.byStatus} margin={{ bottom: 5 }}
                onClick={(e) => { if (e?.activeLabel) router.push(`/documents?status=${encodeURIComponent(e.activeLabel)}`) }}
                style={{ cursor: "pointer" }}>
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="value" radius={[4,4,0,0]}>
                  {data.byStatus.map((d) => (
                    <Cell key={d.name} fill={statusColor(d.name)} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            ) : <p className="text-sm text-slate-400 py-10 text-center">No status data available</p>}
          </div>
        </div>
        </>
      ) : null}
    </div>
  )
}
