import { querySnowflake } from "@/lib/snowflake"
import { DB } from "@/lib/db"
import { NextRequest } from "next/server"
import { requireAdmin, escSql, serverError } from "@/lib/api-utils"

export const dynamic = "force-dynamic"

/** GET /api/admin/stages — List all configured ingestion stages */
/** GET /api/admin/stages?action=discover — List available stages not yet registered */
export async function GET(req: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied

  const action = req.nextUrl.searchParams.get("action")

  if (action === "discover") {
    try {
      // Find all stages in the database that are not already registered
      const registered = await querySnowflake(
        `SELECT stage_name FROM ${DB}.ADMIN.ingestion_stages`,
        { callersRights: true }
      )
      const registeredNames = new Set(
        (registered as Record<string, unknown>[]).map(r =>
          String(r.STAGE_NAME ?? r.stage_name ?? "").toUpperCase()
        )
      )

      const stages = await querySnowflake(
        `SHOW STAGES IN DATABASE ${DB}`,
        { callersRights: true }
      )
      const available = (stages as Record<string, unknown>[])
        .filter(r => {
          const schema = String(r.schema_name ?? "")
          const name = String(r.name ?? "")
          const fullName = `${DB}.${schema}.${name}`.toUpperCase()
          return !registeredNames.has(fullName)
        })
        .map(r => ({
          name: `${DB}.${r.schema_name}.${r.name}`,
          type: String(r.type ?? ""),
          comment: String(r.comment ?? ""),
        }))

      return Response.json({ available })
    } catch (e) {
      return serverError(e)
    }
  }

  try {
    const rows = await querySnowflake(
      `SELECT stage_name, description, path_prefix, file_pattern, is_active, created_at, updated_by
       FROM ${DB}.ADMIN.ingestion_stages
       ORDER BY created_at`,
      { callersRights: true }
    )
    return Response.json(rows)
  } catch (e) {
    return serverError(e)
  }
}

/** POST /api/admin/stages — Add a new ingestion stage */
export async function POST(req: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    const { stageName, description, pathPrefix, filePattern } = await req.json()
    if (!stageName) {
      return Response.json({ error: "stageName is required" }, { status: 400 })
    }
    await querySnowflake(
      `INSERT INTO ${DB}.ADMIN.ingestion_stages (stage_name, description, path_prefix, file_pattern)
       VALUES ('${escSql(stageName)}', '${escSql(description ?? "")}', '${escSql(pathPrefix ?? "")}', '${escSql(filePattern ?? ".*\\\\.(tif|tiff|pdf|docx|pptx|jpg|jpeg|png|html|txt)$")}')`,
      { callersRights: true }
    )
    return Response.json({ ok: true })
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed"
    if (msg.includes("duplicate") || msg.includes("already exists")) {
      return Response.json({ error: "Stage already registered" }, { status: 409 })
    }
    return Response.json({ error: msg }, { status: 500 })
  }
}

/** DELETE /api/admin/stages?stage_name=... — Remove a stage */
export async function DELETE(req: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied
  const stageName = req.nextUrl.searchParams.get("stage_name")
  if (!stageName) {
    return Response.json({ error: "stage_name parameter required" }, { status: 400 })
  }
  try {
    await querySnowflake(
      `DELETE FROM ${DB}.ADMIN.ingestion_stages WHERE stage_name = '${escSql(stageName)}'`,
      { callersRights: true }
    )
    return Response.json({ ok: true })
  } catch (e) {
    return serverError(e)
  }
}

/** PATCH /api/admin/stages — Toggle active state */
export async function PATCH(req: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    const { stageName, isActive } = await req.json()
    if (!stageName || isActive === undefined) {
      return Response.json({ error: "stageName and isActive required" }, { status: 400 })
    }
    await querySnowflake(
      `UPDATE ${DB}.ADMIN.ingestion_stages
       SET is_active = ${isActive ? 'TRUE' : 'FALSE'}, updated_by = CURRENT_USER()
       WHERE stage_name = '${escSql(stageName)}'`,
      { callersRights: true }
    )
    return Response.json({ ok: true })
  } catch (e) {
    return serverError(e)
  }
}
