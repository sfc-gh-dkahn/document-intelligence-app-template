import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db")>()),
 DB: "DOC_INTEL",
}))
vi.mock("@/lib/snowflake", () => ({ querySnowflake: vi.fn() }))
vi.mock("@/lib/api-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-utils")>()
  return { ...actual, requireUser: vi.fn().mockResolvedValue(null), requireAdmin: vi.fn().mockResolvedValue(null) }
})

describe("GET /api/analytics", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.resetModules() })

  it("returns byType, byLob, byStatus and catalog totals", async () => {
    const { querySnowflake } = await import("@/lib/snowflake")
    // Route destructures as: [byType, byLob, byStatus, totalRow] — match this order
    vi.mocked(querySnowflake)
      .mockResolvedValueOnce([{ NAME: "Invoice",    VALUE: 50 }])     // byType   (index 0)
      .mockResolvedValueOnce([{ NAME: "Operations", VALUE: 30 }])     // byLob    (index 1)
      .mockResolvedValueOnce([{ NAME: "open",       VALUE: 80 }])     // byStatus (index 2)
      .mockResolvedValueOnce([{ TOTAL: 120, LOBS: 4 }])              // totals   (index 3)
    const { GET } = await import("@/app/api/analytics/route")
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.byType).toEqual([{ name: "Invoice", value: 50 }])
    expect(body.byLob).toEqual([{ name: "Operations", value: 30 }])
    expect(body.byStatus).toEqual([{ name: "open", value: 80 }])
    expect(body.total).toBe(120)
    expect(body.lobs).toBe(4)
    // Every query runs with caller's rights so row access policies apply
    expect(querySnowflake).toHaveBeenCalledTimes(4)
    for (const call of vi.mocked(querySnowflake).mock.calls) {
      expect(call[1]).toEqual({ callersRights: true })
    }
  })

  it("normalises NAME/VALUE columns to name/value", async () => {
    const { querySnowflake } = await import("@/lib/snowflake")
    vi.mocked(querySnowflake).mockResolvedValue([{ NAME: "Finance", VALUE: 42 }])
    const { GET } = await import("@/app/api/analytics/route")
    const body = await (await GET()).json()
    expect(body.byType[0]).toEqual({ name: "Finance", value: 42 })
  })

  it("returns 500 on Snowflake error", async () => {
    const { querySnowflake } = await import("@/lib/snowflake")
    vi.mocked(querySnowflake).mockRejectedValue(new Error("warehouse suspended"))
    const { GET } = await import("@/app/api/analytics/route")
    const res = await GET()
    expect(res.status).toBe(500)
    // serverError only exposes the message in development
    expect((await res.json()).error).toBe("Internal server error")
  })
})
