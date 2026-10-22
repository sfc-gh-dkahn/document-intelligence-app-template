-- =============================================================================
-- DOC_INTEL: Ingestion Pipeline — Deduplication, Task DAG
-- File: sql/02_ingestion.sql
-- Description: Ingestion registry, dedup logic, stream detection, task DAG
-- Run as: DOC_INTEL_ADMIN after 01_foundation.sql
-- RUNTIME DEPS: Procedures reference ADMIN.system_config (created in 06_admin.sql).
--               Tasks are resumed by deploy.sh AFTER all scripts run.
-- =============================================================================

USE ROLE DOC_INTEL_ADMIN;
USE DATABASE DOC_INTEL;
USE SCHEMA DATA;
USE WAREHOUSE DOC_INTEL_WH;

-- =============================================================================
-- INGESTION REGISTRY: Single source of truth for every file ever seen
-- =============================================================================

CREATE TABLE IF NOT EXISTS DOC_INTEL.DATA.ingestion_registry (
    -- Identity
    registry_id             VARCHAR         DEFAULT UUID_STRING()           NOT NULL,
    file_path               VARCHAR         NOT NULL,
    stage_name              VARCHAR         NOT NULL,
    file_format             VARCHAR         NOT NULL,   -- TIFF,PDF,DOCX,JPEG,PNG,HTML,TXT

    -- File metadata
    file_size_bytes         BIGINT,
    file_hash               VARCHAR,        -- SHA2(256) — set when file is first read
    src_file_id              VARCHAR,
    source_folder               VARCHAR,
    src_document_type        VARCHAR,    -- native document type from the source system
    src_reference_number        VARCHAR,
    src_case_number         VARCHAR,
    src_assigned_to          VARCHAR,
    src_date_created         TIMESTAMP_NTZ,
    src_metadata             VARIANT,        -- full JSON sidecar

    -- Pipeline state machine
    ingestion_status        VARCHAR         DEFAULT 'PENDING',
    -- Valid: PENDING | PROCESSING | COMPLETE | FAILED | ABANDONED | SKIPPED
    processing_version      INT             DEFAULT 1,
    force_reprocess         BOOLEAN         DEFAULT FALSE,

    -- Timestamps
    first_seen_at           TIMESTAMP_NTZ   DEFAULT CURRENT_TIMESTAMP(),
    last_seen_at            TIMESTAMP_NTZ   DEFAULT CURRENT_TIMESTAMP(),
    processing_started_at   TIMESTAMP_NTZ,
    processing_completed_at TIMESTAMP_NTZ,

    -- Error tracking
    processing_attempts     INT             DEFAULT 0,
    last_error              VARCHAR,
    error_stage             VARCHAR,        -- which stage failed: PARSE/CLASSIFY/EXTRACT

    -- Content tracking for change detection
    content_hash            VARCHAR,        -- hash of AI-extracted text (set after PARSE)
    previous_content_hash   VARCHAR,        -- previous version for diff tracking

    -- Audit
    created_by              VARCHAR         DEFAULT CURRENT_USER(),
    updated_at              TIMESTAMP_NTZ   DEFAULT CURRENT_TIMESTAMP(),

    CONSTRAINT pk_registry PRIMARY KEY (registry_id),
    CONSTRAINT uq_registry_version UNIQUE (file_path, processing_version)
)
CLUSTER BY (source_folder, ingestion_status)
DATA_RETENTION_TIME_IN_DAYS = 30
COMMENT = 'Master registry of all documents — dedup, state tracking, lineage';

-- =============================================================================
-- STAGE SCAN VIEW: Reads current stage contents across both stages
-- =============================================================================

