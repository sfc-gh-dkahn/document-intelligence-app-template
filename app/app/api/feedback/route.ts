import { querySnowflake } from "@/lib/snowflake"
import { DB } from "@/lib/db"
import { NextRequest } from "next/server"
import { escSql, requireUser, serverError } from "@/lib/api-utils"

export const dynamic = "force-dynamic"

const VALID_FEEDBACK_TYPES = ["thumbs_up", "thumbs_down"] as const
type FeedbackType = typeof VALID_FEEDBACK_TYPES[number]

export async function POST(req: NextRequest) {
  const denied = await requireUser()
  if (denied) return denied
  try {
    const { filePath, feedbackType, queryText, documentType } = await req.json() as {
      filePath: string
      feedbackType: string   // runtime-validated below (TypeScript alone doesn't protect API input)
      queryText?: string
      documentType?: string
    }
    if (!filePath || !feedbackType) {
      return Response.json({ error: "filePath and feedbackType are required" }, { status: 400 })
    }
    // Allowlist validation — reject anything not in the known set
    if (!VALID_FEEDBACK_TYPES.includes(feedbackType as FeedbackType)) {
      return Response.json(
        { error: `feedbackType must be one of: ${VALID_FEEDBACK_TYPES.join(", ")}` },
        { status: 400 }
      )
    }
    await querySnowflake(
      `INSERT INTO ${DB}.ADMIN.search_feedback
         (file_path, feedback_type, query_text, document_type, submitted_by)
       VALUES (
         '${escSql(filePath)}',
         '${escSql(feedbackType)}',
         ${queryText   ? `'${escSql(queryText)}'`   : "NULL"},
         ${documentType ? `'${escSql(documentType)}'` : "NULL"},
         CURRENT_USER()
       )`,
      { callersRights: true }
    )
    return Response.json({ ok: true })
  } catch (e) {
    return serverError(e)
  }
}
