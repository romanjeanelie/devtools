#!/usr/bin/env bash
set -euo pipefail

# ── Parse arguments ────────────────────────────────────────────────────────────
INPUT=""
MANIFEST="false"

for arg in "$@"; do
  case $arg in
    --input=*)    INPUT="${arg#*=}" ;;
    --manifest=*) MANIFEST="${arg#*=}" ;;
    *) echo "Unknown argument: $arg" ;;
  esac
done

if [ -z "$INPUT" ] || [ ! -f "$INPUT" ]; then
  echo "Error: valid --input file required" >&2; exit 1
fi

# ── Output directory ───────────────────────────────────────────────────────────
BASE_DIR="$(dirname "$INPUT")/favicon_pack"
OUT_DIR="$BASE_DIR"
COUNTER=2
while [ -d "$OUT_DIR" ]; do
  OUT_DIR="${BASE_DIR}_${COUNTER}"
  COUNTER=$((COUNTER + 1))
done
mkdir -p "$OUT_DIR"

echo "Input:  $INPUT"
echo "Output: $OUT_DIR"
echo ""

# ── SVG → PNG (512px source) ──────────────────────────────────────────────────
EXT="$(printf '%s' "${INPUT##*.}" | tr '[:upper:]' '[:lower:]')"
SOURCE_PNG="/tmp/favicon_source_$$.png"

if [[ "$EXT" == "svg" ]]; then
  echo "▶  Converting SVG → PNG (512px)…"
  if command -v rsvg-convert &>/dev/null; then
    rsvg-convert -w 512 -h 512 "$INPUT" -o "$SOURCE_PNG"
  elif command -v inkscape &>/dev/null; then
    inkscape --export-filename="$SOURCE_PNG" --export-width=512 --export-height=512 "$INPUT" 2>/dev/null
  else
    # macOS Quick Look fallback (works on macOS 12+)
    qlmanage -t -s 512 -o /tmp/ "$INPUT" 2>/dev/null
    mv "/tmp/$(basename "$INPUT").png" "$SOURCE_PNG"
  fi
  echo "   ✓ Converted"
  cp "$INPUT" "$OUT_DIR/favicon.svg"
  echo "   ✓ favicon.svg"
else
  cp "$INPUT" "$SOURCE_PNG"
fi

# ── Generate PNG sizes ─────────────────────────────────────────────────────────
echo "▶  Generating PNG sizes…"

generate() {
  local size=$1 name=$2
  sips -Z "$size" "$SOURCE_PNG" --out "$OUT_DIR/$name" >/dev/null 2>&1
  echo "   ✓ $name (${size}×${size})"
}

generate 16  "favicon-16x16.png"
generate 32  "favicon-32x32.png"
generate 48  "favicon-48x48.png"
generate 96  "favicon-96x96.png"
generate 180 "apple-touch-icon.png"
generate 192 "android-chrome-192x192.png"
generate 512 "android-chrome-512x512.png"

# ── favicon.ico (16 + 32 + 48 combined) ───────────────────────────────────────
echo "▶  Generating favicon.ico…"
ffmpeg \
  -i "$OUT_DIR/favicon-16x16.png" \
  -i "$OUT_DIR/favicon-32x32.png" \
  -i "$OUT_DIR/favicon-48x48.png" \
  "$OUT_DIR/favicon.ico" -y 2>/dev/null
echo "   ✓ favicon.ico"

# ── site.webmanifest ───────────────────────────────────────────────────────────
if [ "$MANIFEST" = "true" ]; then
  echo "▶  Generating site.webmanifest…"
  cat > "$OUT_DIR/site.webmanifest" << 'EOF'
{
  "name": "",
  "short_name": "",
  "icons": [
    { "src": "/android-chrome-192x192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/android-chrome-512x512.png", "sizes": "512x512", "type": "image/png" }
  ],
  "theme_color": "#ffffff",
  "background_color": "#ffffff",
  "display": "standalone"
}
EOF
  echo "   ✓ site.webmanifest"
fi

rm -f "$SOURCE_PNG"
echo ""
echo "Done! Output: $OUT_DIR"
