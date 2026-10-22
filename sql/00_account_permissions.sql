-- =============================================================================
-- DOC_INTEL: One-Time Account Provisioning
-- File: sql/00_account_permissions.sql
--
-- Run this ONCE before deploy.sh to set up roles, infrastructure, and grants.
-- Requires ACCOUNTADMIN (or run sections individually with appropriate roles).
--
-- Two ways to run:
--   1. SQL:  snow sql -f sql/00_account_permissions.sql
--   2. Bash: ./provision.sh  (wrapper with checks, dry-run, --check mode)
--
-- Both methods produce the same result. Use whichever fits your workflow.
--
-- After this script runs, DOC_INTEL_ADMIN can deploy and operate everything
-- without needing SYSADMIN or ACCOUNTADMIN.
--
-- IDEMPOTENT: Safe to re-run.
-- =============================================================================

-- =========================================================================
-- STEP 1: Create roles (SECURITYADMIN)
-- =========================================================================

USE ROLE SECURITYADMIN;

CREATE ROLE IF NOT EXISTS DOC_INTEL_USER
    COMMENT = 'Standard user — search, analytics, document browser';

CREATE ROLE IF NOT EXISTS DOC_INTEL_PIPELINE
    COMMENT = 'Pipeline service role — runs tasks, writes pipeline tables, calls Cortex AI';

CREATE ROLE IF NOT EXISTS DOC_INTEL_ADMIN
    COMMENT = 'Admin/deploy role — owns database, deploys app, manages pipeline and users';

GRANT ROLE DOC_INTEL_USER     TO ROLE DOC_INTEL_ADMIN;
GRANT ROLE DOC_INTEL_ADMIN    TO ROLE SYSADMIN;

-- =========================================================================
-- STEP 2: Account-level grants (ACCOUNTADMIN)
-- These are the only statements that strictly require ACCOUNTADMIN.
-- =========================================================================

USE ROLE ACCOUNTADMIN;

-- Operational privileges
GRANT MANAGE CALLER GRANTS    ON ACCOUNT TO ROLE DOC_INTEL_ADMIN;
GRANT BIND SERVICE ENDPOINT   ON ACCOUNT TO ROLE DOC_INTEL_ADMIN;
GRANT EXECUTE TASK            ON ACCOUNT TO ROLE DOC_INTEL_ADMIN;
GRANT EXECUTE TASK            ON ACCOUNT TO ROLE DOC_INTEL_PIPELINE;
GRANT EXECUTE ALERT           ON ACCOUNT TO ROLE DOC_INTEL_ADMIN;

-- =========================================================================
-- STEP 3: Create infrastructure (SYSADMIN)
-- =========================================================================

USE ROLE SYSADMIN;

-- Database and schemas
CREATE DATABASE IF NOT EXISTS DOC_INTEL
    COMMENT = 'Document Intelligence Pipeline';

CREATE SCHEMA IF NOT EXISTS DOC_INTEL.DATA;
CREATE SCHEMA IF NOT EXISTS DOC_INTEL.SERVICES;
CREATE SCHEMA IF NOT EXISTS DOC_INTEL.TELEMETRY;
CREATE SCHEMA IF NOT EXISTS DOC_INTEL.ADMIN;
CREATE SCHEMA IF NOT EXISTS DOC_INTEL.APP;
CREATE SCHEMA IF NOT EXISTS DOC_INTEL.APP_SERVICE;

-- Warehouses
CREATE WAREHOUSE IF NOT EXISTS DOC_INTEL_WH
    WAREHOUSE_SIZE      = 'MEDIUM'
    AUTO_SUSPEND        = 120
    AUTO_RESUME         = TRUE
    INITIALLY_SUSPENDED = TRUE
    COMMENT = 'Document Intelligence pipeline processing — parsing, classification, extraction';

CREATE WAREHOUSE IF NOT EXISTS DOC_INTEL_QUERY_WH
    WAREHOUSE_SIZE      = 'XSMALL'
    AUTO_SUSPEND        = 60
    AUTO_RESUME         = TRUE
    INITIALLY_SUSPENDED = TRUE
    COMMENT = 'Document Intelligence application queries — user-facing, low-latency';

-- Compute pool for SPCS app
CREATE COMPUTE POOL IF NOT EXISTS DOC_MONITOR_POOL
    MIN_NODES         = 1
    MAX_NODES         = 1
    INSTANCE_FAMILY   = CPU_X64_S
    AUTO_SUSPEND_SECS = 300
    AUTO_RESUME       = TRUE
    COMMENT = 'Document Intelligence SPCS container pool — app service + build jobs';

-- Network egress for npm install during SPCS build
CREATE OR REPLACE NETWORK RULE DOC_INTEL.ADMIN.DOC_INTEL_EGRESS_RULE
    MODE = EGRESS
    TYPE = HOST_PORT
    VALUE_LIST = (
        'registry.npmjs.org:443',
        'registry.npmmirror.com:443',
        'nodejs.org:443'
    )
    COMMENT = 'Document Intelligence egress — npm registry for build-time package install';

