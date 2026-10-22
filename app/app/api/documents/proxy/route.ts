/**
 * GET /api/documents/proxy?file_path=...&stage_name=...
 *
 * Proxies document content from a Snowflake stage through the app server.
 * 
 * In SPCS, presigned URLs fail when accessed directly from the browser because
 * the SPCS IAM role doesn't have S3 access. However, GET_PRESIGNED_URL still
 * generates a valid signed URL that can be fetched SERVER-SIDE from within
 * the Snowflake network. This route fetches the content and streams it back.
 *
 * Fallback: If the presigned fetch fails, serves the AI-parsed text as HTML.
 */
import { querySnowflake } from "@/lib/snowflake"
import { DB } from "@/lib/db"
import { NextRequest } from "next/server"
import { requireUser, escSql, badRequest, serverError } from "@/lib/api-utils"
import { getUserEntitlements } from "@/lib/entitlements"
import { logAudit } from "@/lib/audit"

export const dynamic = "force-dynamic"

const MIME_MAP: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  tiff: "image/tiff",
  tif: "image/tiff",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  txt: "text/plain",
  html: "text/html",
}

export async function GET(req: NextRequest) {
  const denied = await requireUser()
  if (denied) return denied

  const filePath = req.nextUrl.searchParams.get("file_path")
  if (!filePath) {
    return badRequest("file_path parameter is required")
  }

  // Enforce canDownload entitlement and LOB access
  const userRows = await querySnowflake(`SELECT CURRENT_USER() AS u`, { callersRights: true })
  const userName = String((userRows[0] as Record<string, unknown>).U ?? (userRows[0] as Record<string, unknown>).u ?? "")
  const entitlements = await getUserEntitlements(userName)

  if (!entitlements.canDownload) {
    return Response.json({ error: "Download permission denied by your role" }, { status: 403 })
  }

  // Verify user has access via the RAP-protected view
  const lobCheck = await querySnowflake(
    `SELECT 1 FROM ${DB}.APP.v_document_catalog
     WHERE file_path = '${escSql(filePath)}'
     LIMIT 1`,
    { callersRights: true }
  )
  if (!lobCheck || lobCheck.length === 0) {
    return Response.json({ error: "Access denied — document not in your permitted lines of business" }, { status: 403 })
  }

  // Resolve stage from registry if not provided
  let stageName = req.nextUrl.searchParams.get("stage_name") || ""
  if (stageName && !stageName.toUpperCase().startsWith(`${DB}.DATA.`)) {
    return badRequest("Invalid stage reference — must be within DOC_INTEL.DATA schema")
  }
  if (!stageName) {
    try {
      const rows = await querySnowflake(
        `SELECT stage_name FROM ${DB}.DATA.ingestion_registry
         WHERE file_path = '${escSql(filePath)}' LIMIT 1`,
        { callersRights: true }
      )
      stageName = String(rows[0]?.STAGE_NAME ?? rows[0]?.stage_name ?? `${DB}.DATA.doc_stage`)
    } catch {
      stageName = `${DB}.DATA.doc_stage`
    }
  }

  const stageRef = stageName.startsWith("@") ? stageName : `@${stageName}`
  const ext = filePath.split(".").pop()?.toLowerCase() ?? ""
  const contentType = MIME_MAP[ext] || "application/octet-stream"

  try {
    // Approach 1: GET_PRESIGNED_URL — fetch server-side (works within Snowflake network)
    const rows = await querySnowflake(
      `SELECT GET_PRESIGNED_URL('${escSql(stageRef)}', '${escSql(filePath)}', 3600) AS url`,
      { callersRights: true }
    )
    const presignedUrl = rows[0]?.url ?? rows[0]?.URL ?? null

    if (presignedUrl) {
      const upstream = await fetch(presignedUrl)
      if (upstream.ok && upstream.body) {
        // Audit trail: log view event (fire-and-forget)
        logAudit({ eventType: "DOCUMENT_VIEW", userName, filePath, stageName: stageRef, status: "SUCCESS" })
        const safeFileName = (filePath.split("/").pop() ?? "document").replace(/[^a-zA-Z0-9._-]/g, "_")
        return new Response(upstream.body, {
          status: 200,
          headers: {
            "Content-Type": contentType,
            "Content-Disposition": `attachment; filename="${safeFileName}"`,
            "Cache-Control": "private, max-age=3600",
            "X-Content-Type-Options": "nosniff",
          },
        })
      }
    }

    // Approach 2: Presigned URL failed — serve parsed text as HTML
    const textRows = await querySnowflake(
      `SELECT raw_content FROM ${DB}.DATA.parsed_documents
       WHERE file_path = '${escSql(filePath)}' 
       ORDER BY processing_version DESC LIMIT 1`,
      { callersRights: true }
    )
    const textContent = textRows[0]?.RAW_CONTENT ?? textRows[0]?.raw_content ?? null

    if (textContent) {
      const safeFileName = (filePath.split("/").pop() ?? "document")
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
      const html = `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<title>${safeFileName}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; 
         max-width: 800px; margin: 40px auto; padding: 0 20px; 
         line-height: 1.6; color: #334155; }
  .banner { background: #FEF3C7; border: 1px solid #F59E0B; border-radius: 8px;
            padding: 12px 16px; margin-bottom: 24px; font-size: 13px; color: #92400E; }
  pre { white-space: pre-wrap; word-wrap: break-word; font-size: 13px; 
        background: #F8FAFC; padding: 20px; border-radius: 8px; border: 1px solid #E2E8F0; }
  h1 { font-size: 16px; color: #1E293B; margin-bottom: 4px; }
  .meta { font-size: 12px; color: #94A3B8; margin-bottom: 16px; }
</style>
</head><body>
<h1>${safeFileName}</h1>
<p class="meta">Extracted text content from pipeline</p>
<div class="banner">The original PDF cannot be displayed inline from this environment. 
This is the extracted text content from the AI parsing pipeline.</div>
<pre>${String(textContent).replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre>
</body></html>`

      return new Response(html, {
        status: 200,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "private, max-age=3600",
        },
      })
    }

    return new Response("File content not available", { status: 404 })
  } catch (e) {
    console.error(new Date().toISOString(), "[documents/proxy] error", e)
    return serverError(e)
  }
}
