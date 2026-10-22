# DOC_INTEL: API Reference

## Stored Procedures

### `sp_register_new_files()`

**Schema:** `DOC_INTEL.DATA`  
**Purpose:** Scans the document stages and keeps the ingestion registry current. In order, it:
1. Marks PROCESSING rows older than `processing_timeout_minutes` (default 30) as FAILED with error stage `TIMEOUT`
2. Registers new files from `@DOC_INTEL.DATA.doc_stage` (files under `documents/`) and `@DOC_INTEL.DATA.sample_stage`, through the `v_stage_files` view
3. Updates `last_seen_at` for known files still on a stage
4. Moves FAILED files back to PENDING while they are under `max_processing_attempts` (default 3)
5. Marks FAILED files that hit the limit as ABANDONED

A file is registered once, by path. Uploading a changed file under the same path does not create a new version; use `sp_force_reprocess` for that.

**Called by:** `task_01_register_files` (daily by default; set by `DOC_INTEL_PIPELINE_SCHEDULE`), and by every upload

```sql
CALL DOC_INTEL.DATA.sp_register_new_files();
-- Returns: 'OK: Registration complete'
```

---

### `sp_force_reprocess(p_file_path, p_reason)`

**Schema:** `DOC_INTEL.DATA`  
**Purpose:** Adds a new PENDING version of a document so it is parsed, classified, and extracted again, whatever its current status. Logs a `FORCE_REPROCESS` event.

| Parameter | Type | Required | Description |
|---|---|---|---|
| p_file_path | VARCHAR | Yes | File path as stored in ingestion_registry |
| p_reason | VARCHAR | No | Reason for the audit trail (default 'Admin-initiated reprocess') |

```sql
CALL DOC_INTEL.DATA.sp_force_reprocess(
    'documents/my-document.pdf',
    'Document type was wrong'
);
-- Returns: 'OK: File queued for reprocessing as version N' or 'ERROR: File not found in registry: ...'
```

---

### `sp_bulk_reprocess(p_folder, p_file_format, p_dry_run)`

**Schema:** `DOC_INTEL.DATA`  
**Purpose:** Adds a new PENDING version for every COMPLETE document that matches the filters.

| Parameter | Type | Default | Description |
|---|---|---|---|
| p_folder | VARCHAR | NULL | Filter by source_folder (NULL = all folders) |
| p_file_format | VARCHAR | NULL | Filter by file_format (NULL = all formats) |
| p_dry_run | BOOLEAN | TRUE | If TRUE, returns a reminder message and changes nothing |

The dry run does not count matching documents. To preview a count, use the Reprocess tab in Pipeline Management (it calls `/api/admin/pipeline` with `action=preview_reprocess`) or run a `SELECT COUNT(*)` with the same filters.

`source_folder` stays empty unless you load source-system metadata, so most calls pass `NULL` for the folder.

```sql
-- Dry run
CALL DOC_INTEL.DATA.sp_bulk_reprocess(NULL, 'TIFF', TRUE);
-- Returns: 'DRY RUN: Use p_dry_run=FALSE to execute'

-- Run it: reprocess every completed TIFF
CALL DOC_INTEL.DATA.sp_bulk_reprocess(NULL, 'TIFF', FALSE);
-- Returns: 'OK: Bulk reprocess queued'
```

---

### `sp_parse_pending_documents()`

**Schema:** `DOC_INTEL.DATA`  
**Purpose:** Moves up to `batch_size` (default 100) PENDING documents to PROCESSING, then runs AI_PARSE_DOCUMENT on them: OCR mode for TIF, TIFF, JPG, JPEG, and PNG; LAYOUT mode for PDF, DOCX, PPTX, HTML, and TXT. Writes `parsed_documents`, splits pages into `document_pages`, and sets `content_hash` on the registry. Called by `task_02_parse_documents`.

---

### `sp_classify_parsed_documents()`

**Schema:** `DOC_INTEL.DATA`  
**Purpose:** Runs AI_CLASSIFY (multi-label) on the first page of each parsed document, against the active labels in `ADMIN.classification_labels`. Sets confidence by how many labels come back (1 = 0.95, 2 = 0.80, 3 = 0.65, 4 or more = 0.50) and sets `needs_review` when three or more labels come back. Called by `task_03_classify_documents`.