CREATE OR REPLACE EXTERNAL ACCESS INTEGRATION DOC_INTEL_EGRESS_EAI
    ALLOWED_NETWORK_RULES = (DOC_INTEL.ADMIN.DOC_INTEL_EGRESS_RULE)
    ENABLED = TRUE
    COMMENT = 'Dedicated EAI for Document Intelligence app deployment and runtime';

-- =========================================================================
-- STEP 4: Transfer ownership to DOC_INTEL_ADMIN
-- After this, DOC_INTEL_ADMIN owns everything and doesn't need SYSADMIN.
-- =========================================================================

GRANT OWNERSHIP ON DATABASE DOC_INTEL TO ROLE DOC_INTEL_ADMIN COPY CURRENT GRANTS;
GRANT OWNERSHIP ON ALL SCHEMAS IN DATABASE DOC_INTEL TO ROLE DOC_INTEL_ADMIN COPY CURRENT GRANTS;
GRANT USAGE, OPERATE, MONITOR ON WAREHOUSE DOC_INTEL_WH       TO ROLE DOC_INTEL_ADMIN;
GRANT USAGE, OPERATE, MONITOR ON WAREHOUSE DOC_INTEL_QUERY_WH TO ROLE DOC_INTEL_ADMIN;
GRANT OWNERSHIP ON COMPUTE POOL DOC_MONITOR_POOL TO ROLE DOC_INTEL_ADMIN COPY CURRENT GRANTS;
GRANT USAGE ON INTEGRATION DOC_INTEL_EGRESS_EAI TO ROLE DOC_INTEL_ADMIN;

-- =========================================================================
-- STEP 5: Assign roles to the current user
-- Replace YOUR_USERNAME below if running manually in Snowsight.
-- When run via `snow sql -f`, CURRENT_USER() resolves automatically.
-- =========================================================================

USE ROLE SECURITYADMIN;

EXECUTE IMMEDIATE $$
BEGIN
    LET user_name := CURRENT_USER();
    EXECUTE IMMEDIATE 'GRANT ROLE DOC_INTEL_ADMIN TO USER "' || :user_name || '"';
    EXECUTE IMMEDIATE 'GRANT ROLE DOC_INTEL_PIPELINE TO USER "' || :user_name || '"';
    EXECUTE IMMEDIATE 'GRANT ROLE DOC_INTEL_USER TO USER "' || :user_name || '"';
END;
$$;

-- =========================================================================
-- STEP 6: Cortex AI access (ACCOUNTADMIN)
-- Grants the CORTEX_USER database role to all three application roles.
-- =========================================================================

USE ROLE ACCOUNTADMIN;

GRANT DATABASE ROLE SNOWFLAKE.CORTEX_USER TO ROLE DOC_INTEL_ADMIN;
GRANT DATABASE ROLE SNOWFLAKE.CORTEX_USER TO ROLE DOC_INTEL_PIPELINE;
GRANT DATABASE ROLE SNOWFLAKE.CORTEX_USER TO ROLE DOC_INTEL_USER;

-- =========================================================================
-- STEP 7: Snowflake Intelligence object
-- Creates the Snowflake Intelligence object so the agent can be registered
-- later by deploy.sh after 05_intelligence.sql creates the agent.
-- =========================================================================

EXECUTE IMMEDIATE $$
BEGIN
    CREATE SNOWFLAKE INTELLIGENCE SNOWFLAKE_INTELLIGENCE_OBJECT_DEFAULT;
EXCEPTION WHEN OTHER THEN NULL;
END;
$$;

GRANT USAGE ON SNOWFLAKE INTELLIGENCE SNOWFLAKE_INTELLIGENCE_OBJECT_DEFAULT TO ROLE DOC_INTEL_ADMIN;
GRANT USAGE ON SNOWFLAKE INTELLIGENCE SNOWFLAKE_INTELLIGENCE_OBJECT_DEFAULT TO ROLE DOC_INTEL_USER;

-- =========================================================================
-- STEP 8: Pipeline role isolation
-- DOC_INTEL_PIPELINE must NOT be inherited by DOC_INTEL_ADMIN.
-- This prevents IS_ROLE_IN_SESSION('DOC_INTEL_PIPELINE') from being TRUE
-- for admin users, which would bypass row access policy checks.
-- =========================================================================

USE ROLE SECURITYADMIN;

EXECUTE IMMEDIATE $$
BEGIN
  REVOKE ROLE DOC_INTEL_PIPELINE FROM ROLE DOC_INTEL_ADMIN;
EXCEPTION WHEN OTHER THEN NULL;
END;
$$;

-- =========================================================================
-- VERIFICATION: Check that provisioning succeeded
-- =========================================================================

SELECT 'Provisioning complete' AS status, CURRENT_USER() AS provisioned_by, CURRENT_TIMESTAMP() AS provisioned_at;
