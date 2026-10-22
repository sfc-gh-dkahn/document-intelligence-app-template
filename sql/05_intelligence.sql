  -- =============================================================================
-- DOC_INTEL: Intelligence Services
-- File: sql/05_intelligence.sql
-- Description: Cortex Search, Semantic View, Cortex Agent
-- Run as: DOC_INTEL_ADMIN after 04_telemetry.sql
-- =============================================================================

USE ROLE DOC_INTEL_ADMIN;
USE DATABASE DOC_INTEL;
USE SCHEMA SERVICES;
USE WAREHOUSE DOC_INTEL_WH;

-- =============================================================================
-- CORTEX SEARCH SERVICE: Hybrid semantic + keyword retrieval
-- =============================================================================
-- Indexes document_pages for granular per-page retrieval AND document_catalog
-- for document-level search with structured metadata filters.
--
-- The search services read document_catalog and document_pages, which have no
-- row access policy. /api/search checks each result against
-- APP.v_document_catalog (which has the policy) before returning it.

-- Detach RAP if attached (idempotent — safe on fresh deploys)
EXECUTE IMMEDIATE $$
BEGIN
  ALTER TABLE DOC_INTEL.DATA.document_catalog
    DROP ROW ACCESS POLICY DOC_INTEL.ADMIN.document_entitlement_policy;
EXCEPTION WHEN OTHER THEN NULL;
END;
$$;

-- Document-level search (full catalog, with all filterable attributes)
CREATE OR REPLACE CORTEX SEARCH SERVICE DOC_INTEL.SERVICES.doc_search_svc
    ON full_text
    ATTRIBUTES  document_type,
                doc_status,
                source_folder,
                line_of_business,
                doc_subtype,
                src_reference_number,
                src_case_number,
                file_format,
                party_name
    WAREHOUSE   = DOC_INTEL_WH
    TARGET_LAG  = '1 hour'
    EMBEDDING_MODEL = 'snowflake-arctic-embed-l-v2.0'
    COMMENT = 'Primary document search — hybrid vector+keyword, filterable by folder/type/LOB'
AS (
    SELECT
        dc.file_path,
        dc.src_file_id,
        dc.source_folder,
        dc.src_reference_number,
        dc.src_case_number,
        dc.src_assigned_to,
        dc.document_type,
        dc.all_document_types,
        dc.classification_confidence,
        dc.party_name,
        dc.issuer_name,
        dc.counterparty_name,
        dc.line_of_business,
        dc.doc_subtype,
        dc.reference_date::VARCHAR        AS reference_date,
        dc.start_date::VARCHAR          AS start_date,
        dc.end_date::VARCHAR         AS end_date,
        dc.event_date::VARCHAR               AS event_date,
        dc.primary_amount,
        dc.total_amount,
        dc.secondary_amount,
        dc.key_terms,
        dc.action_required,
        dc.doc_status,
        dc.doc_summary,
        dc.file_format,
        dc.page_count,
        dc.processing_completed_at::VARCHAR AS indexed_at,
        dc.full_text
    FROM DOC_INTEL.DATA.document_catalog dc
);

-- Page-level search: one row per page
CREATE OR REPLACE CORTEX SEARCH SERVICE DOC_INTEL.SERVICES.doc_page_search_svc
    ON page_content
    ATTRIBUTES  source_folder, src_reference_number, src_case_number, file_path
    WAREHOUSE   = DOC_INTEL_WH
    TARGET_LAG  = '1 hour'
    EMBEDDING_MODEL = 'snowflake-arctic-embed-l-v2.0'
    COMMENT = 'Page-level search for RAG — granular retrieval from multi-page documents'
AS (
    SELECT
        dp.file_path,
        dp.processing_version,
        dp.page_index,
        dp.total_pages,
        dp.source_folder,
        dp.src_reference_number,
        dp.src_case_number,
        dp.page_content
    FROM DOC_INTEL.DATA.document_pages dp
);

-- Grant search to user role
GRANT USAGE ON CORTEX SEARCH SERVICE DOC_INTEL.SERVICES.doc_search_svc      TO ROLE DOC_INTEL_USER;
GRANT USAGE ON CORTEX SEARCH SERVICE DOC_INTEL.SERVICES.doc_page_search_svc TO ROLE DOC_INTEL_USER;

-- =============================================================================
-- SEMANTIC VIEW: Cortex Analyst — natural language → SQL for analytics
-- =============================================================================

-- NOTE: The semantic view reads document_catalog directly, so agent analytics
-- answers are not filtered by app role.

