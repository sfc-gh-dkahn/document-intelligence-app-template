-- =============================================================================
-- DOC_INTEL: Row Access Policy for Document Entitlements
-- File: sql/11_row_access_policy.sql
-- Description: Filters the app's document catalog (APP.v_document_catalog) by
--              each user's app-role lines of business and document types.
--              Admins are filtered by their app roles too. DOC_INTEL_PIPELINE and
--              ACCOUNTADMIN see everything. Base tables in DATA are not covered.
-- Run as: DOC_INTEL_ADMIN
-- =============================================================================

USE ROLE DOC_INTEL_ADMIN;
USE DATABASE DOC_INTEL;
USE SCHEMA ADMIN;
USE WAREHOUSE DOC_INTEL_QUERY_WH;

-- =============================================================================
-- CRITICAL: DOC_INTEL_ADMIN must NOT inherit DOC_INTEL_PIPELINE
-- This REVOKE is applied in 00_account_permissions.sql (requires SECURITYADMIN).
-- =============================================================================

-- =============================================================================
-- CLEANUP: Drop a policy from earlier template versions, if present
-- =============================================================================
DROP ROW ACCESS POLICY IF EXISTS DOC_INTEL.DATA.doc_intel_folder_policy;

-- =============================================================================
-- HELPER FUNCTION: Get current user's effective LOB access
-- Resolves LOB codes (e.g. 'FIN') to full names (e.g. 'Finance')
-- and generates variants (using CHR(38) for "&") so either spelling matches.
-- =============================================================================

CREATE OR REPLACE FUNCTION DOC_INTEL.ADMIN.get_user_lob_access()
RETURNS ARRAY
LANGUAGE SQL
COMMENT = 'Returns effective LOB codes AND names for RAP matching. Resolves codes via lines_of_business table.'
AS
$$
  SELECT CASE
    WHEN CURRENT_ROLE() = 'DOC_INTEL_PIPELINE' THEN ARRAY_CONSTRUCT('*')
    ELSE COALESCE(
      (SELECT
        CASE
          WHEN ARRAY_CONTAINS('*'::VARIANT, ARRAY_AGG(DISTINCT f.value)) THEN ARRAY_CONSTRUCT('*')
          ELSE (
            SELECT ARRAY_AGG(DISTINCT v.value)
            FROM (
              SELECT DISTINCT f2.value::VARCHAR AS lob_code
              FROM DOC_INTEL.ADMIN.user_role_assignments a2
              JOIN DOC_INTEL.ADMIN.entitlement_roles r2
                ON a2.role_id = r2.role_id AND r2.is_active = TRUE
              , LATERAL FLATTEN(input => r2.lob_access) f2
              WHERE UPPER(a2.user_name) = CURRENT_USER()
            ) codes
            LEFT JOIN DOC_INTEL.ADMIN.lines_of_business lob
              ON lob.lob_code = codes.lob_code
            , LATERAL FLATTEN(input =>
              CASE
                WHEN lob.lob_name IS NOT NULL THEN
                  ARRAY_CONSTRUCT(
                    codes.lob_code,
                    lob.lob_name,
                    REPLACE(lob.lob_name, ' and ', ' ' || CHR(38) || ' '),
                    REPLACE(lob.lob_name, ' and ', ' ' || CHR(38) || 'amp; '),
                    REPLACE(lob.lob_name, CHR(38), 'and'),
                    REPLACE(lob.lob_name, CHR(38), CHR(38) || 'amp;')
                  )
                ELSE ARRAY_CONSTRUCT(codes.lob_code)
              END
            ) v
          )
        END
       FROM DOC_INTEL.ADMIN.user_role_assignments a
       JOIN DOC_INTEL.ADMIN.entitlement_roles r
         ON a.role_id = r.role_id AND r.is_active = TRUE
       , LATERAL FLATTEN(input => r.lob_access) f
       WHERE UPPER(a.user_name) = CURRENT_USER()
      ),
      ARRAY_CONSTRUCT()  -- No roles assigned = no access
    )
  END
$$;

-- =============================================================================
-- HELPER FUNCTION: Get current user's effective document type access (raw)
-- Used only for wildcard check; actual matching uses user_can_access_doc_type()
-- =============================================================================

