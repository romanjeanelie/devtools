#!/usr/bin/env bash
set -euo pipefail

# ── Parse arguments ────────────────────────────────────────────────────────────
INPUT=""
MODE="standard"     # standard | transparent
FORMAT="mp4"        # mp4 | webm | both
QUALITY=75          # 1–100 (mapped to CRF internally)
ALPHA_QUALITY=90    # 1–100 (transparent mode, HEVC alpha layer)
MAX_WIDTH=1920
STRIP_AUDIO="false"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

for arg in "$@"; do
  case $arg in
    --input=*)        INPUT="${arg#*=}" ;;
    --mode=*)         MODE="${arg#*=}" ;;
    --format=*)       FORMAT="${arg#*=}" ;;
    --quality=*)      QUALITY="${arg#*=}" ;;
    --alphaQuality=*) ALPHA_QUALITY="${arg#*=}" ;;
    --maxWidth=*)     MAX_WIDTH="${arg#*=}" ;;
    --stripAudio=*)   STRIP_AUDIO="${arg#*=}" ;;
    *) echo "Unknown argument: $arg" ;;
  esac
done

if [ -z "$INPUT" ]; then
  echo "Error: --input is required" >&2; exit 1
fi
if [ ! -f "$INPUT" ]; then
  echo "Error: file not found: $INPUT" >&2; exit 1
fi

WANT_MP4="false"
WANT_WEBM="false"
if [ "$FORMAT" = "mp4"  ] || [ "$FORMAT" = "both" ]; then WANT_MP4="true";  fi
if [ "$FORMAT" = "webm" ] || [ "$FORMAT" = "both" ]; then WANT_WEBM="true"; fi
if [ "$WANT_MP4" = "false" ] && [ "$WANT_WEBM" = "false" ]; then
  echo "Error: --format must be mp4, webm or both (got '$FORMAT')" >&2; exit 1
fi

# ── Map quality (1–100) → CRF ─────────────────────────────────────────────────
# H.264  : quality 100 → CRF 15 / quality 1 → CRF 35
# VP9    : quality 100 → CRF 24 / quality 1 → CRF 56
CRF_H264=$(echo "scale=0; 35 - $QUALITY * 20 / 100" | bc)
CRF_VP9=$(echo  "scale=0; 56 - $QUALITY * 32 / 100" | bc)
# VideoToolbox constant quality: 1–100, higher = better (quality 100 → 75 / 1 → 30)
VT_Q=$(echo "scale=0; 30 + $QUALITY * 45 / 100" | bc)
# HEVC alpha layer quality: 0.00–1.00 (bc drops the leading zero, printf restores it)
ALPHA_Q=$(printf '%.2f' "$(echo "scale=4; $ALPHA_QUALITY / 100" | bc)")

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

echo "Input:     $INPUT"
echo "Output:    $OUT_DIR"
echo "Mode:      $MODE"
echo "Format:    $FORMAT"
echo "Max width: ${MAX_WIDTH}px"

# ── Shared flags ──────────────────────────────────────────────────────────────
VF="scale='min(iw,${MAX_WIDTH})':-2:flags=lanczos"
IN_FLAGS=()

AUDIO_MP4=(-c:a aac -b:a 128k)
AUDIO_WEBM=(-c:a libopus -b:a 96k)
if [ "$STRIP_AUDIO" = "true" ]; then
  AUDIO_MP4=(-an)
  AUDIO_WEBM=(-an)
fi

# ── Source inspection ─────────────────────────────────────────────────────────
SRC_PROBE=$(ffprobe -v error -select_streams v:0 \
  -show_entries stream=codec_name,pix_fmt,width,height,r_frame_rate \
  -show_entries format=duration -of default=nw=1 "$INPUT" 2>/dev/null || echo "")
probe_field() { printf '%s\n' "$SRC_PROBE" | sed -n "s/^$1=//p" | head -1; }
SRC_CODEC=$(probe_field codec_name)
SRC_PIXFMT=$(probe_field pix_fmt)
SRC_W=$(probe_field width)
SRC_H=$(probe_field height)
SRC_RATE=$(probe_field r_frame_rate)
SRC_DUR=$(probe_field duration)

