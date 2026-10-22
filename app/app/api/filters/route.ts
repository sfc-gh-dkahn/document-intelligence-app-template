import { querySnowflake } from "@/lib/snowflake"
import { DB } from "@/lib/db"
import { requireUser, decodeHtmlEntities } from "@/lib/api-utils"

export const dynamic = "force-dynamic"

/**
 * Returns dynamic filter option lists populated from actual data in the
 * document_catalog table.
 *
 * Used by Search, Document Browser, and Analytics to populate dropdowns
 * with real values rather than hardcoded static lists.
 *
 * Results are derived from the data the caller is authorized to see
 * (caller's rights + row-level security apply).
 */
export async function GET() {
  const denied = await requireUser()
  if (denied) return denied
  try {
    const [lobs, docTypes, statuses, formats, featureFlags] = await Promise.all([
      // Lines of business the user can actually see (RAP filters to their access)
      querySnowflake(`
        SELECT DISTINCT line_of_business AS value
        FROM ${DB}.APP.v_document_catalog
        WHERE line_of_business IS NOT NULL
        ORDER BY 1
      `, { callersRights: true }),

      // Document types the user can actually see (RAP filters to their access)
      querySnowflake(`
        SELECT DISTINCT document_type AS value
        FROM ${DB}.APP.v_document_catalog
        WHERE document_type IS NOT NULL
        ORDER BY 1
      `, { callersRights: true }),

      // Distinct doc statuses
      querySnowflake(`
        SELECT DISTINCT doc_status AS value
        FROM ${DB}.APP.v_document_catalog
        WHERE doc_status IS NOT NULL
        ORDER BY 1
        LIMIT 30
      `, { callersRights: true }),

      // Distinct file formats
      querySnowflake(`
        SELECT DISTINCT UPPER(file_format) AS value
        FROM ${DB}.APP.v_document_catalog
        WHERE file_format IS NOT NULL
        ORDER BY 1
        LIMIT 20
      `, { callersRights: true }),

      // Feature flags from system_config
      querySnowflake(`
        SELECT config_key, config_value
        FROM ${DB}.ADMIN.system_config
        WHERE config_type = 'BOOLEAN'
      `, { callersRights: true }),
    ])

    const extract = (rows: Record<string, unknown>[], col = "value") =>
      rows.map(r => decodeHtmlEntities(String(r[col.toUpperCase()] ?? r[col] ?? ""))).filter(Boolean)

    // Deduplicate after decoding (e.g. "Directors &amp; Officers" and "Directors & Officers" merge)
    const unique = (arr: string[]) => [...new Set(arr)].sort()

    // Build feature flag map
    const flags: Record<string, boolean> = {}
    for (const row of featureFlags) {
      const r = row as Record<string, string>
      const key   = String(r.CONFIG_KEY   ?? r.config_key   ?? "")
      const value = String(r.CONFIG_VALUE ?? r.config_value ?? "false")
      if (key) flags[key] = value === "true"
    }

    return Response.json({
      lobs:      unique(extract(lobs)),
      docTypes:  unique(extract(docTypes)),
      statuses:  extract(statuses),
      formats:   extract(formats),
      featureFlags: flags,
    })
  } catch (e) {
    console.error(new Date().toISOString(), "[filters] error", e)
    return Response.json({
      lobs: [], docTypes: [], statuses: [], formats: [], featureFlags: {},
      _warning: "Failed to load filters from database",
    })
  }
}