CREATE OR REPLACE FUNCTION DOC_INTEL.ADMIN.get_user_doc_type_access()
RETURNS ARRAY
LANGUAGE SQL
COMMENT = 'Returns effective doc type access array. Used for wildcard check only.'
AS
$$
  SELECT CASE
    WHEN CURRENT_ROLE() = 'DOC_INTEL_PIPELINE' THEN ARRAY_CONSTRUCT('*')
    ELSE COALESCE(
      (SELECT IFF(
          ARRAY_CONTAINS('*'::VARIANT, ARRAY_AGG(DISTINCT f.value)),
          ARRAY_CONSTRUCT('*'),
          ARRAY_AGG(DISTINCT f.value)
        )
       FROM DOC_INTEL.ADMIN.user_role_assignments a
       JOIN DOC_INTEL.ADMIN.entitlement_roles r
         ON a.role_id = r.role_id AND r.is_active = TRUE
       , LATERAL FLATTEN(input => r.doc_type_access) f
       WHERE UPPER(a.user_name) = CURRENT_USER()
      ),
      ARRAY_CONSTRUCT()  -- No roles assigned = no access
    )
  END
$$;

-- =============================================================================
-- HELPER FUNCTION: Fuzzy doc type access check (RAP-compatible)
-- Uses TABLE(FLATTEN(...)) instead of LATERAL FLATTEN to work inside RAP context.
-- Matches role values like 'Invoice' against catalog values like
-- 'Invoice (Vendor)' using ILIKE contains.
-- =============================================================================

CREATE OR REPLACE FUNCTION DOC_INTEL.ADMIN.user_can_access_doc_type(row_doc_type VARCHAR)
RETURNS BOOLEAN
LANGUAGE SQL
COMMENT = 'Checks if user can access a given document type. RAP-compatible (no LATERAL FLATTEN on subquery).'
AS
$$
  SELECT CASE
    WHEN CURRENT_ROLE() = 'DOC_INTEL_PIPELINE' THEN TRUE
    WHEN row_doc_type IS NULL THEN FALSE
    WHEN ARRAY_CONTAINS('*'::VARIANT, DOC_INTEL.ADMIN.get_user_doc_type_access()) THEN TRUE
    WHEN ARRAY_CONTAINS(row_doc_type::VARIANT, DOC_INTEL.ADMIN.get_user_doc_type_access()) THEN TRUE
    ELSE (
      SELECT COALESCE(MAX(TRUE), FALSE)
      FROM TABLE(FLATTEN(input => DOC_INTEL.ADMIN.get_user_doc_type_access())) f
      WHERE row_doc_type ILIKE '%' || f.value::VARCHAR || '%'
         OR f.value::VARCHAR ILIKE '%' || row_doc_type || '%'
    )
  END
$$;

-- =============================================================================
-- HELPER FUNCTION: Check if user is active in entitlements
-- =============================================================================

CREATE OR REPLACE FUNCTION DOC_INTEL.ADMIN.is_user_active()
RETURNS BOOLEAN
LANGUAGE SQL
COMMENT = 'Returns TRUE if the current user has an active entitlement record.'
AS
$$
  SELECT CASE
    WHEN CURRENT_ROLE() = 'DOC_INTEL_PIPELINE' THEN TRUE
    ELSE COALESCE(
      (SELECT is_active
       FROM DOC_INTEL.ADMIN.user_entitlements
       WHERE UPPER(user_name) = CURRENT_USER()
       LIMIT 1),
      FALSE  -- No entitlement record = not active
    )
  END
$$;

-- =============================================================================
-- DETACH POLICIES (must happen before CREATE OR REPLACE)
-- Idempotent: ignores errors if policies aren't currently attached.
-- =============================================================================

EXECUTE IMMEDIATE $$
BEGIN
  ALTER TABLE DOC_INTEL.DATA.document_catalog
    DROP ROW ACCESS POLICY DOC_INTEL.DATA.doc_intel_folder_policy;
EXCEPTION WHEN OTHER THEN NULL;
END;
$$;

EXECUTE IMMEDIATE $$
BEGIN
  ALTER TABLE DOC_INTEL.DATA.document_catalog
    DROP ROW ACCESS POLICY DOC_INTEL.ADMIN.document_entitlement_policy;
EXCEPTION WHEN OTHER THEN NULL;
END;
$$;

EXECUTE IMMEDIATE $$
BEGIN
  ALTER VIEW DOC_INTEL.APP.v_document_catalog
    DROP ROW ACCESS POLICY DOC_INTEL.DATA.doc_intel_folder_policy;
EXCEPTION WHEN OTHER THEN NULL;
END;
$$;

EXECUTE IMMEDIATE $$
BEGIN
  ALTER VIEW DOC_INTEL.APP.v_document_catalog
    DROP ROW ACCESS POLICY DOC_INTEL.ADMIN.document_entitlement_policy;
