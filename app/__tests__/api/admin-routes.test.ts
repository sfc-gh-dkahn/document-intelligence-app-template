import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db")>()),
 DB: "DOC_INTEL",
}))
vi.mock("@/lib/snowflake", () => ({ querySnowflake: vi.fn() }))
vi.mock("@/lib/api-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-utils")>()
  return { ...actual, requireAdmin: vi.fn().mockResolvedValue(null) }
})

describe("GET /api/cost", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.resetModules() })

  it("returns byFolder, byStage, history, and 30-day KPI fields", async () => {
    const { querySnowflake } = await import("@/lib/snowflake")
    // Route destructures as: [byFolder (by stage_name), byStage (by event_type), summary, history]
    vi.mocked(querySnowflake)
      .mockResolvedValueOnce([{ NAME: "PARSE",   VALUE: 1.5 }])
      .mockResolvedValueOnce([{ NAME: "EXTRACT", VALUE: 0.3 }])
      .mockResolvedValueOnce([{ TOTAL_30D: 5.2, AVG_DAILY: 0.17, PROJECTED_MONTHLY: 5.2 }])
      .mockResolvedValueOnce([{ DATE: "2026-10-01", CREDITS: 0.4 }])
    const { GET } = await import("@/app/api/cost/route")
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.byFolder).toEqual([{ name: "PARSE", value: 1.5 }])
    expect(body.byStage).toEqual([{ name: "EXTRACT", value: 0.3 }])
    expect(body.history).toEqual([{ date: "2026-10-01", credits: 0.4 }])
    expect(body.total30d).toBe(5.2)
    expect(body.avgDaily).toBe(0.17)
    expect(body.projectedMonthly).toBe(5.2)
  })

  it("falls back to empty arrays when the optional queries fail", async () => {
    const { querySnowflake } = await import("@/lib/snowflake")
    vi.mocked(querySnowflake)
      .mockResolvedValueOnce([{ NAME: "PARSE", VALUE: 1.5 }])
      .mockRejectedValueOnce(new Error("no event_type"))
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error("no history"))
    const { GET } = await import("@/app/api/cost/route")
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.byStage).toEqual([])
    expect(body.history).toEqual([])
    expect(body.total30d).toBe(0)
  })

  it("returns 500 on Snowflake error", async () => {
    const { querySnowflake } = await import("@/lib/snowflake")
    vi.mocked(querySnowflake).mockRejectedValue(new Error("access denied"))
    const { GET } = await import("@/app/api/cost/route")
    const res = await GET()
    expect(res.status).toBe(500)
  })
})

describe("GET /api/quality", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.resetModules() })

  it("returns metrics, corrections, feedback, and accuracy arrays", async () => {
    const { querySnowflake } = await import("@/lib/snowflake")
    // Route destructures as: [metrics, corrections, feedback, fieldAccuracy, lobAccuracy]
    vi.mocked(querySnowflake)
      .mockResolvedValueOnce([{ AVG_CONFIDENCE: 0.91, LOW_CONF_PCT: 5, LOW_CONF_COUNT: 3, TOTAL_DOCS: 60, DOC_TYPE_COUNT: 4 }])
      .mockResolvedValueOnce([{ OVERRIDE_ID: "1", FILE_PATH: "docs/a.pdf", FIELD_NAME: "doc_status" }])
      .mockResolvedValueOnce([{ FEEDBACK_ID: "1", FEEDBACK_TYPE: "thumbs_up" }])
      .mockResolvedValueOnce([{ FIELD_NAME: "doc_status", CORRECTION_COUNT: 2, APPROVED_COUNT: 1 }])
      .mockResolvedValueOnce([{ LOB: "Operations", DOC_TYPE: "Invoice", DOC_COUNT: 10, AVG_CONFIDENCE: 0.9 }])
    const { GET } = await import("@/app/api/quality/route")
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.avgConfidence).toBeCloseTo(0.91)
    expect(body.lowConfPct).toBe(5)
    expect(body.lowConfCount).toBe(3)
    expect(body.docCount).toBe(60)
    expect(body.docTypeCount).toBe(4)
    expect(body.corrections).toHaveLength(1)
    expect(body.feedback).toHaveLength(1)
    expect(body.fieldAccuracy[0].FIELD_NAME).toBe("doc_status")
    expect(body.lobAccuracy[0].LOB).toBe("Operations")
  })

  it("returns 500 on error", async () => {
    const { querySnowflake } = await import("@/lib/snowflake")
    vi.mocked(querySnowflake).mockRejectedValue(new Error("timeout"))
    const { GET } = await import("@/app/api/quality/route")
    const res = await GET()
    expect(res.status).toBe(500)
  })
})
