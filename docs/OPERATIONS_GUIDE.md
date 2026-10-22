# Document Intelligence: Operations Guide

## Setup Reference

The README stays high level. The details Cortex Code and hands-on admins need are here.

### Prerequisites

- Snowflake CLI 3.28 or later (`snow`). Older 3.x releases may lack the App Runtime commands. Connect with `snow connection add`, then `snow connection test`.
- python3 (the scripts read CLI output with it) and bash (on Windows, use WSL or Git Bash). Node.js is not needed: the app builds inside Snowflake.
- Cortex AI and Snowflake App Runtime available in your account and region.
- ACCOUNTADMIN once, for account setup (`provision.sh`). After that, `DOC_INTEL_ADMIN` is enough.
- The app build downloads npm packages through an external access integration limited to the npm registry and nodejs.org.

### When an admin provisions for you

Setup grants the roles to whoever runs it. An admin who runs it for you either sets your user first, `DOC_INTEL_DEFAULT_USER=YOUR_USER ./provision.sh`, or afterwards runs `GRANT ROLE DOC_INTEL_ADMIN TO USER YOUR_USER;`. They can also run `sql/00_account_permissions.sql` in a worksheet.

### Setup by hand

```bash
./quickstart.sh /path/to/your/documents --connection=MY_CONNECTION
```

That runs three steps you can also run one at a time:

```bash
./provision.sh --connection=MY_CONNECTION        # once, as ACCOUNTADMIN: roles, warehouses, compute pool, integration
./deploy.sh --connection=MY_CONNECTION           # database objects, pipeline, search, agent, app (safe to re-run)
./scripts/upload_docs.sh /path/to/docs --connection=MY_CONNECTION
```

Then wait for processing and open the app:

```bash
./scripts/upload_docs.sh --status --connection=MY_CONNECTION    # repeat until nothing is PENDING or PROCESSING
./scripts/upload_docs.sh --refresh --connection=MY_CONNECTION   # show finished files now (otherwise up to 1 hour)
(cd app && snow app open --role DOC_INTEL_ADMIN --connection MY_CONNECTION)
```

- Every script takes `--connection=NAME`. Leave it off to use your default connection, or set `SNOW_CONNECTION` in `config/deploy.config`.
- "permission denied" usually means the repo was downloaded as a zip. Run `chmod +x *.sh scripts/*.sh` once, or start scripts with `bash`.

| Step | About (20-document test set) |
|---|---|
| Account setup (`provision.sh`) | 3–5 min, once per account |
| Deploy (`deploy.sh`) | 15–25 min, mostly the app build |
| Upload and process | 10–20 min |
| Refresh and open | ~5 min |

Every `./deploy.sh` repeats the app build. It keeps documents and processed data.

### Supported files

PDF, DOCX, PPTX, TIF/TIFF, JPG/JPEG, PNG, HTML, TXT. Other files are skipped. Limit per file: 2,000 pages and 100 MB; larger files show as FAILED in Ingestion Registry. Files land in `@DOC_INTEL.DATA.doc_stage/documents/`; sub-folders are kept and a file with the same name replaces the old one.

### Customizing by hand

| To change | Edit |
|---|---|
| Document types | `config/classification_labels.csv`, or the Classification Labels tab |
| Lines of business | `config/lobs.csv`, or the Lines of Business tab |
| What each field slot means (AI prompt) | `sql/03_processing.sql`, in `sp_extract_document_attributes`: change descriptions, keep keys |
| On-screen field names | `app/lib/field-labels.ts` |
| Test Lab extra fields | `config/extraction_schemas.csv`, or the Extraction Schema tab |
| Suggested searches | `config/suggested_searches.csv`, or the Suggested Searches tab |
| App roles | `config/roles.csv`, or the User Management tab |
| Branding | `app/theme.config.ts` (`appName`, `appSubtitle`, colors, `logoUrl` in `app/public/`); the deployed app doesn't read `.env` |
| Tabs | `app/lib/app-pages.ts` (label, order, section); page heading in `app/app/<page>/page.tsx`; Help entry in `app/app/help/page.tsx`; icons in `app/components/app-sidebar.tsx` |
| Agent | `sql/05_intelligence.sql` (`doc_intelligence_agent`); app model default `CORTEX_MODEL` in `app/lib/db.ts` |
| Object and role names | `./scripts/rename.sh --prefix=ACME_DOCS --dry-run`, then without `--dry-run`; `--admin-role=`, `--user-role=`, `--pipeline-role=` override single roles |

