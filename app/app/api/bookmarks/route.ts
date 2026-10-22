import { querySnowflake } from "@/lib/snowflake"
import { DB } from "@/lib/db"
import { NextRequest } from "next/server"
import { escSql, clampInt, requireUser, serverError } from "@/lib/api-utils"

export const dynamic = "force-dynamic"

/**
 * GET /api/bookmarks — list current user's bookmarked documents
 */
export async function GET(req: NextRequest) {
  const denied = await requireUser()
  if (denied) return denied

  try {
    const sp = req.nextUrl.searchParams
    const limit = clampInt(sp.get("limit") ?? "100", 1, 200)
    const offset = clampInt(sp.get("offset") ?? "0", 0, 100000)

    const userRows = await querySnowflake(`SELECT CURRENT_USER() AS u`, { callersRights: true })
    const userName = String((userRows[0] as Record<string, unknown>).U ?? (userRows[0] as Record<string, unknown>).u ?? "")

    const rows = await querySnowflake(`
      SELECT b.file_path, b.personal_note AS note, b.created_at,
             c.document_type, c.line_of_business, c.party_name
      FROM ${DB}.ADMIN.document_bookmarks b
      LEFT JOIN ${DB}.APP.v_document_catalog c ON b.file_path = c.file_path
      WHERE UPPER(b.user_name) = UPPER('${escSql(userName)}')
      ORDER BY b.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `, { callersRights: true })

    return Response.json({ bookmarks: rows })
  } catch (e) {
    const msg = e instanceof Error ? e.message : ""
    if (msg.includes("does not exist")) {
      return Response.json({ bookmarks: [], tableNotFound: true })
    }
    return serverError(e)
  }
}


export async function POST(req: NextRequest) {
  const denied = await requireUser()
  if (denied) return denied
  try {
    const { filePath, irFileId, documentType, partyName, note } = await req.json()
    if (!filePath) return Response.json({ error: "filePath required" }, { status: 400 })

    // note: undefined     → do not update personal_note (preserve existing value)
    // note: null / ""     → clear personal_note (set to NULL)
    // note: "some string" → update with the new value
    const noteValue = note === undefined
      ? "t.personal_note"                        // preserve existing on plain toggle
      : note ? `'${escSql(note)}'`              // update to new value
             : "NULL"                             // clear (empty string → NULL)

    await querySnowflake(
      `MERGE INTO ${DB}.ADMIN.document_bookmarks AS t
       USING (SELECT CURRENT_USER() AS user_name, '${escSql(filePath)}' AS file_path) AS s
       ON t.user_name = s.user_name AND t.file_path = s.file_path
       WHEN MATCHED THEN
         UPDATE SET personal_note = ${noteValue}
       WHEN NOT MATCHED THEN
         INSERT (file_path, src_file_id, document_type, party_name, personal_note, user_name)
         VALUES (
           '${escSql(filePath)}',
           ${irFileId     ? `'${escSql(irFileId)}'`     : "NULL"},
           ${documentType ? `'${escSql(documentType)}'` : "NULL"},
           ${partyName  ? `'${escSql(partyName)}'`  : "NULL"},
           ${note         ? `'${escSql(note)}'`         : "NULL"},
           CURRENT_USER()
         )`,
      { callersRights: true }
    )
    return Response.json({ ok: true })
  } catch (e) {
    return serverError(e)
  }
}

export async function DELETE(req: NextRequest) {
  const denied = await requireUser()
  if (denied) return denied
  try {
    const { searchParams } = new URL(req.url)
    const filePath = searchParams.get("file_path")
    if (!filePath) return Response.json({ error: "file_path required" }, { status: 400 })
    await querySnowflake(
      `DELETE FROM ${DB}.ADMIN.document_bookmarks
       WHERE file_path = '${escSql(filePath)}' AND user_name = CURRENT_USER()`,
      { callersRights: true }
    )
    return Response.json({ ok: true })
  } catch (e) {
    return serverError(e)
  }
}
