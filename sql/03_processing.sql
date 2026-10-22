-- =============================================================================
-- DOC_INTEL: AI Processing Pipeline
-- File: sql/03_processing.sql
-- Description: Format-aware parsing, classification, extraction, dynamic catalog
-- Run as: DOC_INTEL_ADMIN after 02_ingestion.sql
-- =============================================================================

USE ROLE DOC_INTEL_ADMIN;
USE DATABASE DOC_INTEL;
USE SCHEMA DATA;
USE WAREHOUSE DOC_INTEL_WH;

-- =============================================================================
-- TABLE: parsed_documents — AI_PARSE_DOCUMENT output
-- =============================================================================

CREATE TABLE IF NOT EXISTS DOC_INTEL.DATA.parsed_documents (
    parse_id                VARCHAR         DEFAULT UUID_STRING()   NOT NULL,
    file_path               VARCHAR         NOT NULL,
    stage_name              VARCHAR         NOT NULL,
    file_format             VARCHAR         NOT NULL,
    processing_version      INT             DEFAULT 1,
    parse_mode              VARCHAR,        -- OCR or LAYOUT
    parse_result            VARIANT,        -- full AI_PARSE_DOCUMENT JSON output
    page_count              INT,
    raw_content             VARCHAR,        -- full concatenated text (all pages)
    parse_status            VARCHAR         DEFAULT 'PENDING',  -- PENDING/COMPLETE/FAILED
    parse_error             VARCHAR,
    parse_started_at        TIMESTAMP_NTZ   DEFAULT CURRENT_TIMESTAMP(),
    parse_completed_at      TIMESTAMP_NTZ,
    parse_duration_ms       BIGINT,
    created_at              TIMESTAMP_NTZ   DEFAULT CURRENT_TIMESTAMP(),
    CONSTRAINT pk_parsed PRIMARY KEY (parse_id),
    CONSTRAINT uq_parsed UNIQUE (file_path, processing_version)
)
CLUSTER BY (file_format, parse_status)
COMMENT = 'AI_PARSE_DOCUMENT results — OCR and layout extraction per document version';

-- =============================================================================
-- TABLE: document_pages — One row per page (for granular search)
-- =============================================================================

CREATE TABLE IF NOT EXISTS DOC_INTEL.DATA.document_pages (
    page_id             VARCHAR         DEFAULT UUID_STRING()   NOT NULL,
    file_path           VARCHAR         NOT NULL,
    processing_version  INT             DEFAULT 1,
    page_index          INT             NOT NULL,
    page_content        VARCHAR,
    total_pages         INT,
    src_file_id          VARCHAR,
    source_folder           VARCHAR,
    src_reference_number    VARCHAR,
    src_case_number     VARCHAR,
    created_at          TIMESTAMP_NTZ   DEFAULT CURRENT_TIMESTAMP(),
    CONSTRAINT pk_pages PRIMARY KEY (page_id),
    CONSTRAINT uq_page UNIQUE (file_path, processing_version, page_index)
)
CLUSTER BY (source_folder, file_path)
CHANGE_TRACKING = TRUE
COMMENT = 'Per-page extracted text — one row per page for granular Cortex Search retrieval';

-- =============================================================================
-- TABLE: classified_documents — AI_CLASSIFY output with confidence
-- =============================================================================

CREATE TABLE IF NOT EXISTS DOC_INTEL.DATA.classified_documents (
    classification_id       VARCHAR         DEFAULT UUID_STRING()   NOT NULL,
    file_path               VARCHAR         NOT NULL,
    processing_version      INT             DEFAULT 1,
    source_folder               VARCHAR,        -- denormalized for clustering/filtering
    ai_classification       VARIANT,        -- full AI_CLASSIFY JSON (labels + scores)
    primary_document_type   VARCHAR,        -- highest-confidence label
    all_document_types      ARRAY,          -- all labels above threshold
    confidence_score        FLOAT,          -- primary label confidence (0-1)
    src_document_type        VARCHAR,        -- native source-system type for comparison
    classification_match    BOOLEAN,        -- does AI match the source system type?
    needs_review            BOOLEAN,        -- TRUE when AI_CLASSIFY returns 3 or more labels
    classified_at           TIMESTAMP_NTZ   DEFAULT CURRENT_TIMESTAMP(),
    CONSTRAINT pk_classified PRIMARY KEY (classification_id),
    CONSTRAINT uq_classified UNIQUE (file_path, processing_version)
)
CLUSTER BY (primary_document_type, source_folder)
COMMENT = 'AI_CLASSIFY results — document type classification';

