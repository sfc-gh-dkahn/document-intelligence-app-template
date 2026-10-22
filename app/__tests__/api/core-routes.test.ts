import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock Snowflake and DB before any imports
vi.mock("@/lib/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db")>()),
 DB: "DOC_INTEL",
}))
vi.mock("@/lib/snowflake", () => ({
  querySnowflake: vi.fn(),
}))
vi.mock("@/lib/entitlements", () => ({
  getUserEntitlements: vi.fn(),
}))
vi.mock("@/lib/api-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-utils")>()
  return { ...actual, requireUser: vi.fn().mockResolvedValue(null), requireAdmin: vi.fn().mockResolvedValue(null) }
})

describe("API routes — basic shape tests", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  describe("GET /api/filters", () => {
    it("returns empty lists when DB returns no rows", async () => {
      const { querySnowflake } = await import("@/lib/snowflake")
      vi.mocked(querySnowflake).mockResolvedValue([])
      const { GET } = await import("@/app/api/filters/route")
      const res = await GET()
      const json = await res.json()
      expect(res.status).toBe(200)
      expect(json).toEqual({ lobs: [], docTypes: [], statuses: [], formats: [], featureFlags: {} })
    })

    it("returns distinct values from DB rows", async () => {
      const { querySnowflake } = await import("@/lib/snowflake")
      // Route destructures as: [lobs, docTypes, statuses, formats, featureFlags]
      vi.mocked(querySnowflake)
        .mockResolvedValueOnce([{ VALUE: "Operations" }, { VALUE: "Finance" }, { VALUE: "Research &amp; Development" }, { VALUE: "Research & Development" }])
        .mockResolvedValueOnce([{ VALUE: "Invoice" }])
        .mockResolvedValueOnce([{ VALUE: "open" }])
        .mockResolvedValueOnce([{ VALUE: "PDF" }])
        .mockResolvedValueOnce([{ CONFIG_KEY: "enable_chat", CONFIG_VALUE: "true" }, { CONFIG_KEY: "enable_export", CONFIG_VALUE: "false" }])
      const { GET } = await import("@/app/api/filters/route")
      const res = await GET()
      const json = await res.json()
      // HTML entities decoded, then deduplicated and sorted
      expect(json.lobs).toEqual(["Finance", "Operations", "Research & Development"])
      expect(json.docTypes).toEqual(["Invoice"])
      expect(json.statuses).toEqual(["open"])
      expect(json.formats).toEqual(["PDF"])
      expect(json.featureFlags).toEqual({ enable_chat: true, enable_export: false })
    })

    it("returns empty lists with a warning when DB throws", async () => {
      const { querySnowflake } = await import("@/lib/snowflake")
      vi.mocked(querySnowflake).mockRejectedValue(new Error("timeout"))
      const { GET } = await import("@/app/api/filters/route")
      const res = await GET()
      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.lobs).toEqual([])
      expect(json._warning).toBeDefined()
    })
  })

  describe("GET /api/auth", () => {
    const entitlements = (overrides: Record<string, unknown> = {}) => ({
      menuAccess: ["search"], lobAccess: ["*"], docTypeAccess: ["*"],
      appRole: "user", canDownload: true, isActive: true, roleName: "Viewer",
      ...overrides,
    })

    /** First call is the role check; later calls are the auto-provision lookup (already registered). */
    async function mockRoleRow(row: Record<string, unknown>) {
      const { querySnowflake } = await import("@/lib/snowflake")
      vi.mocked(querySnowflake)
        .mockResolvedValueOnce([row])
        .mockResolvedValue([{ 1: 1 }])
      return querySnowflake
    }

    it("returns user role info", async () => {
      await mockRoleRow({
        USER_NAME: "test.user",
        CURRENT_ROLE: "DOC_INTEL_USER",
        ACCOUNT: "MY_ACCOUNT",
        IS_ADMIN: false,
        IS_USER: true,
        IS_PIPELINE: false,
      })
      const { getUserEntitlements } = await import("@/lib/entitlements")
      vi.mocked(getUserEntitlements).mockResolvedValue(entitlements() as never)
      const { GET } = await import("@/app/api/auth/route")
      const res = await GET()
      const json = await res.json()
      expect(res.status).toBe(200)
      expect(json.userName).toBe("test.user")
      expect(json.account).toBe("MY_ACCOUNT")
      expect(json.appRole).toBe("user")
      expect(json.isAdmin).toBe(false)
      expect(json.entitlements.roleName).toBe("Viewer")
      expect(getUserEntitlements).toHaveBeenCalledWith("test.user")
    })

    it("returns admin role when IS_ADMIN is true and entitlements grant admin", async () => {
      await mockRoleRow({
        USER_NAME: "admin.user",
        CURRENT_ROLE: "DOC_INTEL_ADMIN",
        ACCOUNT: "MY_ACCOUNT",
        IS_ADMIN: true,
        IS_USER: false,
        IS_PIPELINE: false,
      })
      const { getUserEntitlements } = await import("@/lib/entitlements")
      vi.mocked(getUserEntitlements).mockResolvedValue(entitlements({ appRole: "admin" }) as never)
      const { GET } = await import("@/app/api/auth/route")
      const res = await GET()
      const json = await res.json()
      expect(json.appRole).toBe("admin")
      expect(json.isAdmin).toBe(true)
    })

    it("downgrades to user when IS_ADMIN is true but entitlements are not admin", async () => {
      await mockRoleRow({ USER_NAME: "admin.user", IS_ADMIN: true, IS_USER: false, IS_PIPELINE: false })
      const { getUserEntitlements } = await import("@/lib/entitlements")
      vi.mocked(getUserEntitlements).mockResolvedValue(entitlements({ appRole: "user" }) as never)
      const { GET } = await import("@/app/api/auth/route")
      const json = await (await GET()).json()
      expect(json.appRole).toBe("user")
      expect(json.isAdmin).toBe(false)
    })

    it("returns none when the user is deactivated in entitlements", async () => {
      await mockRoleRow({ USER_NAME: "test.user", IS_ADMIN: false, IS_USER: true, IS_PIPELINE: false })
      const { getUserEntitlements } = await import("@/lib/entitlements")
      vi.mocked(getUserEntitlements).mockResolvedValue(entitlements({ isActive: false }) as never)
      const { GET } = await import("@/app/api/auth/route")
      const json = await (await GET()).json()
      expect(json.appRole).toBe("none")
      expect(json.entitlements).toBeNull()
      expect(json.error).toContain("deactivated")
    })

    it("fails closed with none role when DB throws", async () => {
      const { querySnowflake } = await import("@/lib/snowflake")
      vi.mocked(querySnowflake).mockRejectedValue(new Error("timeout"))
      const { GET } = await import("@/app/api/auth/route")
      const res = await GET()
      expect(res.status).toBe(200)
      const json = await res.json()
      // FAIL CLOSED: errors return none, not user, to prevent accidental access grants
      expect(json.appRole).toBe("none")
      expect(json.error).toBeDefined()
    })
  })

  describe("POST /api/admin — action routing", () => {
    it("returns 400 for unknown action", async () => {
      const { querySnowflake } = await import("@/lib/snowflake")
      vi.mocked(querySnowflake).mockResolvedValue([])
      const { POST } = await import("@/app/api/admin/route")
      const req = new Request("http://localhost/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "unknown_action" }),
      })
      const res = await POST(req as never)
      expect(res.status).toBe(400)
    })

    it("returns 400 for force_reprocess without filePath", async () => {
      const { querySnowflake } = await import("@/lib/snowflake")
      vi.mocked(querySnowflake).mockResolvedValue([])
      const { POST } = await import("@/app/api/admin/route")
      const req = new Request("http://localhost/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "force_reprocess" }),
      })
      const res = await POST(req as never)
      expect(res.status).toBe(400)
    })

    it("returns ok:true for valid force_reprocess", async () => {
      const { querySnowflake } = await import("@/lib/snowflake")
      vi.mocked(querySnowflake).mockResolvedValue([{ STATUS: "OK" }])
      const { POST } = await import("@/app/api/admin/route")
      const req = new Request("http://localhost/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "force_reprocess", filePath: "documents/test.pdf" }),
      })
      const res = await POST(req as never)
      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.ok).toBe(true)
    })

    it("handles submit_correction action", async () => {
      const { querySnowflake } = await import("@/lib/snowflake")
      vi.mocked(querySnowflake).mockResolvedValue([])
      const { POST } = await import("@/app/api/admin/route")
      const req = new Request("http://localhost/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "submit_correction",
          filePath: "documents/test.pdf",
          fieldName: "party_name",
          originalValue: "Wrong Name",
          correctedValue: "Correct Name",
        }),
      })
      const res = await POST(req as never)
      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.ok).toBe(true)
    })
  })
})
