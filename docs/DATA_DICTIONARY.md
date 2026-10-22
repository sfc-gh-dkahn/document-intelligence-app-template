# DOC_INTEL: Data Dictionary

Schema reference for DOC_INTEL tables, columns, and relationships.

## Database: DOC_INTEL

Schemas: `DATA` (pipeline), `TELEMETRY` (events and metrics), `ADMIN` (configuration and access), `APP` (app-facing views), `SERVICES` (Cortex Search, semantic view, agent), `APP_SERVICE` (the app itself).

---

## Quick Lookup: Common Columns by Name

These column names appear in more than one table. Use this list to check which tables hold the column you need.

| Column | Tables |
|--------|--------|
| `FILE_PATH` | ingestion_registry, parsed_documents, classified_documents, document_attributes, document_catalog, document_pages, extraction_overrides, pipeline_events, document_bookmarks, search_feedback |
| `PROCESSING_VERSION` | ingestion_registry, parsed_documents, classified_documents, document_attributes, document_catalog, document_pages, extraction_overrides |
| `SOURCE_FOLDER` | ingestion_registry, classified_documents, document_catalog, document_pages, pipeline_events, reprocess_queue |
| `SRC_FILE_ID` | ingestion_registry, document_catalog, document_pages, pipeline_events, document_bookmarks |
| `PARTY_NAME` | document_attributes, document_catalog, document_bookmarks |
| `LINE_OF_BUSINESS` | document_attributes, document_catalog |
| `INGESTION_STATUS` | ingestion_registry, document_catalog |
| `CREATED_AT` | parsed_documents, document_pages, saved_searches, document_bookmarks, extraction_schemas, classification_labels, notification_config, ingestion_stages, user_entitlements, entitlement_roles, lines_of_business |
| `USER_NAME` | user_entitlements, user_role_assignments, document_bookmarks, saved_searches, user_preferences, agent_audit_log, pipeline_events |
| `DOCUMENT_TYPE` | document_catalog, extraction_schemas, document_bookmarks, search_feedback |

### Columns That Do NOT Exist (Common Mistakes)

| Attempted Column | Fix |
|-----------------|-----|
| `document_catalog.FILE_NAME` | Does not exist. Derive it from `FILE_PATH`: `SPLIT_PART(file_path, '/', -1)` |
| `document_catalog.PRIMARY_DOCUMENT_TYPE` | The catalog renames it to `DOCUMENT_TYPE` |
| `document_catalog.CONFIDENCE_SCORE` | The catalog renames it to `CLASSIFICATION_CONFIDENCE` |
| `extraction_overrides.CREATED_AT` | Use `SUBMITTED_AT` |
| `classified_documents.LINE_OF_BUSINESS` | Only on `document_attributes` and `document_catalog` |
| `classified_documents.PARTY_NAME` | Only on `document_attributes` and `document_catalog` |
| `user_entitlements.ROLE_NAME` | Only on `entitlement_roles`. JOIN through `user_role_assignments.role_id` |
| `user_role_assignments.CREATED_AT` | Use `ASSIGNED_AT` |
| `search_feedback.USER_NAME` | Use `SUBMITTED_BY` |

---

## Stages

| Stage | Purpose |
|---|---|
| `DATA.doc_stage` | Your source documents. Load them with `scripts/upload_docs.sh`. The pipeline only registers files under the `documents/` prefix. |
| `DATA.sample_stage` | An extra document stage the pipeline also scans, for files you load another way. The in-app Upload tab uses `doc_stage`. |
| `DATA.metadata_stage` | Optional JSON sidecar files. Nothing in the current pipeline reads it. |
| `ADMIN.config_stage` | Config CSVs that `deploy.sh` uploads for `10_seed_config.sql` |

Supported file types: TIF, TIFF, PDF, DOCX, PPTX, JPG, JPEG, PNG, HTML, TXT.

---

## Schema: DATA (Pipeline Tables)

### `ingestion_registry`

Master registry of every file the pipeline has seen. The single source of truth for de-duplication and processing state.