---

### `sp_extract_document_attributes()`

**Schema:** `DOC_INTEL.DATA`  
**Purpose:** Runs AI_EXTRACT on each classified document with a fixed set of field prompts (see `document_attributes` in `DATA_DICTIONARY.md`). The line of business prompt lists the active names in `ADMIN.lines_of_business`. `reference_number` and `case_number` fall back to `src_reference_number` and `src_case_number` when the AI finds none. Marks the registry row COMPLETE. Called by `task_04_extract_attributes`.

To change a field's prompt, edit this procedure in `sql/03_processing.sql` and the matching label in `app/lib/field-labels.ts`.

---

### `sp_emit_pipeline_metrics()`

**Schema:** `DOC_INTEL.DATA`  
**Purpose:** Writes a `PIPELINE_METRICS` event to `TELEMETRY.pipeline_events` with pending, processing, failed, and abandoned counts, documents completed in the last hour, and the last hour's error rate. Called by `task_05_emit_metrics`.

---

### `sp_approve_override(p_override_id)`

**Schema:** `DOC_INTEL.ADMIN`  
**Purpose:** Approves a pending field correction. The correction shows up in `document_catalog` on its next refresh, for the fields the catalog applies (see `overrides_pivoted` in `DATA_DICTIONARY.md`).

```sql
CALL DOC_INTEL.ADMIN.sp_approve_override('uuid-of-override');
-- Returns: 'OK: Override approved. Will be reflected in document_catalog on next Dynamic Table refresh.'
--       or 'ERROR: Override not found or already actioned: ...'
```

---

### `sp_get_dashboard_stats()`

**Schema:** `DOC_INTEL.ADMIN`  
**Purpose:** Returns key admin metrics as a JSON string.

```sql
CALL DOC_INTEL.ADMIN.sp_get_dashboard_stats();
-- Returns VARCHAR, for example:
-- {"total_documents":120,"pending_processing":4,"pending_status":"OK",
--  "failed_documents":1,"failed_status":"OK","pending_reviews":7,
--  "unreviewed_overrides":2,"search_queries_24h":35}
-- pending_status is WARNING above 500 pending; failed_status is WARNING above 50 failed.
```

---

### `sp_reset_pipeline(p_confirm)`

**Schema:** `DOC_INTEL.ADMIN`  
**Purpose:** Emergency reset — moves every PROCESSING document back to PENDING and logs a `PIPELINE_RESET` event.

```sql
CALL DOC_INTEL.ADMIN.sp_reset_pipeline('CONFIRM_RESET');
-- You must pass the exact string 'CONFIRM_RESET', so it cannot run by accident
```

---

## Cortex Services

### `doc_search_svc` (Cortex Search)

Document-level search over `document_catalog.full_text`, with structured filters. Embedding model: `snowflake-arctic-embed-l-v2.0`. Target lag: 1 hour.

**REST API endpoint:**
```
https://<account>.snowflakecomputing.com/api/v2/databases/DOC_INTEL/schemas/SERVICES/cortex-search-services/doc_search_svc:query
```

**Query parameters:**

| Parameter | Type | Description |
|---|---|---|
| query | string | Natural language search text |
| columns | array | Columns to return |
| filter | object | Cortex Search filter object |
| limit | integer | Max results (default 10, max 1000) |

**Filterable columns:** `document_type`, `doc_status`, `source_folder`, `line_of_business`, `doc_subtype`, `src_reference_number`, `src_case_number`, `file_format`, `party_name`

**Returnable columns:** `file_path`, `src_file_id`, `source_folder`, `src_reference_number`, `src_case_number`, `src_assigned_to`, `document_type`, `all_document_types`, `classification_confidence`, `party_name`, `issuer_name`, `counterparty_name`, `line_of_business`, `doc_subtype`, `reference_date`, `start_date`, `end_date`, `event_date`, `primary_amount`, `total_amount`, `secondary_amount`, `key_terms`, `action_required`, `doc_status`, `doc_summary`, `file_format`, `page_count`, `indexed_at`

