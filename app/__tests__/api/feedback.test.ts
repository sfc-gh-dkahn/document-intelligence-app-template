import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db")>()),
 DB: "DOC_INTEL",
}))
vi.mock("@/lib/snowflake", () => ({ querySnowflake: vi.fn() }))
vi.mock("@/lib/api-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-utils")>()
  return { ...actual, requireUser: vi.fn().mockResolvedValue(null) }
})

describe("POST /api/feedback — feedbackType allowlist", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.resetModules() })

  it("accepts thumbs_up", async () => {
    const { querySnowflake } = await import("@/lib/snowflake")
    vi.mocked(querySnowflake).mockResolvedValue([])
    const { POST } = await import("@/app/api/feedback/route")
    const req = new Request("http://localhost/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filePath: "documents/test.pdf", feedbackType: "thumbs_up" }),
    })
    const res = await POST(req as never)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
  })

  it("accepts thumbs_down", async () => {
    const { querySnowflake } = await import("@/lib/snowflake")
    vi.mocked(querySnowflake).mockResolvedValue([])
    const { POST } = await import("@/app/api/feedback/route")
    const req = new Request("http://localhost/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filePath: "documents/test.pdf", feedbackType: "thumbs_down" }),
    })
    const res = await POST(req as never)
    expect(res.status).toBe(200)
  })

  it("rejects arbitrary feedbackType — SQL injection prevention", async () => {
    const { querySnowflake } = await import("@/lib/snowflake")
    vi.mocked(querySnowflake).mockResolvedValue([])
    const { POST } = await import("@/app/api/feedback/route")
    const req = new Request("http://localhost/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filePath: "test.pdf", feedbackType: "'; DROP TABLE search_feedback; --" }),
    })
    const res = await POST(req as never)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain("feedbackType must be one of")
    // Should NOT have called querySnowflake at all
    expect(vi.mocked(querySnowflake)).not.toHaveBeenCalled()
  })

  it("returns 400 when filePath is missing", async () => {
    const { POST } = await import("@/app/api/feedback/route")
    const req = new Request("http://localhost/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feedbackType: "thumbs_up" }),
    })
    const res = await POST(req as never)
    expect(res.status).toBe(400)
  })
})
