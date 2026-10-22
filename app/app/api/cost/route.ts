import { querySnowflake } from "@/lib/snowflake"
import { DB } from "@/lib/db"
import { requireAdmin, serverError } from "@/lib/api-utils"

export const dynamic = "force-dynamic"

export async function GET() {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    const [byFolder, byStage, summary, history] = await Promise.all([
      // Credits by ingestion stage (last year)
      querySnowflake(`
        SELECT
          COALESCE(NULLIF(stage_name, ''), 'Unknown') AS name,
          SUM(COALESCE(credits_used, 0.001)) AS value
        FROM ${DB}.TELEMETRY.pipeline_events
        WHERE event_time >= DATEADD('YEAR', -1, CURRENT_TIMESTAMP())
          AND stage_name IS NOT NULL
        GROUP BY 1 ORDER BY 2 DESC
        LIMIT 20
      `, { callersRights: true }),

      // Credits by event type
      querySnowflake(`
        SELECT
          event_type AS name,
          SUM(COALESCE(credits_used, 0.001)) AS value
        FROM ${DB}.TELEMETRY.pipeline_events
        WHERE event_time >= DATEADD('YEAR', -1, CURRENT_TIMESTAMP())
          AND event_type IS NOT NULL
        GROUP BY 1 ORDER BY 2 DESC
        LIMIT 10
      `, { callersRights: true }).catch(() => [] as Record<string, unknown>[]),

      // 30-day summary KPIs
      querySnowflake(`
        WITH daily AS (
          SELECT
            DATE_TRUNC('DAY', event_time)::DATE AS d,
            SUM(COALESCE(credits_used, 0.001)) AS day_credits
          FROM ${DB}.TELEMETRY.pipeline_events
          WHERE event_time >= DATEADD('DAY', -30, CURRENT_TIMESTAMP())
            AND stage_name IS NOT NULL
          GROUP BY 1
        )
        SELECT
          SUM(day_credits) AS total_30d,
          SUM(day_credits) / 30 AS avg_daily,
          SUM(day_credits) / 30 * 30 AS projected_monthly,
          COUNT(*) AS active_days
        FROM daily
      `, { callersRights: true }),

      // Daily history for chart (last 365 days)
      querySnowflake(`
        SELECT
          TO_CHAR(DATE_TRUNC('DAY', event_time), 'YYYY-MM-DD') AS date,
          SUM(COALESCE(credits_used, 0.001)) AS credits
        FROM ${DB}.TELEMETRY.pipeline_events
        WHERE event_time >= DATEADD('YEAR', -1, CURRENT_TIMESTAMP())
          AND stage_name IS NOT NULL
        GROUP BY 1 ORDER BY 1
      `, { callersRights: true }).catch(() => [] as Record<string, unknown>[]),
    ])

    const norm = (rows: Record<string, unknown>[]) =>
      rows.map(r => ({ name: String(r.NAME ?? r.name ?? ""), value: Number(r.VALUE ?? r.value ?? 0) }))
    const s = (summary[0] ?? {}) as Record<string, unknown>

    return Response.json({
      byFolder: norm(byFolder),
      byStage:  norm(byStage),
      history: (history as Record<string, unknown>[]).map(r => ({
        date: String(r.DATE ?? r.date ?? ""),
        credits: Number(r.CREDITS ?? r.credits ?? 0),
      })),
      total30d:         Number(s.TOTAL_30D          ?? s.total_30d ?? 0),
      avgDaily:         Number(s.AVG_DAILY          ?? s.avg_daily ?? 0),
      projectedMonthly: Number(s.PROJECTED_MONTHLY  ?? s.projected_monthly ?? 0),
    })
  } catch (e) {
    console.error(new Date().toISOString(), "[cost] error", e)
    return serverError(e)
  }
}
