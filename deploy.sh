#!/bin/bash
# =============================================================================
# DOC_INTEL: Unified Deployment Script
# =============================================================================
# Usage:
#   ./deploy.sh                    Full deploy (infra + app + grants)
#   ./deploy.sh --infra-only       Database infrastructure only (no app deploy)
#   ./deploy.sh --app-only         App deploy + post-deploy grants only
#   ./deploy.sh --connection=NAME  Use a named snow CLI connection
#   ./deploy.sh --dry-run          Show what would be executed without running
#
# Prerequisites:
#   - Snowflake CLI (`snow`) 3.28 or later, and python3
#   - Account provisioned via ./provision.sh (one-time, requires ACCOUNTADMIN)
#   - User must have DOC_INTEL_ADMIN role granted
#   - Idempotent: safe to re-run
# =============================================================================

set -euo pipefail

# --- Load Configuration ---
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="${SCRIPT_DIR}/config/deploy.config"
SQL_DIR="${SCRIPT_DIR}/sql"
APP_DIR="${SCRIPT_DIR}/app"

if [ ! -f "$CONFIG_FILE" ]; then
  echo "ERROR: config/deploy.config not found at $CONFIG_FILE"
  exit 1
fi
source "$CONFIG_FILE"

# --- Flags ---
INFRA_ONLY=false
APP_ONLY=false
DRY_RUN=false
SNOW_CONN=""
FAILURES=0

for arg in "$@"; do
  case $arg in
    --infra-only)     INFRA_ONLY=true ;;
    --app-only)       APP_ONLY=true ;;
    --dry-run)        DRY_RUN=true ;;
    --connection=*)   SNOW_CONN="--connection ${arg#*=}" ;;
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

run_sql() {
  local file="$1"
  local desc="$2"
  if [ ! -f "$file" ]; then
    fail "SQL file not found: $file"
  fi
  step "$desc ($(basename "$file"))"
  if [ "$DRY_RUN" = true ]; then
    echo "    [dry-run] would execute: $file"
    return
  fi

  local result exit_code=0
  result=$(snow sql --role DOC_INTEL_ADMIN $SNOW_CONN -f "$file" 2>&1) || exit_code=$?
  echo "$result" | tail -5
  if [ "$exit_code" -ne 0 ]; then
    warn "Some statements in $(basename "$file") may have failed (exit code $exit_code)"
    FAILURES=$((FAILURES + 1))
  fi
}

# Runs a SQL query as DOC_INTEL_ADMIN. Never fails the deploy; use run_check to test.
run_admin_sql() {
  local sql="$1"
  snow sql --role DOC_INTEL_ADMIN $SNOW_CONN -q "$sql" 2>/dev/null || true
}

# Runs a SQL query as DOC_INTEL_ADMIN quietly and returns its real exit status
run_check() {
  snow sql --role DOC_INTEL_ADMIN $SNOW_CONN -q "$1" > /dev/null 2>&1
}

# =============================================================================
# PHASE 0: Pre-flight checks
# =============================================================================
info "Phase 0: Pre-flight checks"

ok "Config loaded from config/deploy.config"
ok "  Database: ${DOC_INTEL_DATABASE}"
ok "  App Schema: ${DOC_INTEL_DATABASE}.${DOC_INTEL_APP_SCHEMA}"
ok "  Query WH: ${DOC_INTEL_QUERY_WAREHOUSE}"

if ! command -v snow &> /dev/null; then
  fail "Snowflake CLI (snow) not found. Install: https://docs.snowflake.com/en/developer-guide/snowflake-cli/installation"
fi
ok "snow CLI found"

if ! command -v python3 &> /dev/null; then
  fail "python3 not found. Required for deployment checks."
fi
ok "python3 found"

