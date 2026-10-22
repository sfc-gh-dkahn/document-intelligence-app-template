#!/bin/bash
# =============================================================================
# DOC_INTEL: Quick start — provision (if needed), deploy, and load documents
# =============================================================================
# Usage:
#   ./quickstart.sh                                  Provision + deploy
#   ./quickstart.sh /path/to/your/documents          ...then upload and process them
#   ./quickstart.sh /path/to/docs --connection=NAME  Use a named snow CLI connection
#
# Provisioning needs ACCOUNTADMIN once. If DOC_INTEL is already provisioned,
# that step is skipped and DOC_INTEL_ADMIN is enough.
# Safe to re-run.
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOCS=""
CONN_FLAG=""

for arg in "$@"; do
  case $arg in
    --connection=*) CONN_FLAG="$arg" ;;
    --help|-h)      sed -n "2,13p" "$0" | grep "^#" | sed 's/^# *//'; exit 0 ;;
    -*)             echo "Unknown flag: $arg (use --help)"; exit 1 ;;
    *)              DOCS="$arg" ;;
  esac
done

if [ -n "$DOCS" ] && [ ! -e "$DOCS" ]; then
  echo "ERROR: $DOCS does not exist."
  exit 1
fi

for cmd in snow python3; do
  if ! command -v "$cmd" > /dev/null; then
    echo "ERROR: $cmd not found. Install it and re-run."
    [ "$cmd" = snow ] && echo "  Snowflake CLI: https://docs.snowflake.com/en/developer-guide/snowflake-cli/installation/installation"
    exit 1
  fi
done

echo "=== Step 1 of 3: Account setup"
if bash "${SCRIPT_DIR}/provision.sh" --check $CONN_FLAG > /dev/null 2>&1; then
  echo "  Already provisioned. Skipping."
else
  bash "${SCRIPT_DIR}/provision.sh" $CONN_FLAG
fi

echo "=== Step 2 of 3: Deploy database objects and the app"
bash "${SCRIPT_DIR}/deploy.sh" $CONN_FLAG

echo "=== Step 3 of 3: Load documents"
if [ -n "$DOCS" ]; then
  bash "${SCRIPT_DIR}/scripts/upload_docs.sh" "$DOCS" $CONN_FLAG
  echo ""
  echo "  Processing runs in the background. Then run:"
  echo "    ./scripts/upload_docs.sh --status ${CONN_FLAG}    (until files show COMPLETE)"
  echo "    ./scripts/upload_docs.sh --refresh ${CONN_FLAG}   (so they appear in the app now)"
else
  echo "  Skipped. Load documents any time with:"
  echo "    ./scripts/upload_docs.sh /path/to/your/documents ${CONN_FLAG}"
fi

echo ""
echo "=== Done"
echo "  App URL:  (cd app && snow app open --print-only --role DOC_INTEL_ADMIN ${CONN_FLAG/=/ })"
echo "  Sign in with the same Snowflake user. To tailor it, ask Cortex Code to 'tailor document intelligence to my business'."
