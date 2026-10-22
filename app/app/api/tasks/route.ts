import { querySnowflake } from "@/lib/snowflake"
import { DB } from "@/lib/db"
import { requireAdmin } from "@/lib/api-utils"

export const dynamic = "force-dynamic"

/**
 * Returns task status from Snowflake SHOW TASKS + TASK_HISTORY.
 * Distinguishes between "no tasks created" and "permission denied".
 */
export async function GET() {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    let tasks: Record<string, unknown>[] = []
    let tasksError: string | null = null

    try {
      // SHOW TASKS doesn't work reliably with caller's rights in SPCS.
      // Use service (owner) credentials since this is admin-only anyway.
      tasks = await querySnowflake(
        `SHOW TASKS IN SCHEMA ${DB}.DATA`
      )
    } catch (e) {
      tasksError = e instanceof Error ? e.message : "Failed to query tasks"
    }

    // Recent task execution history
    let recentRuns: Record<string, unknown>[] = []
    if (tasks.length > 0) {
      try {
        recentRuns = await querySnowflake(`
          SELECT
            name, state, scheduled_time, completed_time,
            DATEDIFF('second', scheduled_time, completed_time) AS duration_seconds,
            error_message
          FROM TABLE(${DB}.INFORMATION_SCHEMA.TASK_HISTORY(
            SCHEDULED_TIME_RANGE_START => DATEADD('HOUR', -24, CURRENT_TIMESTAMP()),
            RESULT_LIMIT => 50
          ))
          WHERE name ILIKE 'TASK_%'
          ORDER BY scheduled_time DESC
        `)
      } catch { /* task history may not be accessible */ }
    }

    return Response.json({
      tasks,
      recentRuns,
      tasksExist: tasks.length > 0,
      error: tasksError,
    })
  } catch (e) {
    console.error(new Date().toISOString(), "[tasks] error", e)
    return Response.json({
      tasks: [],
      recentRuns: [],
      tasksExist: false,
      error: e instanceof Error ? e.message : "Failed",
    })
  }
}
