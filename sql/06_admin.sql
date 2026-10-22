-- =============================================================================
-- DOC_INTEL: Admin Tables and Stored Procedures
-- File: sql/06_admin.sql
-- Description: Config, reprocess queue, saved searches, bookmarks, feedback
-- Run as: DOC_INTEL_ADMIN after 05_intelligence.sql
-- =============================================================================

USE ROLE DOC_INTEL_ADMIN;
USE DATABASE DOC_INTEL;
USE SCHEMA ADMIN;
USE WAREHOUSE DOC_INTEL_WH;

-- =============================================================================
-- INGESTION STAGES: Registry of stages to scan for new documents
-- =============================================================================

CREATE TABLE IF NOT EXISTS DOC_INTEL.ADMIN.ingestion_stages (
    stage_name     VARCHAR NOT NULL,
    description    VARCHAR,
    path_prefix    VARCHAR DEFAULT '',
    file_pattern   VARCHAR DEFAULT '.*\\.(tif|tiff|pdf|docx|pptx|jpg|jpeg|png|html|txt)$',
    is_active      BOOLEAN DEFAULT TRUE,
    created_at     TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
    updated_by     VARCHAR DEFAULT CURRENT_USER(),
    CONSTRAINT pk_ingestion_stages PRIMARY KEY (stage_name)
)
COMMENT = 'Registry of stages to scan for new documents during ingestion';

-- Seed default stages
MERGE INTO DOC_INTEL.ADMIN.ingestion_stages t
USING (
  SELECT $1 AS stage_name, $2 AS description, $3 AS path_prefix FROM VALUES
    ('DOC_INTEL.DATA.sample_stage', 'Extra stage for documents loaded another way', ''),
    ('DOC_INTEL.DATA.doc_stage', 'Main document stage', 'documents/')
) s ON t.stage_name = s.stage_name
WHEN NOT MATCHED THEN INSERT (stage_name, description, path_prefix)
  VALUES (s.stage_name, s.description, s.path_prefix);

-- =============================================================================
-- SYSTEM CONFIGURATION: Key-value store for pipeline settings
-- =============================================================================

CREATE TABLE IF NOT EXISTS DOC_INTEL.ADMIN.system_config (
    config_key      VARCHAR         NOT NULL,
    config_value    VARCHAR         NOT NULL,
    config_type     VARCHAR         DEFAULT 'STRING', -- STRING, INTEGER, FLOAT, BOOLEAN, JSON
    description     VARCHAR,
    updated_at      TIMESTAMP_NTZ   DEFAULT CURRENT_TIMESTAMP(),
    updated_by      VARCHAR         DEFAULT CURRENT_USER(),
    CONSTRAINT pk_config PRIMARY KEY (config_key)
)
COMMENT = 'System configuration — pipeline settings, thresholds, AI parameters';

-- Seed default configuration
MERGE INTO DOC_INTEL.ADMIN.system_config t
USING (
  SELECT $1 AS config_key, $2 AS config_value, $3 AS config_type, $4 AS description FROM VALUES
    ('max_processing_attempts',         '3',        'INTEGER',  'Max pipeline retry attempts before ABANDONED status'),
    ('search_result_limit',             '10',       'INTEGER',  'Stored only; not used by the template'),
    ('classify_confidence_threshold',   '0.70',     'FLOAT',    'Stored only; not used by the template (review is flagged when the AI returns 3 or more types)'),
    ('pipeline_target_lag_minutes',     '60',       'INTEGER',  'Stored only; target lag is set in the SQL scripts (1 hour)'),
    ('cost_alert_multiplier',           '2.0',      'FLOAT',    'Stored only; not used by the template'),
    ('queue_backlog_threshold',         '500',      'INTEGER',  'sp_emit_pipeline_metrics logs a PIPELINE_ALERT event when pending documents exceed this'),
    ('error_rate_threshold_pct',        '5',        'FLOAT',    'sp_emit_pipeline_metrics logs a PIPELINE_ALERT event when the 24-hour error rate exceeds this percentage'),
    ('enable_pii_masking',              'true',     'BOOLEAN',  'Stored only; not used by the template'),
    ('enable_feedback_collection',      'true',     'BOOLEAN',  'Stored only; not used by the template'),
    ('max_saved_searches_per_user',     '50',       'INTEGER',  'Stored only; not used by the template'),
    ('admin_email',                     '',         'STRING',   'Stored only; the template does not send email'),
    ('parse_image_mode',                'OCR',      'STRING',   'Shown in the app; the pipeline uses OCR for TIFF/JPEG/PNG'),
    ('parse_doc_mode',                  'LAYOUT',   'STRING',   'Shown in the app; the pipeline uses LAYOUT for other formats'),
    ('search_embedding_model',          'snowflake-arctic-embed-l-v2.0', 'STRING', 'Shown in the app; set on the search services in sql/05_intelligence.sql'),
    ('agent_model',                     'claude-sonnet-4-5', 'STRING', 'Shown in the app; set on the agent in sql/05_intelligence.sql'),
    ('batch_size',                      '100',      'INTEGER',  'Maximum documents to process per pipeline batch run'),
    ('processing_timeout_minutes',      '30',       'INTEGER',  'Minutes before stuck PROCESSING rows are auto-reset to FAILED')
) s ON t.config_key = s.config_key
WHEN NOT MATCHED THEN INSERT (config_key, config_value, config_type, description)
  VALUES (s.config_key, s.config_value, s.config_type, s.description);

