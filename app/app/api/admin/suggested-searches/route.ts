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
      SELECT search_id, lob_code, label, query, sort_order, is_active
      FROM ${DB}.ADMIN.suggested_searches
      ORDER BY lob_code, sort_order
    `, { callersRights: true })
    return Response.json({ searches: rows })
  } catch (e) {
    return serverError(e)
  }
}

export async function POST(req: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    const { lobCode, label, query } = await req.json()
    if (!lobCode || !label || !query) return badRequest("lobCode, label, and query are required")

    const maxOrder = await querySnowflake(`
      SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_order
      FROM ${DB}.ADMIN.suggested_searches WHERE lob_code = '${escSql(lobCode)}'
    `, { callersRights: true })
    const nextOrder = Number((maxOrder[0] as Record<string, unknown>).NEXT_ORDER ?? (maxOrder[0] as Record<string, unknown>).next_order ?? 1)

    await querySnowflake(`
      INSERT INTO ${DB}.ADMIN.suggested_searches (lob_code, label, query, sort_order, is_active)
      VALUES ('${escSql(lobCode)}', '${escSql(label)}', '${escSql(query)}', ${nextOrder}, TRUE)
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
    const body = await req.json()
    const { searchId } = body

    if (!searchId) return badRequest("searchId is required")

    if ("isActive" in body) {
      await querySnowflake(`
        UPDATE ${DB}.ADMIN.suggested_searches
        SET is_active = ${body.isActive !== false}
        WHERE search_id = ${Number(searchId)}
      `, { callersRights: true })
      return Response.json({ ok: true })
    }

    if (body.label && body.query) {
      await querySnowflake(`
        UPDATE ${DB}.ADMIN.suggested_searches
        SET label = '${escSql(body.label)}',
            query = '${escSql(body.query)}',
            lob_code = '${escSql(body.lobCode ?? "*")}'
        WHERE search_id = ${Number(searchId)}
      `, { callersRights: true })
      return Response.json({ ok: true })
    }

    return badRequest("Invalid PUT body")
  } catch (e) {
    return serverError(e)
  }
}

export async function DELETE(req: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    const searchId = req.nextUrl.searchParams.get("id")
    if (!searchId) return badRequest("id parameter is required")
    await querySnowflake(`
      DELETE FROM ${DB}.ADMIN.suggested_searches WHERE search_id = ${Number(searchId)}
    `, { callersRights: true })
    return Response.json({ ok: true })
  } catch (e) {
    return serverError(e)
  }
}
