#!/bin/bash
# =============================================================================
# DOC_INTEL: One-Time Account Provisioning (requires ACCOUNTADMIN)
# =============================================================================
# Usage:
#   ./provision.sh               Provision the account (roles, infra, grants)
#   ./provision.sh --dry-run     Show what would be executed without running
#   ./provision.sh --check       Only verify provisioning state, change nothing
#                                (exits 1 if anything is missing)
#   ./provision.sh --connection=NAME   Use a named snow CLI connection
#
# This script must be run ONCE by an ACCOUNTADMIN user before deploy.sh.
# It creates roles, infrastructure, and account-level grants that require
# elevated privileges. After this completes, deploy.sh can be run by any
# user with the DOC_INTEL_ADMIN role.
#
# Alternatively, run the equivalent SQL directly:
#   snow sql -f sql/00_account_permissions.sql
#
# Both methods produce the same result.
#
# Idempotent: safe to re-run.
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="${SCRIPT_DIR}/config/deploy.config"

if [ ! -f "$CONFIG_FILE" ]; then
  echo "ERROR: config/deploy.config not found at $CONFIG_FILE"
  exit 1
fi
source "$CONFIG_FILE"

# --- Flags ---
DRY_RUN=false
CHECK_ONLY=false
SNOW_CONN=""

for arg in "$@"; do
  case $arg in
    --dry-run)    DRY_RUN=true ;;
    --check)      CHECK_ONLY=true ;;
    --connection=*) SNOW_CONN="--connection ${arg#*=}" ;;
    --help|-h)
      sed -n "2,22p" "$0" | grep "^#" | sed 's/^# *//'
      exit 0
      ;;
    *)
      echo "Unknown flag: $arg (use --help)"
      exit 1
      ;;
  esac
done

if [ -z "$SNOW_CONN" ] && [ -n "${SNOW_CONNECTION:-}" ]; then
  SNOW_CONN="--connection ${SNOW_CONNECTION}"
fi

# --- Helpers ---
info()  { echo "=== $1"; }
step()  { echo "  → $1"; }
ok()    { echo "  ✓ $1"; }
warn()  { echo "  ⚠ $1"; }
fail()  { echo "  ✗ $1" >&2; exit 1; }

run_provision_sql() {
  local sql="$1"
  local desc="$2"
  step "$desc"
  if [ "$DRY_RUN" = true ]; then
    echo "    [dry-run] $sql"
    return 0
  fi
  snow sql --role ACCOUNTADMIN $SNOW_CONN -q "$sql" 2>&1 | tail -3
}

# --- Check function (used by both --check and verify step) ---
check_provisioning() {
  local all_ok=true

  step "Checking DOC_INTEL_ADMIN role..."
  if snow sql $SNOW_CONN -q "USE ROLE DOC_INTEL_ADMIN" 2>/dev/null | grep -q "successfully"; then
    ok "DOC_INTEL_ADMIN role exists and is granted"
  else
    warn "DOC_INTEL_ADMIN role missing or not granted"
    all_ok=false
  fi

  step "Checking database..."
  if snow sql $SNOW_CONN -q "SHOW DATABASES LIKE 'DOC_INTEL'" --format json 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); exit(0 if d else 1)" 2>/dev/null; then
    ok "DOC_INTEL database exists"
  else
    warn "DOC_INTEL database missing"
    all_ok=false
  fi

  step "Checking warehouses..."
  if snow sql $SNOW_CONN -q "SHOW WAREHOUSES LIKE 'DOC_INTEL_WH'" --format json 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); exit(0 if d else 1)" 2>/dev/null; then
    ok "DOC_INTEL_WH warehouse exists"
  else
    warn "DOC_INTEL_WH warehouse missing"
    all_ok=false
  fi
  if snow sql $SNOW_CONN -q "SHOW WAREHOUSES LIKE 'DOC_INTEL_QUERY_WH'" --format json 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); exit(0 if d else 1)" 2>/dev/null; then
    ok "DOC_INTEL_QUERY_WH warehouse exists"
  else
    warn "DOC_INTEL_QUERY_WH warehouse missing"
    all_ok=false
  fi

  step "Checking compute pool..."
  if snow sql $SNOW_CONN -q "SHOW COMPUTE POOLS LIKE 'DOC_MONITOR_POOL'" --format json 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); exit(0 if d else 1)" 2>/dev/null; then
    ok "DOC_MONITOR_POOL compute pool exists"
  else
    warn "DOC_MONITOR_POOL compute pool missing"
    all_ok=false
  fi

  step "Checking external access integration..."
  if snow sql $SNOW_CONN -q "SHOW INTEGRATIONS LIKE 'DOC_INTEL_EGRESS_EAI'" --format json 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); exit(0 if d else 1)" 2>/dev/null; then
    ok "DOC_INTEL_EGRESS_EAI integration exists"
  else
    warn "DOC_INTEL_EGRESS_EAI integration missing"
    all_ok=false
  fi

  if [ "$all_ok" = true ]; then
    ok "All provisioning checks passed"
    return 0
  else
    return 1
  fi
}

