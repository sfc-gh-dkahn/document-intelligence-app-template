/**
 * Tests for POST /api/agent — Cortex Agent REST API with SSE streaming.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

vi.mock("@/lib/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db")>()),
 DB: "DOC_INTEL", SEARCH_SVC: "doc_search_svc", CORTEX_MODEL: "claude-sonnet-4-5",
}))
vi.mock("@/lib/snowflake", () => ({
  getServiceToken: vi.fn(),
}))
vi.mock("@/lib/api-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-utils")>()
  return { ...actual, requireUser: vi.fn().mockResolvedValue(null) }
})

function makeRequest(body: object, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/agent", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  })
}

/** Helper to build a mock SSE body stream from raw SSE text */
function sseStream(text: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(text))
      controller.close()
    },
  })
}

/** Read all SSE data events from a streaming response */
async function readSSE(res: Response): Promise<string[]> {
  const text = await res.text()
  return text
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => line.slice(6))
}

describe("POST /api/agent", () => {
  const originalEnv = process.env.SNOWFLAKE_HOST

  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    process.env.SNOWFLAKE_HOST = "test-host.snowflakecomputing.app"
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    if (originalEnv !== undefined) {
      process.env.SNOWFLAKE_HOST = originalEnv
    } else {
      delete process.env.SNOWFLAKE_HOST
    }
  })

  it("returns 400 when no question provided", async () => {
    const { getServiceToken } = await import("@/lib/snowflake")
    vi.mocked(getServiceToken).mockReturnValue("test-service-token")

    const { POST } = await import("@/app/api/agent/route")
    const res = await POST(makeRequest(
      { question: "", history: [] },
      { "sf-context-current-user-token": "caller-token" },
    ) as never)

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain("No question")
  })

  it("returns 400 when question exceeds 2000 characters", async () => {
    const { getServiceToken } = await import("@/lib/snowflake")
    vi.mocked(getServiceToken).mockReturnValue("test-service-token")

    const { POST } = await import("@/app/api/agent/route")
    const res = await POST(makeRequest(
      { question: "A".repeat(2001), history: [] },
      { "sf-context-current-user-token": "caller-token" },
    ) as never)

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain("2000")
  })

  it("returns 401 when no caller token", async () => {
    const { getServiceToken } = await import("@/lib/snowflake")
    vi.mocked(getServiceToken).mockReturnValue("test-service-token")

    const { POST } = await import("@/app/api/agent/route")
    const res = await POST(makeRequest(
      { question: "What is Finance?", history: [] },
      // No sf-context-current-user-token header
    ) as never)

    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toContain("caller token")
  })

  it("returns 500 when SNOWFLAKE_HOST not set", async () => {
    delete process.env.SNOWFLAKE_HOST
    const { getServiceToken } = await import("@/lib/snowflake")
    vi.mocked(getServiceToken).mockReturnValue("test-service-token")

    const { POST } = await import("@/app/api/agent/route")
    const res = await POST(makeRequest(
      { question: "What is Finance?", history: [] },
      { "sf-context-current-user-token": "caller-token" },
    ) as never)

    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toContain("SNOWFLAKE_HOST")
  })

  it("returns 500 when no service token available", async () => {
    const { getServiceToken } = await import("@/lib/snowflake")
    vi.mocked(getServiceToken).mockReturnValue("")

    const { POST } = await import("@/app/api/agent/route")
    const res = await POST(makeRequest(
      { question: "What is Finance?", history: [] },
      { "sf-context-current-user-token": "caller-token" },
    ) as never)

    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toContain("service token")
  })

  it("returns 502 when agent REST returns non-200", async () => {
    const { getServiceToken } = await import("@/lib/snowflake")
    vi.mocked(getServiceToken).mockReturnValue("test-service-token")
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => "Service Unavailable",
    }))

    const { POST } = await import("@/app/api/agent/route")
    const res = await POST(makeRequest(
      { question: "What invoices are open?", history: [] },
      { "sf-context-current-user-token": "caller-token" },
    ) as never)

    expect(res.status).toBe(502)
    const body = await res.json()
    expect(body.error).toContain("503")
  })

  it("streams SSE response with text deltas", async () => {
    const { getServiceToken } = await import("@/lib/snowflake")
    vi.mocked(getServiceToken).mockReturnValue("test-service-token")

    const sseText = [
      "event: response.text.delta",
      'data: {"text":"Hello "}',
      "",
      "event: response.text.delta",
      'data: {"text":"world!"}',
      "",
      "data: [DONE]",
      "",
    ].join("\n")

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      body: sseStream(sseText),
    }))

    const { POST } = await import("@/app/api/agent/route")
    const res = await POST(makeRequest(
      { question: "Hello?", history: [] },
      { "sf-context-current-user-token": "caller-token" },
    ) as never)

    expect(res.status).toBe(200)
    expect(res.headers.get("Content-Type")).toBe("text/event-stream")

    const events = await readSSE(res)
    const parsed = events.map((e) => JSON.parse(e))

    // Should have two text deltas and a done event
    const textDeltas = parsed.filter((e) => e.delta && !e.done)
    expect(textDeltas).toHaveLength(2)
    expect(textDeltas[0].delta).toBe("Hello ")
    expect(textDeltas[1].delta).toBe("world!")

    const doneEvent = parsed.find((e) => e.done === true)
    expect(doneEvent).toBeDefined()
  })

  it("sends service token as Bearer and caller token in its own header", async () => {
    const { getServiceToken } = await import("@/lib/snowflake")
    vi.mocked(getServiceToken).mockReturnValue("svc-tok")

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      body: sseStream("event: response.text.delta\ndata: {\"text\":\"hi\"}\n\ndata: [DONE]\n\n"),
    })
    vi.stubGlobal("fetch", mockFetch)

    const { POST } = await import("@/app/api/agent/route")
    await POST(makeRequest(
      { question: "test", history: [] },
      { "sf-context-current-user-token": "caller-tok" },
    ) as never)

    expect(mockFetch).toHaveBeenCalledOnce()
    const [url, opts] = mockFetch.mock.calls[0]
    expect(url).toContain("test-host.snowflakecomputing.app")
    expect(url).toContain("doc_intelligence_agent")
    expect(opts.headers["Authorization"]).toBe("Bearer svc-tok")
    expect(opts.headers["sf-context-current-user-token"]).toBe("caller-tok")
    expect(opts.headers["X-Snowflake-Authorization-Token-Type"]).toBe("OAUTH")
  })

  it("forwards tool_use events as status messages", async () => {
    const { getServiceToken } = await import("@/lib/snowflake")
    vi.mocked(getServiceToken).mockReturnValue("test-service-token")

    const sseText = [
      "event: response.tool_use",
      'data: {"type":"analyst","name":"doc_analytics"}',
      "",
      "event: response.text.delta",
      'data: {"text":"Result"}',
      "",
      "data: [DONE]",
      "",
    ].join("\n")

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      body: sseStream(sseText),
    }))

    const { POST } = await import("@/app/api/agent/route")
    const res = await POST(makeRequest(
      { question: "breakdown by LOB", history: [] },
      { "sf-context-current-user-token": "caller-token" },
    ) as never)

    const events = await readSSE(res)
    const parsed = events.map((e) => JSON.parse(e))

    const statusEvent = parsed.find((e) => e.status)
    expect(statusEvent).toBeDefined()
    expect(statusEvent.status).toContain("Analytics")

    // Subsequent text delta should use updated toolUsed
    const textEvent = parsed.find((e) => e.delta === "Result")
    expect(textEvent?.toolUsed).toBe("Analytics")
  })

  it("returns requireUser denial when not authorized", async () => {
    const { requireUser } = await import("@/lib/api-utils")
    vi.mocked(requireUser).mockResolvedValue(
      Response.json({ error: "Unauthorized" }, { status: 401 })
    )

    const { POST } = await import("@/app/api/agent/route")
    const res = await POST(makeRequest(
      { question: "test", history: [] },
      { "sf-context-current-user-token": "caller-token" },
    ) as never)

    expect(res.status).toBe(401)
  })
})
