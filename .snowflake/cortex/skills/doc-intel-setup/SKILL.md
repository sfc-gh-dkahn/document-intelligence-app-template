---
name: doc-intel-setup
description: Set up, tailor, and customize this Document Intelligence app (Next.js on Snowflake App Runtime + Cortex AI pipeline) from this repo. Use when the user says set up document intelligence, build the document intelligence app, tailor document intelligence to my business, make document intelligence mine (or the short forms set up doc intel, tailor doc intel to my business, make doc intel mine), deploy this app, load my documents, customize the app, rename roles, change branding, change permissions, or hide tabs.
---

# Document Intelligence setup

This repo deploys a document intelligence app into the user's Snowflake account: a Cortex AI pipeline (parse, classify, extract), Cortex Search, a Cortex Agent, and a Next.js app on Snowflake App Runtime. The user brings their own documents.

Three modes. Pick from the request; default to **Quick start** if nothing is deployed yet.

| Mode | When | Questions before acting |
|---|---|---|
| Quick start | "set up", "deploy", "build it" | 2 |
| Tailor to my business | after documents are processed | 0, then one approval |
| Make it yours | branding, names, roles, permissions, tabs | menu |

Ground rules:
- Run every command from the repo root. All scripts accept `--connection=NAME`. If a script fails with "permission denied", run it as `bash <script>` (this can happen with a downloaded zip).
- The scripts need bash. On Windows, tell the user to use WSL or Git Bash.
- Never drop Snowflake objects or delete uploaded documents.
- Don't invent facts about the user's business. Everything in a proposal must come from their documents.
- Keep messages short. Show progress at each step.

---

## Mode 1: Quick start

**Goal:** a working app URL with the user's documents in it, after two questions (a third only if their folder is large), then one question about how often new documents arrive.

1. Check tools silently: `snow --version` (needs 3.28 or later) and `python3 --version`. If either is missing, say how to install it and stop.
2. Run `snow connection list`. Then ask both questions in **one** `ask_user_question` call:
   - Which connection (options from the list; default = the one marked default).
   - Path to a folder of their documents (text input). Mention: PDF, Word, PowerPoint, images, HTML, text; start with about 20 typical files.
3. Size the folder before uploading: count supported files and total size (`find "<folder>" -type f \( -iname '*.pdf' -o -iname '*.docx' -o -iname '*.pptx' -o -iname '*.tif' -o -iname '*.tiff' -o -iname '*.jpg' -o -iname '*.jpeg' -o -iname '*.png' -o -iname '*.html' -o -iname '*.txt' \) | wc -l` and `du -sh "<folder>"`). If it has more than 50 files or more than 100 MB, stop and tell the user plainly:
   - Every page is billed (Snowflake bills document parsing per page), and tailoring later reprocesses, and re-bills, every document.
   - Each pipeline run takes up to 100 documents, so a large folder takes many runs.
   - Recommend copying about 20 typical files to a new folder, running quick start on that, tailoring, and then loading the rest with `bash scripts/upload_docs.sh <folder> --drain`.
   Ask once whether to use a small sample or the whole folder, and do what they choose.
4. Run `bash quickstart.sh "<folder>" --connection=<name>` in the background. Tell the user it sets up the account if needed, deploys the pipeline and app (the app build is part of this), and uploads their files. Report each `=== Step` line.
   - **"ACCOUNTADMIN role required"**: provisioning needs an account admin once. Tell the user to have an admin run `./provision.sh --connection=<name>` (or `sql/00_account_permissions.sql` in a worksheet), then re-run quick start. Stop here.
   - **"DOC_INTEL_ADMIN role required"**: provisioning hasn't run, or an admin ran it as their own user. Run `bash provision.sh --check --connection=<name>`. If the roles exist, tell the user to ask the admin for `GRANT ROLE DOC_INTEL_ADMIN TO USER <user>;`. When an admin provisions for someone else, they run `DOC_INTEL_DEFAULT_USER=<user> ./provision.sh`. Stop here.
   - Any other failure: show the last 20 lines and see [reference/troubleshooting.md](reference/troubleshooting.md).