**SQL example:**
```sql
SELECT PARSE_JSON(SNOWFLAKE.CORTEX.SEARCH_PREVIEW(
    'DOC_INTEL.SERVICES.doc_search_svc',
    '{
        "query": "automatic renewal and termination notice",
        "columns": ["file_path","document_type","party_name","end_date","doc_summary"],
        "filter": {"@eq": {"document_type": "Contract"}},
        "limit": 10
    }'
))['results'] AS results;
```

The row access policy is not attached to the base table this service reads. The app checks each user's access before it returns search results (see [Entitlements Architecture](#entitlements-architecture-multi-role)).

---

### `doc_page_search_svc` (Cortex Search)

Page-level search over `document_pages.page_content`, for finding passages inside long documents.

**Filterable:** `source_folder`, `src_reference_number`, `src_case_number`, `file_path`

**Returnable:** `file_path`, `processing_version`, `page_index`, `total_pages`, `source_folder`, `src_reference_number`, `src_case_number`, `page_content`

The app uses this service for in-document search (`/api/search` with `scope`).

---

### `document_analytics_sv` (Semantic View — Cortex Analyst)

Turns natural language into SQL over `DATA.document_catalog`. It defines these dimensions and metrics (see `DATA_DICTIONARY.md` for details):

- **Dimensions:** `file_path`, `src_file_id`, `source_folder`, `src_assigned_to`, `src_reference_number`, `src_case_number`, `document_type`, `file_format`, `needs_review`, `party_name`, `issuer_name`, `counterparty_name`, `line_of_business`, `doc_subtype`, `doc_status`, `start_date`, `end_date`, `upload_timestamp`
- **Metrics:** `document_count` (COUNT), `avg_confidence` (average classification confidence), `total_pages` (SUM of page_count)

The Doc Intelligence agent uses this view as its `doc_analytics` tool. The app also has a direct route, `/api/analyst`; no page calls it today.

**Usage** (via the `/api/analyst` route):
```typescript
const res = await fetch("/api/analyst", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    question: "How many documents do we have by type for each month this year?",
    history: []
  }),
})
const { answer, sql, results, requestId, warnings } = await res.json()
// answer:    string        — prose explanation from Cortex Analyst
// sql:       string | null — generated SQL statement
// results:   object[]      — executed query results (up to 100 rows)
// requestId: string | null — Cortex Analyst request ID for debugging
// warnings:  object[]      — any warnings Cortex Analyst returned
```

The `/api/analyst` route calls the Cortex Analyst REST API
(`POST /api/v2/cortex/analyst/message`) against `document_analytics_sv`,
sends up to the last four turns of history, then runs the generated SQL and
returns the rows.

Outside the app, use the Cortex Analyst REST API, or ask the agent in
Snowflake Intelligence.

---

### `doc_intelligence_agent` (Cortex Agent)

Routes each question to one or both of its two tools:
- **`doc_search`** — Cortex Search on `doc_search_svc` (find documents, read content, look up terms). Returns up to 10 results.
- **`doc_analytics`** — Cortex Analyst on `document_analytics_sv` (how many, count, total, average, compare, breakdown, trend). Runs on `DOC_INTEL_QUERY_WH`.

Orchestration model: `claude-sonnet-4-5`, with a budget of 120 seconds and 32,000 tokens. The agent cites `file_path` and `src_file_id` for each document it names. In Snowflake Intelligence it shows as **Document Intelligence**.

**Usage** (via the `/api/agent` route):
```typescript
const res = await fetch("/api/agent", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    question: "Which contracts end in the next 90 days?",
    history: []
  }),
})
// Response is an SSE stream (Content-Type: text/event-stream)
const reader = res.body.getReader()
// Each SSE event is JSON with one of these shapes:
// Text chunk:   { delta: string, toolUsed: string, done: boolean }
// Status:       { status: string, toolUsed: string, done: false }
// Chart data:   { resultSet: { columns: string[], rows: any[][], title?: string }, toolUsed: string, done: false }
// Activity:     { type: "activity", activity: { kind, tool?, name?, toolType?, input?, text? } }
// The final event has done: true. toolUsed is "Agent", "Search", or "Analytics".
```