| Column | Type | Nullable | Description |
|---|---|---|---|
| registry_id | VARCHAR | NOT NULL (PK) | UUID — unique row ID |
| file_path | VARCHAR | NOT NULL | Path within the stage (for example `documents/my-file.pdf`) |
| stage_name | VARCHAR | NOT NULL | Fully qualified stage name |
| file_format | VARCHAR | NOT NULL | Uppercase file extension: TIFF, PDF, DOCX, JPEG, PNG, HTML, TXT, etc. |
| file_size_bytes | BIGINT | YES | File size from the stage directory |
| file_hash | VARCHAR | YES | SHA2(256) of file bytes, for change detection (reserved; not set today) |
| src_file_id | VARCHAR | YES | File ID in your source system |
| source_folder | VARCHAR | YES | Folder or grouping in your source system |
| src_document_type | VARCHAR | YES | Document type as your source system labels it |
| src_reference_number | VARCHAR | YES | Reference number from your source system |
| src_case_number | VARCHAR | YES | Case, ticket, or order number from your source system |
| src_assigned_to | VARCHAR | YES | Person the document is assigned to in your source system |
| src_date_created | TIMESTAMP_NTZ | YES | When the document was created in your source system |
| src_metadata | VARIANT | YES | Full JSON metadata from your source system |
| ingestion_status | VARCHAR | YES | State: PENDING / PROCESSING / COMPLETE / FAILED / ABANDONED / SKIPPED / ARCHIVED |
| processing_version | INT | YES | Version number; goes up each time the file is reprocessed |
| force_reprocess | BOOLEAN | YES | TRUE on rows created by a forced or bulk reprocess |
| first_seen_at | TIMESTAMP_NTZ | YES | When the file was first found on a stage |
| last_seen_at | TIMESTAMP_NTZ | YES | Last time a stage scan saw the file |
| processing_started_at | TIMESTAMP_NTZ | YES | When the row entered PROCESSING |
| processing_completed_at | TIMESTAMP_NTZ | YES | When the row entered COMPLETE |
| processing_attempts | INT | YES | Parse attempts for this version |
| last_error | VARCHAR | YES | Error message from the latest failure |
| error_stage | VARCHAR | YES | Stage that failed: PARSE / CLASSIFY / EXTRACT / TIMEOUT |
| content_hash | VARCHAR | YES | SHA2 of the extracted text, set after parse |
| previous_content_hash | VARCHAR | YES | Prior content_hash, for diff tracking (reserved) |
| created_by | VARCHAR | YES | User who triggered registration |
| updated_at | TIMESTAMP_NTZ | YES | Time of the last row change |

**Source-system columns (`src_*`, `source_folder`):** Nothing in the current pipeline fills these. They stay empty unless you add a loader for your source system's metadata. Where they are empty, extraction falls back to the AI-extracted values, and folder-based views and filters return no rows.

**Clustering:** `(source_folder, ingestion_status)`  
**Constraints:** `PK (registry_id)`, `UNIQUE (file_path, processing_version)`

---

### `parsed_documents`

AI_PARSE_DOCUMENT output — raw text and structure per document version.

| Column | Type | Description |
|---|---|---|
| parse_id | VARCHAR | UUID PK |
| file_path | VARCHAR | Links to ingestion_registry |
| stage_name | VARCHAR | Stage the file was read from |
| file_format | VARCHAR | Format from the registry |
| processing_version | INT | Links to ingestion_registry |
| parse_mode | VARCHAR | OCR (images and TIFF) or LAYOUT (PDF, DOCX, PPTX, HTML, TXT) |
| parse_result | VARIANT | Full AI_PARSE_DOCUMENT JSON response |
| page_count | INT | Total pages (1 for images) |
| raw_content | VARCHAR | All text, joined across pages |
| parse_status | VARCHAR | PENDING / COMPLETE / FAILED |
| parse_error | VARCHAR | Error message if it failed |
| parse_started_at | TIMESTAMP_NTZ | Parse start time |
| parse_completed_at | TIMESTAMP_NTZ | Parse end time |
| parse_duration_ms | BIGINT | Parse time in milliseconds (currently written as 0) |
| created_at | TIMESTAMP_NTZ | Row creation time |

**Constraints:** `UNIQUE (file_path, processing_version)`

---

### `document_pages`

One row per page, for page-level Cortex Search.

