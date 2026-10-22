/**
 * Input validation utilities for API routes.
 *
 * All user-provided strings are sanitized before being interpolated into
 * SQL via simple escaping. Parameterized queries are preferred but Snowflake
 * SDK's node binding doesn't yet support positional params in all contexts,
 * so we apply defense-in-depth escaping.
 */
import { querySnowflake } from "@/lib/snowflake"
import { ROLE_ADMIN, ROLE_USER } from "@/lib/db"

/**
 * Escape single quotes to prevent SQL injection via string interpolation.
 * Also rejects semicolons as defense-in-depth against multi-statement injection.
 * NOTE: Safety also relies on Snowflake SDK default MULTI_STATEMENT_COUNT=1.
 */
export function escSql(s: unknown): string {
  const str = String(s ?? "")
  if (str.includes(";")) {
    throw new Error("Invalid input: semicolons not allowed")
  }
  return str.replace(/\0/g, "").replace(/'/g, "''")
}

/** Escape ILIKE wildcard characters (% and _) in addition to single quotes. */
export function escLike(s: unknown): string {
  return escSql(s).replace(/%/g, "\\%").replace(/_/g, "\\_")
}

/** Decode common HTML entities that may appear in extracted data. */
export function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

/** Sanitize an identifier (table/schema/column name) — only alphanumeric, underscore, dollar. */
export function escIdent(s: unknown): string {
  return String(s ?? "").replace(/[^a-zA-Z0-9_$]/g, "")
}

/** Clamp a numeric value between min and max. */
export function clampInt(v: unknown, min: number, max: number): number {
  const n = parseInt(String(v ?? min))
  return isNaN(n) ? min : Math.max(min, Math.min(max, n))
}

/** Validate that a value is one of the allowed options (whitelist). */
export function allowList<T extends string>(v: unknown, allowed: T[], fallback: T): T {
  return allowed.includes(v as T) ? (v as T) : fallback
}

/** Return a standardized 400 error response. */
export function badRequest(message: string) {
  return Response.json({ error: message }, { status: 400 })
}

/** Return a standardized 500 error response. */
export function serverError(e: unknown) {
  console.error(new Date().toISOString(), "API error:", e)
  const msg = process.env.NODE_ENV === "development" && e instanceof Error
    ? e.message : "Internal server error"
  return Response.json({ error: msg }, { status: 500 })
}

/**
 * Server-side admin guard for API routes.
 *
 * Returns a 403 Response if the caller does not have DOC_INTEL_ADMIN.
 * Returns null if the caller IS an admin and the route should proceed.
 *
 * Usage:
 *   const denied = await requireAdmin()
 *   if (denied) return denied
 *
 * Security: runs IS_ROLE_IN_SESSION with caller's rights so it reflects
 * the user's actual grants, not the service identity.
 */
export async function requireAdmin(): Promise<Response | null> {
  try {
    const rows = await querySnowflake(
      `SELECT IS_ROLE_IN_SESSION('${ROLE_ADMIN}') AS is_admin`,
      { callersRights: true }
    )
    const r = rows[0] as Record<string, unknown>
    const isAdmin = r.IS_ADMIN === true || r.is_admin === true ||
                    r.IS_ADMIN === "true" || r.is_admin === "true"
    if (!isAdmin) {
      return Response.json({ error: `Forbidden — requires ${ROLE_ADMIN} role` }, { status: 403 })
    }
    return null
  } catch (e) {
    console.error(new Date().toISOString(), "[requireAdmin] error", e)
    // Fail closed — if we can't check the role, deny the request
    return Response.json({ error: "Unable to verify admin access" }, { status: 403 })
  }
}

/**
 * Server-side user guard for API routes.
 *
 * Returns a 403 Response if the caller does not have DOC_INTEL_USER or DOC_INTEL_ADMIN.
 * Returns null if the caller has access and the route should proceed.
 *
 * Fail-closed: errors return 403, not pass-through.
 *
 * NOTE: All data-level access control (LOB, document type) is handled by the
 * entitlements system (user_role_assignments → entitlement_roles → lobFilter/docTypeFilter).
 * Snowflake roles only gate "can you use the app at all?" and "are you an admin?".
 */
export async function requireUser(): Promise<Response | null> {
  try {
    const rows = await querySnowflake(
      `SELECT
         IS_ROLE_IN_SESSION('${ROLE_USER}')   AS is_user,
         IS_ROLE_IN_SESSION('${ROLE_ADMIN}')  AS is_admin
       `,
      { callersRights: true }
    )
    const r = rows[0] as Record<string, unknown>
    const b = (v: unknown) => v === true || v === "true" || v === "TRUE"
    const hasAccess = b(r.IS_USER)  || b(r.is_user) ||
                      b(r.IS_ADMIN) || b(r.is_admin)
    if (!hasAccess) {
      return Response.json({ error: `Forbidden — requires ${ROLE_USER} or ${ROLE_ADMIN} role` }, { status: 403 })
    }
    return null
  } catch (e) {
    console.error(new Date().toISOString(), "[requireUser] error", e)
    return Response.json({ error: "Unable to verify access" }, { status: 403 })
  }
}