# WebM alpha lives in a side stream that only the libvpx decoders expose
case "$SRC_CODEC" in
  vp9) IN_FLAGS=(-c:v libvpx-vp9) ;;
  vp8) IN_FLAGS=(-c:v libvpx) ;;
esac

# Measure the alpha plane of the first frame. Routing through rgba normalises
# any bit depth to 8-bit full range, so YMIN/YAVG are directly comparable.
ALPHA_YMIN=""
ALPHA_YAVG=""
ALPHA_STATS=$(ffmpeg -hide_banner -v error "${IN_FLAGS[@]+"${IN_FLAGS[@]}"}" -i "$INPUT" \
  -frames:v 1 \
  -vf "scale=200:-2,format=rgba,alphaextract,format=gray,signalstats,metadata=print:file=-" \
  -f null - 2>/dev/null || echo "")
if [ -n "$ALPHA_STATS" ]; then
  ALPHA_YMIN=$(printf '%s\n' "$ALPHA_STATS" | sed -n 's/.*YMIN=\([0-9.]*\).*/\1/p' | head -1)
  ALPHA_YAVG=$(printf '%s\n' "$ALPHA_STATS" | sed -n 's/.*YAVG=\([0-9.]*\).*/\1/p' | head -1)
fi

SRC_HAS_ALPHA="false"
SRC_TRANSP_PCT=""
if [ -n "$ALPHA_YMIN" ] && [ "${ALPHA_YMIN%%.*}" -lt 255 ]; then
  SRC_HAS_ALPHA="true"
  SRC_TRANSP_PCT=$(echo "scale=0; (255 - $ALPHA_YAVG) * 100 / 255" | bc)
fi

echo "── Source ────────────────────────────────────────────────────────────────────"
echo "  file       : $(basename "$INPUT")  ($(du -h "$INPUT" 2>/dev/null | cut -f1))"
echo "  codec      : ${SRC_CODEC:-?} / ${SRC_PIXFMT:-?}"
echo "  resolution : ${SRC_W:-?} × ${SRC_H:-?}  ·  ${SRC_RATE:-?} fps  ·  ${SRC_DUR:-?}s"
if [ "$SRC_HAS_ALPHA" = "true" ]; then
  echo "  alpha      : yes — about ${SRC_TRANSP_PCT}% of the first frame is transparent"
  echo "               Straight (non-premultiplied) alpha: transparent pixels still hold"
  echo "               a colour. Any viewer that ignores the alpha channel — Chrome on"
  echo "               the HEVC .mp4, Finder/QuickLook thumbnails — shows that colour"
  echo "               instead of transparency. That is the preview lying, not the encode."
else
  echo "  alpha      : none — every pixel of the first frame is opaque"
fi
echo "──────────────────────────────────────────────────────────────────────────────"
echo ""

# ── Alpha preflight (transparent mode) ────────────────────────────────────────
if [ "$MODE" = "transparent" ]; then

  echo "Quality:   $QUALITY  (VideoToolbox q=$VT_Q · VP9 CRF=$CRF_VP9)"
  echo "Alpha:     $ALPHA_QUALITY  (HEVC alpha_quality=$ALPHA_Q)"
  echo ""

  if [ "$SRC_HAS_ALPHA" != "true" ]; then
    echo "⚠  This source has no alpha channel — the output will be fully opaque."
    echo "   Feed a ProRes 4444, QuickTime/PNG RGBA, HEVC-alpha or VP9-alpha source."
    echo ""
  fi

  if [ "$FORMAT" != "both" ]; then
    echo "⚠  No single file covers every browser for alpha video: Safari (macOS + iOS)"
    echo "   needs the HEVC .mp4, Chrome/Firefox/Edge need the VP9 .webm. Use Format ="
    echo "   both unless you are deliberately targeting one engine."
    echo ""
  fi
else
  echo "Quality:   $QUALITY  (H.264 CRF=$CRF_H264 · VP9 CRF=$CRF_VP9)"
  echo ""
fi

