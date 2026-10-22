-- =============================================================================
-- DOC_INTEL: Telemetry and Observability
-- File: sql/04_telemetry.sql
-- Description: Event log, metric views, cost tracking, alert definitions
-- Run as: DOC_INTEL_ADMIN after 03_processing.sql
-- =============================================================================

USE ROLE DOC_INTEL_ADMIN;
USE DATABASE DOC_INTEL;
USE SCHEMA TELEMETRY;
USE WAREHOUSE DOC_INTEL_WH;

-- =============================================================================
-- EVENT LOG: Central telemetry table for all pipeline and user activity
-- =============================================================================

CREATE TABLE IF NOT EXISTS DOC_INTEL.TELEMETRY.pipeline_events (
    event_id            VARCHAR         DEFAULT UUID_STRING()   NOT NULL,
    event_time          TIMESTAMP_NTZ   DEFAULT CURRENT_TIMESTAMP(),
    event_type          VARCHAR         NOT NULL,
    -- Pipeline stages: INGEST, PARSE, CLASSIFY, EXTRACT, CATALOG, SEARCH, ANALYST, AGENT, FEEDBACK, OVERRIDE, ADMIN, ALERT
    stage_name          VARCHAR,
    file_path           VARCHAR,
    src_file_id          VARCHAR,
    source_folder           VARCHAR,
    user_name           VARCHAR,
    warehouse_name      VARCHAR,
    status              VARCHAR,    -- SUCCESS / FAILED / SKIPPED / RETRY / QUEUED
    duration_ms         BIGINT,
    error_message       VARCHAR,
    error_code          VARCHAR,
    credits_used        FLOAT,
    rows_processed      BIGINT,
    metadata            VARIANT,    -- event-specific structured data
    CONSTRAINT pk_events PRIMARY KEY (event_id)
)
CLUSTER BY (DATE_TRUNC('DAY', event_time), stage_name, status)
DATA_RETENTION_TIME_IN_DAYS = 90
COMMENT = 'Central event log for all pipeline and user activity — telemetry backbone';

-- =============================================================================
-- AGENT AUDIT LOG: All Snowflake Intelligence/agent queries with full context
-- =============================================================================

CREATE TABLE IF NOT EXISTS DOC_INTEL.TELEMETRY.agent_audit_log (
    query_id            VARCHAR         DEFAULT UUID_STRING()   NOT NULL,
    query_time          TIMESTAMP_NTZ   DEFAULT CURRENT_TIMESTAMP(),
    user_name           VARCHAR         DEFAULT CURRENT_USER(),
    user_role           VARCHAR,
    question            VARCHAR,
    tool_used           VARCHAR,        -- SEARCH / ANALYST / BOTH
    search_query        VARCHAR,        -- actual query sent to Cortex Search
    analyst_question    VARCHAR,        -- question sent to Cortex Analyst
    generated_sql       VARCHAR,        -- SQL from Cortex Analyst
    result_count        INT,
    response_text       VARCHAR,
    latency_ms          BIGINT,
    feedback_score      INT,            -- 1=thumbs up, -1=thumbs down, NULL=no feedback
    feedback_at         TIMESTAMP_NTZ,
    session_id          VARCHAR,
    CONSTRAINT pk_audit PRIMARY KEY (query_id)
)
DATA_RETENTION_TIME_IN_DAYS = 90
COMMENT = 'Log of agent and Snowflake Intelligence queries';

-- =============================================================================
-- PROCEDURE: Emit pipeline metrics (called by Task 5)
-- =============================================================================

CREATE OR REPLACE PROCEDURE DOC_INTEL.DATA.sp_emit_pipeline_metrics()
    RETURNS VARCHAR
    LANGUAGE SQL
    EXECUTE AS CALLER
AS
$$
DECLARE
    pending_count     INT;
    processing_count  INT;
    failed_count      INT;
    abandoned_count   INT;
    completed_1h      INT;
    error_rate        FLOAT;
