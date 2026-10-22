#!/bin/bash
# =============================================================================
# DOC_INTEL: Upload your documents and start the pipeline
# =============================================================================
# Usage:
#   ./scripts/upload_docs.sh /path/to/folder        Upload every supported file
#                                                   and start one run (up to
#                                                   100 documents)
#   ./scripts/upload_docs.sh /path/to/file.pdf      Upload one file
#   ./scripts/upload_docs.sh <path> --drain         Upload, then keep starting
#                                                   runs until every file is
#                                                   processed (for large loads)
#   ./scripts/upload_docs.sh --drain                Process everything waiting
#   ./scripts/upload_docs.sh <path> --no-run        Upload only; the next
#                                                   scheduled run picks files up
#   ./scripts/upload_docs.sh --status               Show pipeline progress
#   ./scripts/upload_docs.sh --refresh              Push finished files into the
#                                                   catalog and search now (they
#                                                   refresh hourly on their own)
#   ./scripts/upload_docs.sh <path> --connection=NAME
#
# Files go to @DOC_INTEL.DATA.doc_stage/documents/ and keep their sub-folders.
# Supported: pdf, docx, pptx, tif, tiff, jpg, jpeg, png, html, txt.
# Re-uploading a file with the same name replaces it.
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../config/deploy.config"

STAGE="@DOC_INTEL.DATA.doc_stage/documents"
ROLE="DOC_INTEL_ADMIN"
SRC=""
RUN_PIPELINE=true
DRAIN=false
STATUS_ONLY=false
REFRESH_ONLY=false
SNOW_CONN=""

for arg in "$@"; do
  case $arg in
    --no-run)       RUN_PIPELINE=false ;;
    --drain)        DRAIN=true ;;
    --status)       STATUS_ONLY=true ;;
    --refresh)      REFRESH_ONLY=true ;;
    --connection=*) SNOW_CONN="--connection ${arg#*=}" ;;
    --help|-h)      sed -n '5,/^# ===/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*)             echo "Unknown flag: $arg (use --help)"; exit 1 ;;
    *)              SRC="$arg" ;;
  esac
done

if [ -z "$SNOW_CONN" ] && [ -n "${SNOW_CONNECTION:-}" ]; then
  SNOW_CONN="--connection ${SNOW_CONNECTION}"
fi
# Same connection, in the form to show in printed hints
CONN_HINT="${SNOW_CONN/--connection /--connection=}"

sf() { snow sql --role "$ROLE" $SNOW_CONN -q "$1"; }

# Values of a one-row query, space-separated, or empty on error
sfv() {
  snow sql --role "$ROLE" $SNOW_CONN --format json -q "$1" 2>/dev/null | python3 -c '
import json, sys
try:
    d = json.load(sys.stdin)
    while isinstance(d, list) and d and isinstance(d[0], list):
        d = d[-1]
    print(" ".join(str(v) for v in d[0].values()) if d else "")
except Exception:
    print("")
' || true
}

show_status() {
  sf "SELECT ingestion_status, COUNT(*) AS files
      FROM DOC_INTEL.DATA.ingestion_registry
      GROUP BY ingestion_status ORDER BY ingestion_status"
  echo "  PENDING/PROCESSING files are still working. COMPLETE files are processed."
  echo "  The catalog and search refresh hourly. To see COMPLETE files in the app now:"
  echo "    ./scripts/upload_docs.sh --refresh ${CONN_HINT}"
}

refresh_now() {
  echo "=== Refreshing catalog and search"
  sf "ALTER DYNAMIC TABLE DOC_INTEL.DATA.overrides_pivoted REFRESH" > /dev/null
  sf "ALTER DYNAMIC TABLE DOC_INTEL.DATA.document_catalog REFRESH" > /dev/null
  sf "ALTER CORTEX SEARCH SERVICE DOC_INTEL.SERVICES.doc_search_svc REFRESH" > /dev/null
  sf "ALTER CORTEX SEARCH SERVICE DOC_INTEL.SERVICES.doc_page_search_svc REFRESH" > /dev/null
  echo "  Done. Reload the app."
}