# ── MP4 (H.264 + AAC) ─────────────────────────────────────────────────────────
encode_mp4() {
  echo "▶  Encoding MP4 (H.264 CRF=$CRF_H264)…"
  ffmpeg -hide_banner -y -i "$INPUT" \
    -vf "$VF" \
    -c:v libx264 \
    -crf "$CRF_H264" \
    -preset slow \
    -pix_fmt yuv420p \
    -movflags +faststart \
    "${AUDIO_MP4[@]}" \
    -progress pipe:1 \
    "$OUT_DIR/${BASENAME}.mp4"
  echo "   ✓ ${BASENAME}.mp4"
}

# ── WebM (VP9 + Opus) ─────────────────────────────────────────────────────────
encode_webm() {
  echo "▶  Encoding WebM (VP9 CRF=$CRF_VP9)…"
  ffmpeg -hide_banner -y -i "$INPUT" \
    -vf "${VF},format=yuv420p" \
    -c:v libvpx-vp9 \
    -crf "$CRF_VP9" \
    -b:v 0 \
    -row-mt 1 \
    "${AUDIO_WEBM[@]}" \
    -progress pipe:1 \
    "$OUT_DIR/${BASENAME}.webm"
  echo "   ✓ ${BASENAME}.webm"
}

# ── MP4 (HEVC with alpha — Safari macOS + iOS) ────────────────────────────────
# libx265 cannot write an alpha layer; only Apple's VideoToolbox encoder can.
encode_mp4_alpha() {
  if ! ffmpeg -hide_banner -encoders 2>/dev/null | grep -q hevc_videotoolbox; then
    echo "✗  hevc_videotoolbox unavailable — HEVC with alpha requires macOS."
    echo "   Skipping the Safari .mp4; the VP9 .webm still covers Chrome/Firefox."
    return 0
  fi
  echo "▶  Encoding MP4 (HEVC + alpha · VideoToolbox q=$VT_Q · alpha_quality=$ALPHA_Q)…"
  local out="$OUT_DIR/${BASENAME}.mp4"
  local enc=(
    -c:v hevc_videotoolbox
    -alpha_quality "$ALPHA_Q"
    -allow_sw 1
  )
  local base=(
    -y "${IN_FLAGS[@]+"${IN_FLAGS[@]}"}" -i "$INPUT"
    -vf "${VF},format=bgra"
    "${enc[@]}"
    -tag:v hvc1
    -movflags +faststart
    "${AUDIO_MP4[@]}"
    -progress pipe:1
  )
  local rate=(-q:v "$VT_Q")
  if ! ffmpeg -hide_banner "${base[@]}" "${rate[@]}" "$out"; then
    # Constant-quality VideoToolbox needs Apple Silicon + macOS 13 — fall back to a bitrate
    rate=(-b:v "$(( MAX_WIDTH * 5 ))k")
    echo "   … constant quality refused, retrying at ${rate[1]}"
    ffmpeg -hide_banner "${base[@]}" "${rate[@]}" "$out"
  fi
  repair_hevc_alpha "$out" "${rate[@]}"
  echo "   ✓ ${BASENAME}.mp4  (HEVC alpha · Safari)"
}

# VideoToolbox writes Apple's HEVC alpha as two layers — the picture on
# nuh_layer_id 0, the alpha on layer 1 — each with its own SPS and PPS. ffmpeg's
# mov/mp4 muxer keeps only the layer-0 parameter sets in the hvcC box, so
# AVFoundation (Safari, QuickTime, QuickLook, Finder) cannot decode the alpha
# layer and refuses the file outright, even though the picture data is intact.
# Annex-B output keeps every parameter set, so re-encode a single frame to
# harvest them and patch them back into the container.
repair_hevc_alpha() {
  local out="$1"; shift
  local rate=("$@")

  if ! command -v node >/dev/null 2>&1; then
    echo "⚠  node not found — cannot repair the hvcC box."
    echo "   The .mp4 will not play in Safari, QuickTime or Finder. The .webm is unaffected."
    return 0
  fi

  local params="${OUT_DIR}/.${BASENAME}.params.hevc"
  ffmpeg -hide_banner -v error -y "${IN_FLAGS[@]+"${IN_FLAGS[@]}"}" -i "$INPUT" \
    -frames:v 1 \
    -vf "${VF},format=bgra" \
    -c:v hevc_videotoolbox \
    -alpha_quality "$ALPHA_Q" \
    -allow_sw 1 \
    "${rate[@]}" \
    -an \
    -f hevc "$params"

  local msg=""
  if msg=$(node "$SCRIPT_DIR/hevc_alpha_fix.mjs" --video="$out" --params="$params" 2>&1); then
    echo "   ↻ $msg"
  else
    echo "   ✗ $msg"
    echo "⚠  hvcC repair failed — this .mp4 will not play in Safari, QuickTime or Finder."
  fi
  rm -f "$params"
}

