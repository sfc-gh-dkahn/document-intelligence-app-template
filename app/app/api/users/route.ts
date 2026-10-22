import { querySnowflake } from "@/lib/snowflake"
import { DB, ROLE_ADMIN, ROLE_USER } from "@/lib/db"
import { requireAdmin, serverError } from "@/lib/api-utils"

export const dynamic = "force-dynamic"

export async function GET() {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    const [activity, adminGrants, userGrants] = await Promise.all([
      // User activity from agent audit log (last 30 days)
      querySnowflake(`
        SELECT user_name,
               COUNT(*)                                                AS total_queries,
               MAX(query_time)                                         AS last_active,
               SUM(CASE WHEN tool_used = 'Search'    THEN 1 ELSE 0 END) AS search_count,
               SUM(CASE WHEN tool_used = 'Analytics' THEN 1 ELSE 0 END) AS analytics_count
        FROM ${DB}.TELEMETRY.agent_audit_log
        WHERE query_time >= DATEADD('DAY', -30, CURRENT_TIMESTAMP())
        GROUP BY user_name
        ORDER BY total_queries DESC
        LIMIT 100
      `, { callersRights: true }),

      // Who has the admin role — SHOW GRANTS returns grantee_name column
      querySnowflake(`SHOW GRANTS OF ROLE ${ROLE_ADMIN}`, { callersRights: true })
        .catch(() => []),

      // Who has the user role
      querySnowflake(`SHOW GRANTS OF ROLE ${ROLE_USER}`, { callersRights: true })
        .catch(() => []),
    ])

    // Build a role membership map from SHOW GRANTS results
    // SHOW GRANTS OF ROLE returns columns: created_on, privilege, granted_on, name, granted_to, grantee_name, ...
    const extractGrantees = (rows: Record<string, unknown>[]) =>
      rows
        .filter(r => String(r.GRANTED_TO ?? r.granted_to ?? "") === "USER")
        .map(r => String(r.GRANTEE_NAME ?? r.grantee_name ?? ""))
        .filter(Boolean)

    const roleSummary = [
      { role_name: "DOC_INTEL_ADMIN", users: extractGrantees(adminGrants) },
      { role_name: "DOC_INTEL_USER",  users: extractGrantees(userGrants)  },
    ].filter(r => r.users.length > 0)

    return Response.json({ activity, roleSummary })
  } catch (e) {
    console.error(new Date().toISOString(), "[users] error", e)
    return serverError(e)
  }
}