- Each deploy reloads the CSVs in `config/` and turns their rows back on, so the CSVs are the source of truth. To drop a starter value, delete its CSV row and switch it off in its tab. A deploy also resets any app role listed in `config/roles.csv`.
- To hide a tab from everyone, remove its key from every row in `config/roles.csv` and uncheck it in User Management. Don't delete it from `app-pages.ts`: unlisted pages aren't guarded.
- Admin tabs also need the `DOC_INTEL_ADMIN` Snowflake role, or they show errors even when the app role allows them.
- Rename before the first deploy. Renaming after deploying and running `./quickstart.sh` again creates a separate copy under the new names (useful for test and prod in one account).
- After changing types or prompts, reprocess once (see [Bulk Reprocess](#bulk-reprocess)). Review Queue corrections belong to the old version of each document and don't carry over.

### Throughput and credits

- Parsing runs at about 100–120 pages a minute (one measured run). Each run takes at most 100 documents (`batch_size`). Every upload starts a run; `upload_docs.sh --drain` keeps starting runs until nothing is waiting. Larger warehouses don't speed up parsing.
- `DOC_INTEL_WH` (Medium) runs the AI steps and suspends after 2 idle minutes. It also wakes for each scheduled run (daily by default); see [Pipeline Schedule](#pipeline-schedule). The three alerts check once a day on `DOC_INTEL_QUERY_WH`.
- `DOC_INTEL_QUERY_WH` (X-Small) serves the app and suspends after 1 idle minute. Cortex Search and dynamic tables refresh hourly. The `DOC_MONITOR_POOL` compute pool (CPU_X64_S) builds the app. Sizes are set in `provision.sh`.
- Cortex AI functions bill per page; a bulk reprocess costs about as much as the first run. Check real spend in Snowsight under Admin → Cost Management.

### Quick fixes

| Problem | Fix |
|---|---|
| `ACCOUNTADMIN role required` | An account admin runs `./provision.sh` once. |
| `DOC_INTEL_ADMIN role required` after an admin provisioned | `GRANT ROLE DOC_INTEL_ADMIN TO USER YOUR_USER;` |
| Files stay PENDING | Tasks may be suspended: `SHOW TASKS IN SCHEMA DOC_INTEL.DATA;` See [Suspend/Resume Tasks](#suspendresume-tasks). |
| Files COMPLETE but not in the app | `./scripts/upload_docs.sh --refresh` |
| A user sees no documents | Give them an app role in User Management → Users. |
| App deploy failed | `cd app && snow app events --role DOC_INTEL_ADMIN`, fix, re-run `./deploy.sh`. |

### Repository layout

```
quickstart.sh            provision (if needed) + deploy + upload
provision.sh             one-time account setup (ACCOUNTADMIN)
deploy.sh                database objects, pipeline, search, agent, app (safe to re-run)
config/                  deploy.config (connection, names) and starter CSVs
scripts/                 upload_docs.sh (upload, status, refresh), rename.sh
sql/                     01–12 run in order by deploy.sh; 00 is the SQL form of provision.sh
app/                     Next.js app (Snowflake App Runtime)
docs/                    user, operations, data, and API reference
.snowflake/cortex/skills/doc-intel-setup/   the Cortex Code skill
```

## Loading Documents

Document Intelligence processes the files you load into Snowflake. There is no connector to an outside document system.

**Bulk loads:** Use `scripts/upload_docs.sh` to copy your files to `@DOC_INTEL.DATA.doc_stage`. The pipeline only registers files under the stage's `documents/` prefix, so keep them there.

**A few files:** Use **Pipeline Management → Upload** in the app (up to 50MB per file). These files go to `@DOC_INTEL.DATA.doc_stage/documents/`, the same place as bulk loads.

Supported formats: TIF, TIFF, PDF, DOCX, PPTX, JPG, JPEG, PNG, HTML, TXT.

Both upload paths start a pipeline run right away. A run takes up to 100 documents (`batch_size`), so for a load larger than that use `./scripts/upload_docs.sh <folder> --drain`, which starts runs back to back until nothing is waiting and then refreshes the catalog and search. Files put on the stage another way wait for the next scheduled run (see [Pipeline Schedule](#pipeline-schedule)), or start one yourself:

```sql
EXECUTE TASK DOC_INTEL.DATA.task_01_register_files;
```

Before loading, tailor the starter config to your documents: classification labels, lines of business, extraction schema, suggested searches, and roles (see [Updating the Starter Configuration](#updating-the-starter-configuration)).

---

## Daily Operations

### Check Pipeline Health

```sql
SELECT * FROM DOC_INTEL.TELEMETRY.v_pipeline_health;
```

**Healthy:** `pending_count = 0`, `failed_count = 0`, `processing_count = 0`  
**Act on:** `pending_count > 500` (check tasks), `failed_count > 0` (review errors), `abandoned_count > 0` (files that failed `max_processing_attempts` times)

### Check for Errors

```sql
SELECT * FROM DOC_INTEL.TELEMETRY.v_error_summary
WHERE error_date = CURRENT_DATE()
ORDER BY occurrence_count DESC;
```

The pipeline records most errors on the registry row rather than as events, so also check:

```sql
SELECT error_stage, last_error, COUNT(*) AS files
FROM DOC_INTEL.DATA.ingestion_registry
WHERE ingestion_status IN ('FAILED', 'ABANDONED')
GROUP BY 1, 2 ORDER BY 3 DESC;
```

### Check Alerts

```sql
SELECT event_time, metadata:alert_type::VARCHAR AS alert_type
FROM DOC_INTEL.TELEMETRY.pipeline_events
WHERE event_type = 'PIPELINE_ALERT'
  AND event_time >= DATEADD('DAY', -1, CURRENT_TIMESTAMP())
ORDER BY event_time DESC;
```

### Monitor Cost

The pipeline does not yet write credit figures to `pipeline_events`, so `v_cost_by_folder` and the Cost Dashboard show activity, not spend. For real warehouse spend, use account usage (needs a role that can read `SNOWFLAKE.ACCOUNT_USAGE`):

```sql
SELECT DATE_TRUNC('DAY', start_time) AS usage_date,
       warehouse_name,
       SUM(credits_used) AS credits
FROM SNOWFLAKE.ACCOUNT_USAGE.WAREHOUSE_METERING_HISTORY
WHERE warehouse_name IN ('DOC_INTEL_WH', 'DOC_INTEL_QUERY_WH')
  AND start_time >= DATEADD('DAY', -7, CURRENT_TIMESTAMP())
GROUP BY 1, 2 ORDER BY 1 DESC, 2;
```

Cortex AI function, Cortex Search, and agent costs are billed separately from warehouse time; check them in Snowsight's cost management pages.

---

## Weekly Operations

### Review Low-Confidence Classifications

```sql
SELECT file_path, source_folder, primary_document_type, all_document_types, confidence_score
FROM DOC_INTEL.DATA.classified_documents
WHERE needs_review = TRUE
  AND classified_at >= DATEADD('DAY', -7, CURRENT_TIMESTAMP())
ORDER BY confidence_score ASC;
```

A document needs review when AI_CLASSIFY returns three or more labels. If one pair of labels keeps showing up together, make them easier to tell apart: rename one, merge them, or disable one (see [Updating the Classification Taxonomy](#updating-the-classification-taxonomy)).

### Review Pending Overrides

```sql
SELECT * FROM DOC_INTEL.ADMIN.extraction_overrides
WHERE override_status = 'PENDING'
  AND field_name <> '__review_status__'   -- skip Review Queue decisions
ORDER BY submitted_at ASC;
```

Approve in **Quality & Feedback**, or: `CALL DOC_INTEL.ADMIN.sp_approve_override('<override_id>');`

The catalog applies approved corrections to these fields only: `document_date`, `party_name`, `reference_number`, `case_number`, `issuer_name`, `counterparty_name`, `line_of_business`, `doc_subtype`, `key_terms`, `doc_status`. Corrections to other fields (for example `document_type`, `start_date`, `end_date`) are stored but do not change the catalog.

### Check Search Quality

User feedback on search results and chat answers:

```sql
SELECT DATE_TRUNC('DAY', submitted_at) AS day,
       feedback_type,
       COUNT(*) AS votes
FROM DOC_INTEL.ADMIN.search_feedback
WHERE submitted_at >= DATEADD('DAY', -7, CURRENT_TIMESTAMP())
GROUP BY 1, 2 ORDER BY 1 DESC, 2;
```

`TELEMETRY.v_search_analytics` reports query counts, latency, and feedback from `agent_audit_log`. Nothing in the app writes to that table yet, so the view stays empty until you add agent logging.

---

## Pipeline Management

### Force-Reprocess a Single Document

```sql
CALL DOC_INTEL.DATA.sp_force_reprocess(
    'documents/my-document.pdf',
    'Content changed on source system'
);
```

Use this after you overwrite a file on the stage with a new copy under the same path. Registration does not detect changed files by itself.

### Bulk Reprocess

```sql
-- Dry run (returns a reminder only; it does not count rows)
CALL DOC_INTEL.DATA.sp_bulk_reprocess(NULL, 'PDF', TRUE);

-- Check how many documents match first
SELECT COUNT(*) FROM DOC_INTEL.DATA.ingestion_registry
WHERE ingestion_status = 'COMPLETE' AND file_format = 'PDF';

-- Run it
CALL DOC_INTEL.DATA.sp_bulk_reprocess(NULL, 'PDF', FALSE);
```

The first argument filters by `source_folder`. It is empty unless you load source-system metadata, so pass `NULL`. For a filtered reprocess with a match count, use the Reprocess tab in Pipeline Management.

### Pipeline Schedule

`task_01_register_files` starts the pipeline on a schedule set by `DOC_INTEL_PIPELINE_SCHEDULE` in `config/deploy.config`; `deploy.sh` applies it. The default is once a day at 06:00 UTC. Uploads start their own runs, so the schedule only matters for files that arrive between uploads. Choose the slowest schedule that works: each scheduled run wakes `DOC_INTEL_WH`, even when there's nothing to process.

| Setting | Runs |
|---|---|
| `USING CRON 0 6 * * * UTC` (default) | Daily |
| `USING CRON 0 6 * * 1 UTC` | Weekly, Mondays |
| `60 MINUTES` | Hourly (wakes the warehouse 24 times a day) |
| `MANUAL` | Only when you upload or run `EXECUTE TASK` |

To change it without a full deploy, set the value in `config/deploy.config` (so later deploys keep it) and run, as `DOC_INTEL_ADMIN`:

```sql
ALTER TASK DOC_INTEL.DATA.task_01_register_files SUSPEND;
ALTER TASK DOC_INTEL.DATA.task_01_register_files SET SCHEDULE = 'USING CRON 0 6 * * * UTC';
ALTER TASK DOC_INTEL.DATA.task_01_register_files RESUME;   -- leave suspended for MANUAL
```

A scheduled run processes up to `batch_size` documents. If more than that regularly arrive between runs, load them with `upload_docs.sh --drain`, or raise `batch_size` in the Configuration tab. Keep a run under about 1,500 pages: the parse step stops after 20 minutes.

### Suspend/Resume Tasks

```sql
-- Suspend (maintenance window)
ALTER TASK DOC_INTEL.DATA.task_01_register_files SUSPEND;

-- Resume
ALTER TASK DOC_INTEL.DATA.task_01_register_files RESUME;
```

The task graph is `task_01_register_files` → `task_02_parse_documents` → `task_03_classify_documents` → `task_04_extract_attributes` → `task_05_emit_metrics`. Suspending the first task stops the whole run. To resume the full graph, resume from the last task back to the first, as `deploy.sh` does.

Every run goes through all five tasks, and each step processes whatever is waiting for it (new files, new versions from a reprocess, and FAILED files that registration moved back to PENDING). To process waiting files now instead of at the next scheduled run, click **Parse Documents** on the Run Pipeline tab, or run:

```sql
CALL DOC_INTEL.DATA.sp_parse_pending_documents();
CALL DOC_INTEL.DATA.sp_classify_parsed_documents();
CALL DOC_INTEL.DATA.sp_extract_document_attributes();
```

### Reset Stuck PROCESSING Documents

`sp_register_new_files` already marks PROCESSING rows older than `processing_timeout_minutes` (default 30) as FAILED, and they then retry. To push them back to PENDING at once:

```sql
-- If tasks died mid-run, PROCESSING documents may be stuck
CALL DOC_INTEL.ADMIN.sp_reset_pipeline('CONFIRM_RESET');
```

### Settings the Pipeline Reads

| `ADMIN.system_config` key | Default | Effect |
|---|---|---|
| `batch_size` | 100 | Most documents parsed per run |
| `max_processing_attempts` | 3 | Failures before a file is ABANDONED |
| `processing_timeout_minutes` | 30 | Minutes before a stuck PROCESSING row is marked FAILED |

Other keys on the Configuration page are stored for your use but nothing reads them yet. These behaviors are set in the SQL scripts instead:

| Behavior | Where |
|---|---|
| Review rule (three or more labels) and confidence values | `sp_classify_parsed_documents` in `sql/03_processing.sql` |
| Extraction fields and prompts | `sp_extract_document_attributes` in `sql/03_processing.sql` |
| Agent model, budget, and instructions | `doc_intelligence_agent` in `sql/05_intelligence.sql` |
| Alert limits (5% errors, 500 pending, 20% needing review) | Alerts in `sql/04_telemetry.sql` |
| Target lag (1 hour) | Dynamic tables in `sql/03_processing.sql`, search services in `sql/05_intelligence.sql` |

---

## Common Troubleshooting

### Documents Not Appearing in Search

1. Check that the file is under `documents/` on `doc_stage` (or on `sample_stage`) and has a supported extension:
   ```sql
   SELECT * FROM DOC_INTEL.DATA.v_stage_files WHERE file_path ILIKE '%my-file%';
   ```
2. Check `ingestion_status` in the registry:
   ```sql
   SELECT ingestion_status, COUNT(*) FROM DOC_INTEL.DATA.ingestion_registry GROUP BY 1;
   ```
3. If PENDING: tasks may be suspended. Check `SHOW TASKS IN SCHEMA DOC_INTEL.DATA;`
4. If COMPLETE but not in the catalog: the Dynamic Table may not have refreshed. Check `SHOW DYNAMIC TABLES IN SCHEMA DOC_INTEL.DATA;`
5. If in the catalog but not in search: Cortex Search may still be indexing. Wait for its 1-hour target lag.
6. If search finds it but a user cannot see it: check the user's app roles. Their LOB and document type access must include the document's `line_of_business` and `document_type`.

### High Error Rate

1. Check error details:
   ```sql
   SELECT last_error, error_stage, COUNT(*) FROM DOC_INTEL.DATA.ingestion_registry
   WHERE ingestion_status IN ('FAILED', 'ABANDONED') GROUP BY 1,2 ORDER BY 3 DESC;
   ```
2. Common causes:
   - File too large: split it, or process it on its own
   - Unsupported format: check the extension is in the supported list
   - OCR failure: the file may be damaged or password-protected
   - Timeout (`error_stage = 'TIMEOUT'`): a run took longer than `processing_timeout_minutes`; lower `batch_size` or raise the timeout
   - Network timeout: a retry usually fixes it

Each failing step marks the whole batch it was working on as FAILED, so one bad file can fail its batch. The pipeline retries failed files; a bad file then reaches ABANDONED while the rest complete.

### Cortex Search Not Returning Results

1. Check the search services:
   ```sql
   SHOW CORTEX SEARCH SERVICES IN SCHEMA DOC_INTEL.SERVICES;
   ```
2. Check that document_catalog has rows:
   ```sql
   SELECT COUNT(*) FROM DOC_INTEL.DATA.document_catalog;
   ```
3. Test with SEARCH_PREVIEW:
   ```sql
   SELECT PARSE_JSON(SNOWFLAKE.CORTEX.SEARCH_PREVIEW(
       'DOC_INTEL.SERVICES.doc_search_svc',
       '{"query":"test","columns":["document_type"],"limit":3}'
   ))['results'];
   ```

### A User Sees Pages but No Documents

Users who hold a DOC_INTEL Snowflake role but have no app role assignment can open the user pages, but the row access policy shows them no documents. Assign an app role in **User Management**.

### A User Cannot Open a Page

A page missing from a user's app roles is hidden from the sidebar and blocked by URL ("*Page* is not available for your role"). Turn it on under **User Management → Roles → App Pages**.

---

## Adding a New User

1. Grant the Snowflake role:

```sql
USE ROLE SECURITYADMIN;

-- Standard user (browse, search, review, agent)
GRANT ROLE DOC_INTEL_USER TO USER new_user;

-- Admin (adds the admin pages and routes)
GRANT ROLE DOC_INTEL_ADMIN TO USER admin_user;
```

`DOC_INTEL_PIPELINE` runs the automated tasks. Do not grant it to people; it bypasses the row access policy.

2. Assign app roles in **User Management → Users** (**Add User**, or **Sync from Roles** to register everyone who holds a DOC_INTEL role). The starter app roles are Administrator, Analyst, Finance Reviewer, and Viewer. A user can hold several.

3. Share the app URL. From the `app/` folder, run:
```bash
snow app open --print-only --role DOC_INTEL_ADMIN
```

---

## Updating the Starter Configuration

The `config/` folder holds the starter setup. Edit these CSVs to fit your documents, then run `./deploy.sh` (or `./deploy.sh --infra-only` to skip the app). Each run uploads the CSVs to `@DOC_INTEL.ADMIN.config_stage` and MERGEs them into the tables (`sql/10_seed_config.sql`).

| File | Table | Starter content |
|---|---|---|
| `classification_labels.csv` | `ADMIN.classification_labels` | 15 labels in Contracts, Financial, Operations, Correspondence, Compliance, Other |
| `lobs.csv` | `ADMIN.lines_of_business` | GEN, FIN, OPS, LEG, HR |
| `extraction_schemas.csv` | `ADMIN.extraction_schemas` | Common fields plus per-category fields |
| `roles.csv` | `ADMIN.entitlement_roles` | Administrator, Analyst, Finance Reviewer, Viewer |
| `suggested_searches.csv` | `ADMIN.suggested_searches` | Starter searches per LOB |

Each deploy reloads the CSVs and turns their rows back on, so the CSVs are the source of truth. Changes made in the Admin UI to rows that are in a CSV are undone by the next deploy, so make lasting changes in the CSV. The MERGE never deletes rows you removed from a CSV: switch those off in the Admin UI or with SQL.

---

## Updating the Classification Taxonomy

Manage labels and categories in the Admin UI:

1. Go to **AI Config → Classification Labels**
2. **Add a label:** Enter a name, pick (or create) a category, click Add
3. **Create a category:** Click the folder+ icon next to the category list
4. **Rename a category:** Click the pencil icon on the category header
5. **Delete a category:** Click the trash icon on the category header (removes all its labels)
6. **Disable a label:** Turn the switch off (the AI stops using it for new documents)

Changes apply to newly classified documents. To reclassify existing documents, use the Reprocess tab in Pipeline Management.

Role document type access matches by text, so if you rename a label, check any role that lists the old name.

**SQL alternative:**
```sql
-- Add a label
INSERT INTO DOC_INTEL.ADMIN.classification_labels (label, category, sort_order, is_active)
VALUES ('Service Agreement', 'Contracts', 100, TRUE);

-- Reclassify existing documents
CALL DOC_INTEL.DATA.sp_bulk_reprocess(NULL, NULL, FALSE);
```

**CSV alternative (best for bulk or repeatable changes):** Edit `config/classification_labels.csv`, then run `./deploy.sh` (see above).

---

## Managing Lines of Business

Manage lines of business in the Admin UI. The extraction step reads the active LOB names from this table every run, so adding or removing a LOB needs no code change.

1. Go to **AI Config → Lines of Business**
2. **Add a LOB:** Click "Add LOB", enter a code (for example `PROC`), a name (for example `Procurement`), and an optional description
3. **Edit a LOB:** Click the pencil icon to edit the name or description
4. **Disable a LOB:** Turn the switch off (the AI stops assigning it to new documents)
5. **Delete a LOB:** Click the trash icon (existing documents keep their value)

**Important:**
- The AI picks a LOB by **name**. Use clear, distinct names.
- Role LOB access and Suggested Searches use the **code**. The row access policy matches both the code and the name, so a role with `FIN` sees documents tagged "Finance".
- LOB-specific extraction schema rows use the code in `match_rule`, for example `{"category":"Financial", "lob":"FIN"}`. These rows apply in the Test Lab.

**SQL alternative:**
```sql
-- Add a LOB
INSERT INTO DOC_INTEL.ADMIN.lines_of_business (lob_code, lob_name, description, sort_order)
VALUES ('PROC', 'Procurement', 'Supplier contracts, purchase orders, and bids', 6);

-- View active LOBs
SELECT lob_code, lob_name FROM DOC_INTEL.ADMIN.lines_of_business
WHERE is_active = TRUE ORDER BY sort_order;
```

**CSV alternative (best for bulk or repeatable changes):** Edit `config/lobs.csv`, then run `./deploy.sh`.

The CSV format is: `lob_code,lob_name,description,is_default,sort_order`

---

## Backup & Recovery

Every derived table can be rebuilt from the files on the stages. The files themselves live in `DOC_INTEL.DATA.doc_stage` and `sample_stage`, inside the database.

1. **Registry only:** Run `CALL DOC_INTEL.DATA.sp_register_new_files();` — it rebuilds from the stages
2. **Parsed documents:** Reprocess with `sp_bulk_reprocess` or `sp_force_reprocess`
3. **Objects:** `./deploy.sh` is safe to re-run. It recreates procedures, tasks, search services, the agent, and the app without touching your documents or processed data.
4. **Source documents:** the files live in stages inside the `DOC_INTEL` database. If the database is dropped, they go with it. Keep your own copy of the originals so you can reload them. If the database was dropped by mistake, `UNDROP DATABASE DOC_INTEL` can restore it within its Time Travel retention period.

Corrections, saved searches, bookmarks, and role assignments live in the ADMIN schema. A full rebuild loses them unless you export them first.

---

## Scaling Considerations

| Dimension | Guidance |
|---|---|
| > 1M documents | Consider raising `DOC_INTEL_WH` to LARGE during the first bulk load, and raise `batch_size` |
| High query volume | Create more query warehouses for different user groups (the agent's analytics queries run on `DOC_INTEL_QUERY_WH`; the app uses the warehouse in its `SNOWFLAKE_WAREHOUSE` setting) |
| Model availability | If a Cortex model is not offered in your region, an account admin can turn on cross-region inference (account parameter `CORTEX_ENABLED_CROSS_REGION`) |
| Faster freshness | Lower `TARGET_LAG` on the dynamic tables and Cortex Search services, and shorten the [pipeline schedule](#pipeline-schedule) (daily by default) |