| Column | Type | Description |
|---|---|---|
| page_id | VARCHAR | UUID PK |
| file_path | VARCHAR | Links to parsed_documents |
| processing_version | INT | Links to parsed_documents |
| page_index | INT | 0-based page number |
| page_content | VARCHAR | Text of this page |
| total_pages | INT | Total pages in the document |
| src_file_id | VARCHAR | Copied from the registry |
| source_folder | VARCHAR | Copied from the registry (for clustering) |
| src_reference_number | VARCHAR | Copied from the registry |
| src_case_number | VARCHAR | Copied from the registry |
| created_at | TIMESTAMP_NTZ | Row creation time |

**Change tracking:** enabled (required by `doc_page_search_svc`)

---

### `classified_documents`

AI_CLASSIFY output with a confidence score. The AI reads the first page and chooses from the active labels in `ADMIN.classification_labels`.

| Column | Type | Description |
|---|---|---|
| classification_id | VARCHAR | UUID PK |
| file_path | VARCHAR | Links to the registry |
| processing_version | INT | Links to the registry |
| source_folder | VARCHAR | Copied for clustering |
| ai_classification | VARIANT | Full AI_CLASSIFY JSON response (labels array) |
| primary_document_type | VARCHAR | First label returned |
| all_document_types | ARRAY | All labels returned |
| confidence_score | FLOAT | Based on label count: 1 = 0.95, 2 = 0.80, 3 = 0.65, 4 or more = 0.50 |
| src_document_type | VARCHAR | Source-system type (for comparison) |
| classification_match | BOOLEAN | TRUE if the AI labels include the source-system type |
| needs_review | BOOLEAN | TRUE when three or more labels came back (confidence 0.65 or lower) |
| classified_at | TIMESTAMP_NTZ | Classification time |

---

### `document_attributes`

AI_EXTRACT output — key fields per document version. The prompts live in `sp_extract_document_attributes` (`sql/03_processing.sql`). On-screen labels live in `app/lib/field-labels.ts`.

| Column | Type | Screen label | Description |
|---|---|---|---|
| attribute_id | VARCHAR | | UUID PK |
| file_path | VARCHAR | | Links to the registry |
| processing_version | INT | | Links to the registry |
| extracted_attributes | VARIANT | | Full AI_EXTRACT JSON response |
| document_date | DATE | Document Date | Date the document was created, issued, or took effect |
| party_name | VARCHAR | Party | Main person or organization the document is about |
| reference_number | VARCHAR | Reference # | Main reference, account, contract, or ID number (falls back to `src_reference_number`) |
| case_number | VARCHAR | Case # | Case, ticket, order, or incident number (falls back to `src_case_number`) |
| issuer_name | VARCHAR | Issuer | Organization that issued or wrote the document |
| counterparty_name | VARCHAR | Counterparty | Other party named in the document, such as a vendor, customer, or agent |
| line_of_business | VARCHAR | Line of Business | One of the active lines of business, by name (for example Finance, Legal) |
| doc_subtype | VARCHAR | Subtype | More specific subtype or form name |
| reference_date | DATE | Other Key Date | Any other key date the document refers to |
| start_date | DATE | Start Date | Start or effective date |
| end_date | DATE | End Date | End, expiration, due, or renewal date |
| event_date | DATE | Event Date | Date of the main event, incident, or transaction described |
| primary_amount | VARCHAR | Amount | Main monetary amount, as text (for example "$5,000,000") |
| total_amount | VARCHAR | Total Amount | Total or maximum amount, as text |
| secondary_amount | VARCHAR | Other Amount | Any other important amount, such as a fee or balance, as text |
| monetary_amounts | VARIANT | | All monetary values, with what each one is for |
| key_terms | VARCHAR | Key Terms | Key terms, conditions, exclusions, or limits |
| action_required | VARCHAR | Action Required | Required actions, follow-up items, or deadlines |
| doc_status | VARCHAR | Status | Status as the document states it, such as draft, active, approved, open, closed, or expired |
| doc_summary | VARCHAR | Summary | Two- to three-sentence AI summary |
| extraction_confidence | FLOAT | | Overall extraction quality estimate (reserved; not set today) |
| low_confidence_fields | ARRAY | | Fields where extraction may be unreliable (reserved; not set today) |
| pii_detected | BOOLEAN | | TRUE if personal information was detected (default FALSE) |
| extracted_at | TIMESTAMP_NTZ | | Extraction time |

