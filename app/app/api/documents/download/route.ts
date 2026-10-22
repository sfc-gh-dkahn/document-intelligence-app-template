/**
 * GET /api/documents/download?file_path=...&stage_name=...
 *
 * Generates a presigned URL for a document file stored on a Snowflake stage.
 * The URL is valid for 1 hour and allows direct browser download/viewing.
 *
 * Supports multiple stages: if stage_name is not provided as a query param,
 * the route looks up the stage from the ingestion_registry for that file_path.
 * Falls back to doc_stage only if no registry record exists.
 */
import { querySnowflake } from "@/lib/snowflake"
import { DB } from "@/lib/db"
import { NextRequest } from "next/server"
import { requireUser, escSql, badRequest, serverError } from "@/lib/api-utils"
import { getUserEntitlements } from "@/lib/entitlements"
import { logAudit } from "@/lib/audit"

export const dynamic = "force-dynamic"

const FALLBACK_STAGE = `${DB}.DATA.doc_stage`

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

  // Verify user has access to this document (RAP enforces LOB/docType filtering)
  const lobCheck = await querySnowflake(
    `SELECT 1 FROM ${DB}.APP.v_document_catalog
     WHERE file_path = '${escSql(filePath)}'
     LIMIT 1`,
    { callersRights: true }
  )
  if (!lobCheck || lobCheck.length === 0) {
    return Response.json({ error: "Access denied — document not in your permitted lines of business" }, { status: 403 })
  }

  // Use explicitly provided stage, or look up from registry
  let stageName = req.nextUrl.searchParams.get("stage_name") || ""

  if (!stageName) {
    // Look up the stage from ingestion_registry for this file
    try {
      const rows = await querySnowflake(
        `SELECT stage_name FROM ${DB}.DATA.ingestion_registry
         WHERE file_path = '${escSql(filePath)}' LIMIT 1`,
        { callersRights: true }
      )
      stageName = String(rows[0]?.STAGE_NAME ?? rows[0]?.stage_name ?? FALLBACK_STAGE)
    } catch {
      stageName = FALLBACK_STAGE
    }
  }

  // Normalize: ensure stage reference starts with @
  const stageRef = stageName.startsWith("@") ? stageName : `@${stageName}`

  try {
    const rows = await querySnowflake(
      `SELECT GET_PRESIGNED_URL('${escSql(stageRef)}', '${escSql(filePath)}', 3600) AS url`,
      { callersRights: true }
    )

    const url = rows[0]?.url ?? rows[0]?.URL ?? null
    if (!url) {
      return Response.json(
        { error: "Could not generate download URL — file may not exist on stage" },
        { status: 404 }
      )
    }

    // Audit trail: log download event (fire-and-forget)
    logAudit({ eventType: "DOCUMENT_DOWNLOAD", userName, filePath, stageName: stageRef, status: "SUCCESS" })

    return Response.json({ url, file_path: filePath, stage_name: stageRef })
  } catch (e) {
    console.error(new Date().toISOString(), "[documents/download] error", e)
    const msg = e instanceof Error ? e.message : ""
    if (msg.includes("does not exist") || msg.includes("not found")) {
      return Response.json(
        { error: "File not found on stage", detail: msg.slice(0, 200) },
        { status: 404 }
      )
    }
    return serverError(e)
  }
}