-- =============================================================================
-- SAVED SEARCHES: Per-user saved search queries with filter state
-- Supports visibility scoping: personal (default), role-based, or global
-- =============================================================================

CREATE TABLE IF NOT EXISTS DOC_INTEL.ADMIN.saved_searches (
    search_id       VARCHAR         DEFAULT UUID_STRING()   NOT NULL,
    user_name       VARCHAR         DEFAULT CURRENT_USER(),
    search_name     VARCHAR         NOT NULL,
    query_text      VARCHAR,
    filters_json    VARCHAR,        -- JSON string: {document_type, source_folder, lob, date_from, date_to, status, file_format}
    visibility      VARCHAR         DEFAULT 'personal',     -- personal | role | global
    shared_role     VARCHAR,        -- role name when visibility='role'
    last_run_at     TIMESTAMP_NTZ,
    created_at      TIMESTAMP_NTZ   DEFAULT CURRENT_TIMESTAMP(),
    CONSTRAINT pk_saved_searches PRIMARY KEY (search_id)
)
COMMENT = 'Saved search queries — personal, role-scoped, or global visibility';

-- =============================================================================
-- DOCUMENT BOOKMARKS: Per-user pinned documents
-- =============================================================================

CREATE TABLE IF NOT EXISTS DOC_INTEL.ADMIN.document_bookmarks (
    bookmark_id     VARCHAR         DEFAULT UUID_STRING()   NOT NULL,
    user_name       VARCHAR         DEFAULT CURRENT_USER(),
    file_path       VARCHAR         NOT NULL,
    src_file_id      VARCHAR,
    document_type   VARCHAR,
    party_name    VARCHAR,
    personal_note   VARCHAR,
    created_at      TIMESTAMP_NTZ   DEFAULT CURRENT_TIMESTAMP(),
    CONSTRAINT pk_bookmarks PRIMARY KEY (bookmark_id),
    CONSTRAINT uq_bookmark UNIQUE (user_name, file_path)
)
COMMENT = 'User-pinned documents — personal bookmarks persisted between sessions';

-- =============================================================================
-- SEARCH FEEDBACK: Thumbs up/down on search results and agent responses
-- =============================================================================

CREATE TABLE IF NOT EXISTS DOC_INTEL.ADMIN.search_feedback (
    feedback_id     VARCHAR         DEFAULT UUID_STRING()   NOT NULL,
    file_path       VARCHAR,
    feedback_type   VARCHAR,        -- thumbs_up / thumbs_down
    query_text      VARCHAR,
    document_type   VARCHAR,
    submitted_by    VARCHAR         DEFAULT CURRENT_USER(),
    submitted_at    TIMESTAMP_NTZ   DEFAULT CURRENT_TIMESTAMP(),
    CONSTRAINT pk_feedback PRIMARY KEY (feedback_id)
)
COMMENT = 'User feedback on search results and agent responses — quality improvement data';

-- =============================================================================
-- EXTRACTION SCHEMAS: Configurable AI_EXTRACT attributes per document type
-- =============================================================================