---

### `overrides_pivoted` (Dynamic Table)

Approved corrections from `ADMIN.extraction_overrides`, one row per `(file_path, processing_version)`, so the catalog can join them in one step.

Columns: `file_path`, `processing_version`, and one `<field>_override` column each for `document_date`, `party_name`, `reference_number`, `case_number`, `issuer_name`, `counterparty_name`, `line_of_business`, `doc_subtype`, `key_terms`, `doc_status`.

Approved corrections to any other field are kept in `extraction_overrides` but do not change the catalog.

**Refresh:** TARGET_LAG = 1 hour

---

### `document_catalog` (Dynamic Table)

The latest COMPLETE version of each document, with approved corrections applied. Archived, failed, and pending documents are not in it.

| Column | Source | Notes |
|---|---|---|
| registry_id, file_path, stage_name, file_format, processing_version | ingestion_registry | |
| src_file_id, source_folder, src_reference_number, src_case_number, src_assigned_to, src_date_created | ingestion_registry | Empty unless you load source-system metadata |
| document_type | classified_documents.primary_document_type | |
| all_document_types | classified_documents | |
| classification_confidence | classified_documents.confidence_score | |
| needs_review, src_document_type, classification_match | classified_documents | |
| document_date, party_name, reference_number, case_number, issuer_name, counterparty_name, line_of_business, doc_subtype, key_terms, doc_status | document_attributes | Approved corrections replace these values |
| reference_date, start_date, end_date, event_date, primary_amount, total_amount, secondary_amount, monetary_amounts, action_required, doc_summary | document_attributes | |
| full_text | parsed_documents.raw_content | Full extracted text |
| page_count, parse_mode | parsed_documents | |
| upload_timestamp | ingestion_registry.first_seen_at | Alias of `first_seen_at` |
| first_seen_at, processing_completed_at, ingestion_status | ingestion_registry | |

**Refresh:** TARGET_LAG = 1 hour, REFRESH_MODE = INCREMENTAL (required for Cortex Search change tracking)  
**Row Access Policy:** Not on this table. `ADMIN.document_entitlement_policy` is attached to `APP.v_document_catalog` (see below).

---

### `v_stage_files` (View)

Current files on `doc_stage` (under `documents/`) and `sample_stage`, with supported extensions only. `sp_register_new_files` reads it.

Columns: `file_path`, `stage_name`, `full_path`, `file_size_bytes`, `file_modified_at`, `file_format`.

---

## Schema: TELEMETRY

### `pipeline_events`

Central event log for pipeline and user activity.

| Column | Type | Description |
|---|---|---|
| event_id | VARCHAR | UUID PK |
| event_time | TIMESTAMP_NTZ | Event time |
| event_type | VARCHAR | For example PARSE_COMPLETE, CLASSIFY_COMPLETE, EXTRACT_COMPLETE, FORCE_REPROCESS, PIPELINE_METRICS, PIPELINE_ALERT, PIPELINE_RESET |
| stage_name | VARCHAR | INGEST / PARSE / CLASSIFY / EXTRACT / CATALOG / SEARCH / ANALYST / AGENT / FEEDBACK / OVERRIDE / ADMIN / ALERT / METRICS |
| file_path | VARCHAR | Related file (if any) |
| src_file_id | VARCHAR | Source-system file ID |
| source_folder | VARCHAR | Source folder |
| user_name | VARCHAR | Snowflake user who triggered the event |
| warehouse_name | VARCHAR | Warehouse used |
| status | VARCHAR | SUCCESS / FAILED / SKIPPED / RETRY / QUEUED / TRIGGERED / EXECUTED |
| duration_ms | BIGINT | Time in milliseconds |
| error_message | VARCHAR | Error detail if status = FAILED |
| error_code | VARCHAR | Error code, if any |
| credits_used | FLOAT | Snowflake credits used |
| rows_processed | BIGINT | Rows affected |
| metadata | VARIANT | Event-specific data |

**Retention:** 90 days

### `agent_audit_log`

Audit trail of agent and Snowflake Intelligence questions. Nothing in the app writes to this table yet, so it and `v_search_analytics` stay empty until you add agent logging.

