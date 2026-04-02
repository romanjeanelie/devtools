#!/bin/bash
set -euo pipefail

# ── Parse arguments ────────────────────────────────────────────────────────────
INPUT=""
MAX_WIDTH=1920
QUALITY=80
ALPHA_Q=90

for arg in "$@"; do
  case $arg in
    --input=*)    INPUT="${arg#*=}" ;;
    --maxWidth=*) MAX_WIDTH="${arg#*=}" ;;
    --quality=*)
      QUALITY="${arg#*=}"
      # Derive alpha_q from quality tier
      if   [ "$QUALITY" -ge 90 ]; then ALPHA_Q=95
      elif [ "$QUALITY" -ge 80 ]; then ALPHA_Q=90
      else                              ALPHA_Q=85
      fi
      ;;
    --alphaQ=*)   ALPHA_Q="${arg#*=}" ;;
    *) echo "Unknown argument: $arg" ;;
  esac
done

if [ -z "$INPUT" ]; then
  echo "❌ ERREUR: --input est requis (fichier ou dossier)" >&2
  exit 1
fi

if [ ! -e "$INPUT" ]; then
  echo "❌ ERREUR: chemin introuvable: $INPUT" >&2
  exit 1
fi

# ── Logging ────────────────────────────────────────────────────────────────────
log_file="$HOME/Desktop/images_optimize_$(date +%Y%m%d_%H%M%S).log"
error_file="$HOME/Desktop/images_errors_$(date +%Y%m%d_%H%M%S).log"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$log_file"
}
error_log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] ❌ ERREUR: $1" | tee -a "$log_file" >> "$error_file"
}

log "========================================="
log "DÉBUT DE L'OPTIMISATION IMAGES → WebP"
log "========================================="
log "📁 Input:           $INPUT"
log "📐 Résolution max:  ${MAX_WIDTH}px"
log "🎚️  Qualité:         q=$QUALITY, alpha_q=$ALPHA_Q"
log "========================================="

# ── Dependency checks ──────────────────────────────────────────────────────────
if ! command -v cwebp &> /dev/null; then
  log "❌ cwebp non installé — installe-le avec: brew install webp"
  exit 1
fi
log "✅ cwebp: $(which cwebp)"

if ! command -v sips &> /dev/null; then
  log "❌ sips non disponible"
  exit 1
fi
log "✅ sips:  $(which sips)"

# ── Build file list ────────────────────────────────────────────────────────────
if [ -d "$INPUT" ]; then
  folder="$INPUT"
  output_folder="${folder%/}/optimized/"
  cd "$folder"

  shopt -s nullglob
  files=( *.png *.PNG *.jpg *.JPG *.jpeg *.JPEG )
  shopt -u nullglob

  IFS=$'\n'
  files=($(printf "%s\n" "${files[@]}" | sort -V))
  unset IFS
else
  folder="$(dirname "$INPUT")"
  output_folder="${folder}/optimized/"
  files=( "$(basename "$INPUT")" )
  cd "$folder"
fi

mkdir -p "$output_folder"
log "📂 Dossier de sortie: $output_folder"