The `/api/agent` route calls the Cortex Agent REST API
(`POST /api/v2/cortex/agent:run`) with SSE streaming. Authentication uses a
combined OAuth token (`serviceToken.callerToken`) for the SPCS caller's identity.

**Environment requirements:**
- `SNOWFLAKE_HOST` env var must be set (available only in SPCS)
- Returns HTTP 500 outside an SPCS environment
- `/api/agent/debug` checks the environment, token, and agent connection without showing token values

The agent is also available in **Snowflake Intelligence** for natural language access without API calls.

---

## Telemetry Views

All in `DOC_INTEL.TELEMETRY`, with matching views in `DOC_INTEL.APP`.

### `v_pipeline_health`

Current queue snapshot, using the latest version of each file. One row.

```sql
SELECT * FROM DOC_INTEL.TELEMETRY.v_pipeline_health;
-- Columns: pending_count, processing_count, complete_count, failed_count,
--          abandoned_count, skipped_count, total_registered,
--          last_completed_at, oldest_pending_at, max_queue_age_minutes
```

### `v_ingestion_metrics`

Daily throughput and failure rates by source folder and format.
Columns: `process_date`, `source_folder`, `file_format`, `docs_processed`, `total_bytes`, `avg_processing_min`, `failed_count`, `failure_rate_pct`.

### `v_cost_by_folder`

Credits by day, source folder, and pipeline stage (PARSE, CLASSIFY, EXTRACT, SEARCH, ANALYST, AGENT). Only counts events with a `source_folder`.
Columns: `cost_date`, `source_folder`, `stage_name`, `events_count`, `total_credits`, `rows_processed`.

### `v_search_analytics`

Agent query counts, latency, and feedback, from `agent_audit_log`.
Columns: `query_date`, `tool_used`, `user_role`, `query_count`, `avg_latency_ms`, `p50_latency_ms`, `p95_latency_ms`, `avg_result_count`, `thumbs_up`, `thumbs_down`, `positive_feedback_pct`.

### `v_quality_metrics`

Classification confidence by day, folder, and document type.
Columns: `date`, `source_folder`, `primary_document_type`, `doc_count`, `avg_confidence`, `low_confidence_count`, `low_confidence_pct`, `src_match_count`, `src_match_pct`.

### `v_error_summary`

Failed events grouped by day, stage, and message.
Columns: `error_date`, `stage_name`, `error_message`, `occurrence_count`, `last_occurred_at`, `sample_files`.

### `v_agent_audit_log` (APP schema)

Agent query log without the response text or generated SQL.
Columns: `query_id`, `query_time`, `user_name`, `user_role`, `question`, `tool_used`, `result_count`, `latency_ms`, `feedback_score`, `session_id`.

### Alerts

Three Snowflake alerts write a `PIPELINE_ALERT` event (stage `ALERT`, status `TRIGGERED`) to `pipeline_events`. They do not send email unless you add a notification integration.

| Alert | Schedule | Fires when | `alert_type` |
|---|---|---|---|
| `alert_high_error_rate` | Daily, 07:00 UTC | More than 5% of PARSE/CLASSIFY/EXTRACT events failed in the last 24 hours | HIGH_ERROR_RATE |
| `alert_queue_backlog` | Daily, 07:00 UTC | More than 500 pending and the oldest has waited over 120 minutes | QUEUE_BACKLOG |
| `alert_low_confidence` | Daily, 07:00 UTC | More than 20% of documents classified yesterday and today need review | LOW_CONFIDENCE |

---

## Next.js App API Routes

All routes are Next.js App Router handlers in `app/app/api/`.
Routes marked **requireUser** accept any DOC_INTEL Snowflake role (user, admin, or pipeline).
Routes marked **requireAdmin** require DOC_INTEL_ADMIN.

