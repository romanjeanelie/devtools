#!/usr/bin/env bash
set -euo pipefail

# ── Parse arguments ────────────────────────────────────────────────────────────
INPUT=""
FPS=30
QUALITY=85
AF_MAX_WIDTH=1920
AF_CODEC="h264"
AF_GOP=5
AF_CRF=28
OUTPUT_DIR=""

for arg in "$@"; do
  case $arg in
    --input=*)       INPUT="${arg#*=}" ;;
    --fps=*)        FPS="${arg#*=}" ;;
    --quality=*)    QUALITY="${arg#*=}" ;;
    --afMaxWidth=*) AF_MAX_WIDTH="${arg#*=}" ;;
    --afCodec=*)    AF_CODEC="${arg#*=}" ;;
    --afGop=*)      AF_GOP="${arg#*=}" ;;
    --afCrf=*)      AF_CRF="${arg#*=}" ;;
    --outputDir=*)  OUTPUT_DIR="${arg#*=}" ;;
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

TEMP_SEQ_DIR=""
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

SEQ_DIR="$TEMP_SEQ_DIR"
SEQ_PATTERN="frame_%05d.${EXT}"
START_NUMBER=1

# ── Output path (auto-increment) ───────────────────────────────────────────────
if [ -n "$OUTPUT_DIR" ]; then
  OUT_DIR="$OUTPUT_DIR"
  mkdir -p "$OUT_DIR"
else
  OUT_DIR="$(dirname "$INPUT")"
fi

FOLDER_NAME="$(basename "$INPUT")"
BASE_OUT="${OUT_DIR}/${FOLDER_NAME}_mask"
OUT_FILE="${BASE_OUT}.mp4"
AF_FILE="${BASE_OUT}.af"
COUNTER=2
while [ -f "$OUT_FILE" ]; do
  OUT_FILE="${BASE_OUT}_${COUNTER}.mp4"
  AF_FILE="${BASE_OUT}_${COUNTER}.af"
  COUNTER=$((COUNTER + 1))
done

# ── Map quality (1–100) → CRF (15–35) ─────────────────────────────────────────
CRF=$(echo "scale=0; 35 - $QUALITY * 20 / 100" | bc)

echo "Input folder:  $INPUT"
echo "Frames:        ${#IMAGES[@]}"
echo "FPS:           ${FPS}"
echo "Quality:       ${QUALITY}  (CRF=${CRF})"
echo "Output:        $OUT_FILE"
echo "AF Output:     $AF_FILE"
echo ""

FILTER_COMPLEX="[0:v]split=2[rgb][alpha];[rgb]format=rgb24[rgbout];[alpha]alphaextract,format=gray[alphaout];[rgbout][alphaout]vstack=inputs=2"

cleanup() {
  if [ -n "$TEMP_SEQ_DIR" ] && [ -d "$TEMP_SEQ_DIR" ]; then
    rm -rf "$TEMP_SEQ_DIR"
  fi
}

trap cleanup EXIT

ffmpeg -framerate "$FPS" \
  -start_number "$START_NUMBER" \
  -i "$SEQ_DIR/$SEQ_PATTERN" \
  -filter_complex "$FILTER_COMPLEX" \
  -c:v libx264 \
  -crf "$CRF" \
  -preset slow \
  -pix_fmt yuv420p \
  -movflags +faststart \
  -progress pipe:1 \
  "$OUT_FILE"

echo ""
echo "▶  Generating .af (ActiveFrame)…"
node "$(dirname "$0")/af.js" "$OUT_FILE" "$AF_FILE" "$AF_MAX_WIDTH" "$AF_CODEC" "$AF_GOP" "$AF_CRF"

echo ""
echo "Done! Output: $OUT_FILE"
echo "Done! AF:     $AF_FILE"