CREATE OR REPLACE VIEW DOC_INTEL.DATA.v_stage_files AS
WITH staged AS (
    -- Main document stage
    SELECT
        RELATIVE_PATH                                           AS file_path,
        'DOC_INTEL.DATA.doc_stage'                    AS stage_name,
        '@DOC_INTEL.DATA.doc_stage/' || RELATIVE_PATH AS full_path,
        SIZE                                                    AS file_size_bytes,
        LAST_MODIFIED                                           AS file_modified_at,
        UPPER(REGEXP_SUBSTR(RELATIVE_PATH, '\\.([^.]+)$', 1, 1, 'e')) AS file_format
    FROM DIRECTORY(@DOC_INTEL.DATA.doc_stage)
    WHERE RELATIVE_PATH ILIKE 'documents/%'
      AND REGEXP_LIKE(RELATIVE_PATH,
            '.*\\.(tif|tiff|pdf|docx|pptx|jpg|jpeg|png|html|txt)$', 'i')

    UNION ALL

    -- Extra document stage
    SELECT
        RELATIVE_PATH,
        'DOC_INTEL.DATA.sample_stage',
        '@DOC_INTEL.DATA.sample_stage/' || RELATIVE_PATH,
        SIZE,
        LAST_MODIFIED,
        UPPER(REGEXP_SUBSTR(RELATIVE_PATH, '\\.([^.]+)$', 1, 1, 'e'))
    FROM DIRECTORY(@DOC_INTEL.DATA.sample_stage)
    WHERE REGEXP_LIKE(RELATIVE_PATH,
            '.*\\.(tif|tiff|pdf|docx|pptx|jpg|jpeg|png|html|txt)$', 'i')
)
SELECT * FROM staged;

-- =============================================================================
-- STORED PROCEDURE: Register new files (dedup logic)
-- Called by Task 1 on its schedule (daily by default; see DOC_INTEL_PIPELINE_SCHEDULE in config/deploy.config)
-- =============================================================================

CREATE OR REPLACE PROCEDURE DOC_INTEL.DATA.sp_register_new_files()
    RETURNS VARCHAR
    LANGUAGE SQL
    EXECUTE AS CALLER
AS
$$
BEGIN
    -- Step 0: Reset stale PROCESSING rows (stuck beyond configured timeout) to FAILED
    UPDATE DOC_INTEL.DATA.ingestion_registry
    SET ingestion_status = 'FAILED',
        last_error       = 'Processing timeout - automatically reset',
        error_stage      = 'TIMEOUT',
        updated_at       = CURRENT_TIMESTAMP()
    WHERE ingestion_status = 'PROCESSING'
      AND processing_started_at < DATEADD('MINUTE',
          -(SELECT COALESCE(config_value::INT, 30)
            FROM DOC_INTEL.ADMIN.system_config
            WHERE config_key = 'processing_timeout_minutes'),
          CURRENT_TIMESTAMP());

    -- Step 1: Insert genuinely new files (never seen before)
    INSERT INTO DOC_INTEL.DATA.ingestion_registry (
        file_path, stage_name, file_format, file_size_bytes,
        ingestion_status, processing_version, first_seen_at, last_seen_at
    )
    SELECT
        sf.file_path,
        sf.stage_name,
        sf.file_format,
        sf.file_size_bytes,
        'PENDING',
        1,
        CURRENT_TIMESTAMP(),
        CURRENT_TIMESTAMP()
    FROM DOC_INTEL.DATA.v_stage_files sf
    WHERE NOT EXISTS (
        SELECT 1 FROM DOC_INTEL.DATA.ingestion_registry r
        WHERE r.file_path = sf.file_path
    );

    -- Step 2: Update last_seen_at for all known files still on stage
    UPDATE DOC_INTEL.DATA.ingestion_registry r
    SET last_seen_at = CURRENT_TIMESTAMP(),
        updated_at   = CURRENT_TIMESTAMP()
    FROM DOC_INTEL.DATA.v_stage_files sf
    WHERE r.file_path = sf.file_path;

    -- Step 3: Reset FAILED files under retry limit back to PENDING
    UPDATE DOC_INTEL.DATA.ingestion_registry
    SET ingestion_status = 'PENDING',
        updated_at       = CURRENT_TIMESTAMP()
    WHERE ingestion_status = 'FAILED'
      AND processing_attempts < (
          SELECT COALESCE(config_value::INT, 3)
          FROM DOC_INTEL.ADMIN.system_config
          WHERE config_key = 'max_processing_attempts'
      );

    -- Step 4: Mark exhausted FAILED files as ABANDONED
    UPDATE DOC_INTEL.DATA.ingestion_registry
    SET ingestion_status = 'ABANDONED',
        updated_at       = CURRENT_TIMESTAMP()
    WHERE ingestion_status = 'FAILED'
      AND processing_attempts >= (
          SELECT COALESCE(config_value::INT, 3)
          FROM DOC_INTEL.ADMIN.system_config
          WHERE config_key = 'max_processing_attempts'
      );

    RETURN 'OK: Registration complete';
