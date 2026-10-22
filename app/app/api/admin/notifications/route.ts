import { querySnowflake } from "@/lib/snowflake"
import { DB } from "@/lib/db"
import { NextRequest } from "next/server"
import { escSql, requireAdmin, badRequest, serverError } from "@/lib/api-utils"

export const dynamic = "force-dynamic"

export async function GET() {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    const rows = await querySnowflake(`
      SELECT id, channel_type, endpoint, event_types, threshold_value, is_active, created_at
      FROM ${DB}.ADMIN.notification_config
      ORDER BY created_at DESC
    `, { callersRights: true })
    return Response.json({ rules: rows })
  } catch (e) {
    return serverError(e)
  }
}

export async function POST(req: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    const { channelType, endpoint, eventTypes, thresholdValue } = await req.json()
    if (!channelType || !endpoint) return badRequest("channelType and endpoint are required")
    if (!Array.isArray(eventTypes) || eventTypes.length === 0) return badRequest("eventTypes array required")
    const evTypesArr = eventTypes.map((e: string) => `'${escSql(e)}'`).join(",")
    await querySnowflake(`
      INSERT INTO ${DB}.ADMIN.notification_config (channel_type, endpoint, event_types, threshold_value, is_active)
      SELECT '${escSql(channelType)}', '${escSql(endpoint)}', ARRAY_CONSTRUCT(${evTypesArr}), ${parseInt(thresholdValue) || 0}, TRUE
    `, { callersRights: true })
    return Response.json({ ok: true })
  } catch (e) {
    return serverError(e)
  }
}

export async function DELETE(req: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    const id = req.nextUrl.searchParams.get("id")
    if (!id) return badRequest("id parameter required")
    await querySnowflake(`
      DELETE FROM ${DB}.ADMIN.notification_config WHERE id = '${escSql(id)}'
    `, { callersRights: true })
    return Response.json({ ok: true })
  } catch (e) {
    return serverError(e)
  }
}

export async function PUT(req: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    const { id, isActive } = await req.json()
    if (!id) return badRequest("id is required")
    await querySnowflake(`
      UPDATE ${DB}.ADMIN.notification_config SET is_active = ${isActive !== false} WHERE id = '${escSql(id)}'
    `, { callersRights: true })
    return Response.json({ ok: true })
  } catch (e) {
    return serverError(e)
  }
}