# =============================================================================
# CHECK-ONLY MODE
# =============================================================================
if [ "$CHECK_ONLY" = true ]; then
  info "Checking provisioning state"
  if check_provisioning; then
    echo ""
    echo "  Environment is fully provisioned. Ready for: ./deploy.sh"
  else
    echo ""
    echo "  Environment is NOT fully provisioned. Run: ./provision.sh"
    exit 1
  fi
  exit 0
fi

# =============================================================================
# PRE-FLIGHT: Verify ACCOUNTADMIN access
# =============================================================================
info "Pre-flight checks"

if ! command -v snow &> /dev/null; then
  fail "Snowflake CLI (snow) not found."
fi
ok "snow CLI found"

if [ "$DRY_RUN" = false ]; then
  CURRENT_ROLE=$(snow sql $SNOW_CONN -q "SELECT CURRENT_ROLE()" --format json 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['CURRENT_ROLE()'])" 2>/dev/null)
  CURRENT_USER_NAME=$(snow sql $SNOW_CONN -q "SELECT CURRENT_USER()" --format json 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['CURRENT_USER()'])" 2>/dev/null)
  ok "Connected as: $CURRENT_USER_NAME (role: $CURRENT_ROLE)"

  # Check ACCOUNTADMIN access
  _role_check=$(snow sql $SNOW_CONN --role ACCOUNTADMIN -q "USE ROLE ACCOUNTADMIN" 2>/dev/null || true)
  if echo "$_role_check" | grep -q "successfully"; then
    ok "ACCOUNTADMIN role available"
  else
    fail "ACCOUNTADMIN role required. Ask your account administrator to run this script. If they already did for another user, ask them instead for: GRANT ROLE DOC_INTEL_ADMIN TO USER <your user>;"
  fi
fi

# =============================================================================
# STEP 1: Create roles (SECURITYADMIN)
# =============================================================================
info "Step 1: Create roles"
run_provision_sql "USE ROLE SECURITYADMIN" "Switching to SECURITYADMIN"
run_provision_sql "CREATE ROLE IF NOT EXISTS DOC_INTEL_USER COMMENT = 'Standard user — search, analytics, document browser'" "Creating DOC_INTEL_USER role"
run_provision_sql "CREATE ROLE IF NOT EXISTS DOC_INTEL_PIPELINE COMMENT = 'Pipeline service role — tasks, Cortex AI'" "Creating DOC_INTEL_PIPELINE role"
run_provision_sql "CREATE ROLE IF NOT EXISTS DOC_INTEL_ADMIN COMMENT = 'Admin/deploy role — owns database, deploys app'" "Creating DOC_INTEL_ADMIN role"
run_provision_sql "GRANT ROLE DOC_INTEL_USER TO ROLE DOC_INTEL_ADMIN" "Granting DOC_INTEL_USER to DOC_INTEL_ADMIN"
run_provision_sql "GRANT ROLE DOC_INTEL_ADMIN TO ROLE SYSADMIN" "Granting DOC_INTEL_ADMIN to SYSADMIN"