| Route | Method | Auth | Description |
|---|---|---|---|
| `/api/health` | GET | requireUser | Snowflake connection check. Returns `{ status: "ok", ts }`, or 503 on failure. Shows no database names or error details. |
| `/api/auth` | GET | None | Returns the current user's app role (`admin`, `user`, or `none`), identity, and entitlements. Registers users who hold a DOC_INTEL Snowflake role but have no entitlement row yet. Used by the client role context. |
| `/api/filters` | GET | requireUser | Lists for filter dropdowns: source folders, LOBs, document types, statuses, file formats, and feature flags. |
| `/api/search` | GET | requireUser | Cortex Search. Params: `q`, `docType`, `lob`, `status`, `format`, `limit` (max 50), `scope` (base64url file path; switches to `doc_page_search_svc`). Returns results with extracted fields. |
| `/api/suggestions` | GET | requireUser | Suggested searches for the user's lines of business, from `ADMIN.suggested_searches`. Returns `{ suggestions: [{ label, query }] }`. |
| `/api/agent` | POST | requireUser | Cortex Agent (`doc_intelligence_agent`) SSE stream. Requires SPCS (`SNOWFLAKE_HOST`). Body: `{ question, history[] }`. Events: `{ delta, toolUsed, done }`, `{ status, toolUsed, done }`, `{ resultSet, toolUsed, done }`, `{ type: "activity", activity }`. |
| `/api/agent/debug` | GET | requireUser | Checks the SPCS environment, token availability, and agent connection. Does not show token values. |
| `/api/analyst` | POST | requireUser | Cortex Analyst REST API against `document_analytics_sv`. Body: `{ question, history[] }`. Returns `{ answer, sql, results[], requestId, warnings[] }`. |
| `/api/analytics` | GET | requireUser | Chart data for the Overview page: `{ byType, byLob, byStatus, total, lobs }`. |
| `/api/documents` | GET | requireUser | Paged document catalog. Params: `folder`, `docType`, `lob`, `status`, `review`, `search`, `limit` (max 200), `offset`. Returns `{ rows[], total, limit, offset }`. |
| `/api/saved` | GET/POST/DELETE | requireUser | Saved searches. POST body: `{ name, queryText, filtersJson, visibility, sharedRole? }` (`visibility` is `personal`, `role`, or `global`). DELETE param: `?id=`. |
| `/api/bookmarks` | GET/POST/DELETE | requireUser | Document bookmarks. GET lists the current user's bookmarks. POST body: `{ filePath, irFileId?, documentType?, partyName?, note? }`. DELETE param: `?file_path=`. |
| `/api/feedback` | POST | requireUser | Thumbs up/down on search results and chat answers. Body: `{ filePath, feedbackType, queryText?, documentType? }`. `feedbackType` must be `thumbs_up` or `thumbs_down`. |
| `/api/corrections` | POST | requireUser | Submit a field correction from any page. Stored in `extraction_overrides` as PENDING. |
| `/api/admin` | POST | requireAdmin | Admin actions: `force_reprocess`, `approve_override`, `reject_override`, `submit_correction`. |
| `/api/config` | GET/PUT | requireAdmin | System config key/value store. PUT body: `{ key, value }`. |
| `/api/quality` | GET | requireAdmin | Quality metrics (`avgConfidence`, `lowConfPct`, `lowConfCount`, `docCount`, `docTypeCount`) plus `corrections`, `feedback`, `fieldAccuracy`, `lobAccuracy`. |
| `/api/registry` | GET | requireAdmin | Paged ingestion registry. Params: `status`, `folder`, `search`, `limit` (max 200), `offset`. One row per `file_path` (QUALIFY). |
| `/api/pipeline` | GET | requireAdmin | Queue health snapshot from `v_pipeline_health`. |
| `/api/tasks` | GET | requireAdmin | Snowflake task status from `SHOW TASKS`, plus task run history. |
| `/api/users` | GET | requireAdmin | User activity from `agent_audit_log` (last 30 days) plus role members from `SHOW GRANTS OF ROLE`. |
| `/api/cost` | GET | requireAdmin | Credits from `pipeline_events`: `byFolder` (by pipeline stage), `byStage` (by event type), `history` (daily, last year), and KPIs `total30d`, `avgDaily`, `projectedMonthly`. |
| `/api/models` | GET | requireUser | Available Cortex models. Queries `SHOW CORTEX BASE MODELS`, keeps GA and public preview models, and returns `{ cortex_model: string[], extraction_model: string[], agent_model: string[] }`. |
| `/api/documents/download` | GET | requireUser | Presigned URL for a document on a stage. Params: `file_path` (required), `stage_name` (optional; looked up from the registry, then falls back to `DOC_INTEL.DATA.doc_stage`). Checks `canDownload` and LOB access. Logs a download event to `pipeline_events`. Returns `{ url, file_path, stage_name }`, or 404 if the file is missing. |
| `/api/documents/proxy` | GET | requireUser | Streams a document from its stage through the app server, for the in-app viewer. Params: `file_path`, `stage_name`. Checks `canDownload` and LOB access. Logs a view event. |

