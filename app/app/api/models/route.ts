import { querySnowflake } from "@/lib/snowflake"
import { requireUser } from "@/lib/api-utils"

export const dynamic = "force-dynamic"

// Patterns to EXCLUDE from the LLM (cortex_model) dropdown
const EXCLUDE_LLM = [
  /^ARCTIC-/i,
  /^SNOWFLAKE-ARCTIC/i,
  /^E5-/i,
  /^NV-EMBED/i,
  /^MULTILINGUAL/i,
  /^VOYAGE-/i,
  /^LLAMAGUARD/i,
  /^TWELVELABS/i,
  /^GEMMA/i,
  /^REKA/i,
  /^CODESTRAL/i,
]

// Statuses to EXCLUDE (end-of-life, internal-only, private preview)
const EXCLUDE_STATUS = ["EOL", "INTERNAL", "PRPR"]

// Fallback model lists if SHOW CORTEX BASE MODELS is unavailable
const FALLBACK_LLM = [
  "claude-sonnet-4-5", "claude-sonnet-4-6", "claude-opus-4-7", "claude-opus-4-6", "claude-haiku-4-5",
  "openai-gpt-5.2", "openai-gpt-5.1", "openai-gpt-5", "openai-gpt-5-mini", "openai-gpt-5-nano", "openai-gpt-4.1",
  "llama4-maverick", "llama3.3-70b", "llama3.1-70b", "llama3.1-8b",
  "mistral-large2", "mixtral-8x7b", "pixtral-large",
]
const FALLBACK_EXTRACTION = ["arctic-extract"]

export async function GET() {
  const denied = await requireUser()
  if (denied) return denied
  try {
    const rows = await querySnowflake(
      `SHOW CORTEX BASE MODELS IN SCHEMA SNOWFLAKE.MODELS`,
      { callersRights: true }
    )

    const models = (Array.isArray(rows) ? rows : []).filter((r: Record<string, unknown>) => {
      const status = String(r.lifecycle_status ?? r.LIFECYCLE_STATUS ?? "").toUpperCase()
      // Include GA, PUPR, and models with no status set; exclude EOL and INTERNAL
      return !EXCLUDE_STATUS.includes(status)
    })

    const llmModels = models
      .filter((r: Record<string, unknown>) => {
        const name = String(r.name ?? r.NAME ?? "")
        return !EXCLUDE_LLM.some(pat => pat.test(name))
      })
      .map((r: Record<string, unknown>) => String(r.name ?? r.NAME ?? "").toLowerCase())
      .sort()

    const extractionModels = models
      .filter((r: Record<string, unknown>) => {
        const name = String(r.name ?? r.NAME ?? "")
        return /^ARCTIC-EXTRACT$/i.test(name)
      })
      .map((r: Record<string, unknown>) => String(r.name ?? r.NAME ?? "").toLowerCase())

    const finalLlm = llmModels.length > 0 ? llmModels : FALLBACK_LLM
    const finalExtract = extractionModels.length > 0 ? extractionModels : FALLBACK_EXTRACTION

    return Response.json({
      cortex_model: finalLlm,
      extraction_model: finalExtract,
      agent_model: finalLlm,
      parse_doc_mode: ["LAYOUT", "OCR"],
      parse_image_mode: ["OCR", "LAYOUT"],
    })
  } catch (e) {
    console.error("[models:GET] falling back to hardcoded list:", e instanceof Error ? e.message : e)
    // Return fallback models even if the query fails entirely
    return Response.json({
      cortex_model: FALLBACK_LLM,
      extraction_model: FALLBACK_EXTRACTION,
      agent_model: FALLBACK_LLM,
      parse_doc_mode: ["LAYOUT", "OCR"],
      parse_image_mode: ["OCR", "LAYOUT"],
    })
  }
}
