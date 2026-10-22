import { querySnowflake } from "@/lib/snowflake"
import { DB } from "@/lib/db"
import { NextRequest } from "next/server"
import { requireAdmin, escIdent, serverError } from "@/lib/api-utils"
import { writeFile, unlink } from "fs/promises"
import { join } from "path"
import { randomUUID } from "crypto"

export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied

  try {
    const formData = await req.formData()
    const file = formData.get("file") as File | null
    const stage = escIdent((formData.get("stage") as string) || "doc_stage")

    if (!file) {
      return Response.json({ error: "No file provided" }, { status: 400 })
    }

    // Sanitize filename to prevent path traversal
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_")

    const allowedTypes = [".pdf", ".tiff", ".tif", ".docx", ".pptx", ".jpg", ".jpeg", ".png", ".html", ".txt"]
    const ext = "." + safeName.split(".").pop()?.toLowerCase()
    if (!allowedTypes.includes(ext)) {
      return Response.json({ error: `File type ${ext} not supported. Allowed: ${allowedTypes.join(", ")}` }, { status: 400 })
    }

    if (file.size > 50 * 1024 * 1024) {
      return Response.json({ error: "File too large (max 50MB)" }, { status: 400 })
    }

    // Write to temp file
    const tmpPath = join("/tmp", `upload_${randomUUID()}${ext}`)
    const buffer = Buffer.from(await file.arrayBuffer())
    await writeFile(tmpPath, buffer)

    try {
      // PUT to stage
      const stagePath = `@${DB}.DATA.${stage}/documents/`
      await querySnowflake(
        `PUT 'file://${tmpPath}' '${stagePath}' AUTO_COMPRESS=FALSE OVERWRITE=TRUE`,
        { callersRights: true }
      )

      // Refresh stage directory listing
      await querySnowflake(
        `ALTER STAGE ${DB}.DATA.${stage} REFRESH`,
        { callersRights: true }
      )

      // Auto-register the new file
      await querySnowflake(
        `CALL ${DB}.DATA.sp_register_new_files()`,
        { callersRights: true }
      )

      // Start a pipeline run now instead of waiting for the schedule (owner's
      // rights, like suspend/resume). The file is already registered, so a
      // failure here only means it waits for the next scheduled run.
      let processing: "started" | "scheduled" = "started"
      try {
        await querySnowflake(`EXECUTE TASK ${DB}.DATA.task_01_register_files`)
      } catch (err) {
        console.error("[upload] could not start pipeline run", err)
        processing = "scheduled"
      }

      return Response.json({
        ok: true,
        fileName: safeName,
        filePath: `documents/${safeName}`,
        stage,
        size: file.size,
        processing,
      })
    } finally {
      await unlink(tmpPath).catch(() => {})
    }
  } catch (e) {
    console.error("[upload]", e)
    return serverError(e)
  }
}
