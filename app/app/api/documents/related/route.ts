/**
 * GET /api/documents/related?id=<base64url file_path>
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
    const docRows = await querySnowflake(`
      SELECT party_name, reference_number, case_number
      FROM ${DB}.APP.v_document_catalog
      WHERE file_path = '${escSql(filePath)}'
      LIMIT 1
    `, { callersRights: true })

    if (!docRows || docRows.length === 0) {
      return Response.json({ related: [] })
    }

    const doc = docRows[0] as Record<string, unknown>
    const party = String(doc.PARTY_NAME ?? doc.party_name ?? "")
    const policy = String(doc.REFERENCE_NUMBER ?? doc.reference_number ?? "")
    const caseNo = String(doc.CASE_NUMBER ?? doc.case_number ?? "")

    const conditions: string[] = []
    if (party) conditions.push(`party_name = '${escSql(party)}'`)
    if (policy) conditions.push(`reference_number = '${escSql(policy)}'`)
    if (caseNo) conditions.push(`case_number = '${escSql(caseNo)}'`)

    if (conditions.length === 0) {
      return Response.json({ related: [] })
    }

    const rows = await querySnowflake(`
      SELECT file_path, document_type, party_name, reference_number,
             case_number, line_of_business, classification_confidence, ingestion_status
      FROM ${DB}.APP.v_document_catalog
      WHERE file_path != '${escSql(filePath)}'
        AND (${conditions.join(" OR ")})
      ORDER BY processing_completed_at DESC NULLS LAST
      LIMIT 20
    `, { callersRights: true })

    return Response.json({ related: rows })
  } catch (e) {
    return serverError(e)
  }
}