# =============================================================================
# STEP 2: Account-level grants (ACCOUNTADMIN)
# =============================================================================
info "Step 2: Account-level grants (ACCOUNTADMIN)"
run_provision_sql "USE ROLE ACCOUNTADMIN" "Switching to ACCOUNTADMIN"
run_provision_sql "GRANT MANAGE CALLER GRANTS ON ACCOUNT TO ROLE DOC_INTEL_ADMIN" "MANAGE CALLER GRANTS"
run_provision_sql "GRANT BIND SERVICE ENDPOINT ON ACCOUNT TO ROLE DOC_INTEL_ADMIN" "BIND SERVICE ENDPOINT"
run_provision_sql "GRANT EXECUTE TASK ON ACCOUNT TO ROLE DOC_INTEL_ADMIN" "EXECUTE TASK (admin)"
run_provision_sql "GRANT EXECUTE TASK ON ACCOUNT TO ROLE DOC_INTEL_PIPELINE" "EXECUTE TASK (pipeline)"
run_provision_sql "GRANT EXECUTE ALERT ON ACCOUNT TO ROLE DOC_INTEL_ADMIN" "EXECUTE ALERT"

# =============================================================================
# STEP 3: Create infrastructure (SYSADMIN)
# =============================================================================
info "Step 3: Create infrastructure"
run_provision_sql "USE ROLE SYSADMIN" "Switching to SYSADMIN"
run_provision_sql "CREATE DATABASE IF NOT EXISTS DOC_INTEL COMMENT = 'Document Intelligence Pipeline'" "Creating database"
run_provision_sql "CREATE SCHEMA IF NOT EXISTS DOC_INTEL.DATA" "Schema: DATA"
run_provision_sql "CREATE SCHEMA IF NOT EXISTS DOC_INTEL.SERVICES" "Schema: SERVICES"
run_provision_sql "CREATE SCHEMA IF NOT EXISTS DOC_INTEL.TELEMETRY" "Schema: TELEMETRY"
run_provision_sql "CREATE SCHEMA IF NOT EXISTS DOC_INTEL.ADMIN" "Schema: ADMIN"
run_provision_sql "CREATE SCHEMA IF NOT EXISTS DOC_INTEL.APP" "Schema: APP"
run_provision_sql "CREATE SCHEMA IF NOT EXISTS DOC_INTEL.APP_SERVICE" "Schema: APP_SERVICE"

run_provision_sql "CREATE WAREHOUSE IF NOT EXISTS DOC_INTEL_WH WAREHOUSE_SIZE='MEDIUM' AUTO_SUSPEND=120 AUTO_RESUME=TRUE INITIALLY_SUSPENDED=TRUE COMMENT='Document Intelligence pipeline processing'" "Creating pipeline warehouse"
run_provision_sql "CREATE WAREHOUSE IF NOT EXISTS DOC_INTEL_QUERY_WH WAREHOUSE_SIZE='XSMALL' AUTO_SUSPEND=60 AUTO_RESUME=TRUE INITIALLY_SUSPENDED=TRUE COMMENT='Document Intelligence app queries'" "Creating query warehouse"
run_provision_sql "CREATE COMPUTE POOL IF NOT EXISTS DOC_MONITOR_POOL MIN_NODES=1 MAX_NODES=1 INSTANCE_FAMILY=CPU_X64_S AUTO_SUSPEND_SECS=300 AUTO_RESUME=TRUE COMMENT='Document Intelligence SPCS pool'" "Creating compute pool"