---

## More Routes

### Document Detail Routes

| Route | Method | Auth | Description |
|-------|--------|------|-------------|
| `/api/documents/detail` | GET | requireUser | Full document detail. Param: `id` (base64url file path). Returns `{ document, pendingCorrections[] }`. Applies the LOB filter. |
| `/api/documents/history` | GET | requireUser | Processing version history. Param: `id`. Returns `{ history[] }` with version, status, times, and errors. |
| `/api/documents/related` | GET | requireUser | Documents that share the same `party_name`, `reference_number`, or `case_number`. Param: `id`. Returns `{ related[] }`. Applies the LOB filter. |
| `/api/documents/export` | GET | requireUser | Export the filtered catalog as CSV. Params: `lob`, `doc_type`, `status`. Requires `canDownload`. |

**URL scheme:** Document `id` params are base64url file paths (+ → -, / → _, = stripped). Encode: `btoa(filePath).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"")`. Decode: reverse it. Snowflake App Runtime (SAR) cannot deploy Next.js `[param]` folders, so the app passes IDs this way.

### Review Queue

| Route | Method | Auth | Description |
|-------|--------|------|-------------|
| `/api/review` | GET | requireUser | Review queue limited to the user's access. Params: `status` (pending/approved/skipped/all), `lob`, `docType`, `search`, `limit`, `offset`. Returns `{ rows[], total }`, each row with a `review_reason`. |
| `/api/review?action=count` | GET | requireUser | Badge counts. Returns `{ pending, approved, skipped }` within the user's access. |
| `/api/review` | POST | requireUser | Review action. Body: `{ filePath, action: "approve"\|"skip" }`. Writes `extraction_overrides` with `field_name='__review_status__'`. |

### Extraction Test Lab

| Route | Method | Auth | Description |
|-------|--------|------|-------------|
| `/api/admin/extraction-test?action=list_stages` | GET | requireUser | Stages from `ADMIN.ingestion_stages`. |
| `/api/admin/extraction-test?action=list_files&stage=<name>` | GET | requireUser | Files on a stage, via `LIST @stage_name`, limited to supported document types. |
| `/api/admin/extraction-test` | POST | requireAdmin | On-demand extraction. Body: `{ filePath, stageName, mode: "full"\|"single_attr" }`, or `{ files[], stageName }` for a batch. Full run: Parse → Classify Document Type → Detect LOB (active LOBs from `lines_of_business`) → Resolve Schema (COMMON + CATEGORY + LOB_SPECIFIC tiers from `extraction_schemas`) → Extract. Returns `{ ok, results: { raw_text, classification, lob, extraction, fieldTiers } }`. Nothing is saved to the pipeline. |
| `/api/admin/extraction-schema` | GET/POST/PUT/DELETE | requireAdmin | Extraction schema CRUD. `action=resolve` returns the merged schema for a category and LOB. |

### Classification Labels CRUD

| Route | Method | Auth | Description |
|-------|--------|------|-------------|
| `/api/admin/classification-labels` | GET | requireAdmin | All labels, ordered by category and sort_order. Returns `{ labels[] }`. |
| `/api/admin/classification-labels` | POST | requireAdmin | Create a label. Body: `{ label, category }`. |
| `/api/admin/classification-labels` | PUT | requireAdmin | Toggle active (`{ label, isActive }`), rename a category (`{ action: "rename_category", oldName, newName }`), or delete a category (`{ action: "delete_category", category }`). |
| `/api/admin/classification-labels?label=<name>` | DELETE | requireAdmin | Delete one label. |

### Lines of Business CRUD

