import { querySnowflake } from "@/lib/snowflake"
import { DB } from "@/lib/db"
import { NextRequest } from "next/server"
import { requireAdmin, escSql, escLike, clampInt, serverError } from "@/lib/api-utils"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied

  const { searchParams } = new URL(req.url)
  const status  = searchParams.get("status") ?? ""
  const folder  = searchParams.get("folder") ?? ""
  const search  = searchParams.get("search") ?? ""
  const limit   = clampInt(searchParams.get("limit"),  1, 200)
  const offset  = clampInt(searchParams.get("offset"), 0, 100000)

  const where = ["1=1"]
  if (status) where.push(`ingestion_status = '${escSql(status)}'`)
  if (folder) where.push(`source_folder ILIKE '%${escLike(folder)}%'`)
  if (search) where.push(`file_path ILIKE '%${escLike(search)}%'`)
  const whereClause = where.join(" AND ")

  try {
    const [rows, countRows] = await Promise.all([
      // WHERE must come before QUALIFY in Snowflake SQL
      querySnowflake(`
        SELECT r.registry_id, r.file_path, r.file_format, r.source_folder,
               r.ingestion_status, r.processing_version, r.processing_attempts,
               r.first_seen_at, r.processing_completed_at, r.last_error,
               r.src_file_id, r.src_reference_number, r.src_case_number
        FROM ${DB}.DATA.ingestion_registry r
        WHERE ${whereClause}
        QUALIFY ROW_NUMBER() OVER (PARTITION BY r.file_path ORDER BY r.processing_version DESC) = 1
        ORDER BY r.first_seen_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `, { callersRights: true }),
      querySnowflake(`
        SELECT COUNT(*) AS total
        FROM (
          SELECT file_path FROM ${DB}.DATA.ingestion_registry
          WHERE ${whereClause}
          QUALIFY ROW_NUMBER() OVER (PARTITION BY file_path ORDER BY processing_version DESC) = 1
        )
      `, { callersRights: true }),
    ])
    const total = Number((countRows[0] as Record<string, unknown>)?.TOTAL ?? 0)
    return Response.json({ rows, total, limit, offset })
  } catch (e) {
    console.error(new Date().toISOString(), "[registry] error", e)
    return serverError(e)
  }
}