CREATE TABLE IF NOT EXISTS DOC_INTEL.ADMIN.extraction_schemas (
    schema_id               VARCHAR         DEFAULT UUID_STRING()   NOT NULL,
    schema_tier             VARCHAR(20)     DEFAULT 'CATEGORY',     -- COMMON, CATEGORY, LOB_SPECIFIC
    document_type           VARCHAR         NOT NULL,               -- 'Common', category name, or 'Category - LOB'
    attribute_name          VARCHAR         NOT NULL,
    attribute_description   VARCHAR         NOT NULL,               -- prompt for AI_EXTRACT
    attribute_type          VARCHAR         DEFAULT 'VARCHAR',      -- VARCHAR, DATE, NUMBER, VARIANT
    is_required             BOOLEAN         DEFAULT TRUE,
    sort_order              INTEGER         DEFAULT 0,
    match_rule              VARCHAR         DEFAULT NULL,           -- JSON string: {"category":"X"} or {"category":"X","lob":"Y"}
    version                 INT             DEFAULT 1,
    status                  VARCHAR(20)     DEFAULT 'PUBLISHED',   -- DRAFT or PUBLISHED
    created_at              TIMESTAMP_NTZ   DEFAULT CURRENT_TIMESTAMP(),
    updated_by              VARCHAR         DEFAULT CURRENT_USER(),
    CONSTRAINT pk_extraction_schemas PRIMARY KEY (schema_id),
    CONSTRAINT uq_extraction_schemas UNIQUE (schema_tier, document_type, attribute_name)
)
COMMENT = 'Layered extraction schema: COMMON > CATEGORY > LOB_SPECIFIC';

-- Data seeded from config/extraction_schemas.csv via 10_seed_config.sql
GRANT SELECT, INSERT, UPDATE, DELETE ON DOC_INTEL.ADMIN.extraction_schemas TO ROLE DOC_INTEL_ADMIN;

-- =============================================================================
-- USER PREFERENCES: Per-user app settings
-- =============================================================================

CREATE TABLE IF NOT EXISTS DOC_INTEL.ADMIN.user_preferences (
    user_name           VARCHAR         NOT NULL,
    default_folder      VARCHAR,        -- default source_folder filter
    default_lob         VARCHAR,        -- default line_of_business filter
    results_per_page    INT             DEFAULT 25,
    theme               VARCHAR         DEFAULT 'light',
    date_format         VARCHAR         DEFAULT 'YYYY-MM-DD',
    notifications_on    BOOLEAN         DEFAULT TRUE,
    onboarding_complete BOOLEAN         DEFAULT FALSE,
    updated_at          TIMESTAMP_NTZ   DEFAULT CURRENT_TIMESTAMP(),
    CONSTRAINT pk_prefs PRIMARY KEY (user_name)
)
COMMENT = 'Per-user application preferences and settings';

-- =============================================================================
-- REPROCESS QUEUE: Admin-triggered reprocess jobs with tracking
-- =============================================================================

CREATE TABLE IF NOT EXISTS DOC_INTEL.ADMIN.reprocess_queue (
    queue_id        VARCHAR         DEFAULT UUID_STRING()   NOT NULL,
    job_name        VARCHAR,
    file_paths      VARIANT,        -- ARRAY of file paths OR NULL for bulk
    source_folder       VARCHAR,        -- bulk by folder
    file_format     VARCHAR,        -- bulk by format
    from_date       TIMESTAMP_NTZ,  -- bulk by date range
    to_date         TIMESTAMP_NTZ,
    files_queued    INT             DEFAULT 0,
    files_complete  INT             DEFAULT 0,
    files_failed    INT             DEFAULT 0,
    status          VARCHAR         DEFAULT 'QUEUED',  -- QUEUED/RUNNING/COMPLETE/FAILED
    requested_by    VARCHAR         DEFAULT CURRENT_USER(),
    requested_at    TIMESTAMP_NTZ   DEFAULT CURRENT_TIMESTAMP(),
    started_at      TIMESTAMP_NTZ,
    completed_at    TIMESTAMP_NTZ,
    notes           VARCHAR,
    CONSTRAINT pk_queue PRIMARY KEY (queue_id)
)
COMMENT = 'Admin-submitted reprocess jobs — single file or bulk operations';