-- =============================================================================
-- TABLE: document_attributes — AI_EXTRACT output (VARIANT + typed columns)
-- =============================================================================

CREATE TABLE IF NOT EXISTS DOC_INTEL.DATA.document_attributes (
    attribute_id            VARCHAR         DEFAULT UUID_STRING()   NOT NULL,
    file_path               VARCHAR         NOT NULL,
    processing_version      INT             DEFAULT 1,
    extracted_attributes    VARIANT,        -- full AI_EXTRACT JSON

    -- Typed columns for analytics (flattened from VARIANT)
    document_date           DATE,
    party_name            VARCHAR,
    reference_number           VARCHAR,
    case_number            VARCHAR,
    issuer_name            VARCHAR,
    counterparty_name             VARCHAR,
    line_of_business        VARCHAR,
    doc_subtype           VARCHAR,        -- more specific subtype or form
    reference_date        DATE,
    start_date          DATE,
    end_date         DATE,
    event_date               DATE,
    primary_amount    VARCHAR,
    total_amount         VARCHAR,
    secondary_amount VARCHAR,
    monetary_amounts        VARIANT,
    key_terms        VARCHAR,
    action_required         VARCHAR,
    doc_status              VARCHAR,
    doc_summary             VARCHAR,

    -- Quality
    extraction_confidence   FLOAT,          -- overall extraction confidence estimate
    low_confidence_fields   ARRAY,          -- fields with low confidence
    pii_detected            BOOLEAN         DEFAULT FALSE,  -- TRUE if PII patterns detected

    extracted_at            TIMESTAMP_NTZ   DEFAULT CURRENT_TIMESTAMP(),
    CONSTRAINT pk_attributes PRIMARY KEY (attribute_id),
    CONSTRAINT uq_attributes UNIQUE (file_path, processing_version)
)
COMMENT = 'AI_EXTRACT results — key attributes per document version';

-- =============================================================================
-- TABLE: extraction_overrides — User-submitted manual corrections
-- =============================================================================

CREATE TABLE IF NOT EXISTS DOC_INTEL.ADMIN.extraction_overrides (
    override_id         VARCHAR         DEFAULT UUID_STRING()   NOT NULL,
    file_path           VARCHAR         NOT NULL,
    processing_version  INT             NOT NULL,
    field_name          VARCHAR         NOT NULL,
    original_value      VARCHAR,
    corrected_value     VARCHAR         NOT NULL,
    override_reason     VARCHAR,
    submitted_by        VARCHAR         DEFAULT CURRENT_USER(),
    submitted_at        TIMESTAMP_NTZ   DEFAULT CURRENT_TIMESTAMP(),
    approved_by         VARCHAR,
    approved_at         TIMESTAMP_NTZ,
    override_status     VARCHAR         DEFAULT 'PENDING', -- PENDING/APPROVED/REJECTED
    CONSTRAINT pk_overrides PRIMARY KEY (override_id)
)
COMMENT = 'User-submitted corrections to AI-extracted attributes — feeds quality improvement';

-- =============================================================================
-- STORED PROCEDURE: Parse pending documents (format-aware)
-- =============================================================================

CREATE OR REPLACE PROCEDURE DOC_INTEL.DATA.sp_parse_pending_documents()
    RETURNS VARCHAR
    LANGUAGE SQL
    EXECUTE AS CALLER
AS
$$
DECLARE
    parsed_count    INT DEFAULT 0;
    failed_count    INT DEFAULT 0;
    stage_prefix    VARCHAR;
    batch_limit     INT DEFAULT 100;
