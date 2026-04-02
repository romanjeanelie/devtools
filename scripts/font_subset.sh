#!/usr/bin/env bash
set -euo pipefail

# ── Parse arguments ────────────────────────────────────────────────────────────
INPUT=""
FORMAT="woff2"
CHARS=""

for arg in "$@"; do
  case $arg in
    --input=*)  INPUT="${arg#*=}" ;;
    --format=*) FORMAT="${arg#*=}" ;;
    --chars=*)  CHARS="${arg#*=}" ;;
    *) echo "Unknown argument: $arg" ;;
  esac
done

if [ -z "$INPUT" ] || [ ! -f "$INPUT" ]; then
  echo "Error: valid --input font file required" >&2; exit 1
fi

if ! command -v pyftsubset &>/dev/null; then
  echo "Error: pyftsubset not found — install with: pip install fonttools brotli" >&2; exit 1
fi

if [ -z "$CHARS" ]; then
  echo "Error: no characters selected" >&2; exit 1
fi

BASENAME=$(basename "$INPUT" | sed 's/\.[^.]*$//')
OUTPUT="$(dirname "$INPUT")/${BASENAME}_subset.${FORMAT}"

echo "Input:   $INPUT"
echo "Format:  $FORMAT"
echo "Glyphs:  $(echo "$CHARS" | tr ',' '\n' | wc -l | tr -d ' ') selected"
echo ""

# ── Flavor flag ────────────────────────────────────────────────────────────────
FLAVOR_FLAG=()
[ "$FORMAT" != "ttf" ] && FLAVOR_FLAG=(--flavor="$FORMAT")

# ── Run pyftsubset with unicode codepoints ────────────────────────────────────
pyftsubset "$INPUT" \
  --unicodes="$CHARS" \
  "${FLAVOR_FLAG[@]}" \
  --output-file="$OUTPUT"

# ── Stats ──────────────────────────────────────────────────────────────────────
ORIGINAL=$(stat -f%z "$INPUT"  2>/dev/null || echo 0)
RESULT=$(stat -f%z   "$OUTPUT" 2>/dev/null || echo 0)

if [ "$ORIGINAL" -gt 0 ] && [ "$RESULT" -gt 0 ]; then
  REDUCTION=$(echo "scale=1; (1 - $RESULT / $ORIGINAL) * 100" | bc)
  ORIG_KB=$(echo   "scale=1; $ORIGINAL / 1024" | bc)
  RESULT_KB=$(echo "scale=1; $RESULT   / 1024" | bc)
  echo "✓ ${ORIG_KB} KB → ${RESULT_KB} KB  (-${REDUCTION}%)"
fi

echo "Done! → $OUTPUT"
