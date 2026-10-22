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
      SELECT label, category, sort_order, is_active
      FROM ${DB}.ADMIN.classification_labels
      ORDER BY category, sort_order, label
    `, { callersRights: true })
    return Response.json({ labels: rows })
  } catch (e) {
    return serverError(e)
  }
}

export async function POST(req: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    const { label, category, sortOrder } = await req.json()
    if (!label) return badRequest("label is required")

    // Duplicate check (case-insensitive) — UNIQUE constraint on standard tables isn't enforced by Snowflake
    const dup = await querySnowflake(`
      SELECT label FROM ${DB}.ADMIN.classification_labels
      WHERE UPPER(label) = UPPER('${escSql(label)}')
    `, { callersRights: true })
    if (dup.length > 0) return Response.json({ error: `Label "${label}" already exists` }, { status: 409 })

    await querySnowflake(`
      INSERT INTO ${DB}.ADMIN.classification_labels (label, category, sort_order, is_active)
      VALUES ('${escSql(label)}', '${escSql(category || "General")}', ${parseInt(sortOrder) || 0}, TRUE)
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
    const label = req.nextUrl.searchParams.get("label")
    if (!label) return badRequest("label parameter is required")
    await querySnowflake(`
      DELETE FROM ${DB}.ADMIN.classification_labels WHERE label = '${escSql(label)}'
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

    // Toggle label active state
    if (body.label && "isActive" in body) {
      await querySnowflake(`
        UPDATE ${DB}.ADMIN.classification_labels
        SET is_active = ${body.isActive !== false}
        WHERE label = '${escSql(body.label)}'
      `, { callersRights: true })
      return Response.json({ ok: true })
    }

    // Rename a category
    if (body.action === "rename_category" && body.oldName && body.newName) {
      await querySnowflake(`
        UPDATE ${DB}.ADMIN.classification_labels
        SET category = '${escSql(body.newName)}'
        WHERE category = '${escSql(body.oldName)}'
      `, { callersRights: true })
      return Response.json({ ok: true })
    }

    // Delete a category (reassign labels to target category, or delete them)
    if (body.action === "delete_category" && body.category) {
      if (body.reassignTo) {
        await querySnowflake(`
          UPDATE ${DB}.ADMIN.classification_labels
          SET category = '${escSql(body.reassignTo)}'
          WHERE category = '${escSql(body.category)}'
        `, { callersRights: true })
      } else {
        await querySnowflake(`
          DELETE FROM ${DB}.ADMIN.classification_labels
          WHERE category = '${escSql(body.category)}'
        `, { callersRights: true })
      }
      return Response.json({ ok: true })
    }

    return badRequest("Invalid PUT body")
  } catch (e) {
    return serverError(e)
  }
}
