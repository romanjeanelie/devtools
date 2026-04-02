#!/usr/bin/env bash
set -euo pipefail

# ── Parse arguments ────────────────────────────────────────────────────────────
INPUT=""
FORMAT="mp4"        # mp4 | webm | both
QUALITY=75          # 1–100 (mapped to CRF internally)
MAX_WIDTH=1920
STRIP_AUDIO="false"

for arg in "$@"; do
  case $arg in
    --input=*)      INPUT="${arg#*=}" ;;
    --format=*)     FORMAT="${arg#*=}" ;;
    --quality=*)    QUALITY="${arg#*=}" ;;
    --maxWidth=*)   MAX_WIDTH="${arg#*=}" ;;
    --stripAudio=*) STRIP_AUDIO="${arg#*=}" ;;
    *) echo "Unknown argument: $arg" ;;
  esac
done

if [ -z "$INPUT" ]; then
  echo "Error: --input is required" >&2; exit 1
fi
if [ ! -f "$INPUT" ]; then
  echo "Error: file not found: $INPUT" >&2; exit 1
fi

# ── Map quality (1–100) → CRF ─────────────────────────────────────────────────
# H.264  : quality 100 → CRF 15 / quality 1 → CRF 35
# VP9    : quality 100 → CRF 24 / quality 1 → CRF 56
CRF_H264=$(echo "scale=0; 35 - $QUALITY * 20 / 100" | bc)
CRF_VP9=$(echo  "scale=0; 56 - $QUALITY * 32 / 100" | bc)

# ── Output directory (auto-increment) ─────────────────────────────────────────
BASENAME=$(basename "$INPUT" | sed 's/\.[^.]*$//')
BASE_DIR="$(dirname "$INPUT")/${BASENAME}_web"
OUT_DIR="$BASE_DIR"
COUNTER=2
while [ -d "$OUT_DIR" ]; do
  OUT_DIR="${BASE_DIR}_${COUNTER}"
  COUNTER=$((COUNTER + 1))
done
mkdir -p "$OUT_DIR"

echo "Input:    $INPUT"
echo "Output:   $OUT_DIR"
echo "Format:   $FORMAT"
echo "Quality:  $QUALITY  (H.264 CRF=$CRF_H264 · VP9 CRF=$CRF_VP9)"
echo "Max width: ${MAX_WIDTH}px"
echo ""

# ── Shared flags ──────────────────────────────────────────────────────────────
VF="scale='min(iw,${MAX_WIDTH}):-2'"
AUDIO_FLAGS=()
if [ "$STRIP_AUDIO" = "true" ]; then
  AUDIO_FLAGS=(-an)
fi

# ── MP4 (H.264 + AAC) ─────────────────────────────────────────────────────────
encode_mp4() {
  echo "▶  Encoding MP4 (H.264 CRF=$CRF_H264)…"
  local audio_codec=()
  if [ "$STRIP_AUDIO" = "true" ]; then
    audio_codec=(-an)
  else
    audio_codec=(-c:a aac -b:a 128k)
  fi
  ffmpeg -i "$INPUT" \
    -vf "$VF" \
    -c:v libx264 \
    -crf "$CRF_H264" \
    -preset slow \
    -movflags +faststart \
    "${audio_codec[@]}" \
    -progress pipe:1 \
    "$OUT_DIR/${BASENAME}.mp4"
  echo "   ✓ ${BASENAME}.mp4"
}

# ── WebM (VP9 + Opus) ─────────────────────────────────────────────────────────
encode_webm() {
  echo "▶  Encoding WebM (VP9 CRF=$CRF_VP9)…"
  local audio_codec=()
  if [ "$STRIP_AUDIO" = "true" ]; then
    audio_codec=(-an)
  else
    audio_codec=(-c:a libopus -b:a 96k)
  fi
  ffmpeg -i "$INPUT" \
    -vf "$VF" \
    -c:v libvpx-vp9 \
    -crf "$CRF_VP9" \
    -b:v 0 \
    "${audio_codec[@]}" \
    -progress pipe:1 \
    "$OUT_DIR/${BASENAME}.webm"
  echo "   ✓ ${BASENAME}.webm"
}

[ "$FORMAT" = "mp4"  ] || [ "$FORMAT" = "both" ] && encode_mp4
[ "$FORMAT" = "webm" ] || [ "$FORMAT" = "both" ] && encode_webm

# ── Poster frame (first frame → WebP) ─────────────────────────────────────────
echo "▶  Extracting poster frame…"
ffmpeg -i "$INPUT" \
  -vf "select=eq(n\\,0),${VF}" \
  -frames:v 1 \
  -c:v libwebp \
  -quality 85 \
  "$OUT_DIR/${BASENAME}_poster.webp"
echo "   ✓ ${BASENAME}_poster.webp"

echo ""
echo "Done! Output: $OUT_DIR"
