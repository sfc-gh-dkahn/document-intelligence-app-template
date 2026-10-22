/**
 * Tests for /api/analyst — Cortex Analyst REST API.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

vi.mock("@/lib/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db")>()),
 DB: "DOC_INTEL",
}))
vi.mock("@/lib/snowflake", () => ({
  querySnowflake: vi.fn(),
  getSnowflakeBaseUrl: vi.fn(),
  getServiceToken: vi.fn(),
  getRestApiAuthHeader: vi.fn().mockReturnValue("Bearer toml-token"),
}))
vi.mock("@/lib/api-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-utils")>()
  return { ...actual, requireUser: vi.fn().mockResolvedValue(null) }
})
vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue({ get: vi.fn().mockReturnValue("mock-caller") }),
}))

describe("POST /api/analyst", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.resetModules() })
  afterEach(() => { vi.unstubAllGlobals() })

  it("returns 400 when question is missing", async () => {
    const { POST } = await import("@/app/api/analyst/route")
    const req = new Request("http://localhost/api/analyst", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: "  " }),
    })
    const res = await POST(req as never)
    expect(res.status).toBe(400)
  })

  it("returns 400 when question exceeds 1000 characters", async () => {
    const { POST } = await import("@/app/api/analyst/route")
    const req = new Request("http://localhost/api/analyst", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: "Q".repeat(1001) }),
    })
    const res = await POST(req as never)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain("too long")
  })

  it("returns 400 when question exceeds 1000 characters", async () => {
    const { POST } = await import("@/app/api/analyst/route")
    const req = new Request("http://localhost/api/analyst", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: "x".repeat(1001) }),
    })
    const res = await POST(req as never)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/1000/)
  })

  it("returns 503 when Snowflake base URL is not configured", async () => {
    const { getSnowflakeBaseUrl, getServiceToken } = await import("@/lib/snowflake")
    vi.mocked(getSnowflakeBaseUrl).mockReturnValue(null)
    vi.mocked(getServiceToken).mockReturnValue("")
    const { POST } = await import("@/app/api/analyst/route")
    const req = new Request("http://localhost/api/analyst", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: "How many invoices?" }),
    })
    const res = await POST(req as never)
    expect(res.status).toBe(503)
  })

  it("passes question WITHOUT SQL-escaping apostrophes (C-1 regression test)", async () => {
    const { getSnowflakeBaseUrl, getServiceToken, querySnowflake } = await import("@/lib/snowflake")
    vi.mocked(getSnowflakeBaseUrl).mockReturnValue("https://acct.snowflakecomputing.com")
    vi.mocked(getServiceToken).mockReturnValue("svc-token")
    vi.mocked(querySnowflake).mockResolvedValue([])
    let capturedBody = ""
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (_url: string, opts: RequestInit) => {
      capturedBody = opts.body as string
      return {
        ok: true,
        json: async () => ({
          message: { role: "analyst", content: [{ type: "text", text: "Answer." }] },
          request_id: "test-id",
        }),
      }
    }))
    const { POST } = await import("@/app/api/analyst/route")
    const req = new Request("http://localhost/api/analyst", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: "What's the open invoice count?" }),
    })
    await POST(req as never)
    // The question should arrive with a SINGLE apostrophe, not double-escaped
    expect(capturedBody).toContain("What's the open invoice count?")
    expect(capturedBody).not.toContain("What''s")
  })

  it("returns answer + sql + results on success", async () => {
    const { getSnowflakeBaseUrl, getServiceToken, querySnowflake } = await import("@/lib/snowflake")
    vi.mocked(getSnowflakeBaseUrl).mockReturnValue("https://acct.snowflakecomputing.com")
    vi.mocked(getServiceToken).mockReturnValue("svc-token")
    // SQL execution returns 2 rows
    vi.mocked(querySnowflake).mockResolvedValue([
      { LOB: "Finance", COUNT: 42 },
      { LOB: "Operations", COUNT: 18 },
    ])
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        message: {
          role: "analyst",
          content: [
            { type: "sql", statement: "SELECT line_of_business AS LOB, COUNT(*) AS COUNT FROM document_catalog GROUP BY 1" },
            { type: "text", text: "Finance has 42 invoices, Operations has 18." },
          ],
        },
        request_id: "r1",
        warnings: [],
      }),
    }))
    const { POST } = await import("@/app/api/analyst/route")
    const req = new Request("http://localhost/api/analyst", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: "How many invoices by LOB?" }),
    })
    const res = await POST(req as never)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.answer).toBe("Finance has 42 invoices, Operations has 18.")
    expect(body.sql).toContain("document_catalog")
    expect(body.results).toHaveLength(2)
    expect(body.requestId).toBe("r1")
  })

  it("returns sql even when SQL execution fails (still useful)", async () => {
    const { getSnowflakeBaseUrl, getServiceToken, querySnowflake } = await import("@/lib/snowflake")
    vi.mocked(getSnowflakeBaseUrl).mockReturnValue("https://acct.snowflakecomputing.com")
    vi.mocked(getServiceToken).mockReturnValue("svc-token")
    vi.mocked(querySnowflake).mockRejectedValue(new Error("warehouse suspended"))
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        message: {
          role: "analyst",
          content: [
            { type: "sql", statement: "SELECT COUNT(*) FROM document_catalog" },
            { type: "text", text: "Generated query." },
          ],
        },
      }),
    }))
    const { POST } = await import("@/app/api/analyst/route")
    const req = new Request("http://localhost/api/analyst", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: "How many documents?" }),
    })
    const res = await POST(req as never)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.sql).toBeTruthy()     // SQL present even though execution failed
    expect(body.results).toHaveLength(0)  // empty results on SQL exec failure
  })

  it("uses getRestApiAuthHeader() in local dev (no SPCS service token)", async () => {
    const { getSnowflakeBaseUrl, getServiceToken, getRestApiAuthHeader } = await import("@/lib/snowflake")
    vi.mocked(getSnowflakeBaseUrl).mockReturnValue("https://acct.snowflakecomputing.com")
    vi.mocked(getServiceToken).mockReturnValue("")  // no SPCS token = local dev
    vi.mocked(getRestApiAuthHeader).mockReturnValue("Bearer local-toml-pat-token")
    let capturedAuth = ""
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (_url: string, opts: RequestInit) => {
      capturedAuth = (opts.headers as Record<string, string>)["Authorization"]
      return { ok: true, json: async () => ({ message: { content: [] } }) }
    }))
    const { POST } = await import("@/app/api/analyst/route")
    const req = new Request("http://localhost/api/analyst", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: "Test auth." }),
    })
    await POST(req as never)
    expect(capturedAuth).toBe("Bearer local-toml-pat-token")
    expect(vi.mocked(getRestApiAuthHeader)).toHaveBeenCalledOnce()
  })
})
