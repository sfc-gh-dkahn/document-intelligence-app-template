#!/bin/bash
# =============================================================================
# DOC_INTEL: Rename the Snowflake objects this template creates
# =============================================================================
# Usage:
#   ./scripts/rename.sh --prefix=ACME_DOCS --dry-run     Show what would change
#   ./scripts/rename.sh --prefix=ACME_DOCS               Rewrite every file
#
# Optional overrides (defaults are <PREFIX>_ADMIN, <PREFIX>_USER, ...):
#   --admin-role=NAME  --user-role=NAME  --pipeline-role=NAME
#
# What changes (current names come from config/deploy.config):
#   database            DOC_INTEL            -> <PREFIX>
#   roles               DOC_INTEL_ADMIN/...  -> <PREFIX>_ADMIN, _USER, _PIPELINE
#   warehouses          DOC_INTEL_WH, ...    -> <PREFIX>_WH, <PREFIX>_QUERY_WH
#   compute pool        DOC_MONITOR_POOL     -> <PREFIX>_POOL
#   integration, rule   DOC_INTEL_EGRESS_*   -> <PREFIX>_EGRESS_EAI, _EGRESS_RULE
#   app service         DOC_INTEL_APP        -> <PREFIX>_APP
#
# Only exact, whole names change, in sql/, app/, config/, scripts, docs, and
# the Cortex Code skill. App-role names (Administrator, Analyst, ...) are not touched;
# edit those in config/roles.csv or the User Management tab.
#
# Run this before your first deploy. If the app is already deployed, run
# quickstart.sh again to set up a separate copy under the new names; the old copy stays.
# Use git (git diff / git checkout .) to review or undo the file changes.
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
source "${ROOT}/config/deploy.config"

PREFIX=""
ADMIN_ROLE=""
USER_ROLE=""
PIPELINE_ROLE=""
DRY_RUN=false

for arg in "$@"; do
  case $arg in
    --prefix=*)        PREFIX="${arg#*=}" ;;
    --admin-role=*)    ADMIN_ROLE="${arg#*=}" ;;
    --user-role=*)     USER_ROLE="${arg#*=}" ;;
    --pipeline-role=*) PIPELINE_ROLE="${arg#*=}" ;;
    --dry-run)         DRY_RUN=true ;;
    --help|-h)         sed -n "2,30p" "$0" | grep "^#" | sed 's/^# *//'; exit 0 ;;
    *)                 echo "Unknown flag: $arg (use --help)"; exit 1 ;;
  esac
done

if [ -z "$PREFIX" ]; then
  echo "ERROR: --prefix is required. Example: ./scripts/rename.sh --prefix=ACME_DOCS --dry-run"
  exit 1
fi

upper() { echo "$1" | tr 'a-z' 'A-Z'; }
PREFIX=$(upper "$PREFIX")
ADMIN_ROLE=$(upper "${ADMIN_ROLE:-${PREFIX}_ADMIN}")
USER_ROLE=$(upper "${USER_ROLE:-${PREFIX}_USER}")
PIPELINE_ROLE=$(upper "${PIPELINE_ROLE:-${PREFIX}_PIPELINE}")

valid() { [[ "$1" =~ ^[A-Z][A-Z0-9_]{0,200}$ ]]; }
for n in "$PREFIX" "$ADMIN_ROLE" "$USER_ROLE" "$PIPELINE_ROLE"; do
  if ! valid "$n"; then
    echo "ERROR: '$n' is not a valid name. Use letters, digits, and underscores, starting with a letter."
    exit 1
  fi
done

# old|new pairs. Old names come from deploy.config so the script can run again.
PAIRS=(
  "${DOC_INTEL_DATABASE}|${PREFIX}"
  "${DOC_INTEL_ADMIN_ROLE}|${ADMIN_ROLE}"
  "${DOC_INTEL_USER_ROLE}|${USER_ROLE}"
  "${DOC_INTEL_PIPELINE_ROLE}|${PIPELINE_ROLE}"
  "${DOC_INTEL_QUERY_WAREHOUSE}|${PREFIX}_QUERY_WH"
  "${DOC_INTEL_PIPELINE_WH}|${PREFIX}_WH"
  "${DOC_INTEL_COMPUTE_POOL}|${PREFIX}_POOL"
  "${DOC_INTEL_EAI}|${PREFIX}_EGRESS_EAI"
  "${DOC_INTEL_NETWORK_RULE}|${PREFIX}_EGRESS_RULE"
  "${DOC_INTEL_APP_NAME}|${PREFIX}_APP"
)

# Refuse a mapping where a new name equals a different old name; the rewrite
# would merge two objects into one. Also refuse if config is missing a name.
OLD_NAMES=" "
for p in "${PAIRS[@]}"; do
  if [ -z "${p%%|*}" ]; then
    echo "ERROR: config/deploy.config is missing an object name (pair: '$p'). Restore it from git and retry."
    exit 1
  fi
  OLD_NAMES+="${p%%|*} "
done
for p in "${PAIRS[@]}"; do
  old="${p%%|*}"; new="${p#*|}"
  if [ "$old" != "$new" ] && [[ "$OLD_NAMES" == *" $new "* ]]; then
    echo "ERROR: new name $new is already used by another object. Pick a different prefix."
    exit 1
  fi
done

# Text files to rewrite (skip dependencies, build output, git, binaries).
FILES=()
while IFS= read -r -d '' f; do FILES+=("$f"); done < <(
  cd "$ROOT" && find . -type f \
    -not -path './.git/*' -not -path '*/node_modules/*' -not -path '*/.next/*' \
    -not -name 'package-lock.json' -not -name '*.min.mjs' -not -name '*.zip' \
    -not -name '*.png' -not -name '*.jpg' -not -name '*.pdf' -not -name '*.ico' \
    -print0
)

echo "=== Rename plan"
for p in "${PAIRS[@]}"; do printf "  %-28s -> %s\n" "${p%%|*}" "${p#*|}"; done

# Perl script: exact whole-word swaps in one pass, so new names never get
# swapped again.
PERL_MAP=""
for p in "${PAIRS[@]}"; do PERL_MAP+="'${p%%|*}' => '${p#*|}', "; done
PERL="my %m = (${PERL_MAP}); my \$re = join('|', map { quotemeta } sort { length(\$b) <=> length(\$a) } keys %m); s/(?<![A-Za-z0-9_])(\$re)(?![A-Za-z0-9_])/\$m{\$1}/g;"

CHANGED=0
for f in "${FILES[@]}"; do
  path="${ROOT}/${f#./}"
  grep -Iq . "$path" 2>/dev/null || continue   # skip binary/empty
  n=$(perl -0777 -ne "my \$t = \$_; ${PERL} print(\$t eq \$_ ? 0 : 1);" "$path")
  if [ "$n" = "1" ]; then
    CHANGED=$((CHANGED + 1))
    if [ "$DRY_RUN" = true ]; then
      echo "  would change: ${f#./}"
    else
      perl -pi -e "${PERL}" "$path"
    fi
  fi
done

echo ""
if [ "$DRY_RUN" = true ]; then
  echo "  ${CHANGED} file(s) would change. Re-run without --dry-run to apply."
else
  echo "  Rewrote ${CHANGED} file(s). Review with: git diff --stat"
  echo "  Next: ./quickstart.sh /path/to/your/documents"
fi