run_provision_sql "CREATE OR REPLACE NETWORK RULE DOC_INTEL.ADMIN.DOC_INTEL_EGRESS_RULE MODE=EGRESS TYPE=HOST_PORT VALUE_LIST=('registry.npmjs.org:443','registry.npmmirror.com:443','nodejs.org:443') COMMENT='Document Intelligence egress — npm registry'" "Creating network rule"
run_provision_sql "CREATE OR REPLACE EXTERNAL ACCESS INTEGRATION DOC_INTEL_EGRESS_EAI ALLOWED_NETWORK_RULES=(DOC_INTEL.ADMIN.DOC_INTEL_EGRESS_RULE) ENABLED=TRUE COMMENT='Document Intelligence EAI'" "Creating external access integration"

# =============================================================================
# STEP 4: Transfer ownership (SYSADMIN)
# =============================================================================
info "Step 4: Transfer ownership to DOC_INTEL_ADMIN"
run_provision_sql "GRANT OWNERSHIP ON DATABASE DOC_INTEL TO ROLE DOC_INTEL_ADMIN COPY CURRENT GRANTS" "Database ownership"
run_provision_sql "GRANT OWNERSHIP ON ALL SCHEMAS IN DATABASE DOC_INTEL TO ROLE DOC_INTEL_ADMIN COPY CURRENT GRANTS" "Schema ownership"
run_provision_sql "GRANT USAGE, OPERATE, MONITOR ON WAREHOUSE DOC_INTEL_WH TO ROLE DOC_INTEL_ADMIN" "Pipeline warehouse grants"
run_provision_sql "GRANT USAGE, OPERATE, MONITOR ON WAREHOUSE DOC_INTEL_QUERY_WH TO ROLE DOC_INTEL_ADMIN" "Query warehouse grants"
run_provision_sql "GRANT OWNERSHIP ON COMPUTE POOL DOC_MONITOR_POOL TO ROLE DOC_INTEL_ADMIN COPY CURRENT GRANTS" "Compute pool ownership"
run_provision_sql "GRANT USAGE ON INTEGRATION DOC_INTEL_EGRESS_EAI TO ROLE DOC_INTEL_ADMIN" "EAI usage grant"

# =============================================================================
# STEP 5: Assign roles to current user (SECURITYADMIN)
# =============================================================================
info "Step 5: Assign roles"
run_provision_sql "USE ROLE SECURITYADMIN" "Switching to SECURITYADMIN"

if [ "$DRY_RUN" = false ]; then
  # Grant to the user running this script
  PROVISION_USER=$(snow sql $SNOW_CONN -q "SELECT CURRENT_USER()" --format json 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['CURRENT_USER()'])" 2>/dev/null)
  run_provision_sql "GRANT ROLE DOC_INTEL_ADMIN TO USER \"${PROVISION_USER}\"" "DOC_INTEL_ADMIN → ${PROVISION_USER}"
  run_provision_sql "GRANT ROLE DOC_INTEL_PIPELINE TO USER \"${PROVISION_USER}\"" "DOC_INTEL_PIPELINE → ${PROVISION_USER}"
  run_provision_sql "GRANT ROLE DOC_INTEL_USER TO USER \"${PROVISION_USER}\"" "DOC_INTEL_USER → ${PROVISION_USER}"

  # Also grant to the configured extra user, if set and different
  if [ -n "${DOC_INTEL_DEFAULT_USER}" ] && [ "${DOC_INTEL_DEFAULT_USER}" != "${PROVISION_USER}" ]; then
    # Quote names with special characters (e.g. SSO emails); plain names stay case-insensitive
    if [[ "${DOC_INTEL_DEFAULT_USER}" =~ ^[A-Za-z_][A-Za-z0-9_\$]*$ ]]; then
      DEFAULT_USER_SQL="${DOC_INTEL_DEFAULT_USER}"
    else
      DEFAULT_USER_SQL="\"${DOC_INTEL_DEFAULT_USER}\""
    fi
    run_provision_sql "GRANT ROLE DOC_INTEL_ADMIN TO USER ${DEFAULT_USER_SQL}" "DOC_INTEL_ADMIN → ${DOC_INTEL_DEFAULT_USER}"
    run_provision_sql "GRANT ROLE DOC_INTEL_PIPELINE TO USER ${DEFAULT_USER_SQL}" "DOC_INTEL_PIPELINE → ${DOC_INTEL_DEFAULT_USER}"
    run_provision_sql "GRANT ROLE DOC_INTEL_USER TO USER ${DEFAULT_USER_SQL}" "DOC_INTEL_USER → ${DOC_INTEL_DEFAULT_USER}"
  fi
