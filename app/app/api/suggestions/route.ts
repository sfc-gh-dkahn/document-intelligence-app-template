import { querySnowflake } from "@/lib/snowflake"
import { DB } from "@/lib/db"
import { requireUser, serverError } from "@/lib/api-utils"

export const dynamic = "force-dynamic"

export async function GET() {
  const denied = await requireUser()
  if (denied) return denied
  try {
    const rows = await querySnowflake(`
      SELECT s.label, s.query, s.lob_code
      FROM ${DB}.ADMIN.suggested_searches s
      WHERE s.is_active = TRUE
        AND (
          s.lob_code = '*'
          OR s.lob_code IN (
            SELECT f.value::VARCHAR
            FROM ${DB}.ADMIN.user_role_assignments a
            JOIN ${DB}.ADMIN.entitlement_roles r
              ON a.role_id = r.role_id AND r.is_active = TRUE
            , LATERAL FLATTEN(input => r.lob_access) f
            WHERE UPPER(a.user_name) = CURRENT_USER()
          )
          OR EXISTS (
            SELECT 1
            FROM ${DB}.ADMIN.user_role_assignments a2
            JOIN ${DB}.ADMIN.entitlement_roles r2
              ON a2.role_id = r2.role_id AND r2.is_active = TRUE
            , LATERAL FLATTEN(input => r2.lob_access) f2
            WHERE UPPER(a2.user_name) = CURRENT_USER()
              AND f2.value::VARCHAR = '*'
          )
        )
      ORDER BY s.lob_code, s.sort_order
      LIMIT 50
    `, { callersRights: true })
    const suggestions = rows.map(r => {
      const row = r as Record<string, unknown>
      return { label: row.LABEL ?? row.label, query: row.QUERY ?? row.query }
    })
    return Response.json({ suggestions })
  } catch (e) {
    return serverError(e)
  }
}