BEGIN
    -- Gather current queue state (latest version of each file only)
    SELECT
        SUM(CASE WHEN ingestion_status = 'PENDING'     THEN 1 ELSE 0 END),
        SUM(CASE WHEN ingestion_status = 'PROCESSING'  THEN 1 ELSE 0 END),
        SUM(CASE WHEN ingestion_status = 'FAILED'      THEN 1 ELSE 0 END),
        SUM(CASE WHEN ingestion_status = 'ABANDONED'   THEN 1 ELSE 0 END)
    INTO :pending_count, :processing_count, :failed_count, :abandoned_count
    FROM (
        SELECT ingestion_status
        FROM DOC_INTEL.DATA.ingestion_registry
        QUALIFY ROW_NUMBER() OVER (PARTITION BY file_path ORDER BY processing_version DESC) = 1
    );

    -- Docs completed in last hour
    SELECT COUNT(*) INTO :completed_1h
    FROM DOC_INTEL.DATA.ingestion_registry
    WHERE ingestion_status = 'COMPLETE'
      AND processing_completed_at >= DATEADD('HOUR', -1, CURRENT_TIMESTAMP());

    -- Error rate over last hour
    SELECT
        ZEROIFNULL(
            SUM(CASE WHEN status = 'FAILED' THEN 1.0 ELSE 0.0 END) /
            NULLIF(COUNT(*), 0) * 100
        )
    INTO :error_rate
    FROM DOC_INTEL.TELEMETRY.pipeline_events
    WHERE event_time >= DATEADD('HOUR', -24, CURRENT_TIMESTAMP())
      AND stage_name IN ('PARSE', 'CLASSIFY', 'EXTRACT');

    -- Emit summary event
    INSERT INTO DOC_INTEL.TELEMETRY.pipeline_events (
        event_type, stage_name, status, metadata
    ) VALUES (
        'PIPELINE_METRICS', 'METRICS', 'SUCCESS',
        OBJECT_CONSTRUCT(
            'pending_count', :pending_count,
            'processing_count', :processing_count,
            'failed_count', :failed_count,
            'abandoned_count', :abandoned_count,
            'completed_last_1h', :completed_1h,
            'error_rate_pct', :error_rate
        )
    );

    -- Trigger alerts if thresholds exceeded
    IF (:error_rate > (SELECT config_value::FLOAT FROM DOC_INTEL.ADMIN.system_config WHERE config_key = 'error_rate_threshold_pct')) THEN
        INSERT INTO DOC_INTEL.TELEMETRY.pipeline_events (event_type, stage_name, status, metadata)
        VALUES ('PIPELINE_ALERT', 'ALERT', 'TRIGGERED',
                OBJECT_CONSTRUCT('alert_type', 'HIGH_ERROR_RATE', 'error_rate_pct', :error_rate));
    END IF;

    IF (:pending_count > (SELECT config_value::INT FROM DOC_INTEL.ADMIN.system_config WHERE config_key = 'queue_backlog_threshold')) THEN
        INSERT INTO DOC_INTEL.TELEMETRY.pipeline_events (event_type, stage_name, status, metadata)
        VALUES ('PIPELINE_ALERT', 'ALERT', 'TRIGGERED',
                OBJECT_CONSTRUCT('alert_type', 'QUEUE_BACKLOG', 'pending_count', :pending_count));
    END IF;

    RETURN 'Metrics emitted. Error rate: ' || :error_rate::VARCHAR || '%. Pending: ' || :pending_count::VARCHAR;
END;
$$;

-- =============================================================================
-- METRIC VIEW: Pipeline health (current state)
-- =============================================================================