| Column | Type | Description |
|---|---|---|
| query_id | VARCHAR | UUID PK |
| query_time | TIMESTAMP_NTZ | Question time |
| user_name | VARCHAR | Snowflake user |
| user_role | VARCHAR | Active role at the time |
| question | VARCHAR | The user's question |
| tool_used | VARCHAR | SEARCH / ANALYST / BOTH |
| search_query | VARCHAR | Query sent to Cortex Search |
| analyst_question | VARCHAR | Question sent to Cortex Analyst |
| generated_sql | VARCHAR | SQL that Cortex Analyst wrote |
| result_count | INT | Number of results |
| response_text | VARCHAR | Agent answer |
| latency_ms | BIGINT | Total response time |
| feedback_score | INT | 1 = positive, -1 = negative, NULL = none |
| feedback_at | TIMESTAMP_NTZ | When feedback was given |
| session_id | VARCHAR | Chat session UUID |

**Retention:** 90 days

### Metric Views

`v_pipeline_health`, `v_ingestion_metrics`, `v_error_summary`, `v_cost_by_folder`, `v_search_analytics`, `v_quality_metrics`. See `API_REFERENCE.md` for their columns.

### Alerts

`alert_high_error_rate`, `alert_queue_backlog`, `alert_low_confidence`. Each writes a `PIPELINE_ALERT` event. See `API_REFERENCE.md`.

---

## Schema: ADMIN

### `system_config`

Key-value settings store.

| Column | Type | Description |
|---|---|---|
| config_key | VARCHAR | PK |
| config_value | VARCHAR | Value, stored as text |
| config_type | VARCHAR | STRING / INTEGER / FLOAT / BOOLEAN / JSON |
| description | VARCHAR | What the setting does |
| updated_at | TIMESTAMP_NTZ | Last change |
| updated_by | VARCHAR | Who changed it |

**Seeded keys:**

| Key | Default | Type | Used by | Description |
|---|---|---|---|---|
| max_processing_attempts | 3 | INTEGER | sp_register_new_files | Attempts before ABANDONED |
| batch_size | 100 | INTEGER | sp_parse_pending_documents | Most documents parsed per run |
| processing_timeout_minutes | 30 | INTEGER | sp_register_new_files | Minutes before a stuck PROCESSING row is marked FAILED |
| search_result_limit | 10 | INTEGER | — | Default search result count |
| classify_confidence_threshold | 0.70 | FLOAT | — | Confidence below which to flag for review |
| pipeline_target_lag_minutes | 60 | INTEGER | — | Target time from upload to searchable |
| cost_alert_multiplier | 2.0 | FLOAT | — | Alert when daily credits exceed N × the 7-day average |
| queue_backlog_threshold | 500 | INTEGER | — | Alert when pending count exceeds this |
| error_rate_threshold_pct | 5 | FLOAT | — | Alert when the 24-hour error rate exceeds this % (checked daily) |
| enable_pii_masking | true | BOOLEAN | — | Turn on PII masking policies |
| enable_feedback_collection | true | BOOLEAN | — | Turn on thumbs up/down collection |
| max_saved_searches_per_user | 50 | INTEGER | — | Saved search limit per user |
| admin_email | (empty) | STRING | — | Email for pipeline alerts |
| parse_image_mode | OCR | STRING | — | Parse mode for TIFF/JPEG/PNG |
| parse_doc_mode | LAYOUT | STRING | — | Parse mode for PDF/DOCX/HTML |
| search_embedding_model | snowflake-arctic-embed-l-v2.0 | STRING | — | Cortex Search embedding model |
| agent_model | claude-sonnet-4-5 | STRING | — | LLM for the Cortex Agent |

"—" means no procedure or route reads the key today; the matching behavior is set in the SQL scripts.

### `extraction_overrides`

User-submitted field corrections.

| Column | Description |
|---|---|
| override_id | UUID PK |
| file_path | Document the correction applies to |
| processing_version | Document version |
| field_name | Field being corrected (for example `party_name`). `__review_status__` rows hold Review Queue decisions. |
| original_value | AI value before the correction |
| corrected_value | New value (for review rows: APPROVED or SKIPPED) |
| override_reason | User's reason |
| submitted_by | User who submitted it |
| submitted_at | Submission time |
| approved_by | Admin who approved or rejected it |
| approved_at | Decision time |
| override_status | PENDING / APPROVED / REJECTED |

