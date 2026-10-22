"use client"

import { useState, useEffect } from "react"
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, Cell, ResponsiveContainer } from "recharts"
import { DollarSign, RefreshCw, TrendingUp, Calendar } from "lucide-react"
import { PageHeader } from "@/components/page-header"
import { showToast } from "@/components/toast"
import { StatCard, StatGrid } from "@/components/stat-card"

interface ChartRow { name: string; value: number }
interface HistoryRow { date: string; credits: number }
interface CostData {
  byFolder: ChartRow[]; byStage: ChartRow[]; history: HistoryRow[]
  total30d: number; avgDaily: number; projectedMonthly: number
}

const COLORS = ["#29B5E8","#11567F","#1A3A5C","#3B82F6","#0EA5E9","#2563EB","#7C3AED"]


export default function AdminCostPage() {
  const [data, setData]     = useState<CostData | null>(null)
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    try {
      const res = await fetch("/api/cost")
      const d = await res.json()
      if (!res.ok || !Array.isArray(d?.byFolder) || !Array.isArray(d?.byStage)) {
        showToast(d?.error ?? "Failed to load cost data", "error")
      } else {
        setData(d as CostData)
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Network error", "error")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      <PageHeader title="Credit Cost Dashboard" icon={DollarSign}>
        <button className="sf-btn-secondary flex items-center gap-1.5" onClick={load} disabled={loading}>
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} /> Refresh
        </button>
      </PageHeader>

      <p className="text-sm text-slate-500">
        These figures count each pipeline event as 0.001 credits, so they show activity, not spend.
        For spend, use Snowsight → Admin → Cost Management.
      </p>

      {/* KPIs */}
      <StatGrid cols={3}>
        <StatCard
          label="Total Credits (30 days)"
          value={loading ? "—" : (data?.total30d ?? 0).toFixed(3)}
          sub="Last 30 days"
        />
        <StatCard
          label="Daily Average"
          value={loading ? "—" : (data?.avgDaily ?? 0).toFixed(4)}
          sub="Credits/day"
        />
        <StatCard
          label="Projected Monthly"
          value={loading ? "—" : (data?.projectedMonthly ?? 0).toFixed(2)}
          sub="Daily average × 30"
        />
      </StatGrid>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 animate-pulse">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="sf-card p-5">
              <div className="h-4 bg-slate-200 rounded w-40 mb-4" />
              <div className="h-36 bg-slate-100 rounded" />
            </div>
          ))}
        </div>
      ) : !data ? (
        <div className="sf-card p-8 text-center text-slate-400">No cost data available</div>
      ) : (
        <>
          {/* History chart */}
          {data.history.length > 0 && (
            <div className="sf-card p-5">
              <h2 className="font-semibold text-slate-700 mb-4 text-sm">Daily Credit Usage (1 year)</h2>
              <ResponsiveContainer width="100%" height={180}>
                <LineChart data={data.history}>
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v: unknown) => [(Number(v)).toFixed(4), "Credits"]} />
                  <Line type="monotone" dataKey="credits" stroke="#29B5E8" strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {/* By Folder */}
            <div className="sf-card p-5">
              <h2 className="font-semibold text-slate-700 mb-4 text-sm">Credits by Stage (1 year)</h2>
              {data.byFolder.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-8">No stage cost data yet</p>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={data.byFolder} layout="vertical">
                    <XAxis type="number" tick={{ fontSize: 11 }} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={110} />
                    <Tooltip formatter={(v: unknown) => [(Number(v)).toFixed(4), "Credits"]} />
                    <Bar dataKey="value" radius={[0,4,4,0]}>
                      {data.byFolder.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* By Stage */}
            <div className="sf-card p-5">
              <h2 className="font-semibold text-slate-700 mb-4 text-sm">Credits by Event Type (1 year)</h2>
              {data.byStage.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-8">No stage cost data yet</p>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={data.byStage}>
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(v: unknown) => [(Number(v)).toFixed(4), "Credits"]} />
                    <Bar dataKey="value" radius={[4,4,0,0]}>
                      {data.byStage.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        </>
      )}


    </div>
  )
}