BEGIN
    -- Read batch limit from config
    SELECT COALESCE(config_value::INT, 100) INTO :batch_limit
    FROM DOC_INTEL.ADMIN.system_config
    WHERE config_key = 'batch_size';

    -- Lock PENDING records → PROCESSING (with batch limit from config)
    UPDATE DOC_INTEL.DATA.ingestion_registry
    SET ingestion_status   = 'PROCESSING',
        processing_started_at = CURRENT_TIMESTAMP(),
        processing_attempts   = processing_attempts + 1,
        error_stage           = NULL,
        last_error            = NULL,
        updated_at            = CURRENT_TIMESTAMP()
    WHERE ingestion_status = 'PENDING'
      AND registry_id IN (
          SELECT registry_id FROM DOC_INTEL.DATA.ingestion_registry
          WHERE ingestion_status = 'PENDING'
          ORDER BY first_seen_at
          LIMIT :batch_limit
      );

    -- ----------------------------------------------------------------
    -- Parse TIFF / JPEG / PNG — use OCR mode
    -- ----------------------------------------------------------------
    BEGIN
        INSERT INTO DOC_INTEL.DATA.parsed_documents (
            file_path, stage_name, file_format, processing_version,
            parse_mode, parse_result, page_count, raw_content,
            parse_status, parse_completed_at, parse_duration_ms
        )
        WITH ocr_batch AS (
            SELECT
                r.file_path, r.stage_name, r.file_format, r.processing_version,
                AI_PARSE_DOCUMENT(
                    TO_FILE('@' || r.stage_name, r.file_path),
                    {'mode': 'OCR'}
                ) AS parsed
            FROM DOC_INTEL.DATA.ingestion_registry r
            WHERE r.ingestion_status = 'PROCESSING'
              AND r.file_format IN ('TIF', 'TIFF', 'JPG', 'JPEG', 'PNG')
              AND NOT EXISTS (
                  SELECT 1 FROM DOC_INTEL.DATA.parsed_documents p
                  WHERE p.file_path = r.file_path AND p.processing_version = r.processing_version
              )
        )
        SELECT
            file_path, stage_name, file_format, processing_version,
            'OCR', parsed, 1, parsed:content::VARCHAR,
            'COMPLETE', CURRENT_TIMESTAMP(), 0
        FROM ocr_batch;
    EXCEPTION
        WHEN OTHER THEN
            -- Bulk OCR parse failed — mark affected rows as FAILED with diagnostic info
            UPDATE DOC_INTEL.DATA.ingestion_registry
            SET ingestion_status = 'FAILED',
                last_error       = 'OCR parse batch failed: ' || SQLERRM,
                error_stage      = 'PARSE',
                updated_at       = CURRENT_TIMESTAMP()
            WHERE ingestion_status = 'PROCESSING'
              AND file_format IN ('TIF', 'TIFF', 'JPG', 'JPEG', 'PNG')
              AND NOT EXISTS (
                  SELECT 1 FROM DOC_INTEL.DATA.parsed_documents p
                  WHERE p.file_path = ingestion_registry.file_path
                    AND p.processing_version = ingestion_registry.processing_version
              );
    END;

    -- ----------------------------------------------------------------
    -- Parse PDF / DOCX / PPTX / HTML / TXT — use LAYOUT mode
    -- ----------------------------------------------------------------
    BEGIN
        INSERT INTO DOC_INTEL.DATA.parsed_documents (
            file_path, stage_name, file_format, processing_version,
            parse_mode, parse_result, page_count, raw_content,
            parse_status, parse_completed_at, parse_duration_ms
        )
        WITH layout_batch AS (
            SELECT
                r.file_path, r.stage_name, r.file_format, r.processing_version,
                AI_PARSE_DOCUMENT(
                    TO_FILE('@' || r.stage_name, r.file_path),
                    {'mode': 'LAYOUT'}
                ) AS parsed
            FROM DOC_INTEL.DATA.ingestion_registry r
            WHERE r.ingestion_status = 'PROCESSING'
              AND r.file_format IN ('PDF', 'DOCX', 'PPTX', 'HTML', 'TXT')
              AND NOT EXISTS (
                  SELECT 1 FROM DOC_INTEL.DATA.parsed_documents p
                  WHERE p.file_path = r.file_path AND p.processing_version = r.processing_version
              )
        )
        SELECT
            file_path, stage_name, file_format, processing_version,
            'LAYOUT', parsed,
            COALESCE(parsed:metadata:pageCount::INT, 1),
            parsed:content::VARCHAR,
            'COMPLETE', CURRENT_TIMESTAMP(), 0
        FROM layout_batch;
    EXCEPTION
        WHEN OTHER THEN
            -- Bulk LAYOUT parse failed — mark affected rows as FAILED
            UPDATE DOC_INTEL.DATA.ingestion_registry
            SET ingestion_status = 'FAILED',
                last_error       = 'LAYOUT parse batch failed: ' || SQLERRM,
                error_stage      = 'PARSE',
                updated_at       = CURRENT_TIMESTAMP()
            WHERE ingestion_status = 'PROCESSING'
              AND file_format IN ('PDF', 'DOCX', 'PPTX', 'HTML', 'TXT')
              AND NOT EXISTS (
                  SELECT 1 FROM DOC_INTEL.DATA.parsed_documents p
                  WHERE p.file_path = ingestion_registry.file_path
                    AND p.processing_version = ingestion_registry.processing_version
              );
    END;

    -- ----------------------------------------------------------------
    -- Flatten pages into document_pages table
    -- ----------------------------------------------------------------
    INSERT INTO DOC_INTEL.DATA.document_pages (
        file_path, processing_version, page_index, page_content, total_pages,
        src_file_id, source_folder, src_reference_number, src_case_number
    )
    SELECT
        pd.file_path,
        pd.processing_version,
        -- For paginated: use page index; for images: page_index = 0
        CASE WHEN pd.parse_result:pages IS NOT NULL
             THEN p.value:index::INT
             ELSE 0
        END                         AS page_index,
        CASE WHEN pd.parse_result:pages IS NOT NULL
             THEN p.value:content::VARCHAR
             ELSE pd.raw_content
        END                         AS page_content,
        pd.page_count               AS total_pages,
        r.src_file_id,
        r.source_folder,
        r.src_reference_number,
        r.src_case_number
    FROM DOC_INTEL.DATA.parsed_documents pd
    INNER JOIN DOC_INTEL.DATA.ingestion_registry r
        ON pd.file_path = r.file_path AND pd.processing_version = r.processing_version
    LEFT JOIN LATERAL FLATTEN(
        input => COALESCE(pd.parse_result:pages, ARRAY_CONSTRUCT(OBJECT_CONSTRUCT('index', 0, 'content', pd.raw_content))),
        OUTER => TRUE
    ) p
    WHERE pd.parse_status = 'COMPLETE'
      AND NOT EXISTS (
          SELECT 1 FROM DOC_INTEL.DATA.document_pages dp
          WHERE dp.file_path = pd.file_path AND dp.processing_version = pd.processing_version
      );

    -- ----------------------------------------------------------------
    -- Update content_hash on registry (change detection for next run)
    -- ----------------------------------------------------------------
    -- Update content_hash only for rows currently being processed (not all historical)
    UPDATE DOC_INTEL.DATA.ingestion_registry r
    SET content_hash  = SHA2(pd.raw_content, 256),
        updated_at    = CURRENT_TIMESTAMP()
    FROM DOC_INTEL.DATA.parsed_documents pd
    WHERE r.file_path = pd.file_path
      AND r.processing_version = pd.processing_version
      AND pd.parse_status = 'COMPLETE'
      AND r.ingestion_status = 'PROCESSING';

    -- Log telemetry for newly parsed docs only (idempotent)
    INSERT INTO DOC_INTEL.TELEMETRY.pipeline_events (
        event_type, stage_name, file_path, source_folder, status,
        metadata
    )
    SELECT
        'PARSE_COMPLETE', 'PARSE', pd.file_path, r.source_folder, 'SUCCESS',
        OBJECT_CONSTRUCT(
            'parse_mode', pd.parse_mode,
            'page_count', pd.page_count,
            'file_format', pd.file_format
        )
    FROM DOC_INTEL.DATA.parsed_documents pd
    INNER JOIN DOC_INTEL.DATA.ingestion_registry r
        ON pd.file_path = r.file_path AND pd.processing_version = r.processing_version
    WHERE pd.parse_status = 'COMPLETE'
      AND r.ingestion_status = 'PROCESSING'
      AND NOT EXISTS (
          SELECT 1 FROM DOC_INTEL.TELEMETRY.pipeline_events pe
          WHERE pe.file_path = pd.file_path AND pe.event_type = 'PARSE_COMPLETE'
      );

    RETURN 'Parsing complete. Check parsed_documents for results.';