5. Poll `bash scripts/upload_docs.sh --status --connection=<name>` every 60 seconds until nothing is PENDING or PROCESSING (cap 20 minutes for a test set). Then run `bash scripts/upload_docs.sh --refresh --connection=<name>`. If the user chose a folder of more than 100 files, instead run `bash scripts/upload_docs.sh --drain --connection=<name>` in the background: one run takes only 100 documents, and `--drain` starts runs back to back until nothing is waiting, then refreshes. Report progress and tell the user they can come back later.
6. Get the URL: `cd app && snow app open --print-only --role DOC_INTEL_ADMIN --connection <name>`. Open it with `open_browser`. The user signs in with the same Snowflake user.
7. Set the schedule. The pipeline checks for new files once a day by default, and every upload through `upload_docs.sh` starts a run right away, so the schedule only matters for files that arrive between uploads. Pick the slowest schedule that works: each scheduled run wakes the pipeline warehouse. Ask both questions in **one** `ask_user_question` call:
   - How often new documents will arrive: once or rarely (schedule `MANUAL`, runs only on upload), daily (**default**, `USING CRON 0 6 * * * UTC`), weekly (`USING CRON 0 6 * * 1 UTC`), or must be searchable within the hour (`60 MINUTES`; say it wakes the warehouse 24 times a day).
   - About how many documents arrive each time: under 100, 100 to 1,000, or more than 1,000.
   Apply it: set `DOC_INTEL_PIPELINE_SCHEDULE` in `config/deploy.config` (so later deploys keep it), then run as `DOC_INTEL_ADMIN`:
   ```sql
   ALTER TASK DOC_INTEL.DATA.task_01_register_files SUSPEND;
   ALTER TASK DOC_INTEL.DATA.task_01_register_files SET SCHEDULE = '<schedule>';  -- skip for MANUAL
   ALTER TASK DOC_INTEL.DATA.task_01_register_files RESUME;                       -- skip for MANUAL
   ```
   If more than 100 documents arrive at a time, explain that a scheduled run processes 100. Recommend loading big drops with `upload_docs.sh <folder> --drain`. If files land on the stage another way and regularly exceed 100 per run, offer to raise `batch_size` in the Configuration tab. The parse step stops after 20 minutes (its task timeout), so raise it in small steps and check the Ingestion Registry for timeouts.
