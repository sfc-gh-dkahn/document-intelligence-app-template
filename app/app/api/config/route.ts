import { querySnowflake } from "@/lib/snowflake"
import { DB } from "@/lib/db"
import { NextRequest } from "next/server"
import { requireAdmin, escSql, serverError } from "@/lib/api-utils"

export const dynamic = "force-dynamic"

export async function GET() {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    const rows = await querySnowflake(
      `SELECT config_key, config_value, config_type, description, updated_at, updated_by
       FROM ${DB}.ADMIN.system_config
       ORDER BY config_key`,
      { callersRights: true }
    )
    return Response.json(rows)
  } catch (e) {
    console.error(new Date().toISOString(), "[config:GET] error", e)
    return serverError(e)
  }
}

export async function PUT(req: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    const { key, value } = await req.json() as { key: string; value: string }
    if (!key || value === undefined) {
      return Response.json({ error: "key and value are required" }, { status: 400 })
    }
    await querySnowflake(
      `UPDATE ${DB}.ADMIN.system_config
       SET config_value = '${escSql(value)}',
           updated_at = CURRENT_TIMESTAMP(),
           updated_by = CURRENT_USER()
       WHERE config_key = '${escSql(key)}' `,
      { callersRights: true }
    )
    return Response.json({ ok: true })
  } catch (e) {
    return serverError(e)
  }
}
