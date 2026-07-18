# Handoff: run the AMRFinderPlus batch scan elsewhere (e.g. via Codex)

## Why this exists

This repo's real-data pipeline for the Genome Firewall hackathon project
needs AMRFinderPlus run once per genome across a 102-genome *E. coli*
cohort pulled from BV-BRC. On this environment's 2-core host that takes
~25-35s/genome (~45-60 minutes total), so it's being run in the background
here AND handed off in parallel to another agent/machine with more CPU, so
whichever finishes first can be used. This file is the self-contained
briefing for whoever (or whatever) picks it up.

## Current state (check before starting, it will have moved on)

- `data/raw/genomes/*.fna` — 102 genome FASTA files, already downloaded,
  ~503 MB total. Do not re-download; they're pinned in
  `data/cohort_manifest.json`.
- `data/raw/amrfinder/*.tsv` — output directory. As of this handoff, 23/102
  are already done (this repo's own background scan is still running and
  will keep adding to this directory). **Check
  `ls data/raw/amrfinder/*.tsv | wc -l` when you start** — whatever's
  already there is done; do not redo it.
- Every script referenced below already exists in this repo at
  `data/scripts/`. You do not need to write anything new — just run
  `data/scripts/run_amrfinder_batch.sh`, or replicate exactly what it does
  if you're on a machine where that script can't run directly (e.g. no
  conda).

## The task

Run **AMRFinderPlus, pinned to version 4.2.7, database version
2026-05-15.1**, once per genome, nucleotide mode, `-O Escherichia`, and
write one TSV per genome to `data/raw/amrfinder/<genome_id>.tsv` where
`<genome_id>` is the FASTA filename without `.fna` (e.g.
`data/raw/genomes/562.100704.fna` -> `data/raw/amrfinder/562.100704.tsv`).

### Option A — same filesystem, has conda

Just run the existing script. It already skips genomes that already have a
non-empty TSV, so it's safe to run alongside another instance of itself
(worst case, two processes briefly both start the same genome — wasteful
but not wrong):

```bash
conda create -y -n amrfinder -c conda-forge -c bioconda ncbi-amrfinderplus  # skip if already installed
source /opt/conda/etc/profile.d/conda.sh
conda activate amrfinder
amrfinder -u   # pins database 2026-05-15.1 into the env's default data dir (skip if already run)

bash data/scripts/run_amrfinder_batch.sh
```

To reduce collision with this repo's own concurrent scan, you can instead
process genomes in reverse order (or any disjoint slice) so the two runs
naturally divide the work:

```bash
# process from the end of the list backward instead of run_amrfinder_batch.sh's forward order
source /opt/conda/etc/profile.d/conda.sh && conda activate amrfinder
for f in $(ls -r data/raw/genomes/*.fna); do
  gid="$(basename "$f" .fna)"
  out="data/raw/amrfinder/$gid.tsv"
  [ -s "$out" ] && { echo "skip $gid"; continue; }
  amrfinder -n "$f" -O Escherichia -o "$out" || rm -f "$out"
done
```

### Option B — different machine / fresh clone

1. Copy or clone this repo (or at minimum `data/raw/genomes/*.fna` and
   `data/scripts/`) to the other machine.
2. Install AMRFinderPlus the same way as Option A.
3. Run the same loop as Option A (full forward pass is fine on a fresh
   copy — nothing to collide with).
4. Copy the resulting `data/raw/amrfinder/*.tsv` files back into this
   repo's `data/raw/amrfinder/` directory (merge, don't overwrite files
   that already exist here and are non-empty — they're already done).

### Exact command reference (what the script does, if you need to replicate it manually)

```bash
amrfinder -n <genome.fna> -O Escherichia -o <output.tsv>
```

No `--plus` flag (keeps runtime down; virulence/stress/biocide screening
is not used by this project's predictor). Nucleotide mode only (`-n`), not
protein mode.

## When it's done

Once `data/raw/amrfinder/*.tsv` has 102 files (`ls data/raw/amrfinder/*.tsv
| wc -l` returns 102), the remaining pipeline steps are:

```bash
source /opt/conda/etc/profile.d/conda.sh && conda activate bioutils  # has mash
python3 data/scripts/build_groups.py --threshold 0.02
node data/scripts/build_features.js
node scripts/train-baseline.js data/features.csv ciprofloxacin
node scripts/train-baseline.js data/features.csv ceftriaxone
node scripts/train-baseline.js data/features.csv gentamicin
```

Full context and design rationale for every step: `data/README.md`.

## Do not

- Do not re-download genomes or re-query BV-BRC — the cohort is already
  pinned in `data/cohort_manifest.json` and must stay exactly as pinned so
  the manifest, labels, and FASTA stay consistent.
- Do not change the AMRFinderPlus version/database or the `-O Escherichia`
  organism flag — every TSV in the merged output must come from the same
  pinned tool version for the feature table to be valid.
- Do not delete or overwrite existing non-empty TSVs in
  `data/raw/amrfinder/` — they represent completed work.