if [ "$DRY_RUN" = false ]; then
  CURRENT_ROLE=$(snow sql $SNOW_CONN -q "SELECT CURRENT_ROLE()" --format json 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['CURRENT_ROLE()'])" 2>/dev/null)
  if [ -z "$CURRENT_ROLE" ]; then
    fail "Cannot connect to Snowflake. Check your connection configuration."
  fi
  ok "Connected as role: $CURRENT_ROLE"

  # Require DOC_INTEL_ADMIN
  ROLE_CHECK=$(snow sql $SNOW_CONN -q "USE ROLE DOC_INTEL_ADMIN" 2>&1) || true
  if echo "$ROLE_CHECK" | grep -q "successfully"; then
    ok "DOC_INTEL_ADMIN role available"
  else
    fail "DOC_INTEL_ADMIN role required. Run ./provision.sh first (requires ACCOUNTADMIN)."
  fi

  # Verify provisioning state
  step "Verifying provisioned infrastructure..."
  PROVISION_OK=true

  check_object() {
    local show_cmd="$1" label="$2"
    local result
    result=$(snow sql --role DOC_INTEL_ADMIN $SNOW_CONN -q "$show_cmd" --format json 2>&1) || true
    if echo "$result" | python3 -c "import sys,json; d=json.load(sys.stdin); exit(0 if d else 1)" 2>/dev/null; then
      return 0
    else
      warn "$label"
      PROVISION_OK=false
      return 1
    fi
  }

  check_object "SHOW DATABASES LIKE 'DOC_INTEL'" "DOC_INTEL database missing"
  check_object "SHOW WAREHOUSES LIKE 'DOC_INTEL_WH'" "DOC_INTEL_WH warehouse missing"
  check_object "SHOW WAREHOUSES LIKE 'DOC_INTEL_QUERY_WH'" "DOC_INTEL_QUERY_WH warehouse missing"
  check_object "SHOW COMPUTE POOLS LIKE 'DOC_MONITOR_POOL'" "DOC_MONITOR_POOL compute pool missing"
  check_object "SHOW INTEGRATIONS LIKE 'DOC_INTEL_EGRESS_EAI'" "DOC_INTEL_EGRESS_EAI integration missing"

  if [ "$PROVISION_OK" = false ]; then
    fail "Environment not provisioned. Run: ./provision.sh (requires ACCOUNTADMIN)"
  fi
  ok "Infrastructure provisioned"
else
  ok "[dry-run] Skipping connection check"
fi