8. Explain cost. Show this table as written, then one line: "Snowsight → Admin → Cost Management shows total spend. The app's Cost Dashboard tab shows pipeline activity, not spend."

   | Cost source | What drives it | How to track it |
   |---|---|---|
   | AI parsing, sorting, extraction | Parsing bills per page; sorting and extraction bill per token. Reprocessing pays again. | `SNOWFLAKE.ACCOUNT_USAGE.CORTEX_AI_FUNCTIONS_USAGE_HISTORY` |
   | Pipeline warehouse `DOC_INTEL_WH` (Medium) | Processing, a brief wake for each scheduled run, and catalog and search refreshes (checked hourly; uses compute only when documents changed) | `WAREHOUSE_METERING_HISTORY` |
   | The app (Snowflake App Runtime) | Runs all the time until suspended, even with no one using it | `SNOWFLAKE_APP_RUNTIME_COMPUTE_HISTORY` |
   | Build compute pool `DOC_MONITOR_POOL` (CPU_X64_S) | Created by the template; billed while active, set to suspend after 5 minutes with nothing running | `SNOWPARK_CONTAINER_SERVICES_HISTORY` |
   | Cortex Search | Size of the indexed text, billed while the service is running even with no searches, plus embedding new or changed text | `CORTEX_SEARCH_DAILY_USAGE_HISTORY` |
   | Agent and Cortex Analyst | Each question asked | `CORTEX_AGENT_USAGE_HISTORY` |
   | Query warehouse `DOC_INTEL_QUERY_WH` (X-Small) | App queries and the daily alerts | `WAREHOUSE_METERING_HISTORY` |

   Snowflake's details: [AI functions](https://docs.snowflake.com/en/user-guide/snowflake-cortex/aisql-cost), [App Runtime](https://docs.snowflake.com/en/developer-guide/snowflake-app-runtime/cost), [Cortex Search](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-search/cortex-search-costs), [dynamic tables](https://docs.snowflake.com/en/user-guide/dynamic-tables/cost).

   Then ask one `ask_user_question`: how should the app run? Explain that the app bills while it runs, even when no one is using it.
   - **Always on** (default): bills while running, including when no one is using it.
   - **Sleep when idle**: suspends after 15 minutes without use and resumes on the next visit.
   - **Off until I turn it on**: suspended; no App Runtime compute until they resume it.

   Apply it as `DOC_INTEL_ADMIN`:
   - Always on: set `DOC_INTEL_APP_IDLE_SUSPEND_SECS=0` in `config/deploy.config` and run `ALTER APPLICATION SERVICE DOC_INTEL.APP_SERVICE.DOC_INTEL_APP SET AUTO_SUSPEND_SECS = 0;`
   - Sleep when idle: set `DOC_INTEL_APP_IDLE_SUSPEND_SECS=900` and run `ALTER APPLICATION SERVICE DOC_INTEL.APP_SERVICE.DOC_INTEL_APP SET AUTO_SUSPEND_SECS = 900 AUTO_RESUME = TRUE;`
   - Off: run `ALTER APPLICATION SERVICE DOC_INTEL.APP_SERVICE.DOC_INTEL_APP SUSPEND;` Tell them `RESUME` turns it back on, and that after a redeploy they should check `SHOW APPLICATION SERVICES IN SCHEMA DOC_INTEL.APP_SERVICE;` and suspend it again if it's running.

   Saving the setting in `config/deploy.config` keeps it across deploys. The `ACCOUNT_USAGE` views need access to the `SNOWFLAKE` database and are not real time.
9. Finish with three things to try (Document Browser, Document Search, Doc Intelligence agent) and one line: "Say **tailor document intelligence to my business** and I'll fit the document types and fields to your files."

---

## Mode 2: Tailor to my business

**Goal:** document types, fields, lines of business, searches, and agent text that fit the user's documents. One approval, then apply. Tell the user it includes a second app build and reprocessing every document.

Use the connection from Mode 1 if you know it. Otherwise use `SNOW_CONNECTION` in `config/deploy.config`, or the default connection. Don't ask.

Follow [reference/tailoring.md](reference/tailoring.md) exactly. In short:

1. Confirm at least 5 documents are COMPLETE. If not, ask them to load more first.
2. Read a sample of parsed text with SQL (queries in the reference file).
3. Write **one** proposal: what the business is, document types, lines of business, field labels and prompts for the 14 field slots, extra Test Lab fields, suggested searches, agent sample questions, app subtitle, and one example scoped role. Show it as short tables. Ask one question: approve, or say what to change.
4. Apply the edits listed in the reference file, redeploy, reprocess existing documents, and refresh.
5. Report document counts by new type and tell them to reload the app.

---

## Mode 3: Make it yours

Use the known connection (as in Mode 2). Offer this menu in one `ask_user_question` call (multi-select). Do only what they pick, then redeploy once at the end with `./deploy.sh --connection=<name>`. Details for each are in [reference/customize.md](reference/customize.md).

1. **Branding**: app name, subtitle, colors, logo.
2. **Object and role names**: rename `DOC_INTEL`, `DOC_INTEL_ADMIN`, and the rest with `scripts/rename.sh`. Best before the first deploy; after that, it creates a second copy under the new names.
3. **App roles and permissions**: who sees which tabs, lines of business, document types, and downloads.
4. **Tabs**: rename, reorder, or hide tabs.
5. **Agent**: instructions, sample questions, model.

After changes, remind them that `git diff` shows everything that changed.