CREATE OR REPLACE SEMANTIC VIEW DOC_INTEL.SERVICES.document_analytics_sv

  TABLES (
    doc_catalog AS DOC_INTEL.DATA.document_catalog
  )

  DIMENSIONS (
    doc_catalog.file_path AS file_path
      COMMENT = 'Full path to the source document file on stage',
    doc_catalog.src_file_id AS src_file_id
      COMMENT = 'Source system file ID',
    doc_catalog.source_folder AS source_folder
      COMMENT = 'Source folder the document was loaded from',
    doc_catalog.src_assigned_to AS src_assigned_to
      COMMENT = 'Person the document is assigned to in source system workflow',
    doc_catalog.src_reference_number AS src_reference_number
      COMMENT = 'Reference number from source system',
    doc_catalog.src_case_number AS src_case_number
      COMMENT = 'Case number from source system',
    doc_catalog.document_type AS document_type
      COMMENT = 'AI-classified document type',
    doc_catalog.file_format AS file_format
      COMMENT = 'Source file format: TIFF, PDF, DOCX, JPEG, PNG, HTML, TXT',
    doc_catalog.needs_review AS needs_review
      COMMENT = 'True if the classifier returned 3 or more document types',
    doc_catalog.party_name AS party_name
      COMMENT = 'Main person or organization the document is about',
    doc_catalog.issuer_name AS issuer_name
      COMMENT = 'Organization that issued the document',
    doc_catalog.counterparty_name AS counterparty_name
      COMMENT = 'Other party named in the document, such as a vendor, customer, or agent',
    doc_catalog.line_of_business AS line_of_business
      COMMENT = 'Line of business or department, from the Lines of Business admin tab',
    doc_catalog.doc_subtype AS doc_subtype
      COMMENT = 'More specific document subtype',
    doc_catalog.doc_status AS doc_status
      COMMENT = 'Document status such as draft, active, approved, open, closed, or expired',
    doc_catalog.start_date AS start_date
      COMMENT = 'Start or effective date',
    doc_catalog.end_date AS end_date
      COMMENT = 'End, expiration, or due date',
    doc_catalog.upload_timestamp AS upload_timestamp
      COMMENT = 'When the document was first seen in the ingestion stage'
  )

  METRICS (
    doc_catalog.document_count AS COUNT(*)
      COMMENT = 'Total number of documents',
    doc_catalog.avg_confidence AS AVG(classification_confidence)
      COMMENT = 'Average AI classification confidence score',
    doc_catalog.total_pages AS SUM(page_count)
      COMMENT = 'Total number of pages across documents'
  )

  COMMENT = 'Analytics model for the document library — natural language to SQL';

GRANT SELECT, REFERENCES ON SEMANTIC VIEW DOC_INTEL.SERVICES.document_analytics_sv TO ROLE DOC_INTEL_USER;

-- =============================================================================
-- CORTEX AGENT: Routes between Search and Analyst based on question intent
-- =============================================================================

CREATE OR REPLACE AGENT DOC_INTEL.SERVICES.doc_intelligence_agent
  COMMENT = 'Document intelligence agent'
  FROM SPECIFICATION
  $$
  models:
    orchestration: claude-sonnet-4-5

  orchestration:
    budget:
      seconds: 120
      tokens: 32000

  instructions:
    response: "You are a document intelligence assistant. Always cite file_path and src_file_id when referencing documents. Format citations as: [file_path] (File: src_file_id). This is informational retrieval, not legal advice."
    orchestration: "Use doc_search for questions seeking specific documents, content, or terms. Use doc_analytics for questions requiring aggregation, counting, statistics, or trend analysis (how many, count, total, average, compare, breakdown). Use both when a question needs retrieval AND analytics."
    sample_questions:
      - question: "What document types do we have?"
      - question: "How many documents do we have by line of business?"
      - question: "Which documents have an end date in the next 90 days?"

  tools:
    - tool_spec:
        type: "cortex_search"
        name: "doc_search"
        description: "Searches documents in the corpus. Use for finding specific documents, content lookups, and research."
    - tool_spec:
        type: "cortex_analyst_text_to_sql"
        name: "doc_analytics"
        description: "Analyzes the document portfolio with SQL queries. Use for counting documents, aggregating by line of business or document type, trend analysis, and statistical breakdowns."

  tool_resources:
    doc_search:
      search_service: "DOC_INTEL.SERVICES.DOC_SEARCH_SVC"
      max_results: 10
      id_column: "file_path"
      title_column: "file_path"
    doc_analytics:
      semantic_view: "DOC_INTEL.SERVICES.DOCUMENT_ANALYTICS_SV"
      execution_environment:
        type: "warehouse"
        warehouse: "DOC_INTEL_QUERY_WH"
  $$;

GRANT USAGE ON AGENT DOC_INTEL.SERVICES.doc_intelligence_agent TO ROLE DOC_INTEL_USER;

-- Set Snowflake Intelligence profile for display in Snowflake Intelligence
ALTER AGENT DOC_INTEL.SERVICES.doc_intelligence_agent SET
  PROFILE = '{"display_name": "Document Intelligence", "color": "blue"}';