# =============================================================================
# PHASE 1: Database Infrastructure
# =============================================================================
if [ "$APP_ONLY" = false ]; then
  info "Phase 1: Database Infrastructure"

  # 01: Foundation (schemas, stages, role grants)
  run_sql "${SQL_DIR}/01_foundation.sql" "Foundation: schemas, stages, role grants"

  # 02: Ingestion (registry table, procedures, task DAG)
  run_sql "${SQL_DIR}/02_ingestion.sql" "Ingestion: registry, procedures, tasks"

  # 03: Processing (parse, classify, extract SPs, dynamic table)
  run_sql "${SQL_DIR}/03_processing.sql" "Processing: document catalog, extractions"

  # 04: Telemetry (events, metrics, alerts)
  run_sql "${SQL_DIR}/04_telemetry.sql" "Telemetry: events, metrics tables"

  # 05: Intelligence (semantic view, search service, agent)
  run_sql "${SQL_DIR}/05_intelligence.sql" "Intelligence: semantic view, search service, agent"

  # 06: Admin (config tables, queues, feedback)
  run_sql "${SQL_DIR}/06_admin.sql" "Admin: config tables, queues, feedback"

  # 07: Entitlements (user_entitlements table)
  run_sql "${SQL_DIR}/07_entitlements.sql" "Entitlements: user access control"

  # 08: Roles (lines_of_business + entitlement_roles DDL)
  run_sql "${SQL_DIR}/08_roles.sql" "Roles: LOB + entitlement role tables"

  # 09: Role assignments (user_role_assignments junction table)
  run_sql "${SQL_DIR}/09_role_assignments.sql" "Role assignments: junction table"

  # 10: Seed config from CSV (must run AFTER tables exist)
  step "Uploading config CSVs to stage..."
  if [ "$DRY_RUN" = false ]; then
    snow sql --role DOC_INTEL_ADMIN $SNOW_CONN -q "CREATE STAGE IF NOT EXISTS DOC_INTEL.ADMIN.config_stage FILE_FORMAT = (TYPE = CSV FIELD_OPTIONALLY_ENCLOSED_BY = '\"' SKIP_HEADER = 1) COMMENT = 'Config CSV uploads'" 2>/dev/null || true
    snow stage copy "${SCRIPT_DIR}/config/classification_labels.csv" @DOC_INTEL.ADMIN.config_stage --overwrite --role DOC_INTEL_ADMIN $SNOW_CONN > /dev/null || fail "Could not upload config/classification_labels.csv"
    snow stage copy "${SCRIPT_DIR}/config/lobs.csv" @DOC_INTEL.ADMIN.config_stage --overwrite --role DOC_INTEL_ADMIN $SNOW_CONN > /dev/null || fail "Could not upload config/lobs.csv"
    snow stage copy "${SCRIPT_DIR}/config/extraction_schemas.csv" @DOC_INTEL.ADMIN.config_stage --overwrite --role DOC_INTEL_ADMIN $SNOW_CONN > /dev/null || fail "Could not upload config/extraction_schemas.csv"
    snow stage copy "${SCRIPT_DIR}/config/roles.csv" @DOC_INTEL.ADMIN.config_stage --overwrite --role DOC_INTEL_ADMIN $SNOW_CONN > /dev/null || fail "Could not upload config/roles.csv"
    snow stage copy "${SCRIPT_DIR}/config/suggested_searches.csv" @DOC_INTEL.ADMIN.config_stage --overwrite --role DOC_INTEL_ADMIN $SNOW_CONN > /dev/null || fail "Could not upload config/suggested_searches.csv"
  fi
  run_sql "${SQL_DIR}/10_seed_config.sql" "Seed: config data from CSV (labels, LOBs, schemas, roles)"

  # 11: Row access policy (references roles + assignments)
  run_sql "${SQL_DIR}/11_row_access_policy.sql" "Row access policy: LOB + DocType entitlements"

  # Resume pipeline tasks (leaf-to-root order for task DAG), then apply the
  # schedule from DOC_INTEL_PIPELINE_SCHEDULE to the root task
  PIPELINE_SCHEDULE="${DOC_INTEL_PIPELINE_SCHEDULE:-USING CRON 0 6 * * * UTC}"
  SCHEDULE_RE="^(MANUAL|[0-9]+ (MINUTES|HOURS)|USING CRON [0-9*/, -]+ [A-Za-z_/+-]+)$"
  if ! [[ "$PIPELINE_SCHEDULE" =~ $SCHEDULE_RE ]]; then
    fail "DOC_INTEL_PIPELINE_SCHEDULE='$PIPELINE_SCHEDULE' is not valid. Use MANUAL, '60 MINUTES', or 'USING CRON 0 6 * * * UTC'."
  fi
  step "Resuming pipeline tasks (schedule: ${PIPELINE_SCHEDULE})..."
  if [ "$DRY_RUN" = false ]; then
    run_admin_sql "ALTER TASK DOC_INTEL.DATA.task_05_emit_metrics RESUME"
    run_admin_sql "ALTER TASK DOC_INTEL.DATA.task_04_extract_attributes RESUME"
    run_admin_sql "ALTER TASK DOC_INTEL.DATA.task_03_classify_documents RESUME"
    run_admin_sql "ALTER TASK DOC_INTEL.DATA.task_02_parse_documents RESUME"
    run_admin_sql "ALTER TASK DOC_INTEL.DATA.task_01_register_files SUSPEND"
    if [ "$PIPELINE_SCHEDULE" = "MANUAL" ]; then
      ok "Pipeline runs only when you upload (root task left suspended)"
    else
      run_check "ALTER TASK DOC_INTEL.DATA.task_01_register_files SET SCHEDULE = '${PIPELINE_SCHEDULE}'" \
        || fail "Could not set the pipeline schedule to '${PIPELINE_SCHEDULE}'"
      run_admin_sql "ALTER TASK DOC_INTEL.DATA.task_01_register_files RESUME"
      ok "Pipeline tasks resumed"
    fi
  fi

  if [ "$FAILURES" -gt 0 ]; then
    fail "$FAILURES SQL file(s) had errors (see above). Fix them and re-run ./deploy.sh before the app is built."
  fi
  ok "Database infrastructure complete"