CREATE OR REPLACE VIEW DOC_INTEL.TELEMETRY.v_pipeline_health AS
WITH latest_versions AS (
    SELECT *
    FROM DOC_INTEL.DATA.ingestion_registry
    QUALIFY ROW_NUMBER() OVER (PARTITION BY file_path ORDER BY processing_version DESC) = 1
)
SELECT
    SUM(CASE WHEN ingestion_status = 'PENDING'     THEN 1 ELSE 0 END)  AS pending_count,
    SUM(CASE WHEN ingestion_status = 'PROCESSING'  THEN 1 ELSE 0 END)  AS processing_count,
    SUM(CASE WHEN ingestion_status = 'COMPLETE'    THEN 1 ELSE 0 END)  AS complete_count,
    SUM(CASE WHEN ingestion_status = 'FAILED'      THEN 1 ELSE 0 END)  AS failed_count,
    SUM(CASE WHEN ingestion_status = 'ABANDONED'   THEN 1 ELSE 0 END)  AS abandoned_count,
    SUM(CASE WHEN ingestion_status = 'SKIPPED'     THEN 1 ELSE 0 END)  AS skipped_count,
    COUNT(*)                                                             AS total_registered,
    MAX(CASE WHEN ingestion_status = 'COMPLETE' THEN processing_completed_at END) AS last_completed_at,
    MIN(CASE WHEN ingestion_status = 'PENDING'  THEN first_seen_at END) AS oldest_pending_at,
    DATEDIFF('MINUTE',
        MIN(CASE WHEN ingestion_status = 'PENDING' THEN first_seen_at END),
        CURRENT_TIMESTAMP()
    )                                                                    AS max_queue_age_minutes
FROM latest_versions;

-- =============================================================================
-- METRIC VIEW: Ingestion throughput by day
-- =============================================================================

CREATE OR REPLACE VIEW DOC_INTEL.TELEMETRY.v_ingestion_metrics AS
SELECT
    DATE_TRUNC('DAY', processing_completed_at)  AS process_date,
    source_folder,
    file_format,
    COUNT(*)                                     AS docs_processed,
    SUM(file_size_bytes)                         AS total_bytes,
    ROUND(AVG(DATEDIFF('SECOND', first_seen_at, processing_completed_at)) / 60, 1)
                                                 AS avg_processing_min,
    COUNT(CASE WHEN ingestion_status = 'FAILED' THEN 1 END) AS failed_count,
    ROUND(COUNT(CASE WHEN ingestion_status = 'FAILED' THEN 1 END) * 100.0 / NULLIF(COUNT(*), 0), 2)
                                                 AS failure_rate_pct
FROM DOC_INTEL.DATA.ingestion_registry
WHERE ingestion_status IN ('COMPLETE', 'FAILED')
  AND processing_completed_at IS NOT NULL
GROUP BY 1, 2, 3
ORDER BY 1 DESC, 4 DESC;

-- =============================================================================
-- METRIC VIEW: Error summary — patterns and frequency
-- =============================================================================

CREATE OR REPLACE VIEW DOC_INTEL.TELEMETRY.v_error_summary AS
SELECT
    DATE_TRUNC('DAY', event_time)   AS error_date,
    stage_name,
    error_message,
    COUNT(*)                        AS occurrence_count,
    MAX(event_time)                 AS last_occurred_at,
    LISTAGG(DISTINCT file_path, ', ') WITHIN GROUP (ORDER BY file_path)
                                    AS sample_files
FROM DOC_INTEL.TELEMETRY.pipeline_events
WHERE status = 'FAILED'
  AND error_message IS NOT NULL
GROUP BY 1, 2, 3
ORDER BY 4 DESC, 5 DESC;

-- =============================================================================
-- METRIC VIEW: Cost attribution by folder and stage
-- =============================================================================

CREATE OR REPLACE VIEW DOC_INTEL.TELEMETRY.v_cost_by_folder AS
SELECT
    DATE_TRUNC('DAY', event_time)   AS cost_date,
    source_folder,
    stage_name,
    COUNT(*)                        AS events_count,
    SUM(COALESCE(credits_used, 0))  AS total_credits,
    SUM(COALESCE(rows_processed, 0)) AS rows_processed
FROM DOC_INTEL.TELEMETRY.pipeline_events
WHERE stage_name IN ('PARSE', 'CLASSIFY', 'EXTRACT', 'SEARCH', 'ANALYST', 'AGENT')
  AND source_folder IS NOT NULL
GROUP BY 1, 2, 3
ORDER BY 1 DESC, 5 DESC;

-- =============================================================================
-- METRIC VIEW: Search/agent query analytics
-- =============================================================================