END;
$$;

-- =============================================================================
-- STORED PROCEDURE: Force reprocess a single document (admin use)
-- =============================================================================

CREATE OR REPLACE PROCEDURE DOC_INTEL.DATA.sp_force_reprocess(
    p_file_path VARCHAR,
    p_reason    VARCHAR DEFAULT 'Admin-initiated reprocess'
)
    RETURNS VARCHAR
    LANGUAGE SQL
    EXECUTE AS CALLER
AS
$$
DECLARE
    current_version INT;
    new_version     INT;
BEGIN
    -- Get current max version
    SELECT MAX(processing_version)
    INTO :current_version
    FROM DOC_INTEL.DATA.ingestion_registry
    WHERE file_path = :p_file_path;

    IF (current_version IS NULL) THEN
        RETURN 'ERROR: File not found in registry: ' || :p_file_path;
    END IF;

    SET new_version = :current_version + 1;

    -- Insert new version row
    INSERT INTO DOC_INTEL.DATA.ingestion_registry (
        file_path, stage_name, file_format, file_size_bytes,
        src_file_id, source_folder, src_reference_number, src_case_number,
        src_assigned_to, src_date_created, src_metadata,
        ingestion_status, processing_version, force_reprocess,
        first_seen_at, last_seen_at
    )
    SELECT
        file_path, stage_name, file_format, file_size_bytes,
        src_file_id, source_folder, src_reference_number, src_case_number,
        src_assigned_to, src_date_created, src_metadata,
        'PENDING', :new_version, TRUE,
        first_seen_at, CURRENT_TIMESTAMP()
    FROM DOC_INTEL.DATA.ingestion_registry
    WHERE file_path = :p_file_path
      AND processing_version = :current_version;

    -- Log the reprocess request
    INSERT INTO DOC_INTEL.TELEMETRY.pipeline_events (
        event_type, stage_name, file_path, status, metadata
    ) VALUES (
        'FORCE_REPROCESS', 'ADMIN', :p_file_path, 'QUEUED',
        OBJECT_CONSTRUCT('reason', :p_reason, 'new_version', :new_version, 'triggered_by', CURRENT_USER())
    );

    RETURN 'OK: File queued for reprocessing as version ' || :new_version::VARCHAR;
END;
$$;

-- =============================================================================
-- STORED PROCEDURE: Bulk reprocess by folder / date range / format
-- =============================================================================

CREATE OR REPLACE PROCEDURE DOC_INTEL.DATA.sp_bulk_reprocess(
    p_folder      VARCHAR DEFAULT NULL,
    p_file_format VARCHAR DEFAULT NULL,
    p_dry_run     BOOLEAN DEFAULT TRUE
)
    RETURNS VARCHAR
    LANGUAGE SQL
    EXECUTE AS CALLER
AS
$$
BEGIN
    IF (:p_dry_run) THEN
        RETURN 'DRY RUN: Use p_dry_run=FALSE to execute';
    ELSE
        INSERT INTO DOC_INTEL.DATA.ingestion_registry (
            file_path, stage_name, file_format, file_size_bytes,
            src_file_id, source_folder, src_reference_number, src_case_number,
            src_metadata, ingestion_status, processing_version, force_reprocess,
            first_seen_at, last_seen_at
        )
        SELECT
            r.file_path, r.stage_name, r.file_format, r.file_size_bytes,
            r.src_file_id, r.source_folder, r.src_reference_number, r.src_case_number,
            r.src_metadata, 'PENDING', r.processing_version + 1, TRUE,
            r.first_seen_at, CURRENT_TIMESTAMP()
        FROM DOC_INTEL.DATA.ingestion_registry r
        WHERE (:p_folder IS NULL OR r.source_folder = :p_folder)
          AND (:p_file_format IS NULL OR r.file_format = :p_file_format)
          AND r.ingestion_status = 'COMPLETE'
          -- Skip files that already have a newer version (done or in progress),
          -- so running this twice doesn't queue the same file twice
          AND NOT EXISTS (
              SELECT 1 FROM DOC_INTEL.DATA.ingestion_registry r2
              WHERE r2.file_path = r.file_path
                AND r2.processing_version > r.processing_version
          );

        RETURN 'OK: Bulk reprocess queued';
    END IF;