fi

# =============================================================================
# PHASE 2: App Deployment
# =============================================================================
if [ "$INFRA_ONLY" = false ]; then
  info "Phase 2: App Deployment"

  if [ ! -f "${APP_DIR}/snowflake.yml" ]; then
    fail "snowflake.yml not found in ${APP_DIR}"
  fi

  # Generate .env for local development (npm run dev). The deployed app
  # ignores it: snowflake.yml excludes .env* from the upload.
  step "Generating app .env from config/deploy.config..."
  cat > "${APP_DIR}/.env" <<EOF
DOC_INTEL_DATABASE=${DOC_INTEL_DATABASE}
DOC_INTEL_SERVICES_SCHEMA=${DOC_INTEL_SERVICES_SCHEMA}
DOC_INTEL_SEARCH_SVC=${DOC_INTEL_SEARCH_SVC}
DOC_INTEL_CORTEX_MODEL=${DOC_INTEL_CORTEX_MODEL}
DOC_INTEL_AGENT_NAME=${DOC_INTEL_AGENT_NAME}
SNOWFLAKE_WAREHOUSE=${DOC_INTEL_QUERY_WAREHOUSE}
NEXT_PUBLIC_DB_DISPLAY=${DOC_INTEL_DATABASE}
EOF

  step "Deploying app via snow app deploy..."
  if [ "$DRY_RUN" = true ]; then
    echo "    [dry-run] would execute: cd ${APP_DIR} && snow app deploy --role ${DOC_INTEL_ADMIN_ROLE} $SNOW_CONN"
  else
    (cd "${APP_DIR}" && snow app deploy --role "${DOC_INTEL_ADMIN_ROLE}" $SNOW_CONN) || fail "snow app deploy failed"
  fi
  ok "App deployed"

  # Apply the idle behavior from DOC_INTEL_APP_IDLE_SUSPEND_SECS. A deploy can
  # reset service settings, so set it again after every app deploy.
  IDLE_SECS="${DOC_INTEL_APP_IDLE_SUSPEND_SECS:-0}"
  if ! [[ "$IDLE_SECS" =~ ^[0-9]+$ ]] || { [ "$IDLE_SECS" -ne 0 ] && [ "$IDLE_SECS" -lt 300 ]; }; then
    fail "DOC_INTEL_APP_IDLE_SUSPEND_SECS='$IDLE_SECS' is not valid. Use 0 (always on) or 300 or more."
  fi
  APP_FQN="${DOC_INTEL_DATABASE}.${DOC_INTEL_APP_SCHEMA}.${DOC_INTEL_APP_NAME}"
  if [ "$DRY_RUN" = true ]; then
    echo "    [dry-run] would set AUTO_SUSPEND_SECS = ${IDLE_SECS} on ${APP_FQN}"
  elif [ "$IDLE_SECS" -eq 0 ]; then
    run_check "ALTER APPLICATION SERVICE ${APP_FQN} SET AUTO_SUSPEND_SECS = 0" \
      && ok "App stays on (bills while running)" \
      || warn "Could not set the app's idle behavior"
  else
    run_check "ALTER APPLICATION SERVICE ${APP_FQN} SET AUTO_SUSPEND_SECS = ${IDLE_SECS} AUTO_RESUME = TRUE" \
      && ok "App suspends after ${IDLE_SECS} idle seconds and resumes on the next visit" \
      || warn "Could not set the app's idle behavior"
  fi
fi

# =============================================================================
# PHASE 3: Post-deploy grants
# Phase 1 recreates views, search services, and the agent, which drops their
# grants, so re-apply them on every run. With --infra-only, only when the app
# already exists (12 also grants access to the app itself).
# =============================================================================
RUN_GRANTS=true
if [ "$INFRA_ONLY" = true ]; then
  if [ "$DRY_RUN" = false ] && ! run_check "SELECT SYSTEM\$GET_SERVICE_STATUS('${DOC_INTEL_DATABASE}.${DOC_INTEL_APP_SCHEMA}.${DOC_INTEL_APP_NAME}')"; then
    RUN_GRANTS=false
    warn "App not deployed yet, so grants were skipped. Run ./deploy.sh to deploy the app and apply them."
  fi
