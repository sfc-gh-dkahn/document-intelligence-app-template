import { querySnowflake } from "@/lib/snowflake"
import { DB } from "@/lib/db"
import { escSql } from "@/lib/api-utils"

/**
 * Fire-and-forget audit event into pipeline_events.
 * Never throws — failures are silently swallowed.
 */
export function logAudit(opts: {
  eventType: string
  userName?: string
  filePath?: string
  stageName?: string
  status?: string
  metadata?: Record<string, unknown>
}) {
  const cols = ["event_type"]
  const vals = [`'${escSql(opts.eventType)}'`]

  if (opts.userName) { cols.push("user_name"); vals.push(`'${escSql(opts.userName)}'`) }
  if (opts.filePath) { cols.push("file_path"); vals.push(`'${escSql(opts.filePath)}'`) }
  if (opts.stageName) { cols.push("stage_name"); vals.push(`'${escSql(opts.stageName)}'`) }
  if (opts.status) { cols.push("status"); vals.push(`'${escSql(opts.status)}'`) }
  if (opts.metadata) {
    cols.push("metadata")
    vals.push(`PARSE_JSON('${escSql(JSON.stringify(opts.metadata))}')`)
  }

  querySnowflake(
    `INSERT INTO ${DB}.TELEMETRY.pipeline_events (${cols.join(", ")}) VALUES (${vals.join(", ")})`
  ).catch(() => {})
}
