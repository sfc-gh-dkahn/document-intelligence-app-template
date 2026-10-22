/**
 * GET /api/documents/history?id=<base64url file_path>
 */
import { querySnowflake } from "@/lib/snowflake"
import { DB } from "@/lib/db"
import { NextRequest } from "next/server"
import { requireUser, escSql, badRequest, serverError } from "@/lib/api-utils"

export const dynamic = "force-dynamic"

function decodeId(id: string): string {
  return Buffer.from(id.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8")
}

export async function GET(req: NextRequest) {
  const denied = await requireUser()
  if (denied) return denied

  const id = req.nextUrl.searchParams.get("id")
  if (!id) return badRequest("id parameter is required")
  const filePath = decodeId(id)

  try {
    const rows = await querySnowflake(`
      SELECT processing_version, ingestion_status, file_format, file_size_bytes,
             processing_started_at, processing_completed_at,
             processing_attempts, last_error, error_stage,
             first_seen_at, last_seen_at
      FROM ${DB}.DATA.ingestion_registry
      WHERE file_path = '${escSql(filePath)}'
      ORDER BY processing_version DESC
    `, { callersRights: true })

    return Response.json({ history: rows })
  } catch (e) {
    return serverError(e)
  }
}
