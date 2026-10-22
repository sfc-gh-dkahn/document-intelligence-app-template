-- =============================================================================
-- DOC_INTEL: LOB Management + Entitlement Roles
-- File: sql/08_roles.sql
-- Description: Master LOB table, entitlement role templates, and role assignment
--              Data is seeded from CSV via 10_seed_config.sql (not hardcoded here)
-- Run as: DOC_INTEL_ADMIN (DDL) + grants
-- =============================================================================

USE ROLE DOC_INTEL_ADMIN;
USE DATABASE DOC_INTEL;
USE SCHEMA ADMIN;

-- =============================================================================
-- LINES OF BUSINESS (Master Table)
-- =============================================================================

CREATE TABLE IF NOT EXISTS DOC_INTEL.ADMIN.lines_of_business (
    lob_id          NUMBER AUTOINCREMENT PRIMARY KEY,
    lob_code        VARCHAR(20) NOT NULL,
    lob_name        VARCHAR(256) NOT NULL,
    description     VARCHAR(1000),
    is_default      BOOLEAN DEFAULT FALSE,
    is_active       BOOLEAN DEFAULT TRUE,
    sort_order      NUMBER DEFAULT 0,
    created_at      TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
    updated_at      TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
    UNIQUE(lob_code),
    UNIQUE(lob_name)
);

COMMENT ON TABLE DOC_INTEL.ADMIN.lines_of_business IS
  'Master list of Lines of Business. Admin-managed. Drives extraction prompts, filters, and entitlements.';

-- =============================================================================
-- ENTITLEMENT ROLES (Role Templates)
-- =============================================================================

CREATE TABLE IF NOT EXISTS DOC_INTEL.ADMIN.entitlement_roles (
    role_id         NUMBER AUTOINCREMENT PRIMARY KEY,
    role_name       VARCHAR(256) NOT NULL,
    description     VARCHAR(1000),
    menu_access     ARRAY,
    lob_access      ARRAY,
    doc_type_access ARRAY,
    can_download    BOOLEAN DEFAULT TRUE,
    is_active       BOOLEAN DEFAULT TRUE,
    created_by      VARCHAR(256),
    created_at      TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
    updated_at      TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
    UNIQUE(role_name)
);

COMMENT ON TABLE DOC_INTEL.ADMIN.entitlement_roles IS
  'Named entitlement role templates. Users assigned to a role inherit its access arrays.';

-- =============================================================================
-- ALTER user_entitlements to support role assignment
-- =============================================================================

ALTER TABLE DOC_INTEL.ADMIN.user_entitlements
  ADD COLUMN IF NOT EXISTS entitlement_role_id NUMBER;

-- =============================================================================
-- GRANTS
-- =============================================================================

-- Admin: full CRUD on LOBs and roles
GRANT SELECT, INSERT, UPDATE, DELETE ON DOC_INTEL.ADMIN.lines_of_business TO ROLE DOC_INTEL_ADMIN;
GRANT SELECT, INSERT, UPDATE, DELETE ON DOC_INTEL.ADMIN.entitlement_roles TO ROLE DOC_INTEL_ADMIN;

-- User: read LOBs (for filter dropdowns) and roles (for display)
GRANT SELECT ON DOC_INTEL.ADMIN.lines_of_business TO ROLE DOC_INTEL_USER;
GRANT SELECT ON DOC_INTEL.ADMIN.entitlement_roles TO ROLE DOC_INTEL_USER;

-- Pipeline: read access
GRANT SELECT ON DOC_INTEL.ADMIN.lines_of_business TO ROLE DOC_INTEL_PIPELINE;
GRANT SELECT ON DOC_INTEL.ADMIN.entitlement_roles TO ROLE DOC_INTEL_PIPELINE;
