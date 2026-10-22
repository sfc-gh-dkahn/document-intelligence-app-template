import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

vi.mock("@/lib/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db")>()),
  DB: "DOC_INTEL",
}))
vi.mock("@/lib/snowflake", () => ({
  querySnowflake: vi.fn(),
  getSnowflakeBaseUrl: vi.fn(),
  getRestApiAuthHeader: vi.fn(),
  getServiceToken: vi.fn(),
}))
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers({ "sf-context-current-user-token": "caller-tok" })),
}))
vi.mock("@/lib/api-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-utils")>()
  return { ...actual, requireUser: vi.fn().mockResolvedValue(null) }
})

/** Stub the Cortex Search REST response. */
function stubSearch(results: Record<string, unknown>[], ok = true, status = 200) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok,
    status,
    json: async () => ({ results }),
    text: async () => "error body",
  })
  vi.stubGlobal("fetch", fetchMock)
  return fetchMock
}

async function setSnowflakeMocks(serviceToken = "") {
  const sf = await import("@/lib/snowflake")
  vi.mocked(sf.getSnowflakeBaseUrl).mockReturnValue("https://myorg-my_account.snowflakecomputing.com")
  vi.mocked(sf.getRestApiAuthHeader).mockReturnValue("Snowflake Token=\"local-tok\"")
  vi.mocked(sf.getServiceToken).mockReturnValue(serviceToken)
  return sf
}

describe("GET /api/search", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.resetModules() })
  afterEach(() => { vi.unstubAllGlobals() })

  it("returns empty array when query is blank", async () => {
    const { GET } = await import("@/app/api/search/route")
    const req = new Request("http://localhost/api/search?q=")
    const res = await GET(req as never)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([])
  })

  it("returns 503 when Snowflake base URL is not configured", async () => {
    const sf = await setSnowflakeMocks()
    vi.mocked(sf.getSnowflakeBaseUrl).mockReturnValue("")
    const { GET } = await import("@/app/api/search/route")
    const res = await GET(new Request("http://localhost/api/search?q=test") as never)
    expect(res.status).toBe(503)
  })

  it("posts a Cortex Search payload with format filter and enriches from the catalog", async () => {
    const { querySnowflake } = await setSnowflakeMocks()
    const fetchMock = stubSearch([
      { file_path: "finance/inv-001.pdf", doc_summary: "Vendor invoice for May", page_index: 0 },
      { file_path: "finance/inv-001.pdf", doc_summary: "Line items", page_index: 1 },
      { file_path: "finance/hidden.pdf", doc_summary: "Not entitled" },
    ])
    vi.mocked(querySnowflake).mockResolvedValue([
      { FILE_PATH: "finance/inv-001.pdf", DOCUMENT_TYPE: "Invoice", FILE_FORMAT: "pdf" },
    ])

    const { GET } = await import("@/app/api/search/route")
    const req = new Request("http://localhost/api/search?q=vendor+invoice&format=pdf&limit=5")
    const res = await GET(req as never)
    expect(res.status).toBe(200)

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toBe(
      "https://myorg-my_account.snowflakecomputing.com/api/v2/databases/DOC_INTEL/schemas/SERVICES/cortex-search-services/doc_search_svc:query"
    )
    const payload = JSON.parse(opts.body)
    expect(payload.query).toBe("vendor invoice")
    expect(payload.limit).toBe(5)
    expect(payload.filter).toEqual({ "@eq": { file_format: "pdf" } })
    // No service token -> local REST auth header, no caller token forwarded
    expect(opts.headers["Authorization"]).toBe("Snowflake Token=\"local-tok\"")
    expect(opts.headers["sf-context-current-user-token"]).toBeUndefined()

    // Catalog enrichment runs with caller's rights over both distinct paths
    expect(querySnowflake).toHaveBeenCalledOnce()
    const [sql, sqlOpts] = vi.mocked(querySnowflake).mock.calls[0]
    expect(sql).toContain("v_document_catalog")
    expect(sql).toContain("'finance/inv-001.pdf'")
    expect(sql).toContain("'finance/hidden.pdf'")
    expect(sqlOpts).toEqual({ callersRights: true })

    // Only entitled files come back, deduplicated with all snippets
    const data = await res.json()
    expect(data).toHaveLength(1)
    expect(data[0].file_path).toBe("finance/inv-001.pdf")
    expect(data[0].document_type).toBe("Invoice")
    expect(data[0].match_count).toBe(2)
    expect(data[0].match_pages).toEqual([0, 1])
  })

  it("uses the service token and forwards the caller token when running in SPCS", async () => {
    await setSnowflakeMocks("svc-tok")
    const fetchMock = stubSearch([])
    const { GET } = await import("@/app/api/search/route")
    const res = await GET(new Request("http://localhost/api/search?q=test") as never)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([])
    const [, opts] = fetchMock.mock.calls[0]
    expect(opts.headers["Authorization"]).toBe("Bearer svc-tok")
    expect(opts.headers["sf-context-current-user-token"]).toBe("caller-tok")
  })

  it("clamps limit to 50 max", async () => {
    await setSnowflakeMocks()
    const fetchMock = stubSearch([])
    const { GET } = await import("@/app/api/search/route")
    await GET(new Request("http://localhost/api/search?q=test&limit=9999") as never)
    const payload = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(payload.limit).toBe(50)
  })

  it("returns 502 when the search service returns non-200", async () => {
    await setSnowflakeMocks()
    stubSearch([], false, 429)
    const { GET } = await import("@/app/api/search/route")
    const res = await GET(new Request("http://localhost/api/search?q=test") as never)
    expect(res.status).toBe(502)
    expect((await res.json()).error).toContain("429")
  })

  it("returns 500 without leaking the error when catalog lookup throws", async () => {
    const { querySnowflake } = await setSnowflakeMocks()
    stubSearch([{ file_path: "finance/inv-001.pdf", doc_summary: "x" }])
    vi.mocked(querySnowflake).mockRejectedValue(new Error("network timeout"))
    const { GET } = await import("@/app/api/search/route")
    const res = await GET(new Request("http://localhost/api/search?q=test") as never)
    expect(res.status).toBe(500)
    const body = await res.json()
    // serverError only exposes the message in development
    expect(body.error).toBe("Internal server error")
  })
})
