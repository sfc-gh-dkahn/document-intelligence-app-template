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
      SELECT lob_code, lob_name, description, is_active, sort_order
      FROM ${DB}.ADMIN.lines_of_business
      ORDER BY sort_order, lob_name
    `, { callersRights: true })
    return Response.json({ lobs: rows })
  } catch (e) {
    return serverError(e)
  }
}

export async function POST(req: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    const { lobCode, lobName, description } = await req.json()
    if (!lobCode || !lobName) return badRequest("lobCode and lobName are required")
    if (!/^[A-Za-z0-9_&]{1,50}$/.test(lobCode)) return badRequest("lobCode must be 1-50 alphanumeric characters (plus _ and &)")

    // Duplicate checks (case-insensitive) — UNIQUE constraints on standard tables aren't enforced by Snowflake
    const dupCode = await querySnowflake(`
      SELECT lob_code FROM ${DB}.ADMIN.lines_of_business
      WHERE UPPER(lob_code) = UPPER('${escSql(lobCode)}')
    `, { callersRights: true })
    if (dupCode.length > 0) return Response.json({ error: "LOB code already exists" }, { status: 409 })

    const dupName = await querySnowflake(`
      SELECT lob_name FROM ${DB}.ADMIN.lines_of_business
      WHERE UPPER(lob_name) = UPPER('${escSql(lobName)}')
    `, { callersRights: true })
    if (dupName.length > 0) return Response.json({ error: `LOB name "${lobName}" already exists` }, { status: 409 })

    const maxOrder = await querySnowflake(`
      SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_order FROM ${DB}.ADMIN.lines_of_business
    `, { callersRights: true })
    const nextOrder = Number((maxOrder[0] as Record<string, unknown>).NEXT_ORDER ?? (maxOrder[0] as Record<string, unknown>).next_order ?? 1)
    await querySnowflake(`
      INSERT INTO ${DB}.ADMIN.lines_of_business (lob_code, lob_name, description, sort_order, is_active)
      VALUES ('${escSql(lobCode)}', '${escSql(lobName)}', '${escSql(description ?? "")}', ${nextOrder}, TRUE)
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

    // Toggle active
    if (body.lobCode && "isActive" in body) {
      await querySnowflake(`
        UPDATE ${DB}.ADMIN.lines_of_business
        SET is_active = ${body.isActive !== false}
        WHERE lob_code = '${escSql(body.lobCode)}'
      `, { callersRights: true })
      return Response.json({ ok: true })
    }

    // Update LOB details
    if (body.lobCode && body.lobName) {
      if (!/^[A-Za-z0-9_&., -]{1,256}$/.test(body.lobName)) return badRequest("lobName contains invalid characters")
      const dupName = await querySnowflake(`
        SELECT lob_name FROM ${DB}.ADMIN.lines_of_business
        WHERE UPPER(lob_name) = UPPER('${escSql(body.lobName)}')
          AND UPPER(lob_code) <> UPPER('${escSql(body.lobCode)}')
      `, { callersRights: true })
      if (dupName.length > 0) return Response.json({ error: `LOB name "${body.lobName}" already exists` }, { status: 409 })
      await querySnowflake(`
        UPDATE ${DB}.ADMIN.lines_of_business
        SET lob_name = '${escSql(body.lobName)}',
            description = '${escSql(body.description ?? "")}'
        WHERE lob_code = '${escSql(body.lobCode)}'
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
    const lobCode = req.nextUrl.searchParams.get("lob_code")
    if (!lobCode) return badRequest("lob_code parameter is required")
    await querySnowflake(`
      DELETE FROM ${DB}.ADMIN.lines_of_business WHERE lob_code = '${escSql(lobCode)}'
    `, { callersRights: true })
    return Response.json({ ok: true })
  } catch (e) {
    return serverError(e)
  }
}