CREATE OR REPLACE VIEW DOC_INTEL.TELEMETRY.v_search_analytics AS
SELECT
    DATE_TRUNC('DAY', query_time)   AS query_date,
    tool_used,
    user_role,
    COUNT(*)                        AS query_count,
    ROUND(AVG(latency_ms), 0)       AS avg_latency_ms,
    ROUND(PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY latency_ms), 0) AS p50_latency_ms,
    ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms), 0) AS p95_latency_ms,
    ROUND(AVG(result_count), 1)     AS avg_result_count,
    SUM(CASE WHEN feedback_score = 1  THEN 1 ELSE 0 END) AS thumbs_up,
    SUM(CASE WHEN feedback_score = -1 THEN 1 ELSE 0 END) AS thumbs_down,
    ROUND(
        SUM(CASE WHEN feedback_score = 1 THEN 1 ELSE 0 END) * 100.0 /
        NULLIF(SUM(CASE WHEN feedback_score IS NOT NULL THEN 1 END), 0), 1
    )                               AS positive_feedback_pct
FROM DOC_INTEL.TELEMETRY.agent_audit_log
GROUP BY 1, 2, 3
ORDER BY 1 DESC, 4 DESC;

-- =============================================================================
-- METRIC VIEW: Quality metrics — confidence and override rates
-- =============================================================================

CREATE OR REPLACE VIEW DOC_INTEL.TELEMETRY.v_quality_metrics AS
SELECT
    DATE_TRUNC('DAY', classified_at) AS date,
    cd.source_folder,
    primary_document_type,
    COUNT(*)                          AS doc_count,
    ROUND(AVG(confidence_score), 3)   AS avg_confidence,
    SUM(CASE WHEN needs_review THEN 1 ELSE 0 END) AS low_confidence_count,
    ROUND(SUM(CASE WHEN needs_review THEN 1.0 ELSE 0.0 END) / NULLIF(COUNT(*), 0) * 100, 1)
                                      AS low_confidence_pct,
    SUM(CASE WHEN classification_match THEN 1 ELSE 0 END) AS src_match_count,
    ROUND(SUM(CASE WHEN classification_match THEN 1.0 ELSE 0.0 END) / NULLIF(COUNT(*), 0) * 100, 1)
                                      AS src_match_pct
FROM DOC_INTEL.DATA.classified_documents cd
JOIN DOC_INTEL.DATA.ingestion_registry r
    ON cd.file_path = r.file_path AND cd.processing_version = r.processing_version
GROUP BY 1, 2, 3
ORDER BY 1 DESC, 4 DESC;

-- =============================================================================
-- SNOWFLAKE ALERTS: Proactive monitoring
-- =============================================================================
-- Each alert checks once a day, an hour after the default daily pipeline run.

-- Alerts: Write to pipeline_events instead of email (no notification integration required).
-- To email alerts, create a notification integration and add a SYSTEM$SEND_EMAIL
-- call to each alert's action.

-- Alert: High pipeline error rate
CREATE OR REPLACE ALERT DOC_INTEL.TELEMETRY.alert_high_error_rate
    WAREHOUSE  = DOC_INTEL_QUERY_WH
    SCHEDULE   = 'USING CRON 0 7 * * * UTC'
    IF (EXISTS (
        SELECT 1
        FROM DOC_INTEL.TELEMETRY.pipeline_events
        WHERE stage_name IN ('PARSE', 'CLASSIFY', 'EXTRACT')
          AND event_time >= DATEADD('HOUR', -24, CURRENT_TIMESTAMP())
        HAVING COUNT(CASE WHEN status='FAILED' THEN 1 END) * 100.0 / NULLIF(COUNT(*), 0) > 5
    ))
    THEN
        INSERT INTO DOC_INTEL.TELEMETRY.pipeline_events (event_type, stage_name, status, metadata)
        VALUES ('PIPELINE_ALERT', 'ALERT', 'TRIGGERED',
                OBJECT_CONSTRUCT('alert_type', 'HIGH_ERROR_RATE'));

-- Alert: Queue backlog
CREATE OR REPLACE ALERT DOC_INTEL.TELEMETRY.alert_queue_backlog
    WAREHOUSE  = DOC_INTEL_QUERY_WH
    SCHEDULE   = 'USING CRON 0 7 * * * UTC'
    IF (EXISTS (
        SELECT 1 FROM DOC_INTEL.TELEMETRY.v_pipeline_health
        WHERE pending_count > 500 AND max_queue_age_minutes > 120
    ))
    THEN
        INSERT INTO DOC_INTEL.TELEMETRY.pipeline_events (event_type, stage_name, status, metadata)
        VALUES ('PIPELINE_ALERT', 'ALERT', 'TRIGGERED',
                OBJECT_CONSTRUCT('alert_type', 'QUEUE_BACKLOG'));

