/**
 * Tests for admin API routes: config, pipeline, tasks, users, registry.
 * These routes all require DOC_INTEL_ADMIN (requireAdmin mock passes through).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { querySnowflake as querySnowflakeMock } from "@/lib/snowflake"

vi.mock("@/lib/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db")>()),
 DB: "DOC_INTEL", SEARCH_SVC: "doc_search_svc", CORTEX_MODEL: "claude-sonnet-4-5",
}))
vi.mock("@/lib/snowflake", () => ({ querySnowflake: vi.fn() }))
vi.mock("@/lib/api-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-utils")>()
  return { ...actual, requireAdmin: vi.fn().mockResolvedValue(null), requireUser: vi.fn().mockResolvedValue(null) }
})

// clearAllMocks keeps queued mock*Once values; reset so they never leak between tests
beforeEach(() => { vi.mocked(querySnowflakeMock).mockReset() })

// ===== /api/config =====
describe("GET /api/config", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.resetModules() })

  it("returns config rows array", async () => {
    const { querySnowflake } = await import("@/lib/snowflake")
    vi.mocked(querySnowflake).mockResolvedValue([
      { CONFIG_KEY: "max_file_size_mb", CONFIG_VALUE: "50", CONFIG_TYPE: "number" },
    ])
    const { GET } = await import("@/app/api/config/route")
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body)).toBe(true)
    expect(body[0].CONFIG_KEY).toBe("max_file_size_mb")
  })

  it("returns 500 on error", async () => {
    const { querySnowflake } = await import("@/lib/snowflake")
    vi.mocked(querySnowflake).mockRejectedValue(new Error("db error"))
    const { GET } = await import("@/app/api/config/route")
    const res = await GET()
    expect(res.status).toBe(500)
  })
})

describe("PUT /api/config", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.resetModules() })

  it("returns 400 when key is missing", async () => {
    const { PUT } = await import("@/app/api/config/route")
    const req = new Request("http://localhost/api/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: "50" }),
    })
    const res = await PUT(req as never)
    expect(res.status).toBe(400)
  })

  it("returns ok:true on valid update", async () => {
    const { querySnowflake } = await import("@/lib/snowflake")
    vi.mocked(querySnowflake).mockResolvedValue([])
    const { PUT } = await import("@/app/api/config/route")
    const req = new Request("http://localhost/api/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "max_file_size_mb", value: "100" }),
    })
    const res = await PUT(req as never)
    expect(res.status).toBe(200)
    expect((await res.json()).ok).toBe(true)
  })

  it("escapes single quotes in key and value", async () => {
    const { querySnowflake } = await import("@/lib/snowflake")
    vi.mocked(querySnowflake).mockResolvedValue([])
    const { PUT } = await import("@/app/api/config/route")
    const req = new Request("http://localhost/api/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "owner's_key", value: "O'Reilly' OR '1'='1" }),
    })
    const res = await PUT(req as never)
    expect(res.status).toBe(200)
    const [sql] = vi.mocked(querySnowflake).mock.calls[0]
    expect(sql).toContain("config_value = 'O''Reilly'' OR ''1''=''1'")
    expect(sql).toContain("config_key = 'owner''s_key'")
  })

  it("rejects values containing semicolons without running SQL (injection prevention)", async () => {
    const { querySnowflake } = await import("@/lib/snowflake")
    vi.mocked(querySnowflake).mockResolvedValue([])
    const { PUT } = await import("@/app/api/config/route")
    const req = new Request("http://localhost/api/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "test_key", value: "O'Reilly; DROP TABLE --" }),
    })
    const res = await PUT(req as never)
    // escSql throws on ';' and the route maps that to serverError
    expect(res.status).toBe(500)
    expect(querySnowflake).not.toHaveBeenCalled()
  })
})

// ===== /api/pipeline =====
describe("GET /api/pipeline", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.resetModules() })

  it("returns health object with queue counts", async () => {
    const { querySnowflake } = await import("@/lib/snowflake")
    vi.mocked(querySnowflake).mockResolvedValue([{
      PENDING_COUNT: 3, PROCESSING_COUNT: 1, COMPLETE_COUNT: 100,
      FAILED_COUNT: 0, ABANDONED_COUNT: 0, SKIPPED_COUNT: 2, TOTAL_REGISTERED: 106
    }])
    const { GET } = await import("@/app/api/pipeline/route")
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.PENDING_COUNT ?? body.pending_count).toBeDefined()
  })

  it("returns 500 on error", async () => {
    const { querySnowflake } = await import("@/lib/snowflake")
    vi.mocked(querySnowflake).mockRejectedValue(new Error("timeout"))
    const { GET } = await import("@/app/api/pipeline/route")
    const res = await GET()
    expect(res.status).toBe(500)
  })
})

// ===== /api/tasks =====
describe("GET /api/tasks", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.resetModules() })

  it("returns tasks and recentRuns arrays even when SHOW TASKS fails", async () => {
    const { querySnowflake } = await import("@/lib/snowflake")
    // SHOW TASKS requires specific privilege — test graceful fallback to empty
    // Route skips TASK_HISTORY when SHOW TASKS returns nothing, so only one call happens
    vi.mocked(querySnowflake)
      .mockRejectedValueOnce(new Error("SHOW TASKS not permitted"))  // tasks
    const { GET } = await import("@/app/api/tasks/route")
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.tasks)).toBe(true)
    expect(Array.isArray(body.recentRuns)).toBe(true)
    expect(body.tasks).toHaveLength(0)   // graceful fallback
    expect(body.tasksExist).toBe(false)
    expect(body.error).toContain("not permitted")
    expect(querySnowflake).toHaveBeenCalledOnce()
  })

  it("returns populated tasks when SHOW TASKS succeeds", async () => {
    const { querySnowflake } = await import("@/lib/snowflake")
    vi.mocked(querySnowflake)
      .mockResolvedValueOnce([{ NAME: "task_01_register_files", STATE: "started" }])
      .mockResolvedValueOnce([{ TASK_NAME: "task_01_register_files", STATE: "SUCCEEDED" }])
    const { GET } = await import("@/app/api/tasks/route")
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.tasks).toHaveLength(1)
    expect(body.recentRuns).toHaveLength(1)
    expect(body.tasksExist).toBe(true)
    expect(body.error).toBeNull()
  })
})

// ===== /api/users =====
describe("GET /api/users", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.resetModules() })

  it("returns activity and roleSummary arrays", async () => {
    const { querySnowflake } = await import("@/lib/snowflake")
    vi.mocked(querySnowflake)
      .mockResolvedValueOnce([{
        USER_NAME: "alice@corp.com", TOTAL_QUERIES: 42, LAST_ACTIVE: "2025-01-01",
        SEARCH_COUNT: 30, ANALYTICS_COUNT: 12
      }])
      .mockResolvedValueOnce([{ GRANTED_TO: "USER", GRANTEE_NAME: "alice@corp.com" }])
      .mockResolvedValueOnce([])
    const { GET } = await import("@/app/api/users/route")
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.activity)).toBe(true)
    expect(Array.isArray(body.roleSummary)).toBe(true)
    expect(body.activity[0].USER_NAME ?? body.activity[0].user_name).toBe("alice@corp.com")
    expect(body.roleSummary).toEqual([{ role_name: "DOC_INTEL_ADMIN", users: ["alice@corp.com"] }])
  })

  it("returns empty roleSummary when SHOW GRANTS fails", async () => {
    const { querySnowflake } = await import("@/lib/snowflake")
    vi.mocked(querySnowflake)
      .mockResolvedValueOnce([{ USER_NAME: "bob", TOTAL_QUERIES: 1 }])
      .mockRejectedValueOnce(new Error("insufficient privileges"))
      .mockRejectedValueOnce(new Error("insufficient privileges"))
    const { GET } = await import("@/app/api/users/route")
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.roleSummary).toHaveLength(0)  // graceful: .catch(() => [])
  })
})

// ===== /api/registry =====
describe("GET /api/registry", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.resetModules() })

  it("returns rows, total, limit, offset", async () => {
    const { querySnowflake } = await import("@/lib/snowflake")
    vi.mocked(querySnowflake)
      .mockResolvedValueOnce([{ REGISTRY_ID: "1", FILE_PATH: "documents/a.pdf" }])
      .mockResolvedValueOnce([{ TOTAL: 1 }])
    const { GET } = await import("@/app/api/registry/route")
    const req = new Request("http://localhost/api/registry?limit=50&offset=0")
    const res = await GET(req as never)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.rows).toHaveLength(1)
    expect(body.total).toBe(1)
    expect(body.limit).toBe(50)
    expect(body.offset).toBe(0)
  })

  it("clamps limit to 200 max", async () => {
    const { querySnowflake } = await import("@/lib/snowflake")
    vi.mocked(querySnowflake).mockResolvedValue([])
    const { GET } = await import("@/app/api/registry/route")
    const req = new Request("http://localhost/api/registry?limit=9999")
    const res = await GET(req as never)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.limit).toBe(200)
  })

  it("applies status and folder filters with SQL escaping", async () => {
    const { querySnowflake } = await import("@/lib/snowflake")
    vi.mocked(querySnowflake).mockResolvedValue([])
    const { GET } = await import("@/app/api/registry/route")
    const req = new Request("http://localhost/api/registry?status=COMPLETE&folder=Finance")
    await GET(req as never)
    const [sql] = vi.mocked(querySnowflake).mock.calls[0]
    expect(sql).toContain("COMPLETE")
    expect(sql).toContain("Finance")
    expect(sql).not.toContain("9999") // limit not exceeded
  })

  it("returns 500 on Snowflake error", async () => {
    const { querySnowflake } = await import("@/lib/snowflake")
    vi.mocked(querySnowflake).mockRejectedValue(new Error("query failed"))
    const { GET } = await import("@/app/api/registry/route")
    const req = new Request("http://localhost/api/registry")
    const res = await GET(req as never)
    expect(res.status).toBe(500)
  })
})
