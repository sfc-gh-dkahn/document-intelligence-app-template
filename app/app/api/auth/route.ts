import { querySnowflake } from "@/lib/snowflake"
import { getUserEntitlements } from "@/lib/entitlements"
import { DB, ROLE_ADMIN, ROLE_USER, ROLE_PIPELINE } from "@/lib/db"
import { escSql } from "@/lib/api-utils"

export const dynamic = "force-dynamic"

/**
 * Returns the current user's app-level role, identity, and entitlements.
 *
 * Checks Snowflake roles for security boundary, then loads fine-grained
 * entitlements from the user_entitlements table for UI/feature control.
 * Auto-provisions users who have a DOC_INTEL Snowflake role but no entitlement record.
 */
export async function GET() {
  try {
    const rows = await querySnowflake(`
      SELECT
        CURRENT_USER()                                       AS user_name,
        CURRENT_ROLE()                                       AS current_role,
        CURRENT_ACCOUNT()                                    AS account,
        IS_ROLE_IN_SESSION('${ROLE_ADMIN}')               AS is_admin,
        IS_ROLE_IN_SESSION('${ROLE_USER}')                AS is_user,
        IS_ROLE_IN_SESSION('${ROLE_PIPELINE}')            AS is_pipeline
    `, { callersRights: true })

    const r = rows[0] as Record<string, unknown>
    const userName    = String(r.USER_NAME    ?? r.user_name    ?? "")
    const currentRole = String(r.CURRENT_ROLE ?? r.current_role ?? "")
    const account     = String(r.ACCOUNT      ?? r.account      ?? "")

    const b = (v: unknown) => v === true || v === "true" || v === "TRUE"

    const isAdmin    = b(r.IS_ADMIN)    || b(r.is_admin)
    const isUser     = b(r.IS_USER)     || b(r.is_user)
    const isPipeline = b(r.IS_PIPELINE) || b(r.is_pipeline)

    const hasAnyRole = isAdmin || isUser || isPipeline

    // Auto-provision: if user has a DOC_INTEL role but no entitlement record, create one
    if (hasAnyRole && userName) {
      await autoProvisionIfNeeded(userName)
    }

    // Load fine-grained entitlements from the entitlements table
    const entitlements = await getUserEntitlements(userName)

    // If user is explicitly deactivated in entitlements, block them
    if (!entitlements.isActive) {
      return Response.json({
        appRole: "none" as const,
        userName,
        currentRole,
        account,
        isAdmin: false,
        entitlements: null,
        error: "Your access has been deactivated. Contact your administrator.",
      })
    }

    // Determine app-level role: Snowflake role is the security boundary,
    // entitlements (from assigned roles) control UI visibility.
    // User must have the Snowflake role AND the entitlement role's admin keys.
    let appRole: "admin" | "user" | "none" = "none"
    if (isAdmin && entitlements.appRole === "admin") {
      appRole = "admin"
    } else if (hasAnyRole) {
      appRole = "user"
    }

    return Response.json({
      appRole,
      userName,
      currentRole,
      account,
      isAdmin: appRole === "admin",
      entitlements: {
        menuAccess: entitlements.menuAccess,
        lobAccess: entitlements.lobAccess,
        docTypeAccess: entitlements.docTypeAccess,
        canDownload: entitlements.canDownload,
        roleName: entitlements.roleName,
      },
    })
  } catch (e) {
    console.error(new Date().toISOString(), "[auth/role] error", e)
    return Response.json({
      appRole: "none" as const,
      userName: "",
      currentRole: "",
      account: "",
      isAdmin: false,
      entitlements: null,
      error: e instanceof Error ? e.message : "Role check failed",
    })
  }
}

/**
 * Auto-provision a user who has a DOC_INTEL Snowflake role but no entitlement record.
 * Creates a user_entitlements row and assigns the Viewer entitlement role.
 */
async function autoProvisionIfNeeded(userName: string): Promise<void> {
  try {
    const safeUser = escSql(userName.toUpperCase())

    // Check if already exists
    const existing = await querySnowflake(`
      SELECT 1 FROM ${DB}.ADMIN.user_entitlements
      WHERE UPPER(user_name) = '${safeUser}'
      LIMIT 1
    `)
    if (existing && existing.length > 0) return // already registered

    // Create entitlement record
    await querySnowflake(`
      INSERT INTO ${DB}.ADMIN.user_entitlements (user_name, app_role, is_active, created_by)
      VALUES ('${safeUser}', 'user', TRUE, 'AUTO_PROVISION')
    `)

    // Find and assign the Viewer role
    const viewerRows = await querySnowflake(`
      SELECT role_id FROM ${DB}.ADMIN.entitlement_roles
      WHERE LOWER(role_name) = 'viewer' AND is_active = TRUE
      LIMIT 1
    `)
    if (viewerRows.length > 0) {
      const viewerRoleId = Number((viewerRows[0] as Record<string, unknown>).ROLE_ID ?? (viewerRows[0] as Record<string, unknown>).role_id)
      await querySnowflake(`
        INSERT INTO ${DB}.ADMIN.user_role_assignments (user_name, role_id, assigned_by)
        VALUES ('${safeUser}', ${viewerRoleId}, 'AUTO_PROVISION')
      `)
    }

    console.log(new Date().toISOString(), `[auth] auto-provisioned ${safeUser} with Viewer role`)
  } catch (e) {
    // Non-fatal — log and continue (table may not exist yet)
    console.warn("[auth] auto-provision failed for", userName, e instanceof Error ? e.message : "")
  }
}