fi
if [ "$RUN_GRANTS" = true ]; then
  info "Phase 3: Post-deploy grants"

  if [ -f "${SQL_DIR}/12_post_deploy_grants.sql" ]; then
    run_sql "${SQL_DIR}/12_post_deploy_grants.sql" "RBAC grants, caller privileges"
  fi

  # Register agent in Snowflake Intelligence (uses DOC_INTEL_ADMIN which has USAGE granted)
  step "Registering agent in Snowflake Intelligence..."
  if [ "$DRY_RUN" = false ]; then
    if run_check "ALTER SNOWFLAKE INTELLIGENCE SNOWFLAKE_INTELLIGENCE_OBJECT_DEFAULT ADD AGENT ${DOC_INTEL_DATABASE}.${DOC_INTEL_SERVICES_SCHEMA}.${DOC_INTEL_AGENT_NAME}" 2>/dev/null; then
      ok "Agent registered in Snowflake Intelligence"
    else
      warn "Could not register agent in Snowflake Intelligence. Check with SHOW AGENTS."
    fi
  fi
fi

# =============================================================================
# PHASE 4: Verification
# =============================================================================
info "Phase 4: Verification"

if [ "$DRY_RUN" = true ]; then
  echo "    [dry-run] would run verification queries"
else
  step "Checking database objects..."
  run_check "SELECT COUNT(*) AS registry_rows FROM ${DOC_INTEL_DATABASE}.DATA.ingestion_registry" && ok "ingestion_registry exists" || warn "ingestion_registry missing"
  run_check "SELECT COUNT(*) AS catalog_rows FROM ${DOC_INTEL_DATABASE}.DATA.document_catalog" && ok "document_catalog exists" || warn "document_catalog missing"

  step "Checking search service..."
  run_check "SHOW CORTEX SEARCH SERVICES IN ${DOC_INTEL_DATABASE}.SERVICES" && ok "Search service configured" || warn "Search service missing"

  step "Checking agent..."
  run_check "DESCRIBE AGENT ${DOC_INTEL_DATABASE}.SERVICES.${DOC_INTEL_AGENT_NAME}" && ok "Agent exists" || warn "Agent missing"

  if [ "$APP_ONLY" = true ] || [ "$INFRA_ONLY" = false ]; then
    step "Checking app status..."
    run_check "SELECT SYSTEM\$GET_SERVICE_STATUS('${DOC_INTEL_DATABASE}.${DOC_INTEL_APP_SCHEMA}.${DOC_INTEL_APP_NAME}')" && ok "App service running" || warn "App service not found"
  fi

  step "Checking config tables..."
  run_admin_sql "SELECT 'labels=' || COUNT(*) FROM DOC_INTEL.ADMIN.classification_labels WHERE is_active=TRUE"
  run_admin_sql "SELECT 'lobs=' || COUNT(*) FROM DOC_INTEL.ADMIN.lines_of_business WHERE is_active=TRUE"
  run_admin_sql "SELECT 'schemas=' || COUNT(*) FROM DOC_INTEL.ADMIN.extraction_schemas"
  run_admin_sql "SELECT 'roles=' || COUNT(*) FROM DOC_INTEL.ADMIN.entitlement_roles WHERE is_active=TRUE"
fi

# =============================================================================
echo ""
if [ "$FAILURES" -gt 0 ]; then
  echo "  ✗ Deployment finished with $FAILURES SQL file error(s). Review the output above and re-run ./deploy.sh."
  exit 1
fi
info "Deployment complete"
echo ""
echo "  Config:    config/deploy.config"
echo "  Database:  ${DOC_INTEL_DATABASE} (owned by ${DOC_INTEL_ADMIN_ROLE})"
echo ""
echo "  Next steps:"
echo "    1. Load your documents:  ./scripts/upload_docs.sh /path/to/your/files"
echo "    2. Open the app:         (cd app && snow app open --role ${DOC_INTEL_ADMIN_ROLE} ${SNOW_CONN})"
echo ""
