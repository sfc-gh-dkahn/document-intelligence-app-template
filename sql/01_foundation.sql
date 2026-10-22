-- =============================================================================
-- DOC_INTEL: Foundation DDL
-- File: sql/01_foundation.sql
-- Description: Schema settings, stages, and RBAC grants
-- Run as: DOC_INTEL_ADMIN (owns the database after 00_account_permissions.sql)
-- =============================================================================

USE ROLE DOC_INTEL_ADMIN;
USE DATABASE DOC_INTEL;

-- =============================================================================
-- SCHEMA SETTINGS (schemas already created by 00_account_permissions.sql)
-- =============================================================================

ALTER SCHEMA IF EXISTS DOC_INTEL.DATA SET DATA_RETENTION_TIME_IN_DAYS = 14;
ALTER SCHEMA IF EXISTS DOC_INTEL.SERVICES SET DATA_RETENTION_TIME_IN_DAYS = 14;
ALTER SCHEMA IF EXISTS DOC_INTEL.TELEMETRY SET DATA_RETENTION_TIME_IN_DAYS = 90;
ALTER SCHEMA IF EXISTS DOC_INTEL.ADMIN SET DATA_RETENTION_TIME_IN_DAYS = 30;
ALTER SCHEMA IF EXISTS DOC_INTEL.APP SET DATA_RETENTION_TIME_IN_DAYS = 14;
ALTER SCHEMA IF EXISTS DOC_INTEL.APP_SERVICE SET DATA_RETENTION_TIME_IN_DAYS = 14;

-- =============================================================================
-- STAGES
-- =============================================================================

-- Primary source: your documents (upload with scripts/upload_docs.sh)
CREATE STAGE IF NOT EXISTS DOC_INTEL.DATA.doc_stage
    DIRECTORY = (ENABLE = TRUE, AUTO_REFRESH = TRUE)
    ENCRYPTION = (TYPE = 'SNOWFLAKE_SSE')
    COMMENT = 'Source documents — TIFF, PDF, DOCX, JPEG, PNG, HTML, TXT';

-- Extra document stage (also scanned by the pipeline)
CREATE STAGE IF NOT EXISTS DOC_INTEL.DATA.sample_stage
    DIRECTORY = (ENABLE = TRUE, AUTO_REFRESH = TRUE)
    ENCRYPTION = (TYPE = 'SNOWFLAKE_SSE')
    COMMENT = 'Extra document stage (also scanned by the pipeline)';

-- Metadata sidecars (JSON files paired with each document)
CREATE STAGE IF NOT EXISTS DOC_INTEL.DATA.metadata_stage
    DIRECTORY = (ENABLE = TRUE, AUTO_REFRESH = TRUE)
    ENCRYPTION = (TYPE = 'SNOWFLAKE_SSE')
    COMMENT = 'Optional metadata JSON sidecars';

-- =============================================================================
-- ROLE GRANTS: All RBAC grants are centralized in 12_post_deploy_grants.sql.
-- Only schema-creation privileges are granted here (required for DDL in later scripts).
-- =============================================================================

USE ROLE DOC_INTEL_ADMIN;

-- Pipeline needs USAGE + CREATE privileges for DDL in 02/03/04 scripts.
-- These USAGE grants are re-confirmed in 12_post_deploy_grants.sql (intentional overlap).
GRANT USAGE ON DATABASE DOC_INTEL                     TO ROLE DOC_INTEL_PIPELINE;
GRANT USAGE ON WAREHOUSE DOC_INTEL_WH                 TO ROLE DOC_INTEL_PIPELINE;
GRANT USAGE ON SCHEMA DOC_INTEL.DATA                  TO ROLE DOC_INTEL_PIPELINE;
GRANT USAGE ON SCHEMA DOC_INTEL.SERVICES              TO ROLE DOC_INTEL_PIPELINE;
GRANT USAGE ON SCHEMA DOC_INTEL.TELEMETRY             TO ROLE DOC_INTEL_PIPELINE;
GRANT USAGE ON SCHEMA DOC_INTEL.ADMIN                 TO ROLE DOC_INTEL_PIPELINE;

GRANT CREATE TABLE    ON SCHEMA DOC_INTEL.DATA      TO ROLE DOC_INTEL_PIPELINE;
GRANT CREATE TABLE    ON SCHEMA DOC_INTEL.TELEMETRY TO ROLE DOC_INTEL_PIPELINE;
GRANT CREATE TABLE    ON SCHEMA DOC_INTEL.ADMIN     TO ROLE DOC_INTEL_PIPELINE;
GRANT CREATE DYNAMIC TABLE ON SCHEMA DOC_INTEL.DATA   TO ROLE DOC_INTEL_PIPELINE;
GRANT CREATE TASK     ON SCHEMA DOC_INTEL.DATA      TO ROLE DOC_INTEL_PIPELINE;
GRANT CREATE STREAM   ON SCHEMA DOC_INTEL.DATA      TO ROLE DOC_INTEL_PIPELINE;

-- Cortex AI functions granted in 00_account_permissions.sql (requires ACCOUNTADMIN)
-- All other RBAC grants (SELECT, INSERT, stage READ, etc.) are in 12_post_deploy_grants.sql

