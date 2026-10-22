/**
 * Tests for lib/api-utils.ts — requireUser() and requireAdmin().
 *
 * requireUser() checks only DOC_INTEL_USER and DOC_INTEL_ADMIN roles.
 * All LOB/document-type scoping is handled by the entitlements system.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/snowflake", () => ({ querySnowflake: vi.fn() }))

describe("requireUser() — role-based access", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.resetModules() })

  async function callRequireUser(flags: Record<string, boolean>) {
    const { querySnowflake } = await import("@/lib/snowflake")
    vi.mocked(querySnowflake).mockResolvedValue([{
      IS_USER:  flags.IS_USER  ?? false,
      IS_ADMIN: flags.IS_ADMIN ?? false,
    }])
    const { requireUser } = await import("@/lib/api-utils")
    return requireUser()
  }

  it("allows access when DOC_INTEL_USER is true", async () => {
    const result = await callRequireUser({ IS_USER: true })
    expect(result).toBeNull()
  })

  it("allows access when DOC_INTEL_ADMIN is true", async () => {
    const result = await callRequireUser({ IS_ADMIN: true })
    expect(result).toBeNull()
  })

  it("allows access when both roles are true", async () => {
    const result = await callRequireUser({ IS_USER: true, IS_ADMIN: true })
    expect(result).toBeNull()
  })

  it("returns 403 when no DOC_INTEL role is present", async () => {
    const result = await callRequireUser({})
    expect(result).not.toBeNull()
    expect((result as Response).status).toBe(403)
  })

  it("returns 403 fail-closed when Snowflake throws", async () => {
    const { querySnowflake } = await import("@/lib/snowflake")
    vi.mocked(querySnowflake).mockRejectedValue(new Error("connection failed"))
    const { requireUser } = await import("@/lib/api-utils")
    const result = await requireUser()
    expect(result).not.toBeNull()
    expect((result as Response).status).toBe(403)
  })
})

describe("requireAdmin()", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.resetModules() })

  it("returns null for IS_ADMIN=true", async () => {
    const { querySnowflake } = await import("@/lib/snowflake")
    vi.mocked(querySnowflake).mockResolvedValue([{ IS_ADMIN: true, is_admin: true }])
    const { requireAdmin } = await import("@/lib/api-utils")
    const result = await requireAdmin()
    expect(result).toBeNull()
  })

  it("returns 403 for IS_ADMIN=false", async () => {
    const { querySnowflake } = await import("@/lib/snowflake")
    vi.mocked(querySnowflake).mockResolvedValue([{ IS_ADMIN: false, is_admin: false }])
    const { requireAdmin } = await import("@/lib/api-utils")
    const result = await requireAdmin()
    expect(result).not.toBeNull()
    expect((result as Response).status).toBe(403)
  })
})