fi

# =============================================================================
# STEP 6: Cortex AI access (ACCOUNTADMIN)
# =============================================================================
info "Step 6: Cortex AI access"
run_provision_sql "USE ROLE ACCOUNTADMIN" "Switching to ACCOUNTADMIN"
run_provision_sql "GRANT DATABASE ROLE SNOWFLAKE.CORTEX_USER TO ROLE DOC_INTEL_ADMIN" "CORTEX_USER → DOC_INTEL_ADMIN"
run_provision_sql "GRANT DATABASE ROLE SNOWFLAKE.CORTEX_USER TO ROLE DOC_INTEL_PIPELINE" "CORTEX_USER → DOC_INTEL_PIPELINE"
run_provision_sql "GRANT DATABASE ROLE SNOWFLAKE.CORTEX_USER TO ROLE DOC_INTEL_USER" "CORTEX_USER → DOC_INTEL_USER"

# =============================================================================
# STEP 7: Snowflake Intelligence object (ACCOUNTADMIN)
# =============================================================================
info "Step 7: Snowflake Intelligence"
if [ "$DRY_RUN" = false ]; then
  step "Creating Snowflake Intelligence object (if not exists)..."
  snow sql $SNOW_CONN --role ACCOUNTADMIN -q "BEGIN CREATE SNOWFLAKE INTELLIGENCE SNOWFLAKE_INTELLIGENCE_OBJECT_DEFAULT; EXCEPTION WHEN OTHER THEN NULL; END;" 2>/dev/null || true
  run_provision_sql "GRANT USAGE ON SNOWFLAKE INTELLIGENCE SNOWFLAKE_INTELLIGENCE_OBJECT_DEFAULT TO ROLE DOC_INTEL_ADMIN" "Intelligence usage → DOC_INTEL_ADMIN"
  run_provision_sql "GRANT USAGE ON SNOWFLAKE INTELLIGENCE SNOWFLAKE_INTELLIGENCE_OBJECT_DEFAULT TO ROLE DOC_INTEL_USER" "Intelligence usage → DOC_INTEL_USER"
fi

# =============================================================================
# STEP 8: Pipeline role isolation (SECURITYADMIN)
# =============================================================================
info "Step 8: Pipeline role isolation"
run_provision_sql "USE ROLE SECURITYADMIN" "Switching to SECURITYADMIN"
if [ "$DRY_RUN" = false ]; then
  snow sql $SNOW_CONN --role ACCOUNTADMIN -q "BEGIN REVOKE ROLE DOC_INTEL_PIPELINE FROM ROLE DOC_INTEL_ADMIN; EXCEPTION WHEN OTHER THEN NULL; END;" 2>/dev/null || true
  ok "DOC_INTEL_PIPELINE isolated from DOC_INTEL_ADMIN"
fi

# =============================================================================
# VERIFY
# =============================================================================
info "Verification"
if [ "$DRY_RUN" = false ]; then
  check_provisioning
fi

echo ""
info "Provisioning complete"
echo ""
echo "  Roles:      DOC_INTEL_ADMIN, DOC_INTEL_USER, DOC_INTEL_PIPELINE"
echo "  Database:   DOC_INTEL (owned by DOC_INTEL_ADMIN)"
echo "  Warehouses: DOC_INTEL_WH (MEDIUM), DOC_INTEL_QUERY_WH (XSMALL)"
echo "  Compute:    DOC_MONITOR_POOL (CPU_X64_S)"
echo "  EAI:        DOC_INTEL_EGRESS_EAI"
echo ""
echo "  Next step: ./deploy.sh"
echo ""