END;
$$;

-- =============================================================================
-- STORED PROCEDURE: Classify parsed documents
-- =============================================================================

CREATE OR REPLACE PROCEDURE DOC_INTEL.DATA.sp_classify_parsed_documents()
    RETURNS VARCHAR
    LANGUAGE SQL
    EXECUTE AS CALLER
AS
$$
DECLARE
    label_array ARRAY;
    rows_classified INT DEFAULT 0;
BEGIN
    -- Dynamically build label array from classification_labels table
    SELECT ARRAY_AGG(label) INTO :label_array
    FROM DOC_INTEL.ADMIN.classification_labels
    WHERE is_active = TRUE
    ORDER BY sort_order;

    IF (ARRAY_SIZE(:label_array) = 0) THEN
        RETURN 'ERROR: No active classification labels found in DOC_INTEL.ADMIN.classification_labels';
    END IF;

    BEGIN
        INSERT INTO DOC_INTEL.DATA.classified_documents (
            file_path, processing_version, source_folder, ai_classification,
            primary_document_type, all_document_types, confidence_score,
            src_document_type, classification_match, needs_review
        )
        SELECT
            pd.file_path,
            pd.processing_version,
            r.source_folder,
            AI_CLASSIFY(
                first_page.page_content,
                :label_array,
                {'output_mode': 'multi'}
            )                                           AS ai_classification,
            ai_classification:labels[0]::VARCHAR        AS primary_document_type,
            ai_classification:labels                    AS all_document_types,
            CASE WHEN ARRAY_SIZE(ai_classification:labels) = 1 THEN 0.95
                 WHEN ARRAY_SIZE(ai_classification:labels) = 2 THEN 0.80
                 WHEN ARRAY_SIZE(ai_classification:labels) = 3 THEN 0.65
                 ELSE 0.50
            END                                         AS confidence_score,
            r.src_document_type,
            CONTAINS(UPPER(ai_classification:labels::VARCHAR), UPPER(r.src_document_type))
                                                        AS classification_match,
            (ARRAY_SIZE(ai_classification:labels) >= 3) AS needs_review
        FROM DOC_INTEL.DATA.parsed_documents pd
        INNER JOIN DOC_INTEL.DATA.ingestion_registry r
            ON pd.file_path = r.file_path AND pd.processing_version = r.processing_version
        INNER JOIN (
            SELECT file_path, processing_version, page_content
            FROM DOC_INTEL.DATA.document_pages
            WHERE page_index = 0
        ) first_page ON first_page.file_path = pd.file_path
                  AND first_page.processing_version = pd.processing_version
        WHERE pd.parse_status = 'COMPLETE'
          AND r.ingestion_status = 'PROCESSING'
          AND NOT EXISTS (
              SELECT 1 FROM DOC_INTEL.DATA.classified_documents cd
              WHERE cd.file_path = pd.file_path AND cd.processing_version = pd.processing_version
          );
    EXCEPTION
        WHEN OTHER THEN
            -- Classification batch failed — mark unclassified PROCESSING rows as FAILED
            UPDATE DOC_INTEL.DATA.ingestion_registry
            SET ingestion_status = 'FAILED',
                last_error       = 'Classification batch failed: ' || SQLERRM,
                error_stage      = 'CLASSIFY',
                updated_at       = CURRENT_TIMESTAMP()
            WHERE ingestion_status = 'PROCESSING'
              AND NOT EXISTS (
                  SELECT 1 FROM DOC_INTEL.DATA.classified_documents cd
                  WHERE cd.file_path = ingestion_registry.file_path
                    AND cd.processing_version = ingestion_registry.processing_version
              );
    END;

    rows_classified := SQLROWCOUNT;

    -- Log telemetry (idempotent — only for newly classified docs)
    INSERT INTO DOC_INTEL.TELEMETRY.pipeline_events (
        event_type, stage_name, file_path, source_folder, status, metadata
    )
    SELECT
        'CLASSIFY_COMPLETE', 'CLASSIFY', cd.file_path, r.source_folder, 'SUCCESS',
        OBJECT_CONSTRUCT(
            'primary_type', cd.primary_document_type,
            'confidence', cd.confidence_score,
            'needs_review', cd.needs_review
        )
    FROM DOC_INTEL.DATA.classified_documents cd
    INNER JOIN DOC_INTEL.DATA.ingestion_registry r
        ON cd.file_path = r.file_path AND cd.processing_version = r.processing_version
    WHERE r.ingestion_status = 'PROCESSING'
      AND NOT EXISTS (
          SELECT 1 FROM DOC_INTEL.TELEMETRY.pipeline_events pe
          WHERE pe.file_path = cd.file_path AND pe.event_type = 'CLASSIFY_COMPLETE'
      );

    RETURN 'Classification complete. ' || :rows_classified || ' documents classified using ' || ARRAY_SIZE(:label_array) || ' labels.';
