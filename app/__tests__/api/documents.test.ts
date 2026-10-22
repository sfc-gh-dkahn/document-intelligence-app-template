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

describe("GET /api/documents", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.resetModules() })

  it("returns paginated rows and total", async () => {
    const { querySnowflake } = await import("@/lib/snowflake")
    vi.mocked(querySnowflake)
      .mockResolvedValueOnce([{ FILE_PATH: "documents/test.pdf", DOCUMENT_TYPE: "Invoice" }]) // rows
      .mockResolvedValueOnce([{ TOTAL: 1 }])  // count
    const { GET } = await import("@/app/api/documents/route")
    const req = new Request("http://localhost/api/documents?limit=50&offset=0")
    const res = await GET(req as never)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.rows).toHaveLength(1)
    expect(body.total).toBe(1)
    expect(body.limit).toBe(50)
    expect(body.offset).toBe(0)
  })

  it("applies folder filter to WHERE clause", async () => {
    const { querySnowflake } = await import("@/lib/snowflake")
    vi.mocked(querySnowflake).mockResolvedValue([])
    const { GET } = await import("@/app/api/documents/route")
    const req = new Request("http://localhost/api/documents?folder=Finance")
    await GET(req as never)
    const [sql] = vi.mocked(querySnowflake).mock.calls[0]
    expect(sql).toContain("Finance")
  })

  it("caps limit at 200", async () => {
    const { querySnowflake } = await import("@/lib/snowflake")
    vi.mocked(querySnowflake).mockResolvedValue([])
    const { GET } = await import("@/app/api/documents/route")
    const req = new Request("http://localhost/api/documents?limit=9999")
    await GET(req as never)
    const [sql] = vi.mocked(querySnowflake).mock.calls[0]
    expect(sql).toContain("LIMIT 200")
  })

  it("returns error response on failure", async () => {
    const { querySnowflake } = await import("@/lib/snowflake")
    vi.mocked(querySnowflake).mockRejectedValue(new Error("db unavailable"))
    const { GET } = await import("@/app/api/documents/route")
    const req = new Request("http://localhost/api/documents")
    const res = await GET(req as never)
    expect(res.status).toBe(500)
  })
})
