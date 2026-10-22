import { querySnowflake, getSnowflakeBaseUrl, getRestApiAuthHeader, getServiceToken } from "@/lib/snowflake"
import { DB, SEARCH_SVC, PAGE_SEARCH_SVC, SERVICES_SCHEMA } from "@/lib/db"
import { NextRequest } from "next/server"
import { escSql, clampInt, requireUser, serverError } from "@/lib/api-utils"
import { headers } from "next/headers"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const denied = await requireUser()
  if (denied) return denied
  const { searchParams } = new URL(req.url)
  const query   = searchParams.get("q") ?? ""
  const docType = searchParams.get("docType")
  const lob     = searchParams.get("lob")
  const status  = searchParams.get("status")
  const format  = searchParams.get("format")
  const limit   = clampInt(searchParams.get("limit"), 1, 50)
  const scopeFilePath = searchParams.get("scope") // base64url-encoded file_path for intra-doc search

  if (!query.trim()) return Response.json([])

  // Decode scope (intra-document search)
  let decodedScope: string | null = null
  if (scopeFilePath) {
    try {
      decodedScope = Buffer.from(scopeFilePath.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8")
    } catch { /* ignore invalid scope */ }
  }

  // If scoped to a document, use page-level service with file_path filter
  const svcName = decodedScope ? PAGE_SEARCH_SVC : SEARCH_SVC

  const searchLimit = limit

  // Build filter object for Cortex Search
  const conditions: object[] = []
  if (format)       conditions.push({ "@eq": { file_format: format } })
  if (decodedScope) conditions.push({ "@eq": { file_path: decodedScope } })

  const filter = conditions.length === 0 ? undefined
                 : conditions.length === 1 ? conditions[0]
                 : { "@and": conditions }

  try {
    // Use Cortex Search REST API directly (SEARCH_PREVIEW SQL function not available in all regions)
    const baseUrl = getSnowflakeBaseUrl()
    if (!baseUrl) {
      return Response.json({ error: "Snowflake base URL not configured" }, { status: 503 })
    }

    const searchPayload = {
      query,
      columns: decodedScope
        ? ["file_path", "page_content", "page_index", "src_reference_number", "src_case_number"]
        : ["file_path", "doc_summary", "document_type", "party_name", "line_of_business",
           "src_reference_number", "src_case_number", "source_folder", "file_format", "src_file_id"],
      ...(filter ? { filter } : {}),
      limit: searchLimit,
    }

    const searchUrl = `${baseUrl}/api/v2/databases/${DB}/schemas/${SERVICES_SCHEMA}/cortex-search-services/${svcName}:query`

    // Auth: use service token with caller token as separate header (same as agent route)
    const serviceToken = getServiceToken()
    let authHeader: string
    const callerToken = serviceToken ? ((await headers()).get("sf-context-current-user-token") ?? "") : ""
    if (serviceToken) {
      authHeader = `Bearer ${serviceToken}`
    } else {
      authHeader = getRestApiAuthHeader()
    }

    const searchRes = await fetch(searchUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": authHeader,
        "X-Snowflake-Authorization-Token-Type": "OAUTH",
        ...(callerToken ? { "sf-context-current-user-token": callerToken } : {}),
      },
      body: JSON.stringify(searchPayload),
    })

    if (!searchRes.ok) {
      const errBody = await searchRes.text().catch(() => "")
      console.error("[search] Cortex Search API error:", searchRes.status, errBody.slice(0, 300))
      return Response.json({ error: `Search service returned ${searchRes.status}` }, { status: 502 })
    }

    const searchJson = await searchRes.json()
    const searchResults = searchJson.results ?? []
    if (!Array.isArray(searchResults) || searchResults.length === 0) {
      return Response.json([])
    }

    // Deduplicate by file_path (search returns page-level hits)
    const fileMap = new Map<string, { hit: Record<string, unknown>; snippets: { text: string; page: number | null; rank: number }[] }>()
    let hitRank = 0
    for (const hit of searchResults as Record<string, unknown>[]) {
      const fp = String(hit.file_path ?? hit.FILE_PATH ?? "")
      if (!fp) continue
      const isScopedSearch = !!decodedScope
      const maxSnippetLen = isScopedSearch ? 2000 : 300
      const content = String(hit.page_content ?? hit.PAGE_CONTENT ?? hit.doc_summary ?? hit.DOC_SUMMARY ?? "").slice(0, maxSnippetLen)
      const pageIdx = hit.page_index ?? hit.PAGE_INDEX ?? null
      const entry = { text: content, page: typeof pageIdx === "number" ? pageIdx : null, rank: hitRank++ }
      if (fileMap.has(fp)) {
        fileMap.get(fp)!.snippets.push(entry)
      } else {
        fileMap.set(fp, { hit, snippets: [entry] })
      }
    }

    // Enrich with document_catalog metadata (RAP enforces LOB/docType filtering)
    const filePaths = [...fileMap.keys()]
    const inClause = filePaths.map(fp => `'${escSql(fp)}'`).join(",")

    let catalogMap: Record<string, Record<string, unknown>> = {}
    if (filePaths.length > 0) {
      const catalogRows = await querySnowflake(
        `SELECT file_path, document_type, party_name, issuer_name,
                line_of_business, doc_subtype, doc_status, doc_summary,
                source_folder, reference_number, case_number, src_reference_number, src_case_number, src_file_id,
                start_date, end_date, primary_amount,
                total_amount, classification_confidence, file_format
         FROM ${DB}.APP.v_document_catalog
         WHERE file_path IN (${inClause})`,
        { callersRights: true }
      ) as Record<string, unknown>[]

      for (const row of catalogRows) {
        const fp = String(row.FILE_PATH ?? row.file_path ?? "")
        catalogMap[fp] = row
      }
    }

    // Build enriched results — only include files the user is entitled to see
    const enriched = filePaths
      .filter(fp => catalogMap[fp]) // Only files that passed entitlements filter
      .map(fp => {
        const { hit, snippets } = fileMap.get(fp)!
        const catalog = catalogMap[fp] ?? {}
        return {
          file_path: fp,
          document_type: catalog.DOCUMENT_TYPE ?? catalog.document_type ?? null,
          party_name: catalog.PARTY_NAME ?? catalog.party_name ?? null,
          issuer_name: catalog.ISSUER_NAME ?? catalog.issuer_name ?? null,
          line_of_business: catalog.LINE_OF_BUSINESS ?? catalog.line_of_business ?? null,
          doc_subtype: catalog.DOC_SUBTYPE ?? catalog.doc_subtype ?? null,
          doc_status: catalog.DOC_STATUS ?? catalog.doc_status ?? null,
          doc_summary: catalog.DOC_SUMMARY ?? catalog.doc_summary ?? null,
          reference_number: catalog.REFERENCE_NUMBER ?? catalog.reference_number ?? null,
          case_number: catalog.CASE_NUMBER ?? catalog.case_number ?? null,
          src_reference_number: catalog.SRC_REFERENCE_NUMBER ?? catalog.src_reference_number ?? hit.src_reference_number ?? null,
          src_case_number: catalog.SRC_CASE_NUMBER ?? catalog.src_case_number ?? hit.src_case_number ?? null,
          src_file_id: catalog.SRC_FILE_ID ?? catalog.src_file_id ?? hit.src_file_id ?? null,
          start_date: catalog.START_DATE ?? catalog.start_date ?? null,
          end_date: catalog.END_DATE ?? catalog.end_date ?? null,
          primary_amount: catalog.PRIMARY_AMOUNT ?? catalog.primary_amount ?? null,
          total_amount: catalog.TOTAL_AMOUNT ?? catalog.total_amount ?? null,
          classification_confidence: catalog.CLASSIFICATION_CONFIDENCE ?? catalog.classification_confidence ?? null,
          file_format: catalog.FILE_FORMAT ?? catalog.file_format ?? hit.file_format ?? null,
          match_snippets: snippets.slice(0, 10).map(s => s.text),
          match_pages: snippets.slice(0, 10).map(s => s.page),
          match_scores: snippets.slice(0, 10).map(s => hitRank > 0 ? Math.round((1 - s.rank / hitRank) * 100) / 100 : 1),
          match_page: snippets[0]?.page ?? null,
          match_count: snippets.length,
        }
      })

    // Apply post-search UI filters on catalog fields
    let filtered = enriched
    if (docType) filtered = filtered.filter(r => r.document_type && String(r.document_type).toLowerCase().includes(docType.toLowerCase()))
    if (lob) filtered = filtered.filter(r => r.line_of_business && String(r.line_of_business).toLowerCase().includes(lob.toLowerCase()))
    if (status) filtered = filtered.filter(r => r.doc_status === status)

    return Response.json(filtered.slice(0, limit))
  } catch (e) {
    console.error(new Date().toISOString(), "[search] error", e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200))
    return serverError(e)
  }
}