END;
$$;

-- =============================================================================
-- STORED PROCEDURE: Extract key attributes
-- =============================================================================

CREATE OR REPLACE PROCEDURE DOC_INTEL.DATA.sp_extract_document_attributes()
    RETURNS VARCHAR
    LANGUAGE SQL
    EXECUTE AS CALLER
AS
$$
DECLARE
    lob_list VARCHAR;
    lob_prompt VARCHAR;
    rows_extracted INT DEFAULT 0;
BEGIN
    -- Dynamically build LOB list from lines_of_business table
    SELECT LISTAGG(lob_name, ', ') WITHIN GROUP (ORDER BY sort_order)
    INTO :lob_list
    FROM DOC_INTEL.ADMIN.lines_of_business
    WHERE is_active = TRUE;

    IF (:lob_list IS NULL OR :lob_list = '') THEN
        lob_list := 'Determine the line of business or category from the document content';
    END IF;

    lob_prompt := 'Line of business: ' || :lob_list;

    BEGIN
        INSERT INTO DOC_INTEL.DATA.document_attributes (
            file_path, processing_version, extracted_attributes,
            document_date, party_name, reference_number, case_number,
            issuer_name, counterparty_name, line_of_business, doc_subtype,
            reference_date, start_date, end_date, event_date,
            primary_amount, total_amount, secondary_amount,
            monetary_amounts, key_terms, action_required,
            doc_status, doc_summary
        )
        WITH extraction_cte AS (
            SELECT
                pd.file_path,
                pd.processing_version,
                r.src_reference_number,
                r.src_case_number,
                AI_EXTRACT(
                    pd.raw_content,
                    {
                        'document_date':         'Date the document was created, issued, or effective',
                        'party_name':          'Main person or organization the document is about',
                        'reference_number':         'Main reference, account, contract, or ID number',
                        'case_number':          'Case, ticket, order, or incident number, if any',
                        'issuer_name':          'Organization that issued or authored the document',
                        'counterparty_name':           'Other party named in the document, such as a vendor, customer, or agent',
                        'line_of_business':      :lob_prompt,
                        'doc_subtype':         'More specific document subtype or form name',
                        'reference_date':      'Any other key date the document refers to',
                        'start_date':        'Start or effective date of the agreement, period, or event',
                        'end_date':       'End, expiration, due, or renewal date',
                        'event_date':             'Date of the main event, incident, or transaction described',
                        'primary_amount':  'Main monetary amount in the document',
                        'total_amount':       'Total or maximum amount',
                        'secondary_amount': 'Any other important amount, such as a fee, balance, or deductible',
                        'monetary_amounts':      'All monetary values mentioned, with what each one is for',
                        'key_terms':      'Key terms, conditions, exclusions, or limitations',
                        'action_required':       'Required actions, follow-up items, or deadlines',
                        'doc_status':            'Document status such as draft, active, approved, open, closed, or expired',
                        'doc_summary':           'Two to three sentence summary of the document purpose and key facts'
                    }
                ) AS extracted_attributes
            FROM DOC_INTEL.DATA.parsed_documents pd
            INNER JOIN DOC_INTEL.DATA.ingestion_registry r
                ON pd.file_path = r.file_path AND pd.processing_version = r.processing_version
            WHERE pd.parse_status = 'COMPLETE'
              AND r.ingestion_status = 'PROCESSING'
              AND NOT EXISTS (
                  SELECT 1 FROM DOC_INTEL.DATA.document_attributes da
                  WHERE da.file_path = pd.file_path AND da.processing_version = pd.processing_version
              )
        )
        SELECT
            file_path,
            processing_version,
            extracted_attributes,
            TRY_TO_DATE(extracted_attributes:response:document_date::VARCHAR),
            extracted_attributes:response:party_name::VARCHAR,
            COALESCE(extracted_attributes:response:reference_number::VARCHAR, src_reference_number),
            COALESCE(extracted_attributes:response:case_number::VARCHAR, src_case_number),
            extracted_attributes:response:issuer_name::VARCHAR,
            extracted_attributes:response:counterparty_name::VARCHAR,
            extracted_attributes:response:line_of_business::VARCHAR,
            extracted_attributes:response:doc_subtype::VARCHAR,
            TRY_TO_DATE(extracted_attributes:response:reference_date::VARCHAR),
            TRY_TO_DATE(extracted_attributes:response:start_date::VARCHAR),
            TRY_TO_DATE(extracted_attributes:response:end_date::VARCHAR),
            TRY_TO_DATE(extracted_attributes:response:event_date::VARCHAR),
            extracted_attributes:response:primary_amount::VARCHAR,
            extracted_attributes:response:total_amount::VARCHAR,
            extracted_attributes:response:secondary_amount::VARCHAR,
            extracted_attributes:response:monetary_amounts,
            extracted_attributes:response:key_terms::VARCHAR,
            extracted_attributes:response:action_required::VARCHAR,
            extracted_attributes:response:doc_status::VARCHAR,
            extracted_attributes:response:doc_summary::VARCHAR
        FROM extraction_cte;
    EXCEPTION
        WHEN OTHER THEN
            -- Extraction batch failed — mark unextracted PROCESSING rows as FAILED
            UPDATE DOC_INTEL.DATA.ingestion_registry
            SET ingestion_status = 'FAILED',
                last_error       = 'Extraction batch failed: ' || SQLERRM,
                error_stage      = 'EXTRACT',
                updated_at       = CURRENT_TIMESTAMP()
            WHERE ingestion_status = 'PROCESSING'
              AND NOT EXISTS (
                  SELECT 1 FROM DOC_INTEL.DATA.document_attributes da
                  WHERE da.file_path = ingestion_registry.file_path
                    AND da.processing_version = ingestion_registry.processing_version
              );
    END;

    -- Mark registry as COMPLETE
    UPDATE DOC_INTEL.DATA.ingestion_registry r
    SET ingestion_status           = 'COMPLETE',
        processing_completed_at    = CURRENT_TIMESTAMP(),
        updated_at                 = CURRENT_TIMESTAMP()
    WHERE ingestion_status = 'PROCESSING'
      AND EXISTS (
          SELECT 1 FROM DOC_INTEL.DATA.document_attributes da
          WHERE da.file_path = r.file_path AND da.processing_version = r.processing_version
      );

    -- Log completion telemetry (idempotent — only for newly extracted docs)
    INSERT INTO DOC_INTEL.TELEMETRY.pipeline_events (
        event_type, stage_name, file_path, source_folder, status, metadata
    )
    SELECT
        'EXTRACT_COMPLETE', 'EXTRACT', da.file_path, r.source_folder, 'SUCCESS',
        OBJECT_CONSTRUCT(
            'line_of_business', da.line_of_business,
            'doc_subtype', da.doc_subtype,
            'has_reference_number', (da.reference_number IS NOT NULL),
            'has_case_number', (da.case_number IS NOT NULL)
        )
    FROM DOC_INTEL.DATA.document_attributes da
    INNER JOIN DOC_INTEL.DATA.ingestion_registry r
        ON da.file_path = r.file_path AND da.processing_version = r.processing_version
    WHERE r.ingestion_status = 'COMPLETE'
      AND NOT EXISTS (
          SELECT 1 FROM DOC_INTEL.TELEMETRY.pipeline_events pe
          WHERE pe.file_path = da.file_path AND pe.event_type = 'EXTRACT_COMPLETE'
      );

    RETURN 'Attribute extraction complete.';
