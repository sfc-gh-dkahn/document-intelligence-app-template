-- =============================================================================
-- DOC_INTEL: Entitlements & App-Level RBAC
-- File: sql/07_entitlements.sql
-- Description: User entitlements table for menu visibility, LOB access, and
--              document type access. Managed through the admin UI.
-- Run as: SYSADMIN (table creation) + SECURITYADMIN (grants)
-- =============================================================================

USE ROLE DOC_INTEL_ADMIN;
USE DATABASE DOC_INTEL;
USE SCHEMA ADMIN;

-- =============================================================================
-- ENTITLEMENTS TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS DOC_INTEL.ADMIN.user_entitlements (
    id                NUMBER AUTOINCREMENT PRIMARY KEY,
    user_name         VARCHAR(256) NOT NULL,
    app_role          VARCHAR(20) DEFAULT 'user',  -- DEPRECATED: appRole now derived from assigned roles
    menu_access       ARRAY,                       -- DEPRECATED: now comes from entitlement_roles
    lob_access        ARRAY,                       -- DEPRECATED: now comes from entitlement_roles
    doc_type_access   ARRAY,                       -- DEPRECATED: now comes from entitlement_roles
    is_active         BOOLEAN DEFAULT TRUE,
    created_by        VARCHAR(256),
    created_at        TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
    updated_at        TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
    UNIQUE(user_name)
);

COMMENT ON TABLE DOC_INTEL.ADMIN.user_entitlements IS
  'User registry for app access. Access control now driven by entitlement_roles via user_role_assignments.';

-- =============================================================================
-- SEED DATA
-- =============================================================================

-- Register the current deploy user (uses CURRENT_USER() so it works for any deployer)
MERGE INTO DOC_INTEL.ADMIN.user_entitlements AS tgt
USING (SELECT CURRENT_USER() AS user_name) AS src ON tgt.user_name = src.user_name
WHEN NOT MATCHED THEN INSERT (user_name, is_active, created_by)
VALUES (CURRENT_USER(), TRUE, 'SYSTEM');

-- =============================================================================
-- GRANTS
-- =============================================================================

-- Admin role: full CRUD on entitlements
GRANT SELECT, INSERT, UPDATE, DELETE ON DOC_INTEL.ADMIN.user_entitlements TO ROLE DOC_INTEL_ADMIN;

-- User role: read own entitlements (enforced by app query filtering on CURRENT_USER())
GRANT SELECT ON DOC_INTEL.ADMIN.user_entitlements TO ROLE DOC_INTEL_USER;

-- Pipeline role: read access for any pipeline-level entitlement checks
GRANT SELECT ON DOC_INTEL.ADMIN.user_entitlements TO ROLE DOC_INTEL_PIPELINE;
