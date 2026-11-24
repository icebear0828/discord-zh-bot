#!/usr/bin/env bash
set -euo pipefail

STRICT_MODE=0
TARGET_DIR="."

for arg in "$@"; do
  case "$arg" in
    --strict)
      STRICT_MODE=1
      ;;
    -h|--help)
      echo "Usage: $(basename "$0") [target_dir] [--strict]"
      echo "Read-only guardrail scan for discord-zh-bot."
      exit 0
      ;;
    *)
      TARGET_DIR="$arg"
      ;;
  esac
done

if [ ! -d "$TARGET_DIR" ]; then
  echo "[ERROR] Target directory not found: $TARGET_DIR" >&2
  exit 2
fi

TARGET_DIR="$(cd "$TARGET_DIR" && pwd)"
FAIL_COUNT=0
WARN_COUNT=0
PASS_COUNT=0

print_hits() {
  local hits="$1"
  local max_lines="${2:-20}"
  local total
  total="$(printf '%s\n' "$hits" | sed '/^$/d' | wc -l | tr -d ' ')"
  printf '%s\n' "$hits" | sed '/^$/d' | head -n "$max_lines" | sed 's/^/  - /'
  if [ "$total" -gt "$max_lines" ]; then
    echo "  ... ($((total - max_lines)) more line(s) omitted)"
  fi
}

echo "=== Discord Bot Guardrails Static Check ==="
echo "Target: $TARGET_DIR"
echo ""

# ---------------------------------------------------------------------------
# Check 1: Zero explicit TypeScript `any` in src/ and tests/
# ---------------------------------------------------------------------------
ANY_PATHS=()
[ -d "$TARGET_DIR/src" ] && ANY_PATHS+=("$TARGET_DIR/src")
[ -d "$TARGET_DIR/tests" ] && ANY_PATHS+=("$TARGET_DIR/tests")

if [ "${#ANY_PATHS[@]}" -eq 0 ]; then
  echo "[WARN] Check 1 (zero-any): Neither src/ nor tests/ found under $TARGET_DIR"
  WARN_COUNT=$((WARN_COUNT + 1))
else
  ANY_HITS="$(
    grep -rnE --include='*.ts' '(:[[:space:]]*any([^A-Za-z0-9_]|$)|[^A-Za-z0-9_]as[[:space:]]+any([^A-Za-z0-9_]|$)|<any>|Array<any>)' "${ANY_PATHS[@]}" 2>/dev/null \
      | grep -vE ':[0-9]+:[[:space:]]*(//|\*)' \
      || true
  )"
  if [ -z "$ANY_HITS" ]; then
    echo "[PASS] Check 1 (zero-any): No explicit TypeScript 'any' found in src/ and tests/"
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    echo "[FAIL] Check 1 (zero-any): Found explicit TypeScript 'any' usages:"
    print_hits "$ANY_HITS" 20
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
fi

# ---------------------------------------------------------------------------
# Check 2: Hardcoded currency ('星币') or timezone ('北京时间') in src/
# Excludes defaults.ts, schema.ts, migrations, and tests/
# ---------------------------------------------------------------------------
if [ ! -d "$TARGET_DIR/src" ]; then
  echo "[WARN] Check 2 (hardcoded-config): src/ directory not found"
  WARN_COUNT=$((WARN_COUNT + 1))
else
  HARDCODE_HITS="$(
    grep -rnE --include='*.ts' '(星币|北京时间)' "$TARGET_DIR/src" 2>/dev/null \
      | grep -vE '(/src/config/defaults\.ts:|/src/db/schema\.ts:|/src/db/migrations/)' \
      | grep -vE ':[0-9]+:[[:space:]]*(//|\*)' \
      || true
  )"
  if [ -z "$HARDCODE_HITS" ]; then
    echo "[PASS] Check 2 (hardcoded-config): No hardcoded currency/timezone literals found outside defaults/migrations"
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    echo "[WARN] Check 2 (hardcoded-config): Potential hardcoded currency or timezone literals found:"
    print_hits "$HARDCODE_HITS" 25
    WARN_COUNT=$((WARN_COUNT + 1))
  fi
fi

# ---------------------------------------------------------------------------
# Check 3: Duplicate local helper definitions in menuHandler.ts vs menuHelpers.ts
# ---------------------------------------------------------------------------
HELPERS_FILE="$TARGET_DIR/src/interactions/menuHelpers.ts"
HANDLER_FILE="$TARGET_DIR/src/interactions/menuHandler.ts"

if [ ! -f "$HELPERS_FILE" ] || [ ! -f "$HANDLER_FILE" ]; then
  echo "[WARN] Check 3 (duplicate-helpers): menuHelpers.ts or menuHandler.ts not found"
  WARN_COUNT=$((WARN_COUNT + 1))
else
  EXPORTED_HELPER_NAMES="$(
    sed -nE 's/^export[[:space:]]+(async[[:space:]]+)?function[[:space:]]+([A-Za-z0-9_]+)[[:space:]]*\(.*/\2/p' "$HELPERS_FILE" \
      | sort -u
  )"
  DUP_HITS=""
  while IFS= read -r fn_name; do
    [ -z "$fn_name" ] && continue
    match="$(grep -nE "^(export[[:space:]]+)?(async[[:space:]]+)?function[[:space:]]+${fn_name}[[:space:]]*\(" "$HANDLER_FILE" || true)"
    if [ -n "$match" ]; then
      DUP_HITS+="${HANDLER_FILE}:${match}"$'\n'
    fi
  done <<< "$EXPORTED_HELPER_NAMES"

  if [ -z "$DUP_HITS" ]; then
    echo "[PASS] Check 3 (duplicate-helpers): No duplicate menuHelpers functions defined in menuHandler.ts"
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    echo "[WARN] Check 3 (duplicate-helpers): Local functions in menuHandler.ts duplicate exports from menuHelpers.ts:"
    print_hits "$DUP_HITS" 25
    WARN_COUNT=$((WARN_COUNT + 1))
  fi
fi

# ---------------------------------------------------------------------------
# Check 4: Global batch expireDue*( calls inside src/interactions/
# ---------------------------------------------------------------------------
INTERACTIONS_DIR="$TARGET_DIR/src/interactions"
if [ ! -d "$INTERACTIONS_DIR" ]; then
  echo "[WARN] Check 4 (no-batch-expire): src/interactions/ not found"
  WARN_COUNT=$((WARN_COUNT + 1))
else
  EXPIRE_HITS="$(
    grep -rnE --include='*.ts' 'expireDue([A-Z][A-Za-z0-9_]*)?[[:space:]]*\(' "$INTERACTIONS_DIR" 2>/dev/null \
      | grep -vE ':[0-9]+:[[:space:]]*(//|\*)' \
      || true
  )"
  if [ -z "$EXPIRE_HITS" ]; then
    echo "[PASS] Check 4 (no-batch-expire): No global expireDue*() calls found in src/interactions/"
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    echo "[WARN] Check 4 (no-batch-expire): Global expireDue*() calls found in src/interactions/ (use single-ID expiry instead):"
    print_hits "$EXPIRE_HITS" 20
    WARN_COUNT=$((WARN_COUNT + 1))
  fi
fi

echo ""
echo "=== Summary: PASS=$PASS_COUNT WARN=$WARN_COUNT FAIL=$FAIL_COUNT ==="

if [ "$FAIL_COUNT" -gt 0 ]; then
  exit 1
fi
if [ "$STRICT_MODE" -eq 1 ] && [ "$WARN_COUNT" -gt 0 ]; then
  exit 1
fi
exit 0