# Start a run, wait for it to finish, and repeat while files are waiting.
# Each run takes up to batch_size documents (100 by default).
drain() {
  echo "=== Processing every waiting file, one run after another"
  local first=true last=-1 stalls=0 pending running
  while true; do
    read -r pending running <<< "$(sfv "SELECT
        (SELECT COUNT(*) FROM DOC_INTEL.DATA.ingestion_registry WHERE ingestion_status = 'PENDING'),
        (SELECT COUNT(*) FROM TABLE(DOC_INTEL.INFORMATION_SCHEMA.CURRENT_TASK_GRAPHS(ROOT_TASK_NAME => 'TASK_01_REGISTER_FILES'))
         WHERE state = 'EXECUTING' AND database_name = 'DOC_INTEL')")" || true
    if ! [[ "$pending" =~ ^[0-9]+$ && "$running" =~ ^[0-9]+$ ]]; then
      echo "  Could not read the pipeline state. Check with: ./scripts/upload_docs.sh --status ${CONN_HINT}"
      return 1
    fi
    if [ "$running" -gt 0 ]; then
      echo "  $(date +%H:%M) Run in progress; ${pending} file(s) waiting"
      sleep 60
      continue
    fi
    if [ "$first" = false ] && [ "$pending" -eq 0 ]; then
      echo "  No files waiting."
      break
    fi
    if [ "$pending" -eq "$last" ]; then stalls=$((stalls + 1)); else stalls=0; fi
    if [ "$stalls" -ge 2 ]; then
      echo "  Stopped: the last two runs left the same ${pending} file(s) waiting. See --status and the Operations Guide."
      return 1
    fi
    last=$pending
    first=false
    echo "  $(date +%H:%M) Starting a run; ${pending} file(s) waiting"
    sf "EXECUTE TASK DOC_INTEL.DATA.task_01_register_files" > /dev/null
    sleep 60
  done
  refresh_now
}

if [ "$REFRESH_ONLY" = true ]; then
  refresh_now
  exit 0
fi

if [ "$STATUS_ONLY" = true ]; then
  show_status
  exit 0
fi

if [ "$DRAIN" = true ] && [ "$RUN_PIPELINE" = false ]; then
  echo "ERROR: --drain and --no-run can't be used together."
  exit 1
fi

if [ "$DRAIN" = true ] && [ -z "$SRC" ]; then
  sf "ALTER STAGE DOC_INTEL.DATA.doc_stage REFRESH" > /dev/null
  drain
  exit $?
fi

if [ -z "$SRC" ] || [ ! -e "$SRC" ]; then
  echo "ERROR: give a folder or file that exists. Example: ./scripts/upload_docs.sh ~/Documents/contracts"
  exit 1
fi

# --- Upload ---
echo "=== Uploading to ${STAGE}/"
COUNT=0
SKIPPED=0
upload_one() {
  local file="$1" rel_dir="$2"
  local dest="${STAGE}/"
  [ -n "$rel_dir" ] && [ "$rel_dir" != "." ] && dest="${STAGE}/${rel_dir}/"
  echo "  -> ${file}"
  snow stage copy "$file" "$dest" --overwrite --role "$ROLE" $SNOW_CONN > /dev/null
  COUNT=$((COUNT + 1))
}

is_supported() {
  local lower
  lower=$(echo "$1" | tr 'A-Z' 'a-z')
  case "$lower" in
    *.pdf|*.docx|*.pptx|*.tif|*.tiff|*.jpg|*.jpeg|*.png|*.html|*.txt) return 0 ;;
    *) return 1 ;;
  esac
}

if [ -f "$SRC" ]; then
  if is_supported "$SRC"; then upload_one "$SRC" ""; else SKIPPED=1; fi
else
  BASE="$(cd "$SRC" && pwd)"
  while IFS= read -r -d '' file; do
    if is_supported "$file"; then
      rel="${file#"$BASE"/}"
      upload_one "$file" "$(dirname "$rel")"
    else
      SKIPPED=$((SKIPPED + 1))
    fi
  done < <(find "$BASE" -type f ! -name '.*' -print0)
fi

echo "  Uploaded ${COUNT} file(s); skipped ${SKIPPED} unsupported file(s)."
if [ "$COUNT" -eq 0 ]; then
  exit 1
fi

# --- Start the pipeline now instead of waiting for the schedule ---
sf "ALTER STAGE DOC_INTEL.DATA.doc_stage REFRESH" > /dev/null
if [ "$DRAIN" = true ]; then
  drain
elif [ "$RUN_PIPELINE" = true ]; then
  echo "=== Starting the pipeline (register -> parse -> classify -> extract)"
  sf "EXECUTE TASK DOC_INTEL.DATA.task_01_register_files" > /dev/null
  echo "  Started. Check progress with: ./scripts/upload_docs.sh --status ${CONN_HINT}"
  BATCH=$(sfv "SELECT config_value FROM DOC_INTEL.ADMIN.system_config WHERE config_key = 'batch_size'")
  [[ "$BATCH" =~ ^[0-9]+$ ]] || BATCH=100
  if [ "$COUNT" -gt "$BATCH" ]; then
    echo "  One run handles ${BATCH} documents. To process all ${COUNT} now, run:"
    echo "    ./scripts/upload_docs.sh --drain ${CONN_HINT}"
    echo "  Otherwise the rest wait for scheduled runs (${BATCH} per run)."
  fi
else
  echo "  Pipeline not started (--no-run). The next scheduled run picks the files up."
fi
