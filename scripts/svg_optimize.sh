#!/usr/bin/env bash
set -euo pipefail

# ── Parse arguments ────────────────────────────────────────────────────────────
INPUT=""
PRECISION=3
REMOVE_COMMENTS="true"
REMOVE_METADATA="true"
CLEANUP_IDS="true"
MERGE_PATHS="true"
INLINE_STYLES="false"
PRETTY_PRINT="false"

for arg in "$@"; do
  case $arg in
    --input=*)          INPUT="${arg#*=}" ;;
    --precision=*)      PRECISION="${arg#*=}" ;;
    --removeComments=*) REMOVE_COMMENTS="${arg#*=}" ;;
    --removeMetadata=*) REMOVE_METADATA="${arg#*=}" ;;
    --cleanupIds=*)     CLEANUP_IDS="${arg#*=}" ;;
    --mergePaths=*)     MERGE_PATHS="${arg#*=}" ;;
    --inlineStyles=*)   INLINE_STYLES="${arg#*=}" ;;
    --prettyPrint=*)    PRETTY_PRINT="${arg#*=}" ;;
    *) echo "Unknown argument: $arg" ;;
  esac
done

if [ -z "$INPUT" ]; then
  echo "Error: --input is required" >&2; exit 1
fi

if ! command -v svgo &>/dev/null; then
  echo "Error: svgo not found — install with: npm install -g svgo" >&2; exit 1
fi

# ── Build svgo JSON config (svgo v4 API) ───────────────────────────────────────
# Build overrides: only add entries for plugins we want to DISABLE (false)
# or enable outside preset-default
OVERRIDES=""
[ "$REMOVE_COMMENTS" = "false" ] && OVERRIDES="${OVERRIDES}\"removeComments\": false, "
[ "$REMOVE_METADATA" = "false" ] && OVERRIDES="${OVERRIDES}\"removeMetadata\": false, "
[ "$CLEANUP_IDS"     = "false" ] && OVERRIDES="${OVERRIDES}\"cleanupIds\": false, "
[ "$MERGE_PATHS"     = "false" ] && OVERRIDES="${OVERRIDES}\"mergePaths\": false, "
[ "$INLINE_STYLES"   = "true"  ] && OVERRIDES="${OVERRIDES}\"inlineStyles\": {}, "
OVERRIDES="${OVERRIDES%, }"  # strip trailing comma+space

JS2SVG=""
[ "$PRETTY_PRINT" = "true" ] && JS2SVG='js2svg: { pretty: true, indent: 2 },'

CONFIG_FILE=$(mktemp /tmp/svgo-config-XXXX.mjs)
cat > "$CONFIG_FILE" <<EOF
export default {
  ${JS2SVG}
  plugins: [
    {
      name: "preset-default",
      params: {
        floatPrecision: ${PRECISION},
        overrides: { ${OVERRIDES} }
      }
    }
  ]
};
EOF

echo "svgo $(svgo --version 2>/dev/null || echo '')"
echo "Precision: $PRECISION  |  Comments: $REMOVE_COMMENTS  |  Metadata: $REMOVE_METADATA  |  IDs: $CLEANUP_IDS  |  Merge paths: $MERGE_PATHS"
echo ""

total=0
saved_bytes=0

optimize_file() {
  local src="$1"
  local dst="$2"
  local orig
  orig=$(stat -f%z "$src" 2>/dev/null || echo 0)

  svgo --config="$CONFIG_FILE" -i "$src" -o "$dst" --quiet

  local result
  result=$(stat -f%z "$dst" 2>/dev/null || echo 0)
  local reduction=0
  [ "$orig" -gt 0 ] && reduction=$(echo "scale=1; (1 - $result / $orig) * 100" | bc)
  local orig_kb result_kb
  orig_kb=$(echo "scale=1; $orig / 1024" | bc)
  result_kb=$(echo "scale=1; $result / 1024" | bc)

  echo "✓ $(basename "$dst")  ${orig_kb}KB → ${result_kb}KB (-${reduction}%)"
  saved_bytes=$((saved_bytes + orig - result))
  total=$((total + 1))
}

if [ -f "$INPUT" ]; then
  DIR=$(dirname "$INPUT")
  NAME=$(basename "$INPUT" .svg)
  optimize_file "$INPUT" "$DIR/${NAME}_opt.svg"

elif [ -d "$INPUT" ]; then
  OUT_DIR="${INPUT%/}/optimized"
  mkdir -p "$OUT_DIR"
  echo "Output: $OUT_DIR"
  echo ""

  shopt -s nullglob
  files=("$INPUT"/*.svg "$INPUT"/*.SVG)
  if [ ${#files[@]} -eq 0 ]; then
    echo "No SVG files found in $INPUT" >&2; exit 1
  fi

  for f in "${files[@]}"; do
    NAME=$(basename "$f" .svg)
    NAME=$(basename "$NAME" .SVG)
    optimize_file "$f" "$OUT_DIR/${NAME}.svg"
  done
fi

rm -f "$CONFIG_FILE"

echo ""
echo "Done — $total file(s) optimized"
[ "$saved_bytes" -gt 0 ] && echo "Total saved: $(echo "scale=1; $saved_bytes / 1024" | bc) KB"
