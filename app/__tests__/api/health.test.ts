import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock lib/snowflake before importing the route
vi.mock("@/lib/snowflake", () => ({
  querySnowflake: vi.fn().mockResolvedValue([{ 1: 1 }]),
}))

vi.mock("@/lib/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db")>()),
  DB: "DOC_INTEL",
}))

vi.mock("@/lib/api-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-utils")>()
  return { ...actual, requireUser: vi.fn().mockResolvedValue(null) }
})

describe("GET /api/health", () => {
  beforeEach(() => { vi.clearAllMocks() })

  it("returns 200 with status ok when Snowflake is reachable", async () => {
    const { querySnowflake } = await import("@/lib/snowflake")
    const { GET } = await import("@/app/api/health/route")
    const res = await GET()
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.status).toBe("ok")
    expect(typeof json.ts).toBe("string")
    expect(querySnowflake).toHaveBeenCalledWith("SELECT 1", { callersRights: true })
  })

  it("returns 503 when Snowflake throws", async () => {
    const { querySnowflake } = await import("@/lib/snowflake")
    vi.mocked(querySnowflake).mockRejectedValueOnce(new Error("connection refused"))
    const { GET } = await import("@/app/api/health/route")
    const res = await GET()
    expect(res.status).toBe(503)
    const json = await res.json()
    expect(json.status).toBe("error")
  })

  it("returns the requireUser denial without touching Snowflake", async () => {
    const { requireUser } = await import("@/lib/api-utils")
    const { querySnowflake } = await import("@/lib/snowflake")
    vi.mocked(requireUser).mockResolvedValueOnce(
      Response.json({ error: "Forbidden" }, { status: 403 })
    )
    const { GET } = await import("@/app/api/health/route")
    const res = await GET()
    expect(res.status).toBe(403)
    expect(querySnowflake).not.toHaveBeenCalled()
  })
})
