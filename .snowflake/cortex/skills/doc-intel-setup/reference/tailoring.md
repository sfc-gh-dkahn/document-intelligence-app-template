# Tailoring reference

Run SQL with `snow sql --role DOC_INTEL_ADMIN --connection <name> -q "..."`.

## 1. Read the documents

```sql
-- How many are done
SELECT ingestion_status, COUNT(*) FROM DOC_INTEL.DATA.ingestion_registry GROUP BY 1;

-- Sample of parsed text: up to 15 files, 2,500 characters each
SELECT file_path, page_count, LEFT(raw_content, 2500) AS text_sample
FROM DOC_INTEL.DATA.parsed_documents
WHERE parse_status = 'COMPLETE'
QUALIFY ROW_NUMBER() OVER (PARTITION BY file_path ORDER BY processing_version DESC) = 1
ORDER BY RANDOM()
LIMIT 15;

-- What the starter labels made of them
SELECT document_type, line_of_business, COUNT(*) AS docs
FROM DOC_INTEL.DATA.document_catalog GROUP BY 1, 2 ORDER BY 3 DESC;
```

If more than 15 files exist, also list all file names (`SELECT file_path FROM DOC_INTEL.DATA.document_catalog`) so the document types cover the whole set, not only the sample.

## 2. The proposal (one message)

Show these as short tables. Base every row on what you saw. If unsure, say so in one line instead of guessing.

1. **Business**: one or two sentences. Example: "Commercial property manager: leases, rent rolls, inspection reports, vendor invoices."
2. **Document types**: 6 to 15 labels, each with a category. Keep `Other`. These replace `config/classification_labels.csv`.
3. **Lines of business**: 3 to 8, each with a short code (2 to 6 capital letters), name, description. Mark one `is_default`. Replaces `config/lobs.csv`.
4. **Field slots**: the pipeline has 14 fixed field columns. The column names can't change, but their meaning can. For each slot give an on-screen label and a one-line AI prompt. If a slot doesn't fit the business, give it a general meaning anyway (for example "Other Amount"). Never leave a prompt empty.

   | Column | Starter label | Starter meaning |
   |---|---|---|
   | party_name | Party | Main person or organization the document is about |
   | issuer_name | Issuer | Organization that issued or authored it |
   | counterparty_name | Counterparty | Other party named |
   | reference_number | Reference # | Main reference, account, contract, or ID number |
   | case_number | Case # | Case, ticket, order, or incident number |
   | doc_subtype | Subtype | More specific subtype or form name |
   | reference_date | Other Key Date | Any other key date |
   | start_date | Start Date | Start or effective date |
   | end_date | End Date | End, expiration, due, or renewal date |
   | event_date | Event Date | Date of the main event or transaction |
   | primary_amount | Amount | Main monetary amount |
   | total_amount | Total Amount | Total or maximum amount |
   | secondary_amount | Other Amount | Any other important amount |
   | key_terms | Key Terms | Key terms, conditions, exclusions |

   `document_date`, `monetary_amounts`, `action_required`, `doc_status`, `doc_summary`, and `line_of_business` keep their meaning. You may reword the `doc_status` prompt's example values to fit the business.
5. **Extra Test Lab fields** (optional): 2 or 3 per category for `config/extraction_schemas.csv`, CATEGORY tier. Also update the COMMON tier rows so their descriptions match the slot prompts. Tell the user these extra fields drive the Extraction Schema tab and Test Lab, not the main pipeline.
6. **Suggested searches**: 6 to 10 rows (`lob_code,label,query,sort_order`), using real terms from the documents.
7. **Agent**: three sample questions and one sentence of context for the agent's response instruction (who uses it and for what).
8. **App subtitle**: 2 to 5 words.
9. **Example scoped role**: replace "Finance Reviewer" in `config/roles.csv` with one role limited to one of the new lines of business and a few of the new document types.

Ask once: "Approve, or tell me what to change." Apply changes they give, then go on without asking again.

## 3. Apply

Edit these files directly:

| File | Change |
|---|---|
| `config/classification_labels.csv` | new labels |
| `config/lobs.csv` | new lines of business |
| `config/extraction_schemas.csv` | COMMON descriptions + CATEGORY rows |
| `config/suggested_searches.csv` | new searches; `lob_code` must be a new LOB code or `*` |
| `config/roles.csv` | swap the example scoped role; keep Administrator, Analyst, Viewer as they are |
| `app/lib/field-labels.ts` | new labels for the 14 slots |
| `sql/03_processing.sql` | in `sp_extract_document_attributes`, replace only the description strings in the `AI_EXTRACT` object; keep the keys. Double any single quote (`''`). |
| `sql/05_intelligence.sql` | semantic view `COMMENT`s for the slot columns that appear there; agent `sample_questions`; add the context sentence to the start of `instructions.response` |
| `app/theme.config.ts` | `appSubtitle` default |
| `app/app/chat/page.tsx` | `FALLBACK_Q` (four questions, shown only when there are no suggested searches) |

Then:

1. Switch off the starter values **before** redeploying. The seed step only adds and reactivates rows that are in the CSVs, so this leaves exactly the new config active: (The DELETE removes Test Lab fields the user added in the app. If `SELECT COUNT(*) FROM DOC_INTEL.ADMIN.extraction_schemas WHERE schema_tier <> 'COMMON'` returns more rows than the old CSV had, confirm with the user first.)
   ```sql
   UPDATE DOC_INTEL.ADMIN.classification_labels SET is_active = FALSE;
   UPDATE DOC_INTEL.ADMIN.lines_of_business    SET is_active = FALSE;
   UPDATE DOC_INTEL.ADMIN.suggested_searches   SET is_active = FALSE;
   DELETE FROM DOC_INTEL.ADMIN.extraction_schemas WHERE schema_tier <> 'COMMON';
   ```
2. `./deploy.sh --connection=<name>` (reloads SQL and config, rebuilds the app). Then retire the old example role:
   ```sql
   UPDATE DOC_INTEL.ADMIN.entitlement_roles SET is_active = FALSE WHERE role_name = 'Finance Reviewer';
   ```
3. Reprocess existing documents once with the new labels and prompts:
   ```sql
   CALL DOC_INTEL.DATA.sp_bulk_reprocess(NULL, NULL, FALSE);
   ```
   Tell the user this re-runs parse, classify, and extract on every document, so it costs about the same as the first run. Run it only once. Corrections approved in the Review Queue stay with the old versions and won't apply to the new ones; tell the user before running if any exist (`SELECT COUNT(*) FROM DOC_INTEL.ADMIN.extraction_overrides WHERE override_status = 'APPROVED'`).
4. Run `bash scripts/upload_docs.sh --drain --connection=<name>` in the background. It starts runs back to back (100 documents each) until nothing is waiting, then refreshes the catalog and search. Report its progress lines.
5. Check two of the new suggested searches return results:
   ```sql
   SELECT PARSE_JSON(SNOWFLAKE.CORTEX.SEARCH_PREVIEW('DOC_INTEL.SERVICES.DOC_SEARCH_SVC',
     '{"query": "<search>", "columns": ["file_path"], "limit": 3}'))['results'];
   ```
6. Report `SELECT document_type, COUNT(*) FROM DOC_INTEL.DATA.document_catalog GROUP BY 1 ORDER BY 2 DESC;` and tell them to reload the app.
