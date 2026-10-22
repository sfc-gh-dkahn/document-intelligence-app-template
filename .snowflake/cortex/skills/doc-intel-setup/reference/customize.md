# Customize reference

After any change here, run `./deploy.sh --connection=<name>` once. It reloads SQL and config and rebuilds the app.

## 1. Branding

Edit the defaults in `app/theme.config.ts` (the deployed app does not read `.env` files, so change the values in the file itself):

| Key | What it changes |
|---|---|
| `appName` | Name in the sidebar and browser tab |
| `appSubtitle` | Line under the name |
| `brandPrimary` | Buttons, links, highlights (hex color) |
| `brandDark` | Headings and dark accents |
| `brandBg` | Overview banner background |
| `logoUrl` | Logo path under `app/public/`. Put the file in `app/public/` and set for example `"/logo.png"`. Square images work best. |

The Overview banner text is in `app/app/page.tsx` (search for "Powered by Snowflake Cortex AI").

## 2. Object and role names

`scripts/rename.sh` rewrites the database, Snowflake roles, warehouses, compute pool, integration, network rule, and app service name in every file.

```bash
./scripts/rename.sh --prefix=ACME_DOCS --dry-run
./scripts/rename.sh --prefix=ACME_DOCS            # roles become ACME_DOCS_ADMIN, _USER, _PIPELINE
./scripts/rename.sh --prefix=ACME_DOCS --admin-role=ACME_DOC_ADMINS   # override one role name
```

- **Not deployed yet:** run it, then quick start.
- **Already deployed:** tell the user the next deploy builds a separate copy under the new names, with its own database, app, and roles, and the old copy stays. Get a clear yes, then run it, then `bash quickstart.sh "<docs folder>" --connection=<name>` to load documents into the new copy. Re-run tailoring there if they had tailored before.
- To run two copies in one account (for example test and prod), rename one copy of the repo to a different prefix.

## 3. App roles and permissions

There are two layers:

1. **Snowflake roles** (`DOC_INTEL_ADMIN`, `DOC_INTEL_USER`, `DOC_INTEL_PIPELINE`) decide who can open the app and run admin actions. Grant `DOC_INTEL_USER` to anyone who should use the app: `GRANT ROLE DOC_INTEL_USER TO USER <name>;` (needs SECURITYADMIN or the role owner).
2. **App roles** (Administrator, Analyst, Viewer, plus any scoped roles) decide what each person sees inside the app. Each user can hold several app roles; they get the combined access.

App role fields (`config/roles.csv`, or **User Management → Roles** in the app):

| Field | Meaning | Values |
|---|---|---|
| `menu_access` | Tabs the role sees. Unchecked tabs are hidden and blocked by direct URL. | Keys from `app/lib/app-pages.ts`, pipe-separated, e.g. `dashboard\|search\|chat` |
| `lob_access` | Lines of business whose documents the role sees | LOB codes, pipe-separated, or `*` |
| `doc_type_access` | Document types the role sees | Labels, pipe-separated, or `*` |
| `can_download` | Can download originals | `TRUE` / `FALSE` |

The row access policy applies these settings to the app's document catalog. It doesn't cover the base tables or stage: anyone with `DOC_INTEL_USER` who runs SQL in Snowsight can read every document's text. Tell the user to grant `DOC_INTEL_USER` only to people who may see all documents. The agent (Doc Intelligence tab and Snowflake Intelligence) is not filtered by app roles either. Admin tabs (Operations, AI Config, Management) also need the `DOC_INTEL_ADMIN` Snowflake role, whatever the app role says.

Each deploy resets every role listed in `roles.csv` to the CSV values. Day-to-day changes in **User Management** take effect at once, but anything meant to last must go in `roles.csv` too. To assign app roles to users, use **User Management → Users** (or **Sync from Roles** to add everyone who holds a DOC_INTEL Snowflake role).

To rename an app role, change it in User Management **and** in `roles.csv`. Changing only the CSV creates a second role (the seed matches on name); changing only the app brings the old name back on the next deploy.

## 4. Tabs

All tabs live in `APP_PAGES` in `app/lib/app-pages.ts`. The sidebar, the role editor, and the page guard all read that list.

- **Rename a tab:** change its `label`. Also change the heading in that page's `app/app/<page>/page.tsx` and its entry in `app/app/help/page.tsx`.
- **Reorder:** move the line.
- **Hide from some people:** remove its key from their role's `menu_access` in `roles.csv` and uncheck it in User Management (section 3). No code change.
- **Hide from everyone:** do that for every role, including Administrator. Don't delete the entry: pages not in `APP_PAGES` are not guarded, so a deleted tab would still open by direct URL.
- **Move between sections:** change `section` (`main`, `operations`, `ai`, `management`).
- Icons and hover text are in `app/components/app-sidebar.tsx`.
- If you add a new key, add it to the Administrator row in `config/roles.csv` too.

## 5. Agent

The agent is defined in `sql/05_intelligence.sql` (`CREATE OR REPLACE AGENT ... doc_intelligence_agent`):

- `instructions.response`: tone, citation format, who it serves.
- `instructions.orchestration`: when to use search versus analytics.
- `sample_questions`: questions shown in Snowflake Intelligence.
- `models.orchestration`: the model. Use a model available in the user's region; if unsure, keep the default.

The app's own Cortex model is the default of `CORTEX_MODEL` in `app/lib/db.ts` (`claude-sonnet-4-5`). Change it there. `DOC_INTEL_CORTEX_MODEL` in `config/deploy.config` and `.env` only affect local development, because the deployed app does not read them.
