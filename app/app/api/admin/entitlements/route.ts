import { querySnowflake } from "@/lib/snowflake"
import { DB, ROLE_ADMIN, ROLE_USER, ROLE_PIPELINE } from "@/lib/db"
import { requireAdmin, escSql, badRequest, serverError } from "@/lib/api-utils"
import { NextRequest } from "next/server"

export const dynamic = "force-dynamic"

/**
 * GET /api/admin/entitlements — list all user entitlements with role assignments
 * GET /api/admin/entitlements?action=role_members — fetch Snowflake role grantees
 * GET /api/admin/entitlements?action=unregistered — role members not yet in entitlements
 */
export async function GET(req: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied

  const action = req.nextUrl.searchParams.get("action")

  if (action === "role_members") {
    return getRoleMembers()
  }
  if (action === "unregistered") {
    return getUnregisteredMembers()
  }

  try {
    // Load users with their role assignments
    const rows = await querySnowflake(`
      SELECT u.id, u.user_name, u.app_role, u.is_active, u.created_by, u.created_at, u.updated_at,
             ARRAY_AGG(DISTINCT a.role_id) WITHIN GROUP (ORDER BY a.role_id) AS role_ids,
             ARRAY_AGG(DISTINCT r.role_name) WITHIN GROUP (ORDER BY r.role_name) AS role_names
      FROM ${DB}.ADMIN.user_entitlements u
      LEFT JOIN ${DB}.ADMIN.user_role_assignments a
        ON UPPER(a.user_name) = UPPER(u.user_name)
      LEFT JOIN ${DB}.ADMIN.entitlement_roles r
        ON a.role_id = r.role_id AND r.is_active = TRUE
      GROUP BY u.id, u.user_name, u.app_role, u.is_active, u.created_by, u.created_at, u.updated_at
      ORDER BY u.app_role DESC, u.user_name ASC
    `, { callersRights: true })

    return Response.json({ entitlements: rows })
  } catch (e) {
    const msg = e instanceof Error ? e.message : ""
    if (msg.includes("does not exist") || msg.includes("DOES_NOT_EXIST")) {
      return Response.json({
        entitlements: [],
        tableNotFound: true,
        message: "user_entitlements table not found. Run ./deploy.sh to create it.",
      })
    }
    return serverError(e)
  }
}

/**
 * Fetch all users granted DOC_INTEL_USER, DOC_INTEL_ADMIN, or DOC_INTEL_PIPELINE roles.
 */
async function getRoleMembers() {
  try {
    const roles = [ROLE_USER, ROLE_ADMIN, ROLE_PIPELINE]
    const members = new Map<string, string[]>() // userName → snowflake roles

    for (const roleName of roles) {
      try {
        const rows = await querySnowflake(
          `SHOW GRANTS OF ROLE ${roleName}`,
          { callersRights: true }
        )
        for (const row of rows) {
          const r = row as Record<string, unknown>
          const grantedTo = String(r.granted_to ?? r.GRANTED_TO ?? "").toUpperCase()
          const grantee = String(r.grantee_name ?? r.GRANTEE_NAME ?? r.name ?? r.NAME ?? "").toUpperCase()
          if (grantedTo === "USER" && grantee) {
            const existing = members.get(grantee) ?? []
            existing.push(roleName)
            members.set(grantee, existing)
          }
        }
      } catch {
        // Role may not exist in this account — skip silently
      }
    }

    const result = Array.from(members.entries()).map(([userName, sfRoles]) => ({
      userName,
      snowflakeRoles: sfRoles,
    }))

    return Response.json({ members: result })
  } catch (e) {
    return serverError(e)
  }
}

/**
 * Sync: auto-provision all Snowflake role members who don't yet have entitlement records.
 * Assigns the "Viewer" entitlement role by default (most restrictive).
 */
async function syncRoleMembers() {
  try {
    // Get unregistered members
    const unregRes = await getUnregisteredMembers()
    const unregData = await unregRes.json()
    const unregistered: { userName: string; snowflakeRoles: string[] }[] = unregData.unregistered ?? []

    if (unregistered.length === 0) {
      return Response.json({ success: true, synced: 0, message: "All role members already have entitlements." })
    }

    // Get Viewer role ID (default for auto-provisioned users)
    const viewerRows = await querySnowflake(`
      SELECT role_id FROM ${DB}.ADMIN.entitlement_roles
      WHERE LOWER(role_name) = 'viewer' AND is_active = TRUE
      LIMIT 1
    `, { callersRights: true })
    const viewerRoleId = viewerRows.length > 0
      ? Number((viewerRows[0] as Record<string, unknown>).ROLE_ID ?? (viewerRows[0] as Record<string, unknown>).role_id)
      : null

    const callerRows = await querySnowflake(`SELECT CURRENT_USER() AS u`, { callersRights: true })
    const callerName = String((callerRows[0] as Record<string, unknown>).U ?? (callerRows[0] as Record<string, unknown>).u ?? "SYSTEM")

    let synced = 0
    for (const member of unregistered) {
      const safeUser = escSql(member.userName)
      // Create user_entitlements record
      await querySnowflake(`
        INSERT INTO ${DB}.ADMIN.user_entitlements (user_name, app_role, is_active, created_by)
        SELECT '${safeUser}', 'user', TRUE, '${escSql(callerName)}'
        WHERE NOT EXISTS (
          SELECT 1 FROM ${DB}.ADMIN.user_entitlements WHERE UPPER(user_name) = '${safeUser}'
        )
      `, { callersRights: true })

      // Assign Viewer role if available
      if (viewerRoleId) {
        await querySnowflake(`
          INSERT INTO ${DB}.ADMIN.user_role_assignments (user_name, role_id, assigned_by)
          SELECT '${safeUser}', ${viewerRoleId}, '${escSql(callerName)}'
          WHERE NOT EXISTS (
            SELECT 1 FROM ${DB}.ADMIN.user_role_assignments
            WHERE UPPER(user_name) = '${safeUser}' AND role_id = ${viewerRoleId}
          )
        `, { callersRights: true })
      }
      synced++
    }

    return Response.json({ success: true, synced, members: unregistered })
  } catch (e) {
    return serverError(e)
  }
}

