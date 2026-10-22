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

describe("POST /api/bookmarks — MERGE logic", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.resetModules() })

  it("returns ok:true on upsert", async () => {
    const { querySnowflake } = await import("@/lib/snowflake")
    vi.mocked(querySnowflake).mockResolvedValue([])
    const { POST } = await import("@/app/api/bookmarks/route")
    const req = new Request("http://localhost/api/bookmarks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filePath: "documents/contract.pdf", documentType: "CONTRACT" }),
    })
    const res = await POST(req as never)
    expect(res.status).toBe(200)
    expect((await res.json()).ok).toBe(true)
  })

  it("returns 400 when filePath missing", async () => {
    const { POST } = await import("@/app/api/bookmarks/route")
    const req = new Request("http://localhost/api/bookmarks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ documentType: "Invoice" }),
    })
    const res = await POST(req as never)
    expect(res.status).toBe(400)
  })

  it("sets personal_note to NULL when note is empty string (clearing note)", async () => {
    const { querySnowflake } = await import("@/lib/snowflake")
    vi.mocked(querySnowflake).mockResolvedValue([])
    const { POST } = await import("@/app/api/bookmarks/route")
    const req = new Request("http://localhost/api/bookmarks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filePath: "documents/contract.pdf", note: "" }),
    })
    await POST(req as never)
    const [sql] = vi.mocked(querySnowflake).mock.calls[0]
    // Empty note should set personal_note = NULL in UPDATE branch
    expect(sql).toContain("personal_note = NULL")
  })

  it("preserves existing note when note is undefined", async () => {
    const { querySnowflake } = await import("@/lib/snowflake")
    vi.mocked(querySnowflake).mockResolvedValue([])
    const { POST } = await import("@/app/api/bookmarks/route")
    const req = new Request("http://localhost/api/bookmarks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filePath: "documents/contract.pdf" }),
    })
    await POST(req as never)
    const [sql] = vi.mocked(querySnowflake).mock.calls[0]
    // Undefined note should keep existing value: personal_note = t.personal_note
    expect(sql).toContain("personal_note = t.personal_note")
  })
})

describe("DELETE /api/bookmarks", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.resetModules() })

  it("returns 400 when file_path missing", async () => {
    const { DELETE } = await import("@/app/api/bookmarks/route")
    const req = new Request("http://localhost/api/bookmarks")
    const res = await DELETE(req as never)
    expect(res.status).toBe(400)
  })

  it("returns ok:true when file_path provided", async () => {
    const { querySnowflake } = await import("@/lib/snowflake")
    vi.mocked(querySnowflake).mockResolvedValue([])
    const { DELETE } = await import("@/app/api/bookmarks/route")
    const req = new Request("http://localhost/api/bookmarks?file_path=documents%2Fcontract.pdf")
    const res = await DELETE(req as never)
    expect(res.status).toBe(200)
    expect((await res.json()).ok).toBe(true)
  })
})
