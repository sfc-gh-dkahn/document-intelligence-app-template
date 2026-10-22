"use client"

import { useState } from "react"
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, CartesianGrid, Cell } from "recharts"
import { BarChart2, Table2 } from "lucide-react"
import { docDetailUrl, filenameFromPath } from "@/lib/doc-utils"

const COLORS = ["#29B5E8", "#11567F", "#6ED6F5", "#0C3E59", "#86E0FA", "#1A8DB5", "#4CC4ED", "#073A4F"]

interface ResultChartProps {
  columns: string[]
  rows: (string | number | null)[][]
  title?: string
}

type ChartType = "bar" | "line" | "none"

function detectChartType(columns: string[], rows: (string | number | null)[][]): ChartType {
  if (columns.length < 2 || rows.length < 2 || rows.length > 50) return "none"

  const firstColValues = rows.map(r => r[0])
  const secondColValues = rows.map(r => r[1])

  const firstAllStrings = firstColValues.every(v => typeof v === "string")
  const secondAllNumeric = secondColValues.every(v => typeof v === "number" || (typeof v === "string" && !isNaN(Number(v))))

  if (!secondAllNumeric) return "none"

  if (firstAllStrings) {
    const datePattern = /^\d{4}-\d{2}/
    const allDates = firstColValues.every(v => typeof v === "string" && datePattern.test(v))
    return allDates ? "line" : "bar"
  }

  return "bar"
}

const LINKABLE_COLS = new Set(["FILE_PATH", "file_path", "SRC_FILE_ID", "src_file_id", "SRC_REFERENCE_NUMBER", "src_reference_number", "SRC_CASE_NUMBER", "src_case_number"])
const PATH_COLS = new Set(["FILE_PATH", "file_path"])

function renderCell(colName: string, cell: string | number | null) {
  if (cell == null) return "\u2014"
  const v = String(cell)
  if (LINKABLE_COLS.has(colName) && v) {
    if (PATH_COLS.has(colName)) {
      return <a href={docDetailUrl(v)} className="text-blue-600 hover:text-blue-800 underline">{filenameFromPath(v)}</a>
    }
    return <a href={`/search?q=${encodeURIComponent(v)}`} className="text-blue-600 hover:text-blue-800 underline">{v}</a>
  }
  return v
}

export function ResultChart({ columns, rows, title }: ResultChartProps) {
  const chartType = detectChartType(columns, rows)
  const [view, setView] = useState<"chart" | "table">(chartType !== "none" ? "chart" : "table")

  const data = rows.map(row => {
    const obj: Record<string, string | number | null> = {}
    columns.forEach((col, i) => {
      obj[col] = typeof row[i] === "string" && !isNaN(Number(row[i])) && row[i] !== ""
        ? Number(row[i])
        : row[i]
    })
    return obj
  })

  const categoryKey = columns[0]
  const valueKey = columns[1]

  return (
    <div className="mt-3 border border-slate-200 rounded-lg bg-white overflow-hidden">
      {title && (
        <div className="px-3 pt-3 pb-1 font-semibold text-sm text-slate-700">{title}</div>
      )}
      {chartType !== "none" && (
        <div className="flex items-center gap-1 px-3 pt-2">
          <button
            onClick={() => setView("chart")}
            className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium transition-colors ${
              view === "chart" ? "bg-[#29B5E8] text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            <BarChart2 size={12} /> Chart
          </button>
          <button
            onClick={() => setView("table")}
            className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium transition-colors ${
              view === "table" ? "bg-[#29B5E8] text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            <Table2 size={12} /> Table
          </button>
        </div>
      )}

      {view === "chart" && chartType === "bar" && (
        <div className="p-3" style={{ height: Math.max(200, rows.length * 32 + 40) }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} layout="vertical" margin={{ left: 10, right: 20, top: 5, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis type="number" tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey={categoryKey} tick={{ fontSize: 11 }} width={120} />
              <Tooltip contentStyle={{ fontSize: 12 }} />
              <Bar dataKey={valueKey} radius={[0, 4, 4, 0]}>
                {data.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {view === "chart" && chartType === "line" && (
        <div className="p-3" style={{ height: 260 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ left: 10, right: 20, top: 5, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey={categoryKey} tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip contentStyle={{ fontSize: 12 }} />
              <Line type="monotone" dataKey={valueKey} stroke="#29B5E8" strokeWidth={2} dot={{ fill: "#11567F", r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {view === "table" && (
        <div className="overflow-x-auto p-3">
          <table className="border-collapse border border-slate-200 text-xs w-full">
            <thead>
              <tr>
                {columns.map(col => (
                  <th key={col} className="border border-slate-200 px-2.5 py-1.5 bg-slate-50 font-semibold text-left text-slate-700">
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} className={i % 2 === 0 ? "" : "bg-slate-25"}>
                  {row.map((cell, j) => (
                    <td key={j} className="border border-slate-200 px-2.5 py-1.5 text-slate-600">
                      {renderCell(columns[j], cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
