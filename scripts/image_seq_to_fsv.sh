#!/usr/bin/env bash
set -euo pipefail

# ──────────────────────────────────────────────────────────────────────────────
#  Image Sequence → AFRAME (.fsv)
#
#  Pipeline inspired by @plutotcool/fsv (https://github.com/plutotcool/fsv):
#    1. Encode the image sequence as a temporary WebM VP9 with alpha (yuva420p)
#    2. Run `fsv convert --alpha --input-codec=libvpx-vp9` → optimized .fsv
# ──────────────────────────────────────────────────────────────────────────────

INPUT=""
FPS=30
QUALITY=20
GOP=5
ALPHA=true
OUTPUT_DIR=""
DEBUG=false

# Export targets
EXPORT_DESKTOP=false
DESKTOP_WIDTH=1920

EXPORT_MOBILE=false
MOBILE_WIDTH=750

for arg in "$@"; do
  case $arg in
    --input=*)         INPUT="${arg#*=}" ;;
    --fps=*)           FPS="${arg#*=}" ;;
    --quality=*)       QUALITY="${arg#*=}" ;;
    --gop=*)           GOP="${arg#*=}" ;;
    --alpha=*)         ALPHA="${arg#*=}" ;;
    --outputDir=*)     OUTPUT_DIR="${arg#*=}" ;;
    --debug=*)         DEBUG="${arg#*=}" ;;
    
    --exportDesktop=*) EXPORT_DESKTOP="${arg#*=}" ;;
    --desktopWidth=*)  DESKTOP_WIDTH="${arg#*=}" ;;
    
    --exportMobile=*)  EXPORT_MOBILE="${arg#*=}" ;;
    --mobileWidth=*)   MOBILE_WIDTH="${arg#*=}" ;;
    
    *) echo "Unknown argument: $arg" ;;
  esac
done

if [ -z "$INPUT" ]; then
  echo "Error: --input is required" >&2
  exit 1
fi

if [ ! -d "$INPUT" ]; then
  echo "Error: folder not found: $INPUT" >&2
  exit 1
fi

