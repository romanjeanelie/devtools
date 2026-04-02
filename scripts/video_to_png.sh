#!/usr/bin/env bash
set -euo pipefail

# ── Parse arguments ────────────────────────────────────────────────────────────
INPUT=""
FPS=24
DESKTOP_WIDTH=1920
MOBILE_WIDTH=750
FORMAT="png"
CHROMA_KEY="false"
CHROMA_COLOR="green"
SIMILARITY=15
BLEND=5

for arg in "$@"; do
  case $arg in
    --input=*)        INPUT="${arg#*=}" ;;
    --fps=*)          FPS="${arg#*=}" ;;
    --desktopWidth=*) DESKTOP_WIDTH="${arg#*=}" ;;
    --mobileWidth=*)  MOBILE_WIDTH="${arg#*=}" ;;
    --format=*)       FORMAT="${arg#*=}" ;;
    --chromaKey=*)    CHROMA_KEY="${arg#*=}" ;;
    --chromaColor=*)  CHROMA_COLOR="${arg#*=}" ;;
    --similarity=*)   SIMILARITY="${arg#*=}" ;;
    --blend=*)        BLEND="${arg#*=}" ;;
    *) echo "Unknown argument: $arg" ;;
  esac
done

if [ -z "$INPUT" ]; then
  echo "Error: --input is required" >&2
  exit 1
fi

if [ ! -f "$INPUT" ]; then
  echo "Error: file not found: $INPUT" >&2
  exit 1
fi

# ── Transparency: force PNG or WebP (JPG/BMP have no alpha) ───────────────────
if [ "$CHROMA_KEY" = "true" ] && [ "$FORMAT" != "png" ] && [ "$FORMAT" != "webp" ]; then
  echo "Warning: transparency requires PNG or WebP — switching format to PNG"
  FORMAT="png"
fi

# ── Helper: find a path not taken by a dir or a .tar file ─────────────────────
find_unique_path() {
  local base="$1"
  local path="$base"
  local counter=2
  while [ -d "$path" ] || [ -f "${path}.tar" ]; do
    path="${base}_${counter}"
    counter=$((counter + 1))
  done
  echo "$path"
}

BASENAME=$(basename "$INPUT" | sed 's/\.[^.]*$//')
INPUT_DIR="$(dirname "$INPUT")"

DESKTOP_PATH=$(find_unique_path "${INPUT_DIR}/${BASENAME}_desktop_frames")
MOBILE_PATH=$(find_unique_path "${INPUT_DIR}/${BASENAME}_mobile_frames")

DESKTOP_DIR="$DESKTOP_PATH"
DESKTOP_TAR="${DESKTOP_PATH}.tar"
MOBILE_DIR="$MOBILE_PATH"
MOBILE_TAR="${MOBILE_PATH}.tar"

echo "Input:         $INPUT"
echo "Desktop width: $DESKTOP_WIDTH px  →  $DESKTOP_TAR"
echo "Mobile width:  $MOBILE_WIDTH px   →  $MOBILE_TAR"
echo "FPS:           $FPS"
echo "Format:        $FORMAT"

# ── Build chroma key filter suffix (shared by both passes) ────────────────────
VF_CHROMA=""
if [ "$CHROMA_KEY" = "true" ]; then
  case "$CHROMA_COLOR" in
    black) HEX="0x000000" ;;
    white) HEX="0xffffff" ;;
    green) HEX="0x00ff00" ;;
    *)     HEX="0x00ff00" ;;
  esac
  SIM=$(echo "scale=3; $SIMILARITY / 100" | bc)
  BLD=$(echo "scale=3; $BLEND / 100" | bc)
  VF_CHROMA=",colorkey=${HEX}:${SIM}:${BLD},format=bgra"
  echo "Transparency:  $CHROMA_COLOR (similarity=$SIM, blend=$BLD)"
fi

echo ""

# ── Build ffmpeg codec args ────────────────────────────────────────────────────
CODEC_ARGS=""
if [ "$FORMAT" = "webp" ]; then
  CODEC_ARGS="-c:v libwebp"
fi

# ── Helper: run one ffmpeg pass ───────────────────────────────────────────────
run_pass() {
  local label="$1"
  local width="$2"
  local out_dir="$3"

  mkdir -p "$out_dir"
  echo "── $label pass (max ${width}px) ──"

  local vf="fps=${FPS},scale='min(iw,${width}):-2'${VF_CHROMA}"

  ffmpeg -i "$INPUT" \
    -vf "$vf" \
    $CODEC_ARGS \
    "${out_dir}/frame_%05d.${FORMAT}" \
    -progress pipe:1

  echo ""
}

# ── Pass 1: desktop ────────────────────────────────────────────────────────────
run_pass "Desktop" "$DESKTOP_WIDTH" "$DESKTOP_DIR"

# ── Pass 2: mobile ─────────────────────────────────────────────────────────────
run_pass "Mobile" "$MOBILE_WIDTH" "$MOBILE_DIR"

# ── Package each pass into a .tar ─────────────────────────────────────────────
echo "── Packaging archives ──"

tar -cf "$DESKTOP_TAR" -C "$INPUT_DIR" "$(basename "$DESKTOP_DIR")"
echo "Desktop archive: $DESKTOP_TAR"

tar -cf "$MOBILE_TAR" -C "$INPUT_DIR" "$(basename "$MOBILE_DIR")"
echo "Mobile archive:  $MOBILE_TAR"

# ── Remove temporary frame directories ────────────────────────────────────────
rm -rf "$DESKTOP_DIR"
rm -rf "$MOBILE_DIR"

echo ""
echo "Done!"
echo "  Desktop → $DESKTOP_TAR"
echo "  Mobile  → $MOBILE_TAR"
