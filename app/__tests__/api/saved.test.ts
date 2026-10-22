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

describe("GET /api/saved — list searches + bookmarks", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.resetModules() })

  it("returns searches and bookmarks arrays", async () => {
    const { querySnowflake } = await import("@/lib/snowflake")
    vi.mocked(querySnowflake)
      .mockResolvedValueOnce([{ SEARCH_ID: "1", SEARCH_NAME: "My Search", QUERY_TEXT: "cyber" }])
      .mockResolvedValueOnce([{ BOOKMARK_ID: "1", FILE_PATH: "documents/a.pdf" }])
    const { GET } = await import("@/app/api/saved/route")
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.searches).toHaveLength(1)
    expect(body.bookmarks).toHaveLength(1)
  })
})

describe("POST /api/saved — create saved search", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.resetModules() })

  it("returns 400 when name or queryText missing", async () => {
    const { querySnowflake } = await import("@/lib/snowflake")
    vi.mocked(querySnowflake).mockResolvedValue([])
    const { POST } = await import("@/app/api/saved/route")
    const req = new Request("http://localhost/api/saved", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "", queryText: "cyber" }),
    })
    const res = await POST(req as never)
    expect(res.status).toBe(400)
  })

  it("returns ok:true when name and queryText provided", async () => {
    const { querySnowflake } = await import("@/lib/snowflake")
    vi.mocked(querySnowflake).mockResolvedValue([])
    const { POST } = await import("@/app/api/saved/route")
    const req = new Request("http://localhost/api/saved", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Operations Searches", queryText: "vendor invoice" }),
    })
    const res = await POST(req as never)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
  })
})

describe("DELETE /api/saved", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.resetModules() })

  it("returns 400 when id is missing", async () => {
    const { querySnowflake } = await import("@/lib/snowflake")
    vi.mocked(querySnowflake).mockResolvedValue([])
    const { DELETE } = await import("@/app/api/saved/route")
    const req = new Request("http://localhost/api/saved")
    const res = await DELETE(req as never)
    expect(res.status).toBe(400)
  })

  it("returns ok:true when id is provided", async () => {
    const { querySnowflake } = await import("@/lib/snowflake")
    vi.mocked(querySnowflake).mockResolvedValue([])
    const { DELETE } = await import("@/app/api/saved/route")
    const req = new Request("http://localhost/api/saved?id=abc-123")
    const res = await DELETE(req as never)
    expect(res.status).toBe(200)
  })
})