-- Alert: Low confidence spike
CREATE OR REPLACE ALERT DOC_INTEL.TELEMETRY.alert_low_confidence
    WAREHOUSE  = DOC_INTEL_QUERY_WH
    SCHEDULE   = 'USING CRON 0 7 * * * UTC'
    IF (EXISTS (
        SELECT 1
        FROM DOC_INTEL.TELEMETRY.v_quality_metrics
        WHERE date >= DATEADD('DAY', -1, CURRENT_DATE())
        HAVING SUM(low_confidence_count) * 100.0 / NULLIF(SUM(doc_count), 0) > 20
    ))
    THEN
        INSERT INTO DOC_INTEL.TELEMETRY.pipeline_events (event_type, stage_name, status, metadata)
        VALUES ('PIPELINE_ALERT', 'ALERT', 'TRIGGERED',
                OBJECT_CONSTRUCT('alert_type', 'LOW_CONFIDENCE'));

-- Resume alerts (requires EXECUTE ALERT grant from provision.sh)
EXECUTE IMMEDIATE $$
BEGIN
    ALTER ALERT DOC_INTEL.TELEMETRY.alert_high_error_rate RESUME;
EXCEPTION WHEN OTHER THEN NULL;
END;
$$;
EXECUTE IMMEDIATE $$
BEGIN
    ALTER ALERT DOC_INTEL.TELEMETRY.alert_queue_backlog RESUME;
EXCEPTION WHEN OTHER THEN NULL;
END;
$$;
EXECUTE IMMEDIATE $$
BEGIN
    ALTER ALERT DOC_INTEL.TELEMETRY.alert_low_confidence RESUME;
EXCEPTION WHEN OTHER THEN NULL;
END;
$$;

-- =============================================================================
-- APP-FACING VIEWS (in DOC_INTEL.APP schema)
-- Row access policy attached in 11_row_access_policy.sql
-- =============================================================================

USE SCHEMA DOC_INTEL.APP;

CREATE OR REPLACE VIEW DOC_INTEL.APP.v_document_catalog AS
SELECT *
FROM DOC_INTEL.DATA.document_catalog;
-- Row access policy applied separately to the underlying table

CREATE OR REPLACE VIEW DOC_INTEL.APP.v_pipeline_health AS
SELECT * FROM DOC_INTEL.TELEMETRY.v_pipeline_health;

CREATE OR REPLACE VIEW DOC_INTEL.APP.v_ingestion_registry AS
SELECT
    registry_id, file_path, stage_name, file_format, file_size_bytes,
    src_file_id, source_folder, src_reference_number, src_case_number, src_assigned_to,
    ingestion_status, processing_version, processing_attempts,
    first_seen_at, last_seen_at, processing_completed_at,
    last_error, error_stage
FROM DOC_INTEL.DATA.ingestion_registry;

CREATE OR REPLACE VIEW DOC_INTEL.APP.v_cost_by_folder AS
SELECT * FROM DOC_INTEL.TELEMETRY.v_cost_by_folder;

CREATE OR REPLACE VIEW DOC_INTEL.APP.v_search_analytics AS
SELECT * FROM DOC_INTEL.TELEMETRY.v_search_analytics;

CREATE OR REPLACE VIEW DOC_INTEL.APP.v_quality_metrics AS
SELECT * FROM DOC_INTEL.TELEMETRY.v_quality_metrics;

CREATE OR REPLACE VIEW DOC_INTEL.APP.v_error_summary AS
SELECT * FROM DOC_INTEL.TELEMETRY.v_error_summary;

CREATE OR REPLACE VIEW DOC_INTEL.APP.v_agent_audit_log AS
SELECT
    query_id, query_time, user_name, user_role, question,
    tool_used, result_count, latency_ms, feedback_score, session_id
FROM DOC_INTEL.TELEMETRY.agent_audit_log;

-- Row access policy is applied via 11_row_access_policy.sql.
