#!/usr/bin/env bash
# Run the pinned AMRFinderPlus install across every downloaded cohort genome.
#
# Pinned versions (recorded in data/README.md):
#   AMRFinderPlus 4.2.7, database 2026-05-15.1, installed via
#   `conda create -n amrfinder -c conda-forge -c bioconda ncbi-amrfinderplus`
#   then `amrfinder -u` for the default database location.
#
# Usage:
#   bash data/scripts/run_amrfinder_batch.sh [organism]
#
# Resumable: genomes that already have a TSV in data/raw/amrfinder/ are skipped.
set -euo pipefail

ORGANISM="${1:-Escherichia}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
GENOME_DIR="$ROOT_DIR/data/raw/genomes"
OUT_DIR="$ROOT_DIR/data/raw/amrfinder"
mkdir -p "$OUT_DIR"

if command -v amrfinder >/dev/null 2>&1; then
  AMRFINDER_COMMAND=(amrfinder)
elif command -v micromamba >/dev/null 2>&1; then
  AMRFINDER_COMMAND=(micromamba run -n "${AMRFINDER_ENV:-genome-firewall-amr}" amrfinder)
elif [ -x /opt/homebrew/bin/micromamba ]; then
  AMRFINDER_COMMAND=(/opt/homebrew/bin/micromamba run -n "${AMRFINDER_ENV:-genome-firewall-amr}" amrfinder)
elif [ -f /opt/conda/etc/profile.d/conda.sh ]; then
  source /opt/conda/etc/profile.d/conda.sh
  conda activate "${AMRFINDER_ENV:-amrfinder}"
  AMRFINDER_COMMAND=(amrfinder)
else
  echo "AMRFinderPlus is not available. Activate its environment first." >&2
  exit 1
fi

shopt -s nullglob
files=("$GENOME_DIR"/*.fna)
total=${#files[@]}
if [ "$total" -eq 0 ]; then
  echo "No genome FASTA files found in $GENOME_DIR. Run fetch_bvbrc_cohort.py first." >&2
  exit 1
fi

count=0
for fasta in "${files[@]}"; do
  count=$((count + 1))
  genome_id="$(basename "$fasta" .fna)"
  out_tsv="$OUT_DIR/$genome_id.tsv"
  out_tmp="$out_tsv.tmp"
  if [ -s "$out_tsv" ]; then
    echo "[$count/$total] $genome_id already scanned, skipping"
    continue
  fi
  echo "[$count/$total] running AMRFinderPlus on $genome_id ..."
  if "${AMRFINDER_COMMAND[@]}" -n "$fasta" -O "$ORGANISM" -o "$out_tmp" >>"$OUT_DIR/amrfinder_batch.log" 2>&1; then
    mv "$out_tmp" "$out_tsv"
  else
    echo "  WARNING: AMRFinderPlus failed on $genome_id (see $OUT_DIR/amrfinder_batch.log)" >&2
    rm -f "$out_tmp"
  fi
done

echo "Done. TSV outputs in $OUT_DIR"
