# Troubleshooting reference

Run SQL with `snow sql --role DOC_INTEL_ADMIN --connection <name> -q "..."` unless noted.

## Setup

| Symptom | Cause | Fix |
|---|---|---|
| `ACCOUNTADMIN role required` | Provisioning needs an account admin once | An admin runs `./provision.sh --connection=<name>`, or runs `sql/00_account_permissions.sql` in a Snowsight worksheet |
| `DOC_INTEL_ADMIN role required` or "role does not exist" | Not provisioned, or the role isn't granted to this user | `./provision.sh --check`. If roles exist, an admin runs `GRANT ROLE DOC_INTEL_ADMIN TO USER <user>;` |
| Compute pool or integration not found | Provisioning didn't finish | `./provision.sh --check`, then re-run `./provision.sh` |
| `snow: command not found` | Snowflake CLI missing | Install Snowflake CLI 3.28 or later, then `snow connection add` |
| Scripts fail on Windows | They need bash | Use WSL or Git Bash |
| `snow app deploy failed` | Build or service start error | Read the output above the failure. Then `cd app && snow app events --role DOC_INTEL_ADMIN --connection <name>` for the app's logs. Fix and re-run `./deploy.sh` (safe to repeat; data is kept) |
| App URL won't print | Service still starting | Wait a minute; `cd app && snow app open --print-only --watch --role DOC_INTEL_ADMIN --connection <name>` |

## Documents

| Symptom | Cause | Fix |
|---|---|---|
| Files skipped on upload | Unsupported type | Supported: pdf, docx, pptx, tif, tiff, jpg, jpeg, png, html, txt |
| Files stay PENDING | Tasks suspended (they stop after 3 failures in a row) | `SHOW TASKS IN SCHEMA DOC_INTEL.DATA;` If suspended: `SELECT SYSTEM$TASK_DEPENDENTS_ENABLE('DOC_INTEL.DATA.task_01_register_files');` then `EXECUTE TASK DOC_INTEL.DATA.task_01_register_files;` |
| Files FAILED | Parse, classify, or extract error | `SELECT file_path, error_stage, last_error FROM DOC_INTEL.DATA.ingestion_registry WHERE ingestion_status = 'FAILED';` Fix the cause, then `CALL DOC_INTEL.DATA.sp_force_reprocess('<file_path>');` and `EXECUTE TASK DOC_INTEL.DATA.task_01_register_files;` |
| COMPLETE but not in the app | Catalog and search have a 1-hour target lag | `./scripts/upload_docs.sh --refresh` |
| Cortex function or model not available | Model not offered in the account's region | Ask an admin about cross-region inference: `ALTER ACCOUNT SET CORTEX_ENABLED_CROSS_REGION = 'ANY_REGION';` (ACCOUNTADMIN) |

## Access

| Symptom | Cause | Fix |
|---|---|---|
| Someone can't open the app | Missing Snowflake role | `GRANT ROLE DOC_INTEL_USER TO USER <user>;` (SECURITYADMIN) |
| Someone sees no documents | No app role, or their app role limits lines of business or document types | In the app: **User Management → Users**, assign an app role. Check that role's lines of business and document types |
| A tab is missing | Unchecked for their app role | **User Management → Roles → App Pages** |
| A user sees "not available for your role" | Same as above, reached by direct URL | Same fix |