-- =============================================================================
-- TABLE: classification_labels — document type labels for AI_CLASSIFY
-- =============================================================================

CREATE TABLE IF NOT EXISTS DOC_INTEL.ADMIN.classification_labels (
    label       VARCHAR(200) NOT NULL,
    category    VARCHAR(100) DEFAULT 'General',
    sort_order  INT DEFAULT 0,
    is_active   BOOLEAN DEFAULT TRUE,
    created_at  TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
    CONSTRAINT uq_classification_label UNIQUE (label)
)
COMMENT = 'Configurable document classification labels used by AI_CLASSIFY pipeline';

-- =============================================================================
-- TABLE: notification_config — Alert routing rules for pipeline events
-- =============================================================================

CREATE TABLE IF NOT EXISTS DOC_INTEL.ADMIN.notification_config (
    id              VARCHAR(36) DEFAULT UUID_STRING(),
    channel_type    VARCHAR(20) NOT NULL,   -- 'webhook' or 'email'
    endpoint        VARCHAR(1000) NOT NULL, -- URL or email address
    event_types     ARRAY NOT NULL,         -- e.g. ['ALERT','INGEST']
    threshold_value INT DEFAULT 0,          -- 0 = all events
    is_active       BOOLEAN DEFAULT TRUE,
    created_at      TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
    PRIMARY KEY (id)
)
COMMENT = 'Alert routing rules — defines where pipeline events are sent';

-- =============================================================================
-- SUGGESTED SEARCHES (per-LOB configurable search suggestions)
-- =============================================================================

CREATE TABLE IF NOT EXISTS DOC_INTEL.ADMIN.suggested_searches (
    search_id   INT AUTOINCREMENT,
    lob_code    VARCHAR(10)  NOT NULL,   -- LOB code or '*' for global
    label       VARCHAR(100) NOT NULL,
    query       VARCHAR(500) NOT NULL,
    sort_order  INT DEFAULT 1,
    is_active   BOOLEAN DEFAULT TRUE,
    PRIMARY KEY (search_id)
)
COMMENT = 'Configurable suggested searches filtered by user LOB access';

-- =============================================================================
-- EXTRACTION OVERRIDES TABLE (created in 03_processing.sql but admin-owned)
-- =============================================================================
-- Already created in 03_processing.sql as DOC_INTEL.ADMIN.extraction_overrides

-- =============================================================================
-- STORED PROCEDURE: Apply approved overrides (admin action)
-- =============================================================================

CREATE OR REPLACE PROCEDURE DOC_INTEL.ADMIN.sp_approve_override(
    p_override_id VARCHAR
)
    RETURNS VARCHAR
    LANGUAGE SQL
    EXECUTE AS CALLER
AS
$$
BEGIN
    UPDATE DOC_INTEL.ADMIN.extraction_overrides
    SET override_status = 'APPROVED',
        approved_by     = CURRENT_USER(),
        approved_at     = CURRENT_TIMESTAMP()
    WHERE override_id = :p_override_id
      AND override_status = 'PENDING';

    IF (SQLROWCOUNT = 0) THEN
        RETURN 'ERROR: Override not found or already actioned: ' || :p_override_id;
    END IF;

    RETURN 'OK: Override approved. Will be reflected in document_catalog on next Dynamic Table refresh.';
END;
$$;

-- =============================================================================
-- STORED PROCEDURE: Get admin summary dashboard stats
-- =============================================================================

CREATE OR REPLACE PROCEDURE DOC_INTEL.ADMIN.sp_get_dashboard_stats()
    RETURNS VARCHAR
    LANGUAGE SQL
    EXECUTE AS CALLER
AS
$$
DECLARE
    v_total INT;
    v_pending INT;
    v_failed INT;
    v_reviews INT;
    v_overrides INT;
    v_queries INT;
