# Document Intelligence User Manual

*Powered by Snowflake Cortex AI*

---

## Table of Contents

1. [Getting Started](#getting-started)
2. [Overview Dashboard](#overview-dashboard)
3. [Document Browser](#document-browser)
4. [Document Search](#document-search)
5. [Review Queue](#review-queue)
6. [Doc Intelligence Agent](#doc-intelligence-agent)
7. [Saved Items](#saved-items)
8. [Document Detail View](#document-detail-view)
9. [Administration](#administration)
    - [Pipeline Management](#pipeline-management)
    - [Ingestion Registry](#ingestion-registry)
    - [Quality & Feedback](#quality--feedback)
    - [Cost Dashboard](#cost-dashboard)
    - [Extraction Schema & Test Lab](#extraction-schema--test-lab)
    - [Classification Labels](#classification-labels)
    - [Lines of Business](#lines-of-business)
    - [Suggested Searches](#suggested-searches)
    - [Notifications](#notifications)
    - [Configuration](#configuration)
    - [Audit Log](#audit-log)
    - [User Management](#user-management)
10. [Help & Tips](#help--tips)
11. [Glossary](#glossary)

---

## Getting Started

Document Intelligence reads your documents, sorts them by type, and pulls out key facts. It works on the files you load into Snowflake: contracts, amendments, statements of work, invoices, purchase orders, receipts, financial statements, reports, policies and procedures, forms, letters, emails, certificates, and regulatory filings.

For each document, the AI pipeline:
1. Reads the text (AI_PARSE_DOCUMENT: OCR mode for TIFF, JPEG, and PNG files; LAYOUT mode for PDF, DOCX, PPTX, HTML, and TXT)
2. Picks a document type from your list of labels (AI_CLASSIFY)
3. Pulls out fields such as party, issuer, reference number, dates, amounts, and key terms (AI_EXTRACT)

You can then browse, search, ask questions, and correct what the AI got wrong.

### Access & Authentication

You sign in with your Snowflake account. Two Snowflake roles control whether you can use the app at all:

- **DOC_INTEL_USER** — Standard access (browse, search, review, agent)
- **DOC_INTEL_ADMIN** — Needed for the administration pages, together with an app role that includes them

A third role, **DOC_INTEL_PIPELINE**, runs the automated pipeline. People do not normally use it.

Inside the app, **app roles** decide what you see. The starter set (from `config/roles.csv`, which your team will tailor) is:

| App role | Pages | Documents | Downloads |
|---|---|---|---|
| Administrator | All pages, including every admin page | All | Yes |
| Analyst | All user pages | All | Yes |
| Finance Reviewer | Overview, Document Browser, Document Search, Doc Intelligence, Saved Items, Help | Finance (FIN) line of business; Invoice, Purchase Order, Receipt, and Financial Statement types only | Yes |
| Viewer | Overview, Document Browser, Document Search, Help | All | No |

Your role controls three things:
- **Line of Business (LOB) access** — Which LOBs' documents you can see
- **Document Type access** — Which document types you can see
- **Page access** — Which pages you can open

If your role does not include a page, the page is missing from your sidebar. If you open its URL directly, you see "*Page* is not available for your role" with a link back to the Overview.

You can hold more than one app role. You then get the combined access of all of them. The first time you sign in, the app gives you the Viewer role.

### Navigation

The left sidebar lists every page your role can open. Admin pages sit under an "Admin" heading.

**User pages:**

| Page | Description |
|------|-------------|
| Overview | Charts, a question box, quick questions, and recent documents |
| Document Browser | Browse and filter all indexed documents |
| Document Search | Search documents by content |
| Review Queue | Approve or correct documents the AI was unsure about |
| Doc Intelligence | Chat with the AI agent about your documents and their data |
| Saved Items | Your saved searches and bookmarked documents |
| Help | In-app tips |

**Administration** (shown only if your role includes these pages):

| Section | Pages |
|---------|-------|
| Operations | Pipeline Management, Ingestion Registry, Quality & Feedback, Cost Dashboard |
| AI Config | Extraction Schema, Classification Labels, Lines of Business, Suggested Searches |
| Management | Notifications, Configuration, Audit Log, User Management |

The Review Queue badge in the sidebar shows how many documents wait for review.

---

## Overview Dashboard

**Path:** `/` (Home)

The Overview page shows what is in your document collection and gives you quick ways in.

### What You See

- **Hero Banner** — Buttons for Browse, Search, Doc Intelligence, Saved Items, and Review Queue
- **Portfolio Analytics** — A question box, three counts, and four charts (see below)
- **Quick Questions** — Ready-made questions. Click one to open the Doc Intelligence agent with that question. The list comes from the Suggested Searches set up for your lines of business (up to six). If none are set up, you see defaults such as:
  - "What document types are in the system?"
  - "How many documents have been processed this month?"
  - "Show me documents that require action"
  - "Which documents expire in the next 60 days?"
- **Recently Indexed** — The last 8 documents processed, with source folder, document type, and format

### Portfolio Analytics

**Ask a Question** — Type a question about your documents (for example, "How many documents were processed by month this year?") and click **Ask**. The Doc Intelligence agent answers right there. A tag shows which tool it used ("via Search", "via Analytics", or "via Agent"). Answers can include tables and an inline chart.

**Counts:**
- **Total Documents** — Documents you can see in the catalog
- **Lines of Business** — How many LOBs have documents
- **Document Types** — How many document types are in use (counts up to 12)

**Charts:**
1. **Documents by Type** — Bar chart of the 10 largest document types. Click a bar to open the Document Browser filtered to that type.
2. **Line of Business** — Donut chart of documents by LOB, with a legend. Click a slice to open the Document Browser filtered to it.
3. **Documents by Line of Business** — Bar chart with one color per LOB. Click a bar to open the Document Browser filtered to it.
4. **Document Status** — Bar chart of documents by the status the AI read from each document (for example draft, active, approved, open, closed, expired). Each status always gets the same color. Click a bar to open the Document Browser filtered to it.

### First-Run Onboarding (Admin Only)

If no documents have been indexed yet, admins see a Getting Started banner with links to:
- **Go to Pipeline Management** — load documents and run the pipeline
- **Configure User Access** — set up users and roles

---

## Document Browser

**Path:** `/documents`

The Document Browser is the main place to browse, filter, and manage indexed documents.

### Filtering Documents

Use the filter bar at the top:

- **Document Type** — Filter by type (for example Contract, Invoice, Report)
- **Line of Business** — Filter by LOB (for example General, Finance, Operations, Legal, Human Resources)
- **Status** — Filter by the statuses found in your documents
- **Text Search** — Search across party, issuer, reference #, case #, summary, and file path
- **Needs Review Only** — Show only documents flagged for human review

The document count updates as you filter.

### Document Table

| Column | Description |
|--------|-------------|
| Checkbox | Select documents for batch actions |
| Type | Document type (links to the detail page) |
| Party | Main person or organization the document is about |
| LOB | Line of Business (color-coded badge) |
| Format | File format (PDF, TIFF, DOCX, etc.) |
| Status | Document status read from the document |
| Conf | AI confidence in the document type (green 75% and up, amber 50–74%, red below 50%) |
| Start Date | Start or effective date |
| End Date | End, expiration, or due date |
| Reference # | Reference number the AI found, or the source-system one if the AI found none |

Rows that need review have a light amber tint.

### Viewing Document Details

Click a row to open the **side panel**:

- Document type, plus a warning when the AI matched several possible types
- Fields: Party, Issuer, LOB, Subtype, Reference #, Case #, Start Date, End Date, Status, Pages, Format, Source File ID, Confidence (empty fields are hidden)
- Document summary
- **View Document** button to preview the original file

### Correcting Attributes

From the side panel, scroll to "Correct an Attribute":

1. Pick the field to correct (the list shows each text field and its current value)
2. Enter the correct value
3. Click **Submit Correction**

Corrections wait for an admin to approve them in **Quality & Feedback**. After approval, corrections to the fields listed there appear the next time the catalog refreshes (it has a 1-hour target lag). A correction belongs to the document version it was made on; reprocessing creates a new version without it.

### Batch Actions

1. Select documents with the row checkboxes
2. A bar appears at the bottom with the selection count
3. Choose **Archive Selected** (admins only)
4. Click **Apply** and confirm, or click **Clear** to deselect

Archived documents drop out of browse and search.

### Export

Click **Export CSV** to download up to 5,000 documents matching the Document Type, Line of Business, and Status filters (file path, type, LOB, status, confidence, completed time). Your role must allow downloads.

### Pagination

Results show 50 per page. Use Previous/Next to move between pages.

---

## Document Search

**Path:** `/search`

Document Search uses Snowflake Cortex Search to find documents by what they say.

### Performing a Search

1. Type a query (for example "contracts with automatic renewal")
2. Click **Search** or press Enter
3. Results appear ranked by relevance, with matching snippets

### Using Filters

Click **Filters** to show more options:

- **Line of Business** — Limit results to one LOB
- **Document Type** — Limit results to one type
- **Format** — Limit by file format (PDF, TIFF, etc.)
- **Status** — Limit by document status
- **Max Results** — 10, 20, 50, or 100 (the server returns at most 50)

### Suggested Searches

When the search bar is empty, you see suggested searches. Admins set these up per line of business on the **Suggested Searches** page, and you see the ones for your LOBs. The starter set includes searches such as "Recent documents", "Needs follow-up", "Large invoices", "Contracts expiring soon", and "Renewal terms". If none are set up, you see defaults: Documents, Action Required, Expiring Soon, Certificates.

Click a suggestion to run it.

### Working with Results

Each result shows:

- Document type with format badge
- Party
- LOB (color badge)
- Status (color badge)
- Matching snippet

**Actions on each result:**
- **Thumbs Up/Down** — Rate whether the result was useful
- **Bookmark** — Save the document for later (it appears in Saved Items)

Results show 20 per page. Click a column header to sort.

### Result Detail Panel

Point at a result to open the detail panel; click it to open the full detail page.
- Fields: Party, Issuer, Subtype, Start Date, End Date, Amount, Total Amount, Reference #, Case #, Source File ID, Confidence
- Document summary
- Up to three more matching excerpts
- Links to the full detail page and the file preview

### Saving Searches

1. Click **Save** (floppy disk icon) next to the search bar
2. Name the search
3. Choose who can see it:
   - **Just Me** — Only you
   - **My Role** — Everyone using the Snowflake role you name
   - **Everyone** — All users
4. Click **Save**

A saved search keeps your query and filters, so you can rerun it with one click.

### Scoped Search

A search link can carry a `scope` parameter that limits the search to one file. A banner then shows the file name and a **Clear scope** button to search everything again. To search inside one document, the simplest way is the search box on the document's **Document** tab (see [Document Detail View](#document-detail-view)).

---

## Review Queue

**Path:** `/review`

The Review Queue lists documents where the AI was unsure of the document type: it returned three or more possible types, so its confidence is 65% or lower.

### Understanding the Queue

- **Scope** — Shows the LOBs and document types you can see. You only review documents inside your access.
- **Progress Bar** — Pending / Approved / Skipped counts and the share completed
- **Filters** — Line of business, classification, and a search box for party, reference #, or case #

### Status Tabs

- **Pending** — Waiting for review (with a count)
- **Approved** — Already approved
- **Skipped** — Skipped
- **All** — Everything

### Document Cards

Each card shows:

- File name and source folder
- Document type badge
- LOB badge
- **Confidence bar**:
  - Green (75% and up)
  - Amber (50–74%)
  - Red (below 50%)
- **Review reason** — Why the AI flagged it (for example "Low confidence (65%) with 3 competing classifications")
- **Also considered** — Other types the AI weighed, to help you decide
- Key fields: Party, Reference #, Case #

### Taking Action

Each pending document has three actions:

1. **Approve** (green check) — The AI's type is right. The document leaves the queue.

2. **Skip** (gray) — Take it out of your queue without approving or correcting. Use this when you are unsure or the document is outside your area.

3. **Correct** (amber, with a list) — Shows the other possible types. Pick the right one to:
   - Submit a Document Type correction (it waits for admin approval in Quality & Feedback; approved type corrections are stored but do not change the catalog)
   - Mark the document as reviewed, so it leaves your pending list
   - Use "Open detail for manual correction..." at the bottom for harder cases

### Pagination

Results show 20 per page with Previous/Next.

---

## Doc Intelligence Agent

**Path:** `/chat`

The Doc Intelligence Agent is a chat assistant built on Snowflake Cortex Agent. It can find and read documents, and it can answer counting and trend questions from the document data. One question can use both. The agent does not apply your app role's line of business and document type limits.

### Starting a Conversation

Type a question and press Enter or click Send. For example:

- "What are the key terms in our contracts?"
- "How many documents did we add this year, by type?"
- "Find documents with an end date in the next 90 days"
- "What is the total amount across all invoices?"
- "Which invoices have the largest amounts?"

The empty chat shows up to four starter questions from your Suggested Searches. If there are none, it shows four defaults.

### How It Works

The agent picks from two tools:
- **Document Search** (`doc_search`) — Finds documents and passages by content, through Cortex Search
- **Analytics** (`doc_analytics`) — Turns your question into SQL through Cortex Analyst and the `document_analytics_sv` semantic view. Use it for "how many", "total", "average", "by month", and "compare" questions.

While the agent works, you see live status lines (for example "Using Search..." or "Using Analytics...") and the steps it takes.

### Analytics Questions

The Analytics tool answers questions about the whole collection, such as:

- "How many documents do we have by line of business?"
- "Show document counts by type for each month this year"
- "Which document types have the lowest average confidence?"
- "How many documents need review?"
- "How many contracts end in the next 90 days?"

The semantic view behind it covers document type, line of business, status, party, issuer, counterparty, subtype, start and end dates, file format, source folder, review flag, and upload time. It counts documents, averages confidence, and sums pages. It does not include amounts or other fields; Document Search covers those.

You can also ask analytics questions from the **Ask a Question** box on the Overview page.

### Reading Responses

- Responses render as formatted Markdown, including tables and lists
- A **tool tag** shows which tool answered (for example "via Search" or "via Analytics")
- **Charts** appear inline when the agent returns a result table

### Citations

The app turns document references in answers into clickable blue chips:

- **File names** (for example `documents/acme-master-services-agreement.pdf`) — Open the detail page with fields, history, and raw text
- **Page citations** (for example `[filename.pdf, p.5]`) — Open the document's detail page
- **ID references** in the form `(File: ABC-2024-12345)` — Search for and open the matching document
- **File paths** in result tables — Any cell holding a file path becomes a chip

Citations work the same way in the Overview page's Ask a Question box.

### Providing Feedback

Each answer has thumbs up/down buttons. Ratings appear on the Quality & Feedback page.

### Managing Conversations

- Click **New conversation** to clear the chat and start fresh
- The conversation clears when you leave or reload the page. The agent sees the last six messages.

### Deep Linking

You can pre-fill a question with the URL parameter `?q=`. The Overview page's Quick Questions work this way.

---

## Saved Items

**Path:** `/saved`

Saved Items holds your saved searches and bookmarked documents.

### Saved Searches Tab

Lists your saved searches and any shared with you or your role (up to 100).

Each entry shows:
- Search name
- Query text (shortened)
- Created date

**Actions:**
- **Run** (green play icon) — Rerun the search with its filters
- **Copy Link** — Copy a link that reruns the query (filters not included)
- **Delete** (red trash) — Remove the saved search

### Bookmarks Tab

Lists the documents you bookmarked from Search or a detail page.

Each entry shows:
- Document type
- Party
- Personal note (if any)
- Created date
- File path link (opens the preview)

**Actions:**
- **Delete** (trash icon) — Remove the bookmark

---

## Document Detail View

**Path:** `/documents/detail?id=<encoded file path>`

The Document Detail page shows one document in full: the file, its fields, its history, and its raw text.

### Header

- **Back** button (returns to where you came from)
- File name
- Badges: Document Type, LOB, Confidence (green 80% and up, amber 50–79%, red below 50%), Processing Status
- **Save** — Bookmark the document
- **Preview** — Open the original file in a viewer
- **Archive** (admin only) — Hide the document from browse and search.
- **Purge** (admin only) — Delete the document's pipeline records and remove the source file from its stage, for good (asks you to confirm twice)

### Document Tab

The left side shows the file with a **Search within this document** box. Matches appear in a list; click one to jump to its page, with your search words marked.

The right side shows the **Attributes** panel.

**Editable fields** (click the pencil icon to correct):
- Party
- Issuer
- Document Type
- Reference #
- Case #
- Line of Business
- Subtype
- Status
- Start Date
- End Date
- Other Key Date

Fields with a correction waiting for approval show a "Pending" badge.

**Read-only fields:**
- Counterparty
- Amount
- Total Amount
- Other Amount
- Summary
- Key Terms
- Action Required

### History Tab

Shows each processing version:
- Version number
- Status (Complete, Failed, Processing)
- Start and end times
- Number of attempts
- Error details and the stage that failed (if any)

### Related Tab

Lists other documents that share this document's party, reference number, or case number. Each one links to its own detail page.

### Raw Text Tab

Shows all the text the AI read:

- **Page count** at the top
- **Highlight values** — When on, colors the extracted values found in the text:
  - Blue = Identifiers (Reference #, Case #)
  - Green = Parties (Party, Issuer, Counterparty)
  - Purple = Dates (Start Date, End Date, Other Key Date, Event Date, Document Date)
  - Amber = Money (Amount, Total Amount, Other Amount)
  - Teal = Classification (Document Type, Line of Business, Subtype)
  - A color legend appears above the text
- **Preview Original** — Opens the source file viewer

---

## Administration

You see these pages only if you have the DOC_INTEL_ADMIN Snowflake role and an app role that includes them. The Administrator app role includes all of them.

### Pipeline Management

**Path:** `/admin/pipeline`

Runs and watches the document pipeline. It has six tabs. Above the tabs: counts of Complete, Pending, Processing, and Failed documents, and an amber banner if the oldest pending document has waited more than 120 minutes.

#### Overview Tab

- **Task Management** — Each Snowflake task with its state and schedule
  - **Suspend** — Pause a task
  - **Resume** — Restart a paused task

#### Upload Tab

Upload one document at a time from your browser:

1. Drag a file onto the upload area, or click to browse
2. Supported formats: PDF, TIFF, DOCX, PPTX, JPEG, PNG, HTML, TXT (up to 50MB each)
3. Click **Upload and Register**

Files land in `DOC_INTEL.DATA.doc_stage/documents/`, and processing starts right away (if the run cannot start, the file waits for the next scheduled run). For large batches, use `scripts/upload_docs.sh --drain` instead (see the Operations Guide).

#### Stages Tab

Manage the list of document stages:

- See each registered stage and whether it is Active or Paused
- **Toggle** a stage between Active and Paused
- **Remove** a stage from the list
- **Add New Stage** — Enter a stage name, description, and path prefix
- **Discover Available Stages** — Find stages in the database that are not yet registered, and add them

The pipeline registers files from `doc_stage` and `sample_stage`. A stage you add here shows in the Test Lab, but the pipeline does not register its files until an admin adds it to the `DATA.v_stage_files` view. Active or Paused here does not change what the pipeline scans.
#### Run Pipeline Tab

Run one pipeline step by hand:
1. **Register Files** — Scan stages for new files and add them to the ingestion registry
2. **Parse Documents** — Read text with AI
3. **Classify** — Pick each document's type
4. **Extract** — Pull out fields

Each step runs on its own. Use this for testing or to recover from a partial failure.

#### Processing Logs Tab

Recent processing activity:
- Columns: File, Status, Folder, Type, Party, Error message
- **Filter by status**: Pending, Processing, Complete, Failed, Abandoned
- **Refresh** to see the latest entries

#### Reprocess Tab

Send documents through the pipeline again:

1. **Search/filter** by file name, status, LOB, or document type
2. **Select** documents with checkboxes, or use "Select All"
3. **Reprocess Selected** — Queue the chosen documents
4. **Reprocess All Filtered** — Queue every listed file that matches the filters (the tab lists up to 200 of the most recently updated files; you see a count first)
5. **Manual entry** — Type a file path to reprocess

---

### Ingestion Registry

**Path:** `/admin/registry`

The record of every file the platform has seen, whatever its status.

**Table columns:**

| Column | Description |
|--------|-------------|
| File Path | Path on the stage (click to preview) |
| Format | File type with a colored badge |
| Folder | Source folder, if one was loaded |
| Status | Pending, Processing, Complete, Failed, Abandoned, or Archived |
| Version | Processing version number |
| Attempts | How many times processing was tried |
| First Seen | When the file was first found |
| Last Error | Most recent error message (if any) |

**Features:**
- **Filter** by status or folder, and search by file name
- **Reprocess** button on each row (asks you to confirm unless the document Failed or was Abandoned)
- **Pagination** — 50 per page with Previous/Next
- **Refresh** button

---

### Quality & Feedback

**Path:** `/admin/quality`

Watch extraction quality and handle user corrections.

#### KPI Cards

All four cover documents classified in the last 7 days:

- **Avg Confidence** — Mean AI confidence
- **Low Conf Docs** — Documents flagged for review
- **Low Conf %** — Share of documents flagged for review
- **Document Types** — How many document types are in use

#### Charts

- **Corrections by Field** — Total and approved corrections for the 10 most-corrected fields
- **Average Confidence by LOB** — Confidence and document count for each line of business

#### Pending Corrections Table

Corrections users submitted that need an admin decision. Review Queue approvals and skips also appear here as field `__review_status__`.
- File name (click to preview)
- Field corrected
- Original value
- Corrected value
- Submitted by
- Date

**Actions:**
- **Approve** — Accept the correction
- **Reject** — Dismiss it

Approved corrections to Document Date, Party, Issuer, Counterparty, Reference #, Case #, Line of Business, Subtype, Key Terms, and Status show up in the catalog on its next refresh. Approved corrections to other fields are stored but do not yet change the catalog.

#### Recent User Feedback Table

Thumbs up/down from Search and Chat:
- Feedback type (up or down icon)
- File name
- Query text
- User
- Date

---

### Cost Dashboard

**Path:** `/admin/cost`

Track the Snowflake credits the pipeline and app record in their event log.

**Note:** The pipeline does not yet write real credit figures to its event log, so the dashboard counts each event as 0.001 credits. Read it as a measure of activity, not spend. For real warehouse spend, see the Operations Guide.

#### KPI Cards

- **Total Credits (30 days)** — Event-based credits in the last 30 days
- **Daily Average** — Average per day
- **Projected Monthly** — Daily average × 30

#### Charts

- **Daily Credit Usage** — Line chart of daily credits over the past year
- **Credits by Stage** — Which pipeline stages use the most credits
- **Credits by Event Type** — Credits by type of operation

---

### Extraction Schema & Test Lab

**Path:** `/admin/extraction-schema`

Define fields to extract and test extraction on real files.

#### Schema Configuration Tab

The schema has three tiers:

1. **Common** — Fields to pull from every document (for example Document Date, Party, Issuer, Reference #, Start Date, End Date, Amount, Summary)
2. **Category** — Fields to pull only when a document falls in a category (for example payment terms and renewal terms for Contracts; currency, tax amount, and line items for Financial)
3. **LOB-Specific** — Fields to pull when a document matches both a category and a line of business

The starter schema comes from `config/extraction_schemas.csv`.

**Navigating the schema:**
- Use the left list to browse tiers and groups
- Each Category and LOB-Specific group shows its "Fires When" rule
- The fields table shows Name, Description, and Data Type

**Managing fields:**
- **Add Attribute** — Create a new field:
  - Pick a tier (Common, Category, or LOB-Specific)
  - Pick or create a group
  - Set the match rule (which categories and LOBs trigger it)
  - Enter a field name, a description (the AI reads this as its instruction), and a type (VARCHAR, DATE, NUMBER, VARIANT)
- **Delete** — Remove a field
- **Test** (flask icon) — Try one field against a pinned file

**Note:** The Test Lab uses this schema. The automated pipeline currently extracts a fixed set of fields (the ones listed in the Data Dictionary under `document_attributes`), defined in `sql/03_processing.sql`.

#### Test Lab Tab

Run the pipeline steps on pinned files without saving the results. All pinned files run against the first pinned file's stage.

**Choosing files:**
1. Pick a Snowflake stage
2. Browse its files (search by name, filter by LOB or type)
3. **Pin** single files, or **Pin All Filtered**, to build your test set
4. Pinned files stay in your browser between visits

**Running tests:**
1. Click **Run Pipeline** to run: Parse → Classify → Detect LOB → Resolve Schema → Extract
2. Each file shows:
   - Document type
   - Line of business
   - Every extracted field, labeled with its tier
   - A check mark for fields with a value
   - An X for empty fields
   - Fields with values listed first

**Upload:**
Use **Upload File** to add a test document to the chosen stage. This also registers the file in the production pipeline and starts a run.

Test Lab results are not saved to the production pipeline.

---

### Classification Labels

**Path:** `/admin/classification-labels`

Manage the document types the AI chooses from.

**Viewing labels:**
- Labels are grouped by category. The starter set is:
  - **Contracts** — Contract, Amendment, Statement of Work
  - **Financial** — Invoice, Purchase Order, Receipt, Financial Statement
  - **Operations** — Report, Policy or Procedure, Form
  - **Correspondence** — Letter, Email
  - **Compliance** — Certificate, Regulatory Filing
  - **Other** — Other
- Each label shows whether it is active or disabled

**Managing labels:**
- **Add Label** — Enter a name and pick or create a category
- **Create Category** — Name a new group; it is saved when you add its first label
- **Rename Category** — Change a category's name
- **Delete Category** — Remove the category and all its labels
- **Toggle Active/Disabled** — The AI skips disabled labels
- **Delete Label** — Remove one label

---

### Lines of Business

**Path:** `/admin/lobs`

Manage the lines of business documents are sorted into. The starter set is GEN (General), FIN (Finance), OPS (Operations), LEG (Legal), and HR (Human Resources).

**Table columns:** Code, Name, Description, Active status

**Actions:**
- **Add LOB** — Enter a unique code, a name, and a description
- **Edit** — Change the name or description in place
- **Toggle Active/Disabled** — The AI does not assign disabled LOBs to new documents
- **Delete** — Remove a LOB (asks you to confirm)

The AI picks a line of business from the list of active LOB names.

---

### Suggested Searches

**Path:** `/admin/suggested-searches`

Manage the suggested searches shown on Document Search and the quick questions on the Overview page and in chat.

Each suggestion has:
- **LOB Code** — The line of business it belongs to, or `*` to show it to everyone
- **Label** — Short text on the button (for example "Contracts expiring soon")
- **Search Query** — The query it runs (for example "contracts with an end or renewal date in the next 90 days")

**Actions:**
- **Add Suggestion**
- **Edit** a suggestion's code, label, or query
- **Toggle** a suggestion on or off
- **Delete** a suggestion

Users see suggestions for the lines of business their role can access.

---

### Notifications

**Path:** `/admin/notifications`

Store rules for pipeline-event messages. This template stores the rules but does not send them; the built-in alerts write to `TELEMETRY.pipeline_events`.

**Viewing rules:**
- The table shows channel, endpoint, event types, and whether each rule is active

**Adding a rule:**
1. Pick a channel: **Webhook** (HTTP POST to a URL) or **Email** (through a Snowflake integration)
2. Enter the URL or email address
3. Pick the event types:
   - INGEST, PARSE, CLASSIFY, EXTRACT
   - ALERT, ARCHIVE, PURGE
   - OVERRIDE, FEEDBACK, DOWNLOAD
4. Set a threshold value

**Managing rules:**
- **Toggle** a rule on or off
- **Delete** a rule

---

### Configuration

**Path:** `/admin/config`

Platform settings, in three groups plus an "Other" group for any remaining keys. A setting appears only if it exists in the `system_config` table.

#### Pipeline Settings

| Setting | Description |
|---------|-------------|
| `pipeline_enabled` | Master on/off for automated processing |
| `batch_size` | Most documents parsed per run (default 100) |
| `max_retries` | Retry limit for failed documents |
| `reprocess_after_days` | Reprocess documents after N days |
| `max_processing_attempts` | Attempts before a failed document is marked Abandoned (default 3) |
| `pipeline_target_lag_minutes` | Target time from upload to searchable |

#### AI Models

| Setting | Description |
|---------|-------------|
| `cortex_model` | Model for classification |
| `extraction_model` | Model for field extraction |
| `agent_model` | Model for the chat agent |
| `search_embedding_model` | Model for search embeddings (locked) |

Model settings offer a list of available Cortex models. Locked settings (lock icon) cannot be changed here, because changing them means rebuilding the services that depend on them.

#### Quality & Alerts

| Setting | Description |
|---------|-------------|
| `confidence_threshold` | Confidence below which documents are flagged |
| `classify_confidence_threshold` | Classification confidence below which documents are flagged |
| `alert_email` | Email address for system alerts |
| `admin_email` | Administrator contact email |
| `cost_alert_multiplier` | Cost spike level (for example 2.0 = twice the normal daily spend) |
| `error_rate_threshold_pct` | Error rate % that should raise an alert |

Each setting has its own **Save** button.

**Note:** Today the SQL reads `batch_size`, `max_processing_attempts`, `processing_timeout_minutes`, `error_rate_threshold_pct`, and `queue_backlog_threshold`. The other settings are stored for your use. The agent's model, the review rule, and the built-in alert limits are set in the SQL scripts. See the Operations Guide.

---

### Audit Log

**Path:** `/admin/audit`

Track user and system actions.

**Filters:**
- **Time Range** — 7, 14, 30, or 90 days
- **Event Type** — One kind of action
- **User** — One user

**Summary Cards:**
- Top event types, with event count and number of users

**Events Table:**
- Time
- User
- Event type
- File path

**Export:**
Click **Export CSV** to download the filtered events.

---

### User Management

**Path:** `/admin/users`

Control who can use the platform and what they can see.

#### Users Tab

- **Add User** — Pick from Snowflake role members not yet registered, or type a name; assign app roles
- **Edit** — Change a user's app roles
- **Deactivate** — Turn off a user's access without deleting the record
- **Reactivate** — Turn access back on (then assign roles again)
- **Sync from Roles** — Register every member of the DOC_INTEL Snowflake roles who is not yet set up, with the Viewer role

#### Roles Tab

Define app roles:

| Permission | Options |
|------------|---------|
| App Pages | A checkbox for every page in the sidebar, grouped as Main, Operations, AI Config, and Management. Unchecked pages are hidden and blocked. |
| LOB Access | All (`*`) or chosen LOB codes (for example FIN) |
| Document Types | All (`*`) or chosen types, grouped by category |
| Downloads | Allow or deny downloads |

**Actions:**
- **Create Role** — Name, description, and permissions (for example a "Finance Reviewer" role limited to FIN and to Invoice, Purchase Order, Receipt, and Financial Statement)
- **Edit** — Change a role's permissions
- **Delete** — Deactivate a role (move its users first)

When you save role changes, your own sidebar updates without a page reload.

#### Lines of Business Tab

Manage LOBs from the access side:
- Add, edit, deactivate, or set a default LOB
- This uses the same lines of business as the AI Config page; it is here so you can manage access in one place

---

## Help & Tips

**Path:** `/help`

The Help page in the app has short guides for each page. This section adds more.

### Quick Tips

- **Search with phrases** — Try "contracts with automatic renewal terms"
- **Follow up in chat** — The agent sees your last six messages, so you can ask follow-up questions
- **Ask for numbers in chat** — "How many", "total", and "by month" questions go to the Analytics tool
- **Click citation chips** — Blue chips in agent answers open the document
- **Batch actions in the Browser** — Use the checkboxes to act on many documents at once
- **Bookmark from Search** — Click the bookmark icon on a result to save it
- **Correct as you go** — Use the pencil icon on the detail page to fix a field. Approved corrections to the fields listed under Quality & Feedback show up in the catalog.
- **Keyboard** — Press Enter to send searches and chat messages

### Understanding Confidence Scores

The confidence score shows how sure the AI was of the document type. It depends on how many types the AI thought the document might be:

| Possible types | Confidence |
|---|---|
| 1 | 95% |
| 2 | 80% |
| 3 | 65% |
| 4 or more | 50% |

Badges in the Browser and Review Queue use green (75% and up), amber (50–74%), and red (below 50%). Documents with three or more possible types (65% or lower) go to the Review Queue.

### Document Processing Pipeline

Documents move through these steps:
1. **Ingest** — A file is found on a stage and registered
2. **Parse** — AI reads the text
3. **Classify** — AI picks the document type from the first page
4. **Extract** — AI pulls out fields and the line of business

If a step fails, the document is marked Failed. The pipeline retries it, and you can reprocess it from Pipeline Management.

---

## Glossary

| Term | Definition |
|------|------------|
| **LOB** | Line of Business — the area of your business a document belongs to (for example General, Finance, Operations, Legal, Human Resources) |
| **Document Type** | The label the AI assigns (for example Contract, Invoice, Report, Letter) |
| **Confidence** | How sure the AI was of the document type (0–100%) |
| **Stage** | A Snowflake stage (file storage) that holds source documents |
| **Ingestion Registry** | The record of every file the platform has found |
| **Extraction Schema** | The fields the AI tries to pull from documents |
| **Cortex Agent** | Snowflake's AI agent service, behind the chat |
| **Cortex Analyst** | Snowflake's question-to-SQL service, behind analytics answers |
| **Cortex Search** | Snowflake's search service |
| **Semantic View** | A business-level data model that Cortex Analyst uses to turn questions into SQL |

---

*Powered by Snowflake Cortex AI*
