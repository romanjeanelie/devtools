#!/usr/bin/env bash
set -euo pipefail

# ── Parse arguments ────────────────────────────────────────────────────────────
INPUT=""
OUTPUT_DIR=""
FPS=25
CRF=20
X264_PRESET="slow"
MAX_WIDTH=1920

for arg in "$@"; do
  case $arg in
    --input=*)       INPUT="${arg#*=}" ;;
    --outputDir=*)   OUTPUT_DIR="${arg#*=}" ;;
    --fps=*)         FPS="${arg#*=}" ;;
    --crf=*)         CRF="${arg#*=}" ;;
    --preset=*)      X264_PRESET="${arg#*=}" ;;
    --maxWidth=*)    MAX_WIDTH="${arg#*=}" ;;
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

# ── Collect + sort images ──────────────────────────────────────────────────────
IMAGES=()
while IFS= read -r -d '' f; do
  IMAGES+=("$f")
done < <(find "$INPUT" -maxdepth 1 -type f \
  \( -iname "*.png" -o -iname "*.jpg" -o -iname "*.jpeg" -o -iname "*.webp" \) \
  -print0 | sort -z)

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

cleanup() {
  if [ -n "${TEMP_SEQ_DIR:-}" ] && [ -d "$TEMP_SEQ_DIR" ]; then
    rm -rf "$TEMP_SEQ_DIR"
  fi
}
trap cleanup EXIT

# ── Output path (auto-increment) ───────────────────────────────────────────────
if [ -n "$OUTPUT_DIR" ]; then
  OUT_DIR="$OUTPUT_DIR"
  mkdir -p "$OUT_DIR"
else
  OUT_DIR="$(dirname "$INPUT")"
fi

FOLDER_NAME="$(basename "$INPUT")"
BASE_OUT="${OUT_DIR}/${FOLDER_NAME}"
OUT_FILE="${BASE_OUT}.mp4"
POSTER_FILE="${BASE_OUT}_poster.webp"
COUNTER=2
while [ -f "$OUT_FILE" ] || [ -f "$POSTER_FILE" ]; do
  OUT_FILE="${BASE_OUT}_${COUNTER}.mp4"
  POSTER_FILE="${BASE_OUT}_${COUNTER}_poster.webp"
  COUNTER=$((COUNTER + 1))
done

# Width capped, height from aspect ratio (-2 = even height for yuv420p). No crop, no stretch.
VF="scale='min(iw,${MAX_WIDTH})':-2:flags=lanczos"

echo "Input folder:  $INPUT"
echo "Frames:        ${#IMAGES[@]}"
echo "FPS:           ${FPS}"
echo "Max width:     ${MAX_WIDTH}px"
echo "CRF:           ${CRF}"
echo "Preset:        ${X264_PRESET}"
echo "Video:         $OUT_FILE"
echo "Poster:        $POSTER_FILE"
echo ""

echo "▶  Encoding video…"
ffmpeg -y \
  -framerate "$FPS" \
  -start_number "$START_NUMBER" \
  -i "${SEQ_DIR}/${SEQ_PATTERN}" \
  -vf "$VF" \
  -c:v libx264 \
  -preset "$X264_PRESET" \
  -crf "$CRF" \
  -pix_fmt yuv420p \
  -colorspace bt709 \
  -color_primaries bt709 \
  -color_trc bt709 \
  -movflags +faststart \
  -r "$FPS" \
  -progress pipe:1 \
  "$OUT_FILE"
echo "   ✓ $(basename "$OUT_FILE")"

# Poster from encoded MP4 (same YUV pipeline as playback — avoids RGB vs H.264 drift)
echo "▶  Extracting poster (1st frame from video)…"
ffmpeg -y \
  -i "$OUT_FILE" \
  -vf "select=eq(n\\,0)" \
  -frames:v 1 \
  -c:v libwebp \
  -quality 85 \
  "$POSTER_FILE"
echo "   ✓ $(basename "$POSTER_FILE")"

echo ""
echo "Done!"
echo "  Video:  $OUT_FILE"
echo "  Poster: $POSTER_FILE"