### `classification_labels`

Document type labels for AI_CLASSIFY. Managed in Admin → Classification Labels; seeded from `config/classification_labels.csv`.

| Column | Type | Description |
|---|---|---|
| label | VARCHAR(200) | Unique — document type name (for example "Invoice") |
| category | VARCHAR(100) | Group (for example "Contracts", "Financial"); default "General" |
| sort_order | INT | Display order |
| is_active | BOOLEAN | Whether the AI can use the label |
| created_at | TIMESTAMP_NTZ | When the label was created |

**Seeded values:** Contract, Amendment, Statement of Work (Contracts); Invoice, Purchase Order, Receipt, Financial Statement (Financial); Report, Policy or Procedure, Form (Operations); Letter, Email (Correspondence); Certificate, Regulatory Filing (Compliance); Other (Other)

### `lines_of_business`

Configurable lines of business. Feeds the extraction prompt, filter dropdowns, and entitlements. Seeded from `config/lobs.csv`.

| Column | Type | Description |
|---|---|---|
| lob_id | NUMBER | Auto-increment PK |
| lob_code | VARCHAR(20) | Unique short code used in match rules and entitlements (for example "FIN") |
| lob_name | VARCHAR(256) | Unique display name; the extraction prompt lists these names (for example "Finance") |
| description | VARCHAR(1000) | What the LOB covers |
| is_default | BOOLEAN | Default LOB |
| is_active | BOOLEAN | Whether the LOB is used for new documents (default TRUE) |
| sort_order | NUMBER | Display order |
| created_at | TIMESTAMP_NTZ | When the LOB was created |
| updated_at | TIMESTAMP_NTZ | Last change |

**Seeded values:** GEN General (default), FIN Finance, OPS Operations, LEG Legal, HR Human Resources

### `extraction_schemas`

Field definitions with tiers (COMMON, CATEGORY, LOB_SPECIFIC). Seeded from `config/extraction_schemas.csv`. The Extraction Schema page and Test Lab use this table; the automated pipeline uses its own fixed prompt.

| Column | Type | Description |
|---|---|---|
| schema_id | VARCHAR | UUID PK |
| schema_tier | VARCHAR(20) | COMMON / CATEGORY / LOB_SPECIFIC |
| document_type | VARCHAR | Display group: 'Common', a category name, or 'Category - LOB' |
| attribute_name | VARCHAR | Field name to extract |
| attribute_description | VARCHAR | Instruction passed to AI_EXTRACT |
| attribute_type | VARCHAR | VARCHAR, DATE, NUMBER, or VARIANT |
| is_required | BOOLEAN | Default TRUE |
| sort_order | INTEGER | Order within the tier |
| match_rule | VARCHAR | JSON string: `{"category":"Financial"}` or `{"category":"Financial","lob":"FIN"}` |
| version | INT | Schema version |
| status | VARCHAR(20) | DRAFT or PUBLISHED |
| created_at | TIMESTAMP_NTZ | Creation time |
| updated_by | VARCHAR | Who last changed it |

**Constraints:** `UNIQUE (schema_tier, document_type, attribute_name)`

### `saved_searches`

Per-user saved searches.

| Column | Description |
|---|---|
| search_id | UUID PK |
| user_name | Snowflake user |
| search_name | Name the user gave it |
| query_text | Search query |
| filters_json | JSON string of filters (document type, folder, LOB, dates, status, format) |
| visibility | personal (default) / role / global |
| shared_role | Role name when visibility = role |
| last_run_at | When it last ran |
| created_at | When it was saved |

### `document_bookmarks`

Documents a user pinned.

| Column | Description |
|---|---|
| bookmark_id | UUID PK |
| user_name | Snowflake user |
| file_path | Bookmarked document |
| src_file_id | Source-system file ID |
| document_type | Document type at the time |
| party_name | Party at the time |
| personal_note | User's note |
| created_at | When it was bookmarked |

**Constraints:** `UNIQUE (user_name, file_path)`

