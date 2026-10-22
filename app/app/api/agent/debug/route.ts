/**
 * GET /api/agent/debug
 *
 * Diagnostic endpoint to verify SPCS environment, token availability,
 * and agent REST API connectivity. Does NOT expose token values.
 */
import { getServiceToken } from "@/lib/snowflake"
import { DB, AGENT_NAME, SERVICES_SCHEMA } from "@/lib/db"
import { NextRequest } from "next/server"
import { requireUser } from "@/lib/api-utils"
import * as fs from "fs"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const denied = await requireUser()
  if (denied) return denied

  const host = process.env.SNOWFLAKE_HOST ?? ""
  const account = process.env.SNOWFLAKE_ACCOUNT ?? ""
  const database = process.env.SNOWFLAKE_DATABASE ?? ""
  const schema = process.env.SNOWFLAKE_SCHEMA ?? ""

  const serviceToken = getServiceToken()
  const callerToken = req.headers.get("sf-context-current-user-token") ?? ""

  const agentUrl = host
    ? `https://${host}/api/v2/databases/${DB}/schemas/${SERVICES_SCHEMA}/agents/${AGENT_NAME}:run`
    : "(SNOWFLAKE_HOST not set)"

  // Attempt a connectivity check to the agent URL
  let connectivityStatus = "not tested"
  let connectivityDetail = ""
  if (host && serviceToken && callerToken) {
    try {
      const combinedToken = `${serviceToken}.${callerToken}`
      const resp = await fetch(agentUrl, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${combinedToken}`,
          "X-Snowflake-Authorization-Token-Type": "OAUTH",
          "Content-Type": "application/json",
          "Accept": "text/event-stream",
        },
        body: JSON.stringify({
          messages: [{ role: "user", content: [{ type: "text", text: "Say hello in one sentence." }] }],
          stream: true,
        }),
      })
      connectivityStatus = `${resp.status} ${resp.statusText}`
      if (!resp.ok) {
        const body = await resp.text()
        connectivityDetail = body.slice(0, 500)
      } else if (resp.body) {
        // Read the SSE stream and capture raw event lines for debugging
        const reader = resp.body.getReader()
        const dec = new TextDecoder()
        let raw = ""
        const rawEvents: string[] = []
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          raw += dec.decode(value, { stream: true })
          if (raw.length > 5000) break // limit capture size
        }
        // Split into event blocks
        const blocks = raw.split("\n")
        for (const line of blocks.slice(0, 60)) {
          if (line.trim()) rawEvents.push(line)
        }
        connectivityDetail = JSON.stringify(rawEvents)
      } else {
        connectivityDetail = "No response body"
      }
    } catch (e) {
      connectivityStatus = "fetch-error"
      connectivityDetail = e instanceof Error ? e.message : String(e)
    }
  }

  // Check token file
  let tokenFileExists = false
  try {
    tokenFileExists = fs.existsSync("/snowflake/session/token")
  } catch {}

  return Response.json({
    environment: {
      SNOWFLAKE_HOST: host || "(not set)",
      SNOWFLAKE_ACCOUNT: account || "(not set)",
      SNOWFLAKE_DATABASE: database || "(not set)",
      SNOWFLAKE_SCHEMA: schema || "(not set)",
    },
    tokens: {
      tokenFileExists,
      serviceTokenLength: serviceToken.length,
      hasServiceToken: serviceToken.length > 0,
      callerTokenLength: callerToken.length,
      hasCallerToken: callerToken.length > 0,
    },
    agent: {
      name: `${DB}.SERVICES.${AGENT_NAME}`,
      url: agentUrl,
      connectivityStatus,
      connectivityDetail,
    },
  })
}