| Route | Method | Auth | Description |
|-------|--------|------|-------------|
| `/api/admin/lobs` | GET | requireAdmin | All LOBs by sort_order. Returns `{ lobs[] }` with `lob_code`, `lob_name`, `description`, `is_active`, `sort_order`. |
| `/api/admin/lobs` | POST | requireAdmin | Create a LOB. Body: `{ lobCode, lobName, description? }`. Sets the next sort_order. Returns 409 if the code exists. |
| `/api/admin/lobs` | PUT | requireAdmin | Toggle active (`{ lobCode, isActive }`) or update details (`{ lobCode, lobName, description }`). |
| `/api/admin/lobs?lob_code=<code>` | DELETE | requireAdmin | Delete a LOB by code. |

### Other Admin Routes

| Route | Method | Auth | Description |
|-------|--------|------|-------------|
| `/api/admin/pipeline` | POST | requireAdmin | Pipeline actions: `run_step`, `suspend_task`, `resume_task`, `refresh_stage`, `bulk_reprocess`, and `preview_reprocess` (returns the match count without queueing anything). |
| `/api/admin/pipeline/logs` | GET | requireAdmin | Recent processing log rows for the Processing Logs tab. |
| `/api/admin/stages` | GET/POST/PATCH/DELETE | requireAdmin | Ingestion stage registry (`ADMIN.ingestion_stages`). `action=discover` lists stages not yet registered. |
| `/api/admin/upload` | POST | requireAdmin | Multipart upload (max 50MB per file). PUTs the file to `@DOC_INTEL.DATA.<stage>/documents/` and refreshes the stage. `stage` defaults to `doc_stage`. |
| `/api/admin/lifecycle` | POST | requireAdmin | Document lifecycle: `archive` (status ARCHIVED), `restore` (back to COMPLETE), `purge` (deletes pipeline rows and overrides, then REMOVEs the file from its stage). Each action logs an event. |
| `/api/admin/audit` | GET | requireAdmin | Audit events from `pipeline_events`, filtered by `days`, event type, and user. |
| `/api/admin/notifications` | GET/POST/PUT/DELETE | requireAdmin | Notification rules in `ADMIN.notification_config`. |
| `/api/admin/suggested-searches` | GET/POST/PUT/DELETE | requireAdmin | Suggested searches. POST body: `{ lobCode, label, query }`; PUT adds `searchId`. |
| `/api/admin/roles` | GET/POST/DELETE | requireAdmin | Entitlement roles (`ADMIN.entitlement_roles`). |
| `/api/admin/entitlements` | GET/POST/DELETE | requireAdmin | User entitlements and role assignments. `action=role_members` lists Snowflake role grantees; `action=unregistered` lists members not yet registered; `action=sync` registers them. |

### Behavior Notes

| Route | Note |
|-------|------|
| `/api/health` | Requires a DOC_INTEL role. |
| `/api/documents/download` | Checks `canDownload` and LOB access. Logs a download event to `TELEMETRY.pipeline_events`. |
| `/api/documents/proxy` | Checks `canDownload` and LOB access. Logs a view event to `TELEMETRY.pipeline_events`. |
| `/api/search` | The `scope` param (base64url file path) switches to `doc_page_search_svc` for in-document search. |
| `/api/agent` | Uses the Cortex Agent REST API with SSE streaming. Requires SPCS (`SNOWFLAKE_HOST`). The app shows citations of the form `[filename, p.N]` as clickable chips. |
| `/api/admin/pipeline` | `action=preview_reprocess` returns the match count without queueing a reprocess. |
| `/api/bookmarks` | GET lists the current user's bookmarks from `ADMIN.document_bookmarks`. |

---

## Entitlements Architecture (Multi-Role)

### Overview

Access is role-based, with multi-role support. Users get access only through role membership, with no per-user overrides. A user can hold several roles; their access is the union of all of them.

There are two layers:
1. **Snowflake roles** (`DOC_INTEL_USER`, `DOC_INTEL_ADMIN`, `DOC_INTEL_PIPELINE`) decide whether a user can reach the app and its admin routes.
2. **Entitlement roles** (rows in `ADMIN.entitlement_roles`, seeded from `config/roles.csv`) decide which pages, lines of business, and document types a user sees, and whether they can download. The starter roles are Administrator, Analyst, Finance Reviewer, and Viewer.