### `search_feedback`

Thumbs up/down on search results and agent answers.

| Column | Description |
|---|---|
| feedback_id | UUID PK |
| file_path | Document (for chat answers, a placeholder such as `chat_response_3`) |
| feedback_type | thumbs_up / thumbs_down |
| query_text | Search query or question |
| document_type | Document type, if known |
| submitted_by | User who gave the feedback |
| submitted_at | When |

### `suggested_searches`

Suggested searches and quick questions, by line of business. Seeded from `config/suggested_searches.csv`.

| Column | Description |
|---|---|
| search_id | Auto-increment PK |
| lob_code | LOB code, or `*` for everyone |
| label | Button text |
| query | Query to run |
| sort_order | Display order |
| is_active | Whether it is shown |

### `ingestion_stages`

Stages shown in Pipeline Management → Stages and in the Test Lab.

| Column | Description |
|---|---|
| stage_name | PK — fully qualified stage name |
| description | What the stage holds |
| path_prefix | Folder prefix to scan (default '') |
| file_pattern | File name pattern (default: supported extensions) |
| is_active | Active or paused |
| created_at | When it was registered |
| updated_by | Who last changed it |

**Seeded values:** `DOC_INTEL.DATA.doc_stage` (prefix `documents/`), `DOC_INTEL.DATA.sample_stage`

The app uses this table to list stages and to refresh their directories. Registration (`sp_register_new_files`) scans only `doc_stage` and `sample_stage`, through `v_stage_files`. A stage you add here is not registered from unless you also add it to that view.

### `notification_config`

Alert routing rules.

| Column | Description |
|---|---|
| id | UUID PK |
| channel_type | webhook or email |
| endpoint | URL or email address |
| event_types | ARRAY of event types (for example `['ALERT','INGEST']`) |
| threshold_value | 0 = every event |
| is_active | On or off |
| created_at | When it was created |

### `reprocess_queue`

Admin reprocess jobs (single file or bulk).

Columns: `queue_id` (PK), `job_name`, `file_paths` (VARIANT array, or NULL for bulk), `source_folder`, `file_format`, `from_date`, `to_date`, `files_queued`, `files_complete`, `files_failed`, `status` (QUEUED / RUNNING / COMPLETE / FAILED), `requested_by`, `requested_at`, `started_at`, `completed_at`, `notes`.

### `user_preferences`

Per-user app settings.

Columns: `user_name` (PK), `default_folder`, `default_lob`, `results_per_page` (default 25), `theme` (default light), `date_format` (default YYYY-MM-DD), `notifications_on`, `onboarding_complete`, `updated_at`.

### `user_entitlements`

One row per app user.

| Column | Description |
|---|---|
| id | Auto-increment PK |
| user_name | Unique Snowflake user name |
| is_active | FALSE blocks the user |
| created_by | Who created the row (SYSTEM for the deploying user) |
| created_at, updated_at | Timestamps |
| app_role, menu_access, lob_access, doc_type_access | Deprecated — access now comes from `entitlement_roles` |
| entitlement_role_id | Deprecated single-role link, migrated into `user_role_assignments` |

### `entitlement_roles`

App roles. Seeded from `config/roles.csv` (Administrator, Analyst, Finance Reviewer, Viewer).

| Column | Description |
|---|---|
| role_id | Auto-increment PK |
| role_name | Unique name |
| description | What the role is for |
| menu_access | ARRAY of page keys from `app/lib/app-pages.ts` (for example `dashboard`, `search`, `admin:users`) |
| lob_access | ARRAY of LOB codes, or `*` |
| doc_type_access | ARRAY of document types, or `*` |
| can_download | Whether members can download |
| is_active | Inactive roles grant nothing |
| created_by, created_at, updated_at | Audit columns |

### `user_role_assignments`

Links users to app roles.

Columns: `id` (PK), `user_name`, `role_id`, `assigned_by`, `assigned_at`. **Constraint:** `UNIQUE (user_name, role_id)`.

### Access Functions and Policy

