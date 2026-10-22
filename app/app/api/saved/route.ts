import { querySnowflake } from "@/lib/snowflake"
import { DB } from "@/lib/db"
import { NextRequest } from "next/server"
import { escSql, requireUser, serverError } from "@/lib/api-utils"

export const dynamic = "force-dynamic"

export async function GET() {
  const denied = await requireUser()
  if (denied) return denied
  try {
    // Return searches visible to the current user:
    // - personal: only their own
    // - role: user has that role (use IS_ROLE_IN_SESSION)
    // - global: visible to everyone
    const [searches, bookmarks] = await Promise.all([
      querySnowflake(
        `SELECT search_id, search_name, query_text, filters_json, created_at,
                last_run_at, visibility, shared_role, user_name
         FROM ${DB}.ADMIN.saved_searches
         WHERE (visibility = 'personal' AND user_name = CURRENT_USER())
            OR (visibility = 'global')
            OR (visibility = 'role' AND IS_ROLE_IN_SESSION(shared_role))
         ORDER BY visibility DESC, created_at DESC
         LIMIT 100`,
        { callersRights: true }
      ),
      querySnowflake(
        `SELECT bookmark_id, file_path, src_file_id, document_type, party_name,
                personal_note, created_at
         FROM ${DB}.ADMIN.document_bookmarks
         WHERE user_name = CURRENT_USER()
         ORDER BY created_at DESC`,
        { callersRights: true }
      ),
    ])
    return Response.json({ searches, bookmarks })
  } catch (e) {
    console.error(new Date().toISOString(), "[saved:GET] error", e)
    return serverError(e)
  }
}

export async function POST(req: NextRequest) {
  const denied = await requireUser()
  if (denied) return denied
  try {
    const { name, queryText, filtersJson, visibility, sharedRole } = await req.json() as {
      name: string
      queryText: string
      filtersJson?: string
      visibility?: string  // personal | role | global
      sharedRole?: string  // role name when visibility='role'
    }
    if (!name || !queryText) {
      return Response.json({ error: "name and queryText are required" }, { status: 400 })
    }
    const vis = ["personal", "role", "global"].includes(visibility ?? "") ? visibility : "personal"
    await querySnowflake(
      `INSERT INTO ${DB}.ADMIN.saved_searches
         (search_name, query_text, filters_json, user_name, visibility, shared_role)
       VALUES (
         '${escSql(name)}',
         '${escSql(queryText)}',
         ${filtersJson ? `'${escSql(filtersJson)}'` : "NULL"},
         CURRENT_USER(),
         '${escSql(vis!)}',
         ${vis === "role" && sharedRole ? `'${escSql(sharedRole)}'` : "NULL"}
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
    const id = searchParams.get("id")
    if (!id) return Response.json({ error: "id required" }, { status: 400 })
    // Users can delete their own; admins can delete global/role searches they own
    await querySnowflake(
      `DELETE FROM ${DB}.ADMIN.saved_searches
       WHERE search_id = '${escSql(id)}' AND user_name = CURRENT_USER()`,
      { callersRights: true }
    )
    return Response.json({ ok: true })
  } catch (e) {
    return serverError(e)
  }
}
