-- =============================================================================
-- DOC_INTEL: Multi-Role Assignments
-- File: sql/09_role_assignments.sql
-- Description: Junction table for multi-role user assignments. Users get access
--              exclusively from roles — no custom/direct entitlements.
--              Deployer admin assignment happens in 10_seed_config.sql (after roles exist).
-- Run as: DOC_INTEL_ADMIN (DDL) + grants
-- =============================================================================

USE ROLE DOC_INTEL_ADMIN;
USE DATABASE DOC_INTEL;
USE SCHEMA ADMIN;

-- =============================================================================
-- USER_ROLE_ASSIGNMENTS (Junction Table)
-- =============================================================================

CREATE TABLE IF NOT EXISTS DOC_INTEL.ADMIN.user_role_assignments (
    id           NUMBER AUTOINCREMENT PRIMARY KEY,
    user_name    VARCHAR(256) NOT NULL,
    role_id      NUMBER NOT NULL,
    assigned_by  VARCHAR(256),
    assigned_at  TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
    UNIQUE(user_name, role_id)
);

COMMENT ON TABLE DOC_INTEL.ADMIN.user_role_assignments IS
  'Junction table: users can be assigned to multiple entitlement roles. Effective access = union of all assigned roles.';

-- =============================================================================
-- MIGRATE existing single-role assignments (idempotent)
-- =============================================================================

INSERT INTO DOC_INTEL.ADMIN.user_role_assignments (user_name, role_id, assigned_by)
SELECT u.user_name, u.entitlement_role_id, 'MIGRATION'
FROM DOC_INTEL.ADMIN.user_entitlements u
WHERE u.entitlement_role_id IS NOT NULL
  AND u.is_active = TRUE
  AND NOT EXISTS (
    SELECT 1 FROM DOC_INTEL.ADMIN.user_role_assignments a
    WHERE a.user_name = u.user_name AND a.role_id = u.entitlement_role_id
  );

-- =============================================================================
-- GRANTS
-- =============================================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON DOC_INTEL.ADMIN.user_role_assignments TO ROLE DOC_INTEL_ADMIN;
GRANT SELECT ON DOC_INTEL.ADMIN.user_role_assignments TO ROLE DOC_INTEL_USER;
GRANT SELECT ON DOC_INTEL.ADMIN.user_role_assignments TO ROLE DOC_INTEL_PIPELINE;
