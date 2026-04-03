#!/usr/bin/env bash
set -euo pipefail

# ── Parse arguments ────────────────────────────────────────────────────────────
INPUT=""
OUTPUT_DIR=""
QUALITY=85
ALPHA_Q=95
EXPORT_DESKTOP="true"
EXPORT_MOBILE="true"
DESKTOP_WIDTH=1920
MOBILE_WIDTH=750

for arg in "$@"; do
  case $arg in
    --input=*)         INPUT="${arg#*=}" ;;
    --outputDir=*)     OUTPUT_DIR="${arg#*=}" ;;
    --quality=*)       QUALITY="${arg#*=}" ;;
    --alphaQ=*)        ALPHA_Q="${arg#*=}" ;;
    --exportDesktop=*) EXPORT_DESKTOP="${arg#*=}" ;;
    --exportMobile=*)  EXPORT_MOBILE="${arg#*=}" ;;
    --desktopWidth=*)  DESKTOP_WIDTH="${arg#*=}" ;;
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

if [ "$EXPORT_DESKTOP" != "true" ] && [ "$EXPORT_MOBILE" != "true" ]; then
  echo "Error: at least one of Desktop or Mobile must be enabled" >&2
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

echo "Input folder:  $INPUT"
echo "Images found:  ${#IMAGES[@]}"
echo "Quality:       ${QUALITY}"
[ "$EXPORT_DESKTOP" = "true" ] && echo "Desktop:       ${DESKTOP_WIDTH}px"
[ "$EXPORT_MOBILE"  = "true" ] && echo "Mobile:        ${MOBILE_WIDTH}px"
echo ""

# ── Output base dir ────────────────────────────────────────────────────────────
if [ -n "$OUTPUT_DIR" ]; then
  OUT_BASE="$OUTPUT_DIR"
  mkdir -p "$OUT_BASE"
else
  OUT_BASE="$(dirname "$INPUT")"
fi

FOLDER_NAME="$(basename "$INPUT")"

# ── Tar path helper (auto-increment) ──────────────────────────────────────────
find_unique_tar() {
  local base="$1"
  local path="${base}.tar"
  local counter=2
  while [ -f "$path" ]; do
    path="${base}_${counter}.tar"
    counter=$((counter + 1))
  done
  echo "$path"
}

# Strip .tar suffix if user included it, then resolve unique path
resolve_tar() {
  local name="${1%.tar}"
  find_unique_tar "${OUT_BASE}/${name}"
}

if [ "$EXPORT_DESKTOP" = "true" ]; then
  DESKTOP_TAR=$(resolve_tar "desktop")
  DESKTOP_TMP="${OUT_BASE}/_desktop_tmp"
fi

if [ "$EXPORT_MOBILE" = "true" ]; then
  MOBILE_TAR=$(resolve_tar "mobile")
  MOBILE_TMP="${OUT_BASE}/_mobile_tmp"
fi

[ "$EXPORT_DESKTOP" = "true" ] && mkdir -p "$DESKTOP_TMP"
[ "$EXPORT_MOBILE"  = "true" ] && mkdir -p "$MOBILE_TMP"

# ── Process each image ─────────────────────────────────────────────────────────
TOTAL=${#IMAGES[@]}
INDEX=0

for img in "${IMAGES[@]}"; do
  INDEX=$((INDEX + 1))
  out_name=$(printf "frame_%05d.webp" "$INDEX")
  echo "[${INDEX}/${TOTAL}] $(basename "$img") → $out_name"

  if [ "$EXPORT_DESKTOP" = "true" ]; then
    cwebp -q "$QUALITY" -alpha_q "$ALPHA_Q" \
      -resize "$DESKTOP_WIDTH" 0 \
      "$img" -o "${DESKTOP_TMP}/${out_name}" 2>/dev/null
  fi

  if [ "$EXPORT_MOBILE" = "true" ]; then
    cwebp -q "$QUALITY" -alpha_q "$ALPHA_Q" \
      -resize "$MOBILE_WIDTH" 0 \
      "$img" -o "${MOBILE_TMP}/${out_name}" 2>/dev/null
  fi
done

echo ""

# ── Package into .tar ──────────────────────────────────────────────────────────
echo "── Packaging archives ──"

if [ "$EXPORT_DESKTOP" = "true" ]; then
  tar -cf "$DESKTOP_TAR" -C "$OUT_BASE" "$(basename "$DESKTOP_TMP")"
  rm -rf "$DESKTOP_TMP"
  echo "Desktop → $DESKTOP_TAR"
fi

if [ "$EXPORT_MOBILE" = "true" ]; then
  tar -cf "$MOBILE_TAR" -C "$OUT_BASE" "$(basename "$MOBILE_TMP")"
  rm -rf "$MOBILE_TMP"
  echo "Mobile  → $MOBILE_TAR"
fi

echo ""
echo "Done! ${TOTAL} images processed."
