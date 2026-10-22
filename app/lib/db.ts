/**
 * Snowflake database name for the Document Intelligence pipeline.
 */
export const DB = process.env.DOC_INTEL_DATABASE ?? "DOC_INTEL"

/**
 * Schema for AI services (agent, search, semantic view).
 */
export const SERVICES_SCHEMA = process.env.DOC_INTEL_SERVICES_SCHEMA ?? "SERVICES"

/**
 * Cortex Search service name (default: doc_search_svc).
 */
export const SEARCH_SVC = process.env.DOC_INTEL_SEARCH_SVC ?? "doc_search_svc"

/**
 * Page-level Cortex Search service name (for intra-document search and page citations).
 */
export const PAGE_SEARCH_SVC = process.env.DOC_INTEL_PAGE_SEARCH_SVC ?? "doc_page_search_svc"

/**
 * Cortex LLM model name for conversational queries (default: claude-sonnet-4-5).
 */
export const CORTEX_MODEL = process.env.DOC_INTEL_CORTEX_MODEL ?? "claude-sonnet-4-5"

/**
 * Cortex Agent name (default: doc_intelligence_agent).
 */
export const AGENT_NAME = process.env.DOC_INTEL_AGENT_NAME ?? "doc_intelligence_agent"

/**
 * Snowflake role names for RBAC checks.
 */
export const ROLE_ADMIN = process.env.DOC_INTEL_ROLE_ADMIN ?? "DOC_INTEL_ADMIN"
export const ROLE_USER = process.env.DOC_INTEL_ROLE_USER ?? "DOC_INTEL_USER"
export const ROLE_PIPELINE = process.env.DOC_INTEL_ROLE_PIPELINE ?? "DOC_INTEL_PIPELINE"