### Tables

| Table | Purpose |
|-------|---------|
| `ADMIN.entitlement_roles` | Named roles with `menu_access`, `lob_access`, `doc_type_access` arrays and a `can_download` flag |
| `ADMIN.user_entitlements` | One row per user, with an `is_active` flag (app role comes from the assigned roles' `menu_access`) |
| `ADMIN.user_role_assignments` | Links users to roles: `(user_name, role_id)`, many roles per user |
| `ADMIN.lines_of_business` | Master LOB list. Feeds the extraction prompt, filters, and entitlements. Managed in Admin → Lines of Business |

### Resolution Logic (`app/lib/entitlements.ts`)

1. If the user's `user_entitlements` row is inactive, they get no access
2. Load the user's active role assignments from `user_role_assignments`
3. For each role, load `menu_access`, `lob_access`, `doc_type_access`, `can_download`
4. Combine the arrays — effective access is the union of all assigned roles
5. If any array contains `"*"`, that dimension grants full access
6. `canDownload = true` if any assigned role allows downloads
7. `appRole` is derived: if any `menuAccess` entry starts with `admin:`, the user is `admin`; otherwise `user`. `/api/auth` only reports `admin` when the user also holds the `DOC_INTEL_ADMIN` Snowflake role.

### Page Access (`app/lib/app-pages.ts`)

`APP_PAGES` is the single list of app pages. Each page has a `key` (the value stored in `menu_access`), a path, a label, and a section (Main, Operations, AI Config, Management). Three things read it:
- The sidebar shows only pages whose key is in the user's `menuAccess`
- The role editor in User Management shows one checkbox per page
- `PageAccessGuard` (`app/components/page-access-guard.tsx`) blocks a page whose key is missing, even when the user types its URL. The user sees "*Page* is not available for your role" and a link back to the Overview.

Page keys: `dashboard`, `documents`, `search`, `review`, `chat`, `saved`, `help`, `admin:pipeline`, `admin:registry`, `admin:quality`, `admin:cost`, `admin:extraction`, `admin:labels`, `admin:lobs`, `admin:suggested-searches`, `admin:notifications`, `admin:config`, `admin:audit`, `admin:users`.

The document detail page (`/documents/detail`) is not gated by page key, because users reach it from Search, Review, and the agent. Its API still checks document-level access.

To add a page, add it to `APP_PAGES`. It then appears in the sidebar, the role editor, and the guard.

### Row Access Policy

`DOC_INTEL.ADMIN.document_entitlement_policy` (in `sql/11_row_access_policy.sql`) is attached to `DOC_INTEL.APP.v_document_catalog` on `(line_of_business, document_type)`. A row is visible when:
- The session role is `DOC_INTEL_PIPELINE` or `ACCOUNTADMIN` (always visible), or
- The user holds `DOC_INTEL_USER` or `DOC_INTEL_ADMIN`, is active, and the row's line of business and document type are in their effective access

LOB matching accepts both codes (for example `FIN`) and names (for example `Finance`), through `lines_of_business`. Document type matching is a case-insensitive contains match. Admins have no bypass; their entitlement roles filter them like everyone else.

The policy is not attached to the base table `DATA.document_catalog`, because Cortex Analyst's SQL runs without the user's session context and the policy would hide every row. The Cortex Search services and the semantic view read the base table, so the app enforces access in its API layer.

### SQL Helper Functions

```typescript
// Append to any SQL query to enforce LOB entitlements
lobFilter(entitlements, "line_of_business")
// → AND line_of_business IN ('FIN','OPS') | (empty string if wildcard)

docTypeFilter(entitlements, "document_type")
// → AND document_type IN ('Invoice','Purchase Order') | (empty string if wildcard)
```

Both helpers return an empty string when the user has wildcard access, and ` AND 1=0` when the user has no access, so you can always append them to a WHERE clause.

### Sidebar Reactivity

After an admin changes role assignments, the sidebar updates without a page reload:
- `RoleProvider` exposes `refreshAuth()` through the `useRole()` hook
- The User Management page calls `refreshAuth()` after saving
- That re-fetches `/api/auth`, which re-checks entitlements and updates the sidebar

---

*Last updated: October 2026*