# ── Collect source frames ─────────────────────────────────────────────────────
shopt -s nullglob
IMAGES=("$INPUT"/*.{png,PNG,jpg,JPG,jpeg,JPEG,webp,WEBP})
shopt -u nullglob
if [ ${#IMAGES[@]} -eq 0 ]; then
  echo "Error: no PNG/JPG/JPEG/WebP images found in $INPUT" >&2
  exit 1
fi

FIRST_FILE=$(basename "${IMAGES[0]}")
EXT="${FIRST_FILE##*.}"
TEMP_SEQ_DIR=$(mktemp -d "${INPUT%/}/_seq_tmp_XXXX")
INDEX=1
for img in "${IMAGES[@]}"; do
  ln -s "${img}" "${TEMP_SEQ_DIR}/frame_$(printf '%05d' "$INDEX").${EXT}" 2>/dev/null \
    || cp "${img}" "${TEMP_SEQ_DIR}/frame_$(printf '%05d' "$INDEX").${EXT}"
  INDEX=$((INDEX + 1))
done

SEQ_PATTERN="frame_%05d.${EXT}"

# ── Output path (auto-increment) ──────────────────────────────────────────────
if [ -n "$OUTPUT_DIR" ]; then
  OUT_DIR="$OUTPUT_DIR"
  mkdir -p "$OUT_DIR"
else
  OUT_DIR="$(dirname "$INPUT")"
fi

FOLDER_NAME="$(basename "$INPUT")"
# Create output folder for all variants
OUTPUT_FOLDER="${OUT_DIR}/${FOLDER_NAME}_fsv"
COUNTER=2
while [ -d "$OUTPUT_FOLDER" ]; do
  OUTPUT_FOLDER="${OUT_DIR}/${FOLDER_NAME}_fsv_${COUNTER}"
  COUNTER=$((COUNTER + 1))
done
mkdir -p "$OUTPUT_FOLDER"
BASE_OUT="${OUTPUT_FOLDER}/${FOLDER_NAME}"

# ── Temporary intermediate WebM (VP9 + alpha) ─────────────────────────────────
TMP_WEBM=$(mktemp -t fsv_intermediate_XXXX).webm

cleanup() {
  [ -n "${TEMP_SEQ_DIR:-}" ] && [ -d "$TEMP_SEQ_DIR" ] && rm -rf "$TEMP_SEQ_DIR"
  [ -n "${TMP_WEBM:-}" ]     && [ -f "$TMP_WEBM" ]     && rm -f  "$TMP_WEBM"
}
trap cleanup EXIT

echo "Input folder:   $INPUT"
echo "Frames:         ${#IMAGES[@]}"
echo "FPS:            ${FPS}"
echo "Quality (CRF):  ${QUALITY}"
echo "GOP:            ${GOP}"
echo "Alpha:          ${ALPHA}"
echo ""
echo "Exports:"
[ "$EXPORT_DESKTOP" = "true" ] && echo "  • Desktop: ${DESKTOP_WIDTH}px (h265 + h264)"
[ "$EXPORT_MOBILE" = "true" ]  && echo "  • Mobile:  ${MOBILE_WIDTH}px (h264)"
echo ""

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# ── Ensure Node ≥ 24 (fsv uses `await using`, requires Node 24+) ──────────────
NODE_BIN="$(command -v node || true)"
NODE_MAJOR=0
if [ -n "$NODE_BIN" ]; then
  NODE_MAJOR="$("$NODE_BIN" -p "process.versions.node.split('.')[0]" 2>/dev/null || echo 0)"
fi

if [ "$NODE_MAJOR" -lt 24 ]; then
  echo "  ℹ  Current node is v${NODE_MAJOR}.x, fsv needs ≥ 24 — looking up nvm…"
  # Try sourcing nvm and picking a suitable node
  NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  if [ -s "$NVM_DIR/nvm.sh" ]; then
    # shellcheck disable=SC1091
    . "$NVM_DIR/nvm.sh"
    if nvm use 24 >/dev/null 2>&1 || nvm use default >/dev/null 2>&1; then
      NODE_BIN="$(command -v node)"
      NODE_MAJOR="$("$NODE_BIN" -p "process.versions.node.split('.')[0]")"
      echo "  ✓  Using node $("$NODE_BIN" --version) via nvm"
    fi
  fi
fi

if [ "$NODE_MAJOR" -lt 24 ]; then
  echo "Error: fsv requires Node ≥ 24 (current: $("$NODE_BIN" --version 2>/dev/null || echo none))." >&2
  echo "       Install with: nvm install 24 && nvm alias default 24" >&2
  exit 1
fi

# ── Function: encode one variant ──────────────────────────────────────────────
encode_variant() {
  local VARIANT_NAME="$1"
  local MAX_WIDTH="$2"
  local CODEC="$3"
  
  # Simple naming: desktop-H265.fsv, desktop-H264.fsv, mobile.fsv
  if [ "$VARIANT_NAME" = "desktop" ]; then
    local OUTPUT_FILE="${OUTPUT_FOLDER}/desktop-H265.fsv"
  elif [ "$VARIANT_NAME" = "safari" ]; then
    local OUTPUT_FILE="${OUTPUT_FOLDER}/desktop-H264.fsv"
  else
    local OUTPUT_FILE="${OUTPUT_FOLDER}/${VARIANT_NAME}.fsv"
  fi
  
  echo ""
  echo "▶  Encoding ${VARIANT_NAME} (${MAX_WIDTH}px, ${CODEC})…"
  
  # Step 1: WebM intermediate
  if [ "$ALPHA" = "true" ]; then
    ffmpeg -y -hide_banner -loglevel warning -stats \
      -framerate "$FPS" \
      -i "$TEMP_SEQ_DIR/$SEQ_PATTERN" \
      -vf "scale='min(${MAX_WIDTH},iw)':-2:flags=lanczos,format=yuva420p" \
      -c:v libvpx-vp9 \
      -pix_fmt yuva420p \
      -auto-alt-ref 0 \
      -b:v 0 \
      -crf 18 \
      -deadline good \
      -cpu-used 2 \
      -an \
      "$TMP_WEBM"
  else
    ffmpeg -y -hide_banner -loglevel warning -stats \
      -framerate "$FPS" \
      -i "$TEMP_SEQ_DIR/$SEQ_PATTERN" \
      -vf "scale='min(${MAX_WIDTH},iw)':-2:flags=lanczos,format=yuv420p" \
      -c:v libvpx-vp9 \
      -pix_fmt yuv420p \
      -auto-alt-ref 0 \
      -b:v 0 \
      -crf 18 \
      -deadline good \
      -cpu-used 2 \
      -an \
      "$TMP_WEBM"
  fi
  
  # Step 2: fsv convert
  FSV_WRAPPER="$ROOT_DIR/scripts/fsv_convert.mjs"
  FSV_ARGS=(
    "$TMP_WEBM"
    "$OUTPUT_FILE"
    --input-codec=libvpx-vp9
    "--output-codec=${CODEC}"
    "--crf=${QUALITY}"
    "--gop=${GOP}"
  )
  [ "$ALPHA" = "true" ] && FSV_ARGS+=(--alpha)
  [ "$DEBUG" = "true" ] && FSV_ARGS+=(--debug)
  
  # Generate poster only for desktop (H265), preserving alpha channel
  if [ "$VARIANT_NAME" = "desktop" ]; then
    local POSTER_FILE="${OUTPUT_FOLDER}/poster.png"
    local POSTER_ARGS=(-y -hide_banner -loglevel error -c:v libvpx-vp9 -i "$TMP_WEBM" -vframes 1)
    [ "$ALPHA" = "true" ] && POSTER_ARGS+=(-pix_fmt rgba)
    POSTER_ARGS+=(-compression_level 9 "$POSTER_FILE")
    ffmpeg "${POSTER_ARGS[@]}"
    echo "  ✓  ${POSTER_FILE}"
  fi
  
  "$NODE_BIN" "$FSV_WRAPPER" "${FSV_ARGS[@]}"
  
  echo "  ✓  ${OUTPUT_FILE}"
}

# ── Run exports ────────────────────────────────────────────────────────────────
if [ "$EXPORT_DESKTOP" = "true" ]; then
  encode_variant "desktop" "$DESKTOP_WIDTH" "libx265"
  encode_variant "safari"  "$DESKTOP_WIDTH" "libx264"
fi

[ "$EXPORT_MOBILE" = "true" ] && encode_variant "mobile" "$MOBILE_WIDTH" "libx264"

echo ""
echo "✅ Done!"
echo ""
echo "Output folder: $OUTPUT_FOLDER"
