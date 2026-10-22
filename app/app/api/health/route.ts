import { querySnowflake } from "@/lib/snowflake"
import { requireUser } from "@/lib/api-utils"

export const dynamic = "force-dynamic"

export async function GET() {
  // Require at least a DOC_INTEL role to access health info
  const denied = await requireUser()
  if (denied) return denied

  try {
    await querySnowflake("SELECT 1", { callersRights: true })
    return Response.json({ status: "ok", ts: new Date().toISOString() })
  } catch (e) {
    console.error(new Date().toISOString(), "[health] Snowflake unreachable", e)
    return Response.json(
      { status: "error", message: "Snowflake connection failed" },
      { status: 503 }
    )
  }
}