END;
$$;

-- =============================================================================
-- DYNAMIC TABLE: overrides_pivoted — pre-pivot overrides for incremental join
-- =============================================================================
-- Pre-pivots extraction_overrides into one row per (file_path, processing_version)
-- so the catalog DT can use a single LEFT JOIN instead of 10 filtered subqueries.

CREATE OR REPLACE DYNAMIC TABLE DOC_INTEL.DATA.overrides_pivoted
    TARGET_LAG = '1 hour'
    WAREHOUSE  = DOC_INTEL_WH
    COMMENT    = 'Pre-pivoted extraction overrides — one row per (file_path, version) for incremental join'
AS
SELECT
    file_path,
    processing_version,
    MAX(CASE WHEN field_name = 'document_date'     THEN corrected_value END) AS document_date_override,
    MAX(CASE WHEN field_name = 'party_name'      THEN corrected_value END) AS party_name_override,
    MAX(CASE WHEN field_name = 'reference_number'     THEN corrected_value END) AS reference_number_override,
    MAX(CASE WHEN field_name = 'case_number'      THEN corrected_value END) AS case_number_override,
    MAX(CASE WHEN field_name = 'issuer_name'      THEN corrected_value END) AS issuer_name_override,
    MAX(CASE WHEN field_name = 'counterparty_name'       THEN corrected_value END) AS counterparty_name_override,
    MAX(CASE WHEN field_name = 'line_of_business'  THEN corrected_value END) AS line_of_business_override,
    MAX(CASE WHEN field_name = 'doc_subtype'     THEN corrected_value END) AS doc_subtype_override,
    MAX(CASE WHEN field_name = 'key_terms'  THEN corrected_value END) AS key_terms_override,
    MAX(CASE WHEN field_name = 'doc_status'        THEN corrected_value END) AS doc_status_override