# ── WebM (VP9 with alpha — Chrome / Firefox / Edge) ───────────────────────────
encode_webm_alpha() {
  echo "▶  Encoding WebM (VP9 + alpha · CRF=$CRF_VP9)…"
  ffmpeg -hide_banner -y "${IN_FLAGS[@]+"${IN_FLAGS[@]}"}" -i "$INPUT" \
    -vf "${VF},format=yuva420p" \
    -c:v libvpx-vp9 \
    -crf "$CRF_VP9" \
    -b:v 0 \
    -row-mt 1 \
    "${AUDIO_WEBM[@]}" \
    -progress pipe:1 \
    "$OUT_DIR/${BASENAME}.webm"
  echo "   ✓ ${BASENAME}.webm  (VP9 alpha · Chrome/Firefox)"
}

if [ "$MODE" = "transparent" ]; then
  if [ "$WANT_MP4"  = "true" ]; then encode_mp4_alpha;  fi
  if [ "$WANT_WEBM" = "true" ]; then encode_webm_alpha; fi
else
  if [ "$WANT_MP4"  = "true" ]; then encode_mp4;  fi
  if [ "$WANT_WEBM" = "true" ]; then encode_webm; fi
fi

# ── Poster frame (first frame → WebP) ─────────────────────────────────────────
echo "▶  Extracting poster frame…"
POSTER_VF="select=eq(n\\,0),${VF}"
if [ "$MODE" = "transparent" ]; then
  # Keep the alpha channel, otherwise the poster flashes an opaque box before playback
  POSTER_VF="${POSTER_VF},format=yuva420p"
else
  POSTER_VF="${POSTER_VF},format=yuv420p"
fi
ffmpeg -hide_banner -y "${IN_FLAGS[@]+"${IN_FLAGS[@]}"}" -i "$INPUT" \
  -vf "$POSTER_VF" \
  -frames:v 1 \
  -c:v libwebp \
  -quality 85 \
  "$OUT_DIR/${BASENAME}_poster.webp"
echo "   ✓ ${BASENAME}_poster.webp"

# ── HTML snippet (transparent mode) ───────────────────────────────────────────
if [ "$MODE" = "transparent" ]; then
  SNIPPET="$OUT_DIR/${BASENAME}.html"
  {
    echo "<!-- Transparent video."
    echo "     Source order matters, and so does the bare codecs=\"hvc1\" string:"
    echo "     Chrome answers \"unsupported\" to bare \"hvc1\" and falls through to the WebM,"
    echo "     but it answers \"probably\" to a full profile string (hvc1.1.6.L93.B0) and would"
    echo "     then play the HEVC file with its alpha silently dropped — an opaque box."
    echo "     Safari skips the WebM because it decodes VP9 without alpha. -->"
    echo "<video"
    echo "  autoplay loop muted playsinline preload=\"metadata\""
    echo "  poster=\"${BASENAME}_poster.webp\""
    echo "  style=\"background: transparent\""
    echo ">"
    if [ -f "$OUT_DIR/${BASENAME}.mp4" ]; then
      echo "  <source src=\"${BASENAME}.mp4\"  type='video/mp4; codecs=\"hvc1\"'>"
    fi
    if [ -f "$OUT_DIR/${BASENAME}.webm" ]; then
      echo "  <source src=\"${BASENAME}.webm\" type=\"video/webm\">"
    fi
    echo "</video>"
  } > "$SNIPPET"
  echo "   ✓ ${BASENAME}.html  (ready-to-paste <video> tag)"
fi

echo ""
echo "Done! Output: $OUT_DIR"
for f in "$OUT_DIR"/*; do
  [ -f "$f" ] || continue
  printf '  %-40s %s\n' "$(basename "$f")" "$(du -h "$f" | cut -f1)"
done
