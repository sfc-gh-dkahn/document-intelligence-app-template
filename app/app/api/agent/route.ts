/**
 * POST /api/agent
 *
 * Calls the Snowflake Cortex Agent via REST API with real-time SSE streaming.
 * Uses the agent object endpoint with the sf-context-current-user-token header
 * so the agent runs as the signed-in user.
 *
 * Note: the agent is not filtered by app roles. Its search tool reads an index
 * built from the whole catalog, and its analytics tool reads the semantic view
 * over DATA.document_catalog, which has no row access policy.
 */
import { getServiceToken } from "@/lib/snowflake"
import { DB, AGENT_NAME, SERVICES_SCHEMA } from "@/lib/db"
import { NextRequest } from "next/server"
import { requireUser, serverError } from "@/lib/api-utils"

export const dynamic = "force-dynamic"

interface AgentMessage {
  role: "user" | "assistant"
  content: { type: "text"; text: string }[]
}

export async function POST(req: NextRequest) {
  const denied = await requireUser()
  if (denied) return denied

  try {
    const { question, history = [] } = await req.json() as {
      question: string
      history?: { role: string; content: string }[]
    }
    if (!question?.trim()) {
      return Response.json({ error: "No question provided" }, { status: 400 })
    }
    if (question.length > 2000) {
      return Response.json({ error: "question too long (max 2000 characters)" }, { status: 400 })
    }

    // Build messages array for the agent
    const messages: AgentMessage[] = []
    for (const h of history.slice(-6)) {
      const role = h.role === "assistant" ? "assistant" : "user"
      messages.push({ role, content: [{ type: "text", text: h.content }] })
    }
    messages.push({ role: "user", content: [{ type: "text", text: question }] })

    // Get tokens for callers-rights auth
    const serviceToken = getServiceToken()
    const callerToken = req.headers.get("sf-context-current-user-token") ?? ""

    if (!serviceToken) {
      return Response.json(
        { error: "No SPCS service token available. Is the app running in Snowflake?" },
        { status: 500 }
      )
    }
    if (!callerToken) {
      return Response.json(
        { error: "No caller token. User authentication required." },
        { status: 401 }
      )
    }

    const host = process.env.SNOWFLAKE_HOST
    if (!host) {
      return Response.json(
        { error: "SNOWFLAKE_HOST not set. App must run in SPCS." },
        { status: 500 }
      )
    }

    const agentUrl = `https://${host}/api/v2/databases/${DB}/schemas/${SERVICES_SCHEMA}/agents/${AGENT_NAME}:run`

    console.log(new Date().toISOString(), "[agent-rest] calling agent, msgCount=", messages.length)

    // Call the Cortex Agent REST API with the service token.
    // The sf-context-current-user-token header passes the caller's identity
    // so the agent's Analyst tool executes SQL in the caller's context (RAP applies).
    const agentResp = await fetch(agentUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${serviceToken}`,
        "X-Snowflake-Authorization-Token-Type": "OAUTH",
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
        "sf-context-current-user-token": callerToken,
      },
      body: JSON.stringify({ messages, stream: true }),
    })

    if (!agentResp.ok) {
      const errBody = await agentResp.text()
      const errMsg = `Agent REST ${agentResp.status}: ${errBody.slice(0, 300)}`
      console.error(new Date().toISOString(), "[agent-rest] error:", errMsg)
      return Response.json(
        { error: errMsg },
        { status: 502 }
      )
    }

    if (!agentResp.body) {
      return Response.json({ error: "Agent returned no response body" }, { status: 502 })
    }

    // Stream SSE events from the agent directly to the client.
    const encoder = new TextEncoder()
    const agentReader = agentResp.body.getReader()
    const decoder = new TextDecoder()
    let toolUsed = "Agent"
    let sentAnyText = false

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let buffer = ""
        let currentEvent = ""
        try {
          while (true) {
            const { done, value } = await agentReader.read()
            if (done) break
            buffer += decoder.decode(value, { stream: true })
            const lines = buffer.split("\n")
            buffer = lines.pop() ?? ""

            for (const line of lines) {
              if (line.startsWith("event:")) {
                currentEvent = line.slice(6).trim()
                continue
              }
              if (!line.startsWith("data:")) continue
              const payload = line.slice(5).trim()
              if (payload === "[DONE]") continue

              try {
                const data = JSON.parse(payload)
                const emit = (obj: Record<string, unknown>) =>
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`))

                if (currentEvent === "error") {
                  const errMsg = data.message ?? JSON.stringify(data)
                  sentAnyText = true
                  emit({ delta: `[Agent error: ${errMsg}]`, toolUsed, done: false })

                } else if (currentEvent === "response.thinking.delta" && data.text) {
                  emit({ type: "activity", activity: { kind: "thinking", text: data.text } })

                } else if (currentEvent === "response.text.delta" && data.text) {
                  sentAnyText = true
                  emit({ delta: data.text, toolUsed, done: false })

                } else if (currentEvent === "response.text.annotation") {
                  const a = data.annotation
                  if (a?.type === "cortex_search_citation") {
                    emit({ type: "citation", citation: { doc_id: a.doc_id, doc_title: a.doc_title, text: a.text } })
                  }

                } else if (currentEvent === "response.tool_use") {
                  const t = data.type ?? ""
                  const n = data.name ?? ""
                  if (t.includes("analyst") || t.includes("sql") || n.includes("analyst") || n.includes("sql")) {
                    toolUsed = "Analytics"
                  } else if (t.includes("search") || n.includes("search")) {
                    toolUsed = "Search"
                  }
                  emit({ status: `Using ${toolUsed}...`, toolUsed, done: false })
                  const toolInput = data.input ? JSON.stringify(data.input).slice(0, 200) : undefined
                  emit({ type: "activity", activity: { kind: "tool_use", tool: toolUsed, name: n, toolType: t, input: toolInput } })

                } else if (currentEvent === "response.tool_result.status") {
                  const msg = data.message ?? data.status ?? ""
                  if (msg) {
                    emit({ type: "activity", activity: { kind: "tool_status", message: msg, status: data.status } })
                  }

                } else if (currentEvent === "response.tool_result") {
                  if (data.type?.includes("search")) {
                    const resultCount = data.content?.[0]?.json?.results?.length ?? 0
                    emit({ type: "activity", activity: { kind: "search_result", resultCount, name: data.name } })
                  }

                } else if (currentEvent === "response.table" && data.result_set) {
                  const rs = data.result_set
                  const columns = rs.resultSetMetaData?.rowType?.map((r: { name: string }) => r.name) ?? []
                  const rows = rs.data ?? []
                  if (columns.length > 0 && rows.length > 0) {
                    emit({ resultSet: { columns, rows, title: data.title }, toolUsed, done: false })
                  }
                } else if (currentEvent === "response.tool_result.analyst.delta" && data.delta?.result_set) {
                  const rs = data.delta.result_set
                  const columns = rs.resultSetMetaData?.rowType?.map((r: { name: string }) => r.name) ?? []
                  const rows = rs.data ?? []
                  if (columns.length > 0 && rows.length > 0) {
                    emit({ resultSet: { columns, rows }, toolUsed, done: false })
                  }
                } else if (currentEvent === "response.status") {
                  const msg = data.message ?? ""
                  if (msg) {
                    emit({ status: msg, toolUsed, done: false })
                    emit({ type: "activity", activity: { kind: "status", message: msg, status: data.status } })
                  }
                } else if (currentEvent === "response" && data.content) {
                  if (!sentAnyText) {
                    const parts = data.content
                      .filter((c: { type: string }) => c.type === "text")
                      .map((c: { text?: string }) => c.text ?? "")
                    const fullText = parts.join("\n").trim()
                    if (fullText) {
                      sentAnyText = true
                      emit({ delta: fullText, toolUsed, done: false })
                    }
                  }
                  // Extract citations from final response if we didn't get annotation events
                  for (const item of data.content) {
                    if (item.type === "text" && item.annotations?.length) {
                      for (const a of item.annotations) {
                        if (a.type === "cortex_search_citation") {
                          emit({ type: "citation", citation: { doc_id: a.doc_id, doc_title: a.doc_title, text: a.text } })
                        }
                      }
                    }
                    if (item.type === "table" && item.table?.result_set) {
                      const rs = item.table.result_set
                      const columns = rs.resultSetMetaData?.rowType?.map((r: { name: string }) => r.name) ?? []
                      const rows = rs.data ?? []
                      if (columns.length > 0 && rows.length > 0) {
                        emit({ resultSet: { columns, rows, title: item.table.title }, toolUsed, done: false })
                      }
                    }
                  }
                }
              } catch (parseErr) { console.warn("[agent-sse] failed to parse event:", currentEvent, parseErr) }

              currentEvent = ""
            }
          }

          if (!sentAnyText) {
            controller.enqueue(encoder.encode(
              `data: ${JSON.stringify({ delta: "[Agent returned no text. Check /api/agent/debug]", toolUsed, done: false })}\n\n`
            ))
          }

          controller.enqueue(encoder.encode(
            `data: ${JSON.stringify({ delta: "", toolUsed, done: true })}\n\n`
          ))
          controller.close()
        } catch (e) {
          const errMsg = e instanceof Error ? e.message : String(e)
          console.error(new Date().toISOString(), "[agent-rest] stream error:", errMsg)
          controller.enqueue(encoder.encode(
            `data: ${JSON.stringify({ delta: `\n\n[Stream error: ${errMsg}]`, toolUsed, done: true })}\n\n`
          ))
          controller.close()
        }
      },
    })

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
      },
    })
  } catch (e) {
    console.error(new Date().toISOString(), "[agent] error", e instanceof Error ? e.message.slice(0, 200) : String(e))
    return serverError(e)
  }
}