| Object | Purpose |
|---|---|
| `get_user_lob_access()` | Current user's LOB codes and names, or `*` |
| `get_user_doc_type_access()` | Current user's document types, or `*` |
| `user_can_access_doc_type(VARCHAR)` | Case-insensitive contains match of a document type against the user's access |
| `is_user_active()` | Whether the current user's entitlement row is active |
| `document_entitlement_policy` | Row access policy on `APP.v_document_catalog`, on `(line_of_business, document_type)` |

---

## Schema: APP (Views)

Views in `DOC_INTEL.APP` expose DATA and TELEMETRY data to the app.

| View | Source | Security |
|---|---|---|
| v_document_catalog | DATA.document_catalog | Row access policy `ADMIN.document_entitlement_policy` on line_of_business and document_type |
| v_pipeline_health | TELEMETRY.v_pipeline_health | Admin pages |
| v_ingestion_registry | DATA.ingestion_registry (selected columns) | Admin pages |
| v_cost_by_folder | TELEMETRY.v_cost_by_folder | Admin pages |
| v_search_analytics | TELEMETRY.v_search_analytics | Admin pages |
| v_quality_metrics | TELEMETRY.v_quality_metrics | Admin pages |
| v_error_summary | TELEMETRY.v_error_summary | Admin pages |
| v_agent_audit_log | TELEMETRY.agent_audit_log | Leaves out search_query, analyst_question, generated_sql, and response_text |

---

## Schema: SERVICES (Cortex AI Services)

### `doc_search_svc` and `doc_page_search_svc`

Cortex Search services over `document_catalog` and `document_pages`. See `API_REFERENCE.md` for filterable and returnable columns.

### `document_analytics_sv`

**Purpose:** Semantic view over `document_catalog` that lets Cortex Analyst turn questions into SQL. It is the `doc_analytics` tool of the Doc Intelligence agent, which answers analytics questions in the chat and in the Overview page's Ask a Question box. The `/api/analyst` route also uses it.

**Source:** `DOC_INTEL.DATA.document_catalog` (not the row-access-protected APP view; see `API_REFERENCE.md`)

**Access:** SELECT and REFERENCES granted to `DOC_INTEL_USER`

**Dimensions:**

| Name | Type | Description |
|---|---|---|
| `file_path` | STRING | Path to the source file on its stage |
| `src_file_id` | STRING | Source-system file ID |
| `source_folder` | STRING | Source folder the document came from |
| `src_assigned_to` | STRING | Person assigned in the source system |
| `src_reference_number` | STRING | Reference number from the source system |
| `src_case_number` | STRING | Case number from the source system |
| `document_type` | STRING | AI-assigned document type (for example Contract, Invoice, Report) |
| `file_format` | STRING | Source format: TIFF, PDF, DOCX, JPEG, PNG, HTML, TXT |
| `needs_review` | BOOLEAN | TRUE if the document is flagged for review |
| `party_name` | STRING | Main person or organization the document is about |
| `issuer_name` | STRING | Organization that issued the document |
| `counterparty_name` | STRING | Other party named in the document, such as a vendor, customer, or agent |
| `line_of_business` | STRING | Line of business (for example General, Finance, Operations, Legal, Human Resources) |
| `doc_subtype` | STRING | More specific document subtype |
| `doc_status` | STRING | Status as the document states it (for example draft, active, approved, open, closed, expired) |
| `start_date` | DATE | Start or effective date |
| `end_date` | DATE | End, expiration, or due date |
| `upload_timestamp` | TIMESTAMP | When the document was first seen on a stage |

**Metrics:**

| Name | Expression | Description |
|---|---|---|
| `document_count` | COUNT(*) | Number of documents |
| `avg_confidence` | AVG(classification_confidence) | Average AI classification confidence |
| `total_pages` | SUM(page_count) | Total pages across documents |

Other catalog columns (amounts, key terms, event date, summary) are not in the semantic view. The agent answers questions about them through `doc_search`.

**Example analytics questions (handled by Cortex Analyst):**
- "How many documents do we have by line of business?"
- "Show document counts by type for each month this year"
- "Which document types have the lowest average confidence?"
- "How many contracts end in the next 90 days?"
- "Which issuers have the most documents?"
- "What is the average page count by document type?"

### `doc_intelligence_agent`

Cortex Agent with two tools: `doc_search` (on `doc_search_svc`) and `doc_analytics` (on `document_analytics_sv`). See `API_REFERENCE.md`.
