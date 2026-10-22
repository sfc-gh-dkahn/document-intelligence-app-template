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
   - Processing time depends on pages. Reading runs at roughly 100 to 120 pages a minute, plus sorting and extraction, in runs of up to 100 documents. Thousands of pages take hours, not minutes.
   - Every page is billed, and tailoring later reprocesses (and re-bills) every page.
   - Recommend copying about 20 typical files to a new folder, running quick start on that, tailoring, and then loading the rest with `bash scripts/upload_docs.sh <folder> --drain`.
   Ask once whether to use a small sample or the whole folder, and do what they choose.
4. Run `bash quickstart.sh "<folder>" --connection=<name>`. Tell the user up front: for a test set of about 20 documents, about 35 to 55 minutes to a working app, mostly the app build (15 to 25 minutes). Larger sets take longer (see "Throughput and credits" in docs/OPERATIONS_GUIDE.md). Run it in the background and report each `=== Step` line.
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
   If more than 100 documents arrive at a time, explain that a scheduled run processes 100. Recommend loading big drops with `upload_docs.sh <folder> --drain`. If files land on the stage another way and regularly exceed 100 per run, offer to raise `batch_size` in the Configuration tab, keeping a run under about 1,500 pages (the parse step stops after 20 minutes).
8. Finish with three things to try (Document Browser, Document Search, Doc Intelligence agent) and one line: "Say **tailor document intelligence to my business** and I'll fit the document types and fields to your files."

---

## Mode 2: Tailor to my business

**Goal:** document types, fields, lines of business, searches, and agent text that fit the user's documents. One approval, then apply. Tell the user it takes about 30 to 45 minutes, mostly a second app build and reprocessing.

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