/**
 * Fetch role members who don't yet have an entitlement record.
 */
async function getUnregisteredMembers() {
  try {
    // Get all Snowflake role members
    const membersRes = await getRoleMembers()
    const membersData = await membersRes.json()
    const allMembers: { userName: string; snowflakeRoles: string[] }[] = membersData.members ?? []

    // Get existing entitlement usernames
    let existingUsers = new Set<string>()
    try {
      const rows = await querySnowflake(`
        SELECT UPPER(user_name) AS user_name FROM ${DB}.ADMIN.user_entitlements
      `, { callersRights: true })
      existingUsers = new Set(rows.map((r: Record<string, unknown>) =>
        String(r.USER_NAME ?? r.user_name ?? "").toUpperCase()
      ))
    } catch { /* table may not exist */ }

    const unregistered = allMembers.filter(m => !existingUsers.has(m.userName))

    return Response.json({ unregistered })
  } catch (e) {
    return serverError(e)
  }
}

/**
 * POST /api/admin/entitlements — create or update a user's entitlements + role assignments
 *
 * Body: { userName, roleIds: number[], isActive }
 *       OR { action: "sync" } — bulk-sync all Snowflake role members with a default entitlement role
 */
export async function POST(request: Request) {
  const denied = await requireAdmin()
  if (denied) return denied

  try {
    const body = await request.json()

    // Sync action: auto-provision all unregistered role members with Viewer role
    if (body.action === "sync") {
      return syncRoleMembers()
    }

    const { userName, roleIds, isActive } = body

    if (!userName || typeof userName !== "string") {
      return badRequest("userName is required")
    }
    if (!Array.isArray(roleIds)) {
      return badRequest("roleIds must be an array")
    }

    const active = isActive !== false ? "TRUE" : "FALSE"
    const safeUser = escSql(userName.trim().toUpperCase())

    // Get the calling admin's username for audit trail
    const callerRows = await querySnowflake(`SELECT CURRENT_USER() AS u`, { callersRights: true })
    const callerName = String((callerRows[0] as Record<string, unknown>).U ?? (callerRows[0] as Record<string, unknown>).u ?? "SYSTEM")

    // Upsert user_entitlements row (just username + isActive; appRole is derived from assigned roles)
    await querySnowflake(`
      MERGE INTO ${DB}.ADMIN.user_entitlements AS tgt
      USING (SELECT '${safeUser}' AS user_name) AS src
        ON UPPER(tgt.user_name) = UPPER(src.user_name)
      WHEN MATCHED THEN UPDATE SET
        is_active = ${active},
        updated_at = CURRENT_TIMESTAMP()
      WHEN NOT MATCHED THEN INSERT (user_name, app_role, is_active, created_by)
      VALUES ('${safeUser}', 'user', ${active}, '${escSql(callerName)}')
    `, { callersRights: true })

    // Replace role assignments: delete existing, insert new
    await querySnowflake(`
      DELETE FROM ${DB}.ADMIN.user_role_assignments
      WHERE UPPER(user_name) = UPPER('${safeUser}')
    `, { callersRights: true })

    if (roleIds.length > 0) {
      const values = roleIds
        .map((id: number) => `('${safeUser}', ${parseInt(String(id))}, '${escSql(callerName)}')`)
        .join(",\n        ")
      await querySnowflake(`
        INSERT INTO ${DB}.ADMIN.user_role_assignments (user_name, role_id, assigned_by)
        VALUES ${values}
      `, { callersRights: true })
    }

    return Response.json({ success: true, userName: safeUser })
  } catch (e) {
    return serverError(e)
  }
}

/**
 * DELETE /api/admin/entitlements — deactivate a user's entitlements
 *
 * Body: { userName }
 */
export async function DELETE(request: Request) {
  const denied = await requireAdmin()
  if (denied) return denied

  try {
    const body = await request.json()
    const { userName } = body

    if (!userName || typeof userName !== "string") {
      return badRequest("userName is required")
    }

    await querySnowflake(`
      UPDATE ${DB}.ADMIN.user_entitlements
      SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP()
      WHERE UPPER(user_name) = UPPER('${escSql(userName)}')
    `, { callersRights: true })

    return Response.json({ success: true, userName })
  } catch (e) {
    return serverError(e)
  }
}