BEGIN
    SELECT COUNT(*) INTO :v_total FROM DOC_INTEL.DATA.ingestion_registry WHERE ingestion_status = 'COMPLETE';
    SELECT COALESCE(pending_count, 0) INTO :v_pending FROM DOC_INTEL.TELEMETRY.v_pipeline_health;
    SELECT COALESCE(failed_count, 0) INTO :v_failed FROM DOC_INTEL.TELEMETRY.v_pipeline_health;
    SELECT COUNT(*) INTO :v_reviews FROM DOC_INTEL.DATA.classified_documents WHERE needs_review = TRUE AND classified_at >= DATEADD('DAY', -7, CURRENT_TIMESTAMP());
    SELECT COUNT(*) INTO :v_overrides FROM DOC_INTEL.ADMIN.extraction_overrides WHERE override_status = 'PENDING';
    SELECT COUNT(*) INTO :v_queries FROM DOC_INTEL.TELEMETRY.agent_audit_log WHERE query_time >= DATEADD('HOUR', -24, CURRENT_TIMESTAMP());

    RETURN OBJECT_CONSTRUCT(
        'total_documents', :v_total,
        'pending_processing', :v_pending,
        'pending_status', IFF(:v_pending > 500, 'WARNING', 'OK'),
        'failed_documents', :v_failed,
        'failed_status', IFF(:v_failed > 50, 'WARNING', 'OK'),
        'pending_reviews', :v_reviews,
        'unreviewed_overrides', :v_overrides,
        'search_queries_24h', :v_queries
    )::VARCHAR;
END;
$$;

-- =============================================================================
-- STORED PROCEDURE: Reset pipeline (admin emergency use)
-- =============================================================================

CREATE OR REPLACE PROCEDURE DOC_INTEL.ADMIN.sp_reset_pipeline(
    p_confirm VARCHAR  -- must pass 'CONFIRM_RESET' to prevent accidents
)
    RETURNS VARCHAR
    LANGUAGE SQL
    EXECUTE AS CALLER
AS
$$
BEGIN
    IF (:p_confirm != 'CONFIRM_RESET') THEN
        RETURN 'ERROR: Pass ''CONFIRM_RESET'' as parameter to execute this procedure.';
    END IF;

    -- Reset all PROCESSING documents back to PENDING (in case tasks died mid-run)
    UPDATE DOC_INTEL.DATA.ingestion_registry
    SET ingestion_status    = 'PENDING',
        processing_started_at = NULL,
        updated_at          = CURRENT_TIMESTAMP()
    WHERE ingestion_status = 'PROCESSING';

    -- Log the reset
    INSERT INTO DOC_INTEL.TELEMETRY.pipeline_events (event_type, stage_name, status, metadata)
    VALUES ('PIPELINE_RESET', 'ADMIN', 'EXECUTED',
            OBJECT_CONSTRUCT('triggered_by', CURRENT_USER(), 'reason', 'Manual pipeline reset'));

    RETURN 'OK: Pipeline reset complete. All PROCESSING documents reset to PENDING.';
END;
$$;

-- Grant admin procedures to admin role
GRANT USAGE ON PROCEDURE DOC_INTEL.ADMIN.sp_approve_override(VARCHAR) TO ROLE DOC_INTEL_ADMIN;
GRANT USAGE ON PROCEDURE DOC_INTEL.ADMIN.sp_get_dashboard_stats() TO ROLE DOC_INTEL_ADMIN;
GRANT USAGE ON PROCEDURE DOC_INTEL.ADMIN.sp_reset_pipeline(VARCHAR) TO ROLE DOC_INTEL_ADMIN;
GRANT USAGE ON PROCEDURE DOC_INTEL.DATA.sp_force_reprocess(VARCHAR, VARCHAR) TO ROLE DOC_INTEL_ADMIN;
GRANT USAGE ON PROCEDURE DOC_INTEL.DATA.sp_bulk_reprocess(VARCHAR, VARCHAR, BOOLEAN) TO ROLE DOC_INTEL_ADMIN;

-- Grant classification_labels table access
GRANT SELECT, INSERT, UPDATE, DELETE ON DOC_INTEL.ADMIN.classification_labels TO ROLE DOC_INTEL_ADMIN;
GRANT SELECT ON DOC_INTEL.ADMIN.classification_labels TO ROLE DOC_INTEL_USER;
GRANT SELECT ON DOC_INTEL.ADMIN.classification_labels TO ROLE DOC_INTEL_PIPELINE;

-- Grant notification_config table access
GRANT SELECT, INSERT, UPDATE, DELETE ON DOC_INTEL.ADMIN.notification_config TO ROLE DOC_INTEL_ADMIN;
GRANT SELECT ON DOC_INTEL.ADMIN.notification_config TO ROLE DOC_INTEL_USER;