EXCEPTION WHEN OTHER THEN NULL;
END;
$$;

-- =============================================================================
-- ROW ACCESS POLICY: Enforces LOB + document type entitlements
-- DOC_INTEL_PIPELINE and ACCOUNTADMIN are exempt; admins are filtered by app role.
-- =============================================================================

CREATE OR REPLACE ROW ACCESS POLICY DOC_INTEL.ADMIN.document_entitlement_policy
  AS (row_lob VARCHAR, row_doc_type VARCHAR) RETURNS BOOLEAN ->
  CASE
    -- Pipeline role always sees all (needed for automated processing)
    WHEN CURRENT_ROLE() = 'DOC_INTEL_PIPELINE' THEN TRUE
    -- ACCOUNTADMIN sees all rows
    WHEN CURRENT_ROLE() = 'ACCOUNTADMIN' THEN TRUE
    -- Must have DOC_INTEL_USER or DOC_INTEL_ADMIN role
    WHEN NOT (IS_ROLE_IN_SESSION('DOC_INTEL_USER') OR IS_ROLE_IN_SESSION('DOC_INTEL_ADMIN')) THEN FALSE
    -- User must be active in entitlements
    WHEN NOT DOC_INTEL.ADMIN.is_user_active() THEN FALSE
    -- Check LOB access (wildcard passes all, otherwise must match resolved names)
    WHEN NOT (
      ARRAY_CONTAINS('*'::VARIANT, DOC_INTEL.ADMIN.get_user_lob_access())
      OR ARRAY_CONTAINS(COALESCE(row_lob, '__NULL__')::VARIANT, DOC_INTEL.ADMIN.get_user_lob_access())
    ) THEN FALSE
    -- Check doc type access (fuzzy contains matching)
    WHEN NOT DOC_INTEL.ADMIN.user_can_access_doc_type(row_doc_type) THEN FALSE
    -- Both checks passed
    ELSE TRUE
  END;

COMMENT ON ROW ACCESS POLICY DOC_INTEL.ADMIN.document_entitlement_policy IS
  'Enforces LOB and document type filtering based on user entitlement role assignments. DOC_INTEL_PIPELINE and ACCOUNTADMIN see all rows. Admins are filtered by their configured entitlements.';

-- =============================================================================
-- ATTACH POLICY to views only
-- =============================================================================
-- NOTE: The policy is attached to the APP view only, not to document_catalog:
--   - App access goes through V_DOCUMENT_CATALOG (RAP-protected)
--   - Agent/Cortex Analyst goes through semantic view → document_catalog (no RAP)
--   - No user role has direct SELECT on document_catalog (only owner DOC_INTEL_ADMIN)

-- Apply to APP view (primary access path for the web application)
EXECUTE IMMEDIATE $$
BEGIN
  ALTER VIEW DOC_INTEL.APP.v_document_catalog
    ADD ROW ACCESS POLICY DOC_INTEL.ADMIN.document_entitlement_policy
    ON (line_of_business, document_type);
EXCEPTION WHEN OTHER THEN NULL;
END;
$$;

-- =============================================================================
-- GRANTS: Ensure functions are callable by DOC_INTEL_USER
-- =============================================================================

GRANT USAGE ON FUNCTION DOC_INTEL.ADMIN.get_user_lob_access() TO ROLE DOC_INTEL_USER;
GRANT USAGE ON FUNCTION DOC_INTEL.ADMIN.get_user_doc_type_access() TO ROLE DOC_INTEL_USER;
GRANT USAGE ON FUNCTION DOC_INTEL.ADMIN.is_user_active() TO ROLE DOC_INTEL_USER;
GRANT USAGE ON FUNCTION DOC_INTEL.ADMIN.user_can_access_doc_type(VARCHAR) TO ROLE DOC_INTEL_USER;

-- =============================================================================
-- VERIFICATION QUERIES (run manually to test)
-- =============================================================================
-- Check your access array:
-- SELECT DOC_INTEL.ADMIN.get_user_lob_access();
-- SELECT DOC_INTEL.ADMIN.get_user_doc_type_access();
-- SELECT DOC_INTEL.ADMIN.is_user_active();
-- Count visible rows:
-- SELECT COUNT(*) FROM DOC_INTEL.DATA.document_catalog;
-- Check LOB breakdown:
-- SELECT LINE_OF_BUSINESS, COUNT(*) FROM DOC_INTEL.DATA.document_catalog GROUP BY 1 ORDER BY 2 DESC;
