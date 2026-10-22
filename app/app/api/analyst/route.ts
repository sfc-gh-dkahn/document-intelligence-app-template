/**
 * POST /api/analyst
 *
 * Calls Snowflake Cortex Analyst REST API against the document_analytics_sv
 * semantic view. Returns NL-to-SQL results: the generated SQL, a prose answer,
 * and any chart suggestions from the Analyst.
 *
 * This endpoint powers the "Ask an Analytics Question" panel on the Analytics
 * page — proper structured SQL generation for portfolio questions like
 * "How many documents were processed by month?" rather than CORTEX.COMPLETE prose.
 */
import { headers } from "next/headers"
import { getSnowflakeBaseUrl, getServiceToken, getRestApiAuthHeader } from "@/lib/snowflake"
import { DB } from "@/lib/db"
import { NextRequest } from "next/server"
import { requireUser, serverError } from "@/lib/api-utils"

export const dynamic = "force-dynamic"

// Fully-qualified semantic view name (uppercase, unquoted per REST API spec)
const SEMANTIC_VIEW = `${DB}.SERVICES.DOCUMENT_ANALYTICS_SV`

interface AnalystMessage {
  role: "user" | "analyst"
  content: { type: "text"; text: string }[]
}

export async function POST(req: NextRequest) {
  const denied = await requireUser()
  if (denied) return denied

  try {
    const { question, history = [] } = await req.json() as {
      question: string
      history?: { role: "user" | "analyst"; content: string }[]
    }
    if (!question?.trim()) {
      return Response.json({ error: "question is required" }, { status: 400 })
    }
    if (question.length > 1000) {
      return Response.json({ error: "question too long (max 1000 characters)" }, { status: 400 })
    }

    const baseUrl = getSnowflakeBaseUrl()
    if (!baseUrl) {
      return Response.json({ error: "Snowflake base URL not configured" }, { status: 503 })
    }

    // Build message history in Cortex Analyst message format
    const messages: AnalystMessage[] = [
      // Prepend context message so the analyst knows the domain
      {
        role: "user",
        content: [{ type: "text", text: `I am analyzing a document portfolio managed by Document Intelligence. Documents are classified by AI into configurable document types and lines of business.` }],
      },
      {
        role: "analyst",
        content: [{ type: "text", text: "Understood. I can answer analytics questions about your document portfolio using the document_catalog data." }],
      },
    ]

    // Add prior turns from conversation history
    for (const h of history.slice(-4)) {
      messages.push({
        role: h.role,
        content: [{ type: "text", text: h.content }],
      })
    }

    // Add the current question — pass raw text; JSON.stringify handles encoding
    messages.push({
      role: "user",
      content: [{ type: "text", text: question }],
    })

    // Build auth header — use combined service+caller token for caller's rights
    const serviceToken = getServiceToken()
    let authHeader: string
    if (serviceToken) {
      // SPCS: combine service token with caller's identity token
      const callerToken = (await headers()).get("sf-context-current-user-token") ?? ""
      authHeader = callerToken
        ? `Bearer ${serviceToken}.${callerToken}`
        : `Bearer ${serviceToken}`
    } else {
      // No SPCS token — use TOML OAuth token file if available (local dev with PAT).
      // Cortex Analyst requires a valid OAuth token; falls back to getRestApiAuthHeader()
      // which reads the token_file_path from ~/.snowflake/connections.toml when present.
      authHeader = getRestApiAuthHeader()
    }

    const analystUrl = `${baseUrl}/api/v2/cortex/analyst/message`
    const body = JSON.stringify({
      messages,
      semantic_view: SEMANTIC_VIEW,
    })

    const analystRes = await fetch(analystUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": authHeader,
        "X-Snowflake-Authorization-Token-Type": "OAUTH",
        "Accept": "application/json",
      },
      body,
      signal: AbortSignal.timeout(45000),  // Analyst can be slower than Agent (also runs SQL)
    })

    if (!analystRes.ok) {
      const errText = await analystRes.text().catch(() => "")
      console.error(new Date().toISOString(), "[analyst] REST error", analystRes.status, errText.slice(0, 200))
      return Response.json(
        { error: `Cortex Analyst returned ${analystRes.status}`, detail: errText.slice(0, 200) },
        { status: analystRes.status }
      )
    }

    const data = await analystRes.json() as {
      message?: {
        role: string
        content: { type: string; statement?: string; text?: string }[]
      }
      request_id?: string
      warnings?: { type: string; message: string }[]
    }

    const content = data.message?.content ?? []

    // Extract SQL statement and prose text from the response
    const sql = content.find(c => c.type === "sql")?.statement ?? null
    const textContent = content
      .filter(c => c.type === "text")
      .map(c => c.text ?? "")
      .join("\n")
      .trim()

    // If Analyst generated SQL, run it to get actual data
    let results: Record<string, unknown>[] = []
    if (sql) {
      try {
        const { querySnowflake } = await import("@/lib/snowflake")
        results = await querySnowflake(sql, { callersRights: true })
      } catch (e) {
        console.error(new Date().toISOString(), "[analyst] SQL execution error", e instanceof Error ? e.message.slice(0, 200) : String(e))
        // Return the SQL even if execution fails — user can inspect it
      }
    }

    return Response.json({
      answer: textContent || (sql ? `Generated SQL query (${results.length} rows)` : "No answer generated"),
      sql,
      results: results.slice(0, 100),   // cap at 100 rows for the response
      requestId: data.request_id ?? null,
      warnings: data.warnings ?? [],
    })
  } catch (e) {
    console.error(new Date().toISOString(), "[analyst] error", e instanceof Error ? e.message.slice(0, 200) : String(e))
    return serverError(e)
  }
}
