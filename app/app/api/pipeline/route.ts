import { querySnowflake } from "@/lib/snowflake"
import { DB } from "@/lib/db"
import { requireAdmin, serverError } from "@/lib/api-utils"

export const dynamic = "force-dynamic"

export async function GET() {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    const rows = await querySnowflake(`
      SELECT * FROM ${DB}.TELEMETRY.v_pipeline_health
    `, { callersRights: true })
    return Response.json(rows[0] ?? {})
  } catch (e) {
    return serverError(e)
  }
}
