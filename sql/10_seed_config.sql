-- =============================================================================
-- DOC_INTEL: Seed Configuration from CSV Files
-- File: sql/10_seed_config.sql
--
-- PURPOSE:
--   Loads all configurable data from CSV files in config/ directory:
--   - Classification labels (document type taxonomy)
--   - Lines of business
--   - Extraction schemas (AI_EXTRACT prompts per document type)
--   - Entitlement roles (app-level access templates)
--
-- REQUIRES: DOC_INTEL_ADMIN role, config/*.csv files uploaded to stage first.
--
-- USAGE:
--   Called by deploy.sh which handles the PUT before running this script.
-- =============================================================================

USE ROLE DOC_INTEL_ADMIN;
USE DATABASE DOC_INTEL;
USE SCHEMA ADMIN;
USE WAREHOUSE DOC_INTEL_QUERY_WH;

-- =============================================================================
-- STAGE: Internal stage for config CSV uploads
-- =============================================================================

CREATE STAGE IF NOT EXISTS DOC_INTEL.ADMIN.config_stage
    FILE_FORMAT = (TYPE = CSV FIELD_OPTIONALLY_ENCLOSED_BY = '"' SKIP_HEADER = 1)
    COMMENT = 'Config CSV file uploads for seed data';

-- =============================================================================
-- 1. CLASSIFICATION LABELS
-- =============================================================================

CREATE OR REPLACE TEMPORARY TABLE DOC_INTEL.ADMIN._tmp_labels (
    label       VARCHAR,
    category    VARCHAR,
    sort_order  INT
);

COPY INTO DOC_INTEL.ADMIN._tmp_labels
    FROM @DOC_INTEL.ADMIN.config_stage/classification_labels.csv
    FILE_FORMAT = (TYPE = CSV FIELD_OPTIONALLY_ENCLOSED_BY = '"' SKIP_HEADER = 1)
    ON_ERROR = 'ABORT_STATEMENT';

MERGE INTO DOC_INTEL.ADMIN.classification_labels AS tgt
USING DOC_INTEL.ADMIN._tmp_labels AS src
ON tgt.label = src.label
WHEN MATCHED THEN UPDATE SET
    category = src.category,
    sort_order = src.sort_order,
    is_active = TRUE
WHEN NOT MATCHED THEN INSERT (label, category, sort_order, is_active)
    VALUES (src.label, src.category, src.sort_order, TRUE);

DROP TABLE IF EXISTS DOC_INTEL.ADMIN._tmp_labels;

-- =============================================================================
-- 2. LINES OF BUSINESS
-- =============================================================================

CREATE OR REPLACE TEMPORARY TABLE DOC_INTEL.ADMIN._tmp_lobs (
    lob_code    VARCHAR,
    lob_name    VARCHAR,
    description VARCHAR,
    is_default  VARCHAR,
    sort_order  INT
);

COPY INTO DOC_INTEL.ADMIN._tmp_lobs
    FROM @DOC_INTEL.ADMIN.config_stage/lobs.csv
    FILE_FORMAT = (TYPE = CSV FIELD_OPTIONALLY_ENCLOSED_BY = '"' SKIP_HEADER = 1)
    ON_ERROR = 'ABORT_STATEMENT';

MERGE INTO DOC_INTEL.ADMIN.lines_of_business AS tgt
USING (
    SELECT lob_code, lob_name, description,
           CASE WHEN UPPER(is_default) = 'TRUE' THEN TRUE ELSE FALSE END AS is_default,
           sort_order
    FROM DOC_INTEL.ADMIN._tmp_lobs
) AS src
ON tgt.lob_code = src.lob_code
WHEN MATCHED THEN UPDATE SET
    lob_name = src.lob_name,
    description = src.description,
    is_default = src.is_default,
    sort_order = src.sort_order,
    is_active = TRUE,
    updated_at = CURRENT_TIMESTAMP()
WHEN NOT MATCHED THEN INSERT (lob_code, lob_name, description, is_default, sort_order)
    VALUES (src.lob_code, src.lob_name, src.description, src.is_default, src.sort_order);

DROP TABLE IF EXISTS DOC_INTEL.ADMIN._tmp_lobs;

-- =============================================================================
-- 3. EXTRACTION SCHEMAS
-- =============================================================================

CREATE OR REPLACE TEMPORARY TABLE DOC_INTEL.ADMIN._tmp_schemas (
    schema_tier      VARCHAR,
    document_type    VARCHAR,
    attribute_name   VARCHAR,
    attribute_description VARCHAR,
    attribute_type   VARCHAR,
    sort_order       INT,
    match_rule       VARCHAR
);

COPY INTO DOC_INTEL.ADMIN._tmp_schemas
    FROM @DOC_INTEL.ADMIN.config_stage/extraction_schemas.csv
    FILE_FORMAT = (TYPE = CSV FIELD_OPTIONALLY_ENCLOSED_BY = '"' SKIP_HEADER = 1)
    ON_ERROR = 'ABORT_STATEMENT';

MERGE INTO DOC_INTEL.ADMIN.extraction_schemas AS tgt
USING DOC_INTEL.ADMIN._tmp_schemas AS src
ON tgt.schema_tier = src.schema_tier
   AND tgt.document_type = src.document_type
   AND tgt.attribute_name = src.attribute_name
WHEN MATCHED THEN UPDATE SET
    attribute_description = src.attribute_description,
    attribute_type = src.attribute_type,
    sort_order = src.sort_order,
    match_rule = src.match_rule,
    status = 'PUBLISHED'
WHEN NOT MATCHED THEN INSERT (schema_tier, document_type, attribute_name, attribute_description, attribute_type, sort_order, match_rule, status)
    VALUES (src.schema_tier, src.document_type, src.attribute_name, src.attribute_description, src.attribute_type, src.sort_order, src.match_rule, 'PUBLISHED');

DROP TABLE IF EXISTS DOC_INTEL.ADMIN._tmp_schemas;

-- =============================================================================
-- 4. ENTITLEMENT ROLES (pipe-delimited arrays in CSV)
-- =============================================================================

CREATE OR REPLACE TEMPORARY TABLE DOC_INTEL.ADMIN._tmp_roles (
    role_name       VARCHAR,
    description     VARCHAR,
    menu_access     VARCHAR,
    lob_access      VARCHAR,
    doc_type_access VARCHAR,
    can_download    VARCHAR
);

COPY INTO DOC_INTEL.ADMIN._tmp_roles
    FROM @DOC_INTEL.ADMIN.config_stage/roles.csv
    FILE_FORMAT = (TYPE = CSV FIELD_OPTIONALLY_ENCLOSED_BY = '"' SKIP_HEADER = 1)
    ON_ERROR = 'ABORT_STATEMENT';

MERGE INTO DOC_INTEL.ADMIN.entitlement_roles AS tgt
USING (
    SELECT role_name, description,
           SPLIT(menu_access, '|')     AS menu_access,
           SPLIT(lob_access, '|')      AS lob_access,
           SPLIT(doc_type_access, '|') AS doc_type_access,
           CASE WHEN UPPER(can_download) = 'TRUE' THEN TRUE ELSE FALSE END AS can_download
    FROM DOC_INTEL.ADMIN._tmp_roles
) AS src
ON tgt.role_name = src.role_name
WHEN MATCHED THEN UPDATE SET
    description = src.description,
    menu_access = src.menu_access,
    lob_access = src.lob_access,
    doc_type_access = src.doc_type_access,
    can_download = src.can_download,
    is_active = TRUE,
    updated_at = CURRENT_TIMESTAMP()
WHEN NOT MATCHED THEN INSERT (role_name, description, menu_access, lob_access, doc_type_access, can_download, created_by)
    VALUES (src.role_name, src.description, src.menu_access, src.lob_access, src.doc_type_access, src.can_download, 'SYSTEM');

DROP TABLE IF EXISTS DOC_INTEL.ADMIN._tmp_roles;

-- =============================================================================
-- 5. SUGGESTED SEARCHES
-- =============================================================================

CREATE OR REPLACE TEMPORARY TABLE DOC_INTEL.ADMIN._tmp_searches (
    lob_code    VARCHAR,
    label       VARCHAR,
    query       VARCHAR,
    sort_order  INT
);

COPY INTO DOC_INTEL.ADMIN._tmp_searches
    FROM @DOC_INTEL.ADMIN.config_stage/suggested_searches.csv
    FILE_FORMAT = (TYPE = CSV FIELD_OPTIONALLY_ENCLOSED_BY = '"' SKIP_HEADER = 1)
    ON_ERROR = 'ABORT_STATEMENT';

MERGE INTO DOC_INTEL.ADMIN.suggested_searches AS tgt
USING DOC_INTEL.ADMIN._tmp_searches AS src
ON tgt.lob_code = src.lob_code AND tgt.label = src.label
WHEN MATCHED THEN UPDATE SET
    query = src.query,
    sort_order = src.sort_order,
    is_active = TRUE
WHEN NOT MATCHED THEN INSERT (lob_code, label, query, sort_order)
    VALUES (src.lob_code, src.label, src.query, src.sort_order);

DROP TABLE IF EXISTS DOC_INTEL.ADMIN._tmp_searches;

-- =============================================================================
-- CLEANUP: Remove uploaded CSV files from stage
-- =============================================================================

REMOVE @DOC_INTEL.ADMIN.config_stage/classification_labels.csv;
REMOVE @DOC_INTEL.ADMIN.config_stage/lobs.csv;
REMOVE @DOC_INTEL.ADMIN.config_stage/extraction_schemas.csv;
REMOVE @DOC_INTEL.ADMIN.config_stage/roles.csv;
REMOVE @DOC_INTEL.ADMIN.config_stage/suggested_searches.csv;

-- =============================================================================
-- SEED: Assign Administrator role to the deploy user (CURRENT_USER)
-- Must run after entitlement_roles is seeded above
-- =============================================================================

MERGE INTO DOC_INTEL.ADMIN.user_role_assignments AS tgt
USING (
    SELECT CURRENT_USER() AS user_name, r.role_id
    FROM DOC_INTEL.ADMIN.entitlement_roles r
    WHERE r.role_name = 'Administrator'
) AS src ON tgt.user_name = src.user_name AND tgt.role_id = src.role_id
WHEN NOT MATCHED THEN INSERT (user_name, role_id, assigned_by)
VALUES (src.user_name, src.role_id, 'SYSTEM');