total_files=${#files[@]}
log "📊 Fichiers trouvés: $total_files"
log ""

if [ "$total_files" -eq 0 ]; then
  log "⚠️  Aucune image trouvée (jpg, jpeg, png)"
  exit 0
fi

# ── Conversion loop ────────────────────────────────────────────────────────────
count=0
skipped=0
errors=0
total_original=0
total_optimized=0

for file in "${files[@]}"; do
  if [ ! -f "$file" ]; then
    error_log "Fichier introuvable: $file"
    errors=$((errors + 1))
    continue
  fi

  count=$((count + 1))
  basename_noext="${file%.*}"
  output_name="${basename_noext}.webp"
  output="${output_folder}${output_name}"

  # Skip already converted
  if [ -f "$output" ]; then
    log "[$count/$total_files] ⏭️  Déjà converti: $file → $output_name"
    skipped=$((skipped + 1))
    original=$(stat -f%z "$file"   2>/dev/null || echo 0)
    optimized=$(stat -f%z "$output" 2>/dev/null || echo 0)
    total_original=$((total_original + original))
    total_optimized=$((total_optimized + optimized))
    continue
  fi

  log "---"
  log "[$count/$total_files] Traitement: $file"

  # Read width
  width=$(sips -g pixelWidth "$file" 2>/dev/null | grep pixelWidth | awk '{print $2}')
  if [ -z "$width" ]; then
    error_log "Impossible de lire les dimensions de: $file"
    errors=$((errors + 1))
    continue
  fi
  log "   Largeur originale: ${width}px"

  # Optional resize
  temp_file="/tmp/tmp_resized_$$.png"
  if [ "$width" -gt "$MAX_WIDTH" ]; then
    log "   🔽 Resize: ${width}px → ${MAX_WIDTH}px"
    if ! sips -Z "$MAX_WIDTH" "$file" --out "$temp_file" >/dev/null 2>&1; then
      error_log "Échec du resize pour: $file"
      errors=$((errors + 1))
      continue
    fi
    input_file="$temp_file"
    log "   ✅ Resize effectué"
  else
    log "   ⏭️  Pas de resize nécessaire"
    input_file="$file"
  fi

  # Convert
  log "   🔄 Conversion WebP (q=$QUALITY, alpha_q=$ALPHA_Q)..."
  cwebp -q "$QUALITY" \
        -alpha_q "$ALPHA_Q" \
        -resize "$MAX_WIDTH" 0 \
        "$input_file" -o "$output" >> "$log_file" 2>&1
  exit_code=$?

  [ -f "$temp_file" ] && rm -f "$temp_file"

  if [ $exit_code -ne 0 ]; then
    error_log "Échec de conversion pour: $file (code: $exit_code)"
    errors=$((errors + 1))
    continue
  fi

  if [ ! -f "$output" ] || [ ! -s "$output" ]; then
    error_log "Fichier de sortie invalide pour: $file"
    errors=$((errors + 1))
    continue
  fi

  # Stats per file
  original=$(stat -f%z "$file"    2>/dev/null || echo 0)
  optimized=$(stat -f%z "$output" 2>/dev/null || echo 0)

  total_original=$((total_original + original))
  total_optimized=$((total_optimized + optimized))

  if [ "$original" -gt 0 ] && [ "$optimized" -gt 0 ]; then
    original_kb=$(echo "scale=2; $original/1024"                        | bc)
    optimized_kb=$(echo "scale=2; $optimized/1024"                      | bc)
    reduction=$(echo "scale=1; (1 - $optimized/$original) * 100"        | bc)
    log "   ✅ ${original_kb} KB → ${optimized_kb} KB (${reduction}% de réduction)"
  fi
  log "   💾 Sauvegardé: $output_name"

  # Progress every 10 files
  if [ $((count % 10)) -eq 0 ]; then
    log "📈 Progression: $count/$total_files images traitées"
  fi
done

# ── Summary ────────────────────────────────────────────────────────────────────
if [ "$total_original" -gt 0 ]; then
  reduction=$(echo "scale=1; (1 - $total_optimized/$total_original) * 100" | bc)
  original_mb=$(echo  "scale=2; $total_original/1024/1024"  | bc)
  optimized_mb=$(echo "scale=2; $total_optimized/1024/1024" | bc)
  saved_mb=$(echo     "scale=2; ($total_original - $total_optimized)/1024/1024" | bc)
else
  reduction=0; original_mb=0; optimized_mb=0; saved_mb=0
fi

processed=$((count - skipped - errors))

log ""
log "========================================="
log "RÉSUMÉ FINAL"
log "========================================="
log "✅ Traitées:          $processed"
log "⏭️  Déjà converties:  $skipped"
log "❌ Erreurs:           $errors"
log "📊 Total:             $count/$total_files"
log "🎚️  Paramètres:        q=$QUALITY, alpha_q=$ALPHA_Q"
log "📐 Résolution max:    ${MAX_WIDTH}px"
log "📊 Original:          ${original_mb} MB"
log "📊 Optimisé:          ${optimized_mb} MB"
log "💾 Économisé:         ${saved_mb} MB (${reduction}%)"
log "📁 Sortie:            $output_folder"
log "📝 Log:               $log_file"
[ $errors -gt 0 ] && log "⚠️  Erreurs log:       $error_file"
log "========================================="
