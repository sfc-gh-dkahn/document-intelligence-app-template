import { querySnowflake } from "@/lib/snowflake"
import { DB } from "@/lib/db"
import { NextRequest } from "next/server"
import { escSql, escLike, clampInt, requireAdmin, serverError } from "@/lib/api-utils"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    const sp = req.nextUrl.searchParams
    const days = Math.min(parseInt(sp.get("days") ?? "30") || 30, 90)
    const eventType = sp.get("eventType") ?? ""
    const user = sp.get("user") ?? ""
    const limit = clampInt(sp.get("limit") ?? "200", 1, 500)
    const offset = clampInt(sp.get("offset") ?? "0", 0, 100000)

    let where = `WHERE event_time >= DATEADD('DAY', -${days}, CURRENT_TIMESTAMP())`
    if (eventType) where += ` AND event_type = '${escSql(eventType)}'`
    if (user) where += ` AND user_name ILIKE '%${escLike(user)}%'`

    const [events, summary, countRows] = await Promise.all([
      querySnowflake(`
        SELECT event_id, event_type, event_time, user_name AS event_user,
               file_path, stage_name AS stage
        FROM ${DB}.TELEMETRY.pipeline_events
        ${where}
        ORDER BY event_time DESC
        LIMIT ${limit} OFFSET ${offset}
      `, { callersRights: true }),
      querySnowflake(`
        SELECT event_type, COUNT(*) AS event_count,
               COUNT(DISTINCT user_name) AS unique_users
        FROM ${DB}.TELEMETRY.pipeline_events
        ${where}
        GROUP BY event_type
        ORDER BY event_count DESC
      `, { callersRights: true }),
      querySnowflake(`
        SELECT COUNT(*) AS total FROM ${DB}.TELEMETRY.pipeline_events ${where}
      `, { callersRights: true }),
    ])
    const total = Number((countRows[0] as Record<string, unknown>)?.TOTAL ?? (countRows[0] as Record<string, unknown>)?.total ?? 0)
    return Response.json({ events, summary, total, limit, offset })
  } catch (e) {
    return serverError(e)
  }
}
