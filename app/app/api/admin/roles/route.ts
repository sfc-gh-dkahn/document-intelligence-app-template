import { querySnowflake } from "@/lib/snowflake"
import { DB } from "@/lib/db"
import { requireAdmin, escSql, badRequest, serverError } from "@/lib/api-utils"

export const dynamic = "force-dynamic"

/** GET /api/admin/roles — list all entitlement roles with member counts */
export async function GET() {
  const denied = await requireAdmin()
  if (denied) return denied

  try {
    const rows = await querySnowflake(`
      SELECT r.role_id, r.role_name, r.description, r.menu_access, r.lob_access,
             r.doc_type_access, r.can_download, r.is_active, r.created_by, r.updated_at,
             COUNT(a.id) AS member_count
      FROM ${DB}.ADMIN.entitlement_roles r
      LEFT JOIN ${DB}.ADMIN.user_role_assignments a
        ON a.role_id = r.role_id
      WHERE r.is_active = TRUE
      GROUP BY r.role_id, r.role_name, r.description, r.menu_access, r.lob_access,
               r.doc_type_access, r.can_download, r.is_active, r.created_by, r.updated_at
      ORDER BY r.role_name
    `, { callersRights: true })

    return Response.json({ roles: rows })
  } catch (e) {
    return serverError(e)
  }
}

/** POST /api/admin/roles — create or update a role */
export async function POST(request: Request) {
  const denied = await requireAdmin()
  if (denied) return denied

  try {
    const body = await request.json()
    const { roleName, description, menuAccess, lobAccess, docTypeAccess, canDownload } = body

    if (!roleName || typeof roleName !== "string") return badRequest("roleName is required")
    if (!Array.isArray(menuAccess) || !Array.isArray(lobAccess) || !Array.isArray(docTypeAccess)) {
      return badRequest("menuAccess, lobAccess, and docTypeAccess must be arrays")
    }

    const menuArr = menuAccess.map((v: string) => `'${escSql(v)}'`).join(",")
    const lobArr = lobAccess.map((v: string) => `'${escSql(v)}'`).join(",")
    const docArr = docTypeAccess.map((v: string) => `'${escSql(v)}'`).join(",")
    const download = canDownload !== false ? "TRUE" : "FALSE"

    const callerRows = await querySnowflake(`SELECT CURRENT_USER() AS u`, { callersRights: true })
    const caller = String((callerRows[0] as Record<string, unknown>).U ?? (callerRows[0] as Record<string, unknown>).u ?? "SYSTEM")

    await querySnowflake(`
      MERGE INTO ${DB}.ADMIN.entitlement_roles AS tgt
      USING (SELECT '${escSql(roleName)}' AS role_name) AS src
        ON tgt.role_name = src.role_name
      WHEN MATCHED THEN UPDATE SET
        description = '${escSql(description || "")}',
        menu_access = ARRAY_CONSTRUCT(${menuArr}),
        lob_access = ARRAY_CONSTRUCT(${lobArr}),
        doc_type_access = ARRAY_CONSTRUCT(${docArr}),
        can_download = ${download},
        is_active = TRUE,
        updated_at = CURRENT_TIMESTAMP()
      WHEN NOT MATCHED THEN INSERT (role_name, description, menu_access, lob_access, doc_type_access, can_download, created_by)
      VALUES ('${escSql(roleName)}', '${escSql(description || "")}',
              ARRAY_CONSTRUCT(${menuArr}), ARRAY_CONSTRUCT(${lobArr}), ARRAY_CONSTRUCT(${docArr}),
              ${download}, '${escSql(caller)}')
    `, { callersRights: true })

    return Response.json({ success: true, roleName })
  } catch (e) {
    return serverError(e)
  }
}

/** DELETE /api/admin/roles — deactivate a role */
export async function DELETE(request: Request) {
  const denied = await requireAdmin()
  if (denied) return denied

  try {
    const body = await request.json()
    const { roleName } = body
    if (!roleName) return badRequest("roleName is required")

    await querySnowflake(`
      UPDATE ${DB}.ADMIN.entitlement_roles
      SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP()
      WHERE role_name = '${escSql(roleName)}'
    `, { callersRights: true })

    return Response.json({ success: true, roleName })
  } catch (e) {
    return serverError(e)
  }
}