END;
$$;

-- =============================================================================
-- TASK DAG: 5-stage pipeline. deploy.sh sets the root task's schedule from
-- DOC_INTEL_PIPELINE_SCHEDULE in config/deploy.config (daily by default)
-- =============================================================================

-- -----------------------------------------------
-- TASK 1: Scan stage and register new files
-- -----------------------------------------------
-- Drop a stream from earlier template versions, if present
DROP STREAM IF EXISTS DOC_INTEL.DATA.registry_pending_stream;

CREATE OR REPLACE TASK DOC_INTEL.DATA.task_01_register_files
    WAREHOUSE  = DOC_INTEL_WH
    SCHEDULE   = 'USING CRON 0 6 * * * UTC'
    SUSPEND_TASK_AFTER_NUM_FAILURES = 3
    USER_TASK_TIMEOUT_MS  = 300000
    USER_TASK_MINIMUM_TRIGGER_INTERVAL_IN_SECONDS = 60
    COMMENT    = 'Scans doc_stage and sample_stage, registers new/changed files'
AS
    CALL DOC_INTEL.DATA.sp_register_new_files();

-- -----------------------------------------------
-- TASK 2: Parse pending documents
-- -----------------------------------------------
CREATE OR REPLACE TASK DOC_INTEL.DATA.task_02_parse_documents
    WAREHOUSE  = DOC_INTEL_WH
    USER_TASK_TIMEOUT_MS = 1200000
    COMMENT    = 'Runs AI_PARSE_DOCUMENT on all PENDING files'
    AFTER      DOC_INTEL.DATA.task_01_register_files
AS
    CALL DOC_INTEL.DATA.sp_parse_pending_documents();

-- -----------------------------------------------
-- TASK 3: Classify parsed documents
-- -----------------------------------------------
CREATE OR REPLACE TASK DOC_INTEL.DATA.task_03_classify_documents
    WAREHOUSE  = DOC_INTEL_WH
    USER_TASK_TIMEOUT_MS = 600000
    COMMENT    = 'Runs AI_CLASSIFY on parsed documents awaiting classification'
    AFTER      DOC_INTEL.DATA.task_02_parse_documents
AS
    CALL DOC_INTEL.DATA.sp_classify_parsed_documents();

-- -----------------------------------------------
-- TASK 4: Extract attributes
-- -----------------------------------------------
CREATE OR REPLACE TASK DOC_INTEL.DATA.task_04_extract_attributes
    WAREHOUSE  = DOC_INTEL_WH
    USER_TASK_TIMEOUT_MS = 1200000
    COMMENT    = 'Runs AI_EXTRACT on classified documents'
    AFTER      DOC_INTEL.DATA.task_03_classify_documents
AS
    CALL DOC_INTEL.DATA.sp_extract_document_attributes();

-- -----------------------------------------------
-- TASK 5: Emit completion metrics
-- -----------------------------------------------
CREATE OR REPLACE TASK DOC_INTEL.DATA.task_05_emit_metrics
    WAREHOUSE  = DOC_INTEL_WH
    USER_TASK_TIMEOUT_MS = 60000
    COMMENT    = 'Emits pipeline completion telemetry and checks alert thresholds'
    AFTER      DOC_INTEL.DATA.task_04_extract_attributes
AS
    CALL DOC_INTEL.DATA.sp_emit_pipeline_metrics();

-- -----------------------------------------------
-- Task resume is handled by deploy.sh AFTER all procedures exist
-- (03_processing.sql and 04_telemetry.sql must run first)
-- To resume manually: run tasks bottom-up (05, 04, 03, 02, 01)
-- -----------------------------------------------
