import { querySnowflake } from "@/lib/snowflake"
import { DB } from "@/lib/db"
import { NextRequest } from "next/server"
import { escSql, requireUser, requireAdmin, badRequest, serverError } from "@/lib/api-utils"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const denied = await requireUser()
  if (denied) return denied

  const action = req.nextUrl.searchParams.get("action")

  // Resolve merged schema for a given document type + LOB
  if (action === "resolve") {
    const category = req.nextUrl.searchParams.get("category") ?? ""
    const lob = req.nextUrl.searchParams.get("lob") ?? ""
    try {
      const rows = await querySnowflake(`
        SELECT attribute_name, attribute_description, attribute_type, schema_tier, document_type
        FROM ${DB}.ADMIN.extraction_schemas
        WHERE schema_tier = 'COMMON'
           OR (schema_tier = 'CATEGORY' AND PARSE_JSON(match_rule):category::VARCHAR = '${escSql(category)}')
           OR (schema_tier = 'LOB_SPECIFIC' AND PARSE_JSON(match_rule):category::VARCHAR = '${escSql(category)}'
               AND PARSE_JSON(match_rule):lob::VARCHAR = '${escSql(lob)}')
        ORDER BY
          CASE schema_tier WHEN 'COMMON' THEN 1 WHEN 'CATEGORY' THEN 2 ELSE 3 END,
          sort_order
      `, { callersRights: true })
      return Response.json({ schema: rows, category, lob })
    } catch (e) { return serverError(e) }
  }

  try {
    const rows = await querySnowflake(
      `SELECT schema_id, document_type, attribute_name, attribute_description,
              attribute_type, is_required, sort_order, updated_by,
              COALESCE(version, 1) AS version,
              COALESCE(status, 'PUBLISHED') AS status,
              COALESCE(schema_tier, 'CATEGORY') AS schema_tier,
              match_rule
       FROM ${DB}.ADMIN.extraction_schemas
       ORDER BY
         CASE schema_tier WHEN 'COMMON' THEN 1 WHEN 'CATEGORY' THEN 2 ELSE 3 END,
         document_type, sort_order`,
      { callersRights: true }
    )
    // Group by tier then document_type
    const tiers: Record<string, Record<string, unknown[]>> = {
      COMMON: {},
      CATEGORY: {},
      LOB_SPECIFIC: {},
    }
    for (const row of rows as Record<string, unknown>[]) {
      const tier = String(row.SCHEMA_TIER ?? row.schema_tier ?? "CATEGORY")
      const dt = String(row.DOCUMENT_TYPE ?? row.document_type ?? "default")
      if (!tiers[tier]) tiers[tier] = {}
      if (!tiers[tier][dt]) tiers[tier][dt] = []
      tiers[tier][dt].push(row)
    }
    return Response.json({ tiers })
  } catch (e) {
    return serverError(e)
  }
}

export async function POST(req: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    const { documentType, attributeName, attributeDescription, attributeType, isRequired, sortOrder, schemaTier, matchRule } = await req.json()
    if (!documentType || !attributeName || !attributeDescription) {
      return badRequest("documentType, attributeName, and attributeDescription are required")
    }
    const tier = schemaTier || "CATEGORY"
    const ruleStr = matchRule ? `PARSE_JSON('${escSql(JSON.stringify(matchRule))}')` : "NULL"
    await querySnowflake(
      `INSERT INTO ${DB}.ADMIN.extraction_schemas
         (document_type, attribute_name, attribute_description, attribute_type, is_required, sort_order, schema_tier, match_rule)
       VALUES (
         '${escSql(documentType)}',
         '${escSql(attributeName)}',
         '${escSql(attributeDescription)}',
         '${escSql(attributeType || "VARCHAR")}',
         ${isRequired !== false},
         ${parseInt(sortOrder) || 0},
         '${escSql(tier)}',
         ${ruleStr}
       )`,
      { callersRights: true }
    )
    return Response.json({ ok: true })
  } catch (e) {
    const msg = e instanceof Error ? e.message : ""
    if (msg.includes("duplicate") || msg.includes("UNIQUE")) {
      return Response.json({ error: "Attribute already exists for this tier/type" }, { status: 409 })
    }
    return serverError(e)
  }
}

export async function PUT(req: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    const { schemaId, attributeDescription, attributeType, isRequired, sortOrder } = await req.json()
    if (!schemaId) return badRequest("schemaId is required")
    await querySnowflake(
      `UPDATE ${DB}.ADMIN.extraction_schemas SET
         attribute_description = '${escSql(attributeDescription)}',
         attribute_type = '${escSql(attributeType || "VARCHAR")}',
         is_required = ${isRequired !== false},
         sort_order = ${parseInt(sortOrder) || 0},
         updated_by = CURRENT_USER()
       WHERE schema_id = '${escSql(schemaId)}'`,
      { callersRights: true }
    )
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
    if (!id) return badRequest("id parameter is required")
    await querySnowflake(
      `DELETE FROM ${DB}.ADMIN.extraction_schemas WHERE schema_id = '${escSql(id)}'`,
      { callersRights: true }
    )
    return Response.json({ ok: true })
  } catch (e) {
    return serverError(e)
  }
}