FROM DOC_INTEL.ADMIN.extraction_overrides
WHERE override_status = 'APPROVED'
GROUP BY file_path, processing_version;

-- =============================================================================
-- DYNAMIC TABLE: document_catalog — final unified view (INCREMENTAL refresh)
-- =============================================================================
-- Uses QUALIFY ROW_NUMBER() to keep each file's latest completed version.

CREATE OR REPLACE DYNAMIC TABLE DOC_INTEL.DATA.document_catalog
    TARGET_LAG    = '1 hour'
    REFRESH_MODE  = INCREMENTAL
    WAREHOUSE     = DOC_INTEL_WH
    COMMENT       = 'Unified document catalog — latest version of each document with all extracted attributes and source-system metadata'
AS
SELECT
    r.registry_id,
    r.file_path,
    r.stage_name,
    r.file_format,
    r.processing_version,
    r.src_file_id,
    r.source_folder,
    r.src_reference_number,
    r.src_case_number,
    r.src_assigned_to,
    r.src_date_created,
    cd.primary_document_type        AS document_type,
    cd.all_document_types,
    cd.confidence_score             AS classification_confidence,
    cd.needs_review,
    cd.src_document_type,
    cd.classification_match,
    COALESCE(ov.document_date_override, da.document_date::VARCHAR)::DATE  AS document_date,
    COALESCE(ov.party_name_override,  da.party_name)                  AS party_name,
    COALESCE(ov.reference_number_override, da.reference_number)                 AS reference_number,
    COALESCE(ov.case_number_override,  da.case_number)                  AS case_number,
    COALESCE(ov.issuer_name_override,  da.issuer_name)                  AS issuer_name,
    COALESCE(ov.counterparty_name_override,   da.counterparty_name)                   AS counterparty_name,
    COALESCE(ov.line_of_business_override, da.line_of_business)           AS line_of_business,
    COALESCE(ov.doc_subtype_override, da.doc_subtype)                 AS doc_subtype,
    da.reference_date,
    da.start_date,
    da.end_date,
    da.event_date,
    da.primary_amount,
    da.total_amount,
    da.secondary_amount,
    da.monetary_amounts,
    COALESCE(ov.key_terms_override, da.key_terms)           AS key_terms,
    da.action_required,
    COALESCE(ov.doc_status_override, da.doc_status)                       AS doc_status,
    da.doc_summary,
    pd.raw_content                  AS full_text,
    pd.page_count,
    pd.parse_mode,
    r.first_seen_at                 AS upload_timestamp,
    r.first_seen_at,
    r.processing_completed_at,
    r.ingestion_status
FROM DOC_INTEL.DATA.ingestion_registry r
INNER JOIN DOC_INTEL.DATA.parsed_documents pd
    ON r.file_path = pd.file_path AND r.processing_version = pd.processing_version
INNER JOIN DOC_INTEL.DATA.classified_documents cd
    ON r.file_path = cd.file_path AND r.processing_version = cd.processing_version
INNER JOIN DOC_INTEL.DATA.document_attributes da
    ON r.file_path = da.file_path AND r.processing_version = da.processing_version
LEFT JOIN DOC_INTEL.DATA.overrides_pivoted ov
    ON r.file_path = ov.file_path AND r.processing_version = ov.processing_version
WHERE r.ingestion_status = 'COMPLETE'
QUALIFY ROW_NUMBER() OVER (
    PARTITION BY r.file_path
    ORDER BY r.processing_version DESC
) = 1;
