# Genome Firewall training data pipeline

This directory documents and reproduces the real-data cohort behind the
trained models in `models/`. It replaces the organizer-pinned dataset the
challenge brief describes (none was handed to this team) with a pipeline
that pins its own reproducible cohort against BV-BRC's public API and
records every filter, version, and threshold used to build it.

## Pipeline overview

```
data/scripts/fetch_bvbrc_cohort.py   -> data/cohort_manifest.json, data/raw/genomes/*.fna
data/scripts/run_amrfinder_batch.sh  -> data/raw/amrfinder/*.tsv
data/scripts/build_groups.py         -> data/groups.csv, data/groups.json
data/scripts/build_features.js       -> data/features.csv
node scripts/train-baseline.js       -> models/<antibiotic>.json
```

Re-running `fetch_bvbrc_cohort.py --from-manifest data/cohort_manifest.json`
only re-downloads FASTA for genomes already pinned in the manifest, so the
cohort composition itself is fixed even if BV-BRC's live query results
change over time.

## 1. Cohort source: BV-BRC

- **Source**: [BV-BRC](https://www.bv-brc.org/) (Bacterial and Viral
  Bioinformatics Resource Center, formerly PATRIC), public REST API at
  `https://www.bv-brc.org/api/`.
- **License**: BV-BRC is a U.S. federally funded, freely available public
  data resource. See <https://www.bv-brc.org/docs/policies_privacy/>. No
  authentication was used; all requests are read-only GETs against public
  collections.
- **Species**: *Escherichia coli* only (NCBI `taxon_id=562`), matching
  `src/config.js` `SUPPORTED_SPECIES`.
- **Antibiotics**: ciprofloxacin, ceftriaxone, gentamicin, matching
  `src/config.js` `ANTIBIOTICS` (the brief's "a few antibiotics well").
- **Ground truth**: `genome_amr` collection, filtered to
  `evidence == "Laboratory Method"`. BV-BRC's `genome_amr` collection also
  contains rows with `evidence == "Computational Method"` (model-generated
  MIC predictions, e.g. an XGBoost model) -- the brief explicitly requires
  excluding those ("Use the organizer-pinned, laboratory-measured test
  results - NOT general phenotype fields, which may contain model-generated
  predictions"), so this pipeline filters on `evidence` accordingly.
- **Kept phenotypes**: `Resistant` and `Susceptible` only. `Intermediate`
  and any other AST category are dropped rather than force-labeled, in
  keeping with the brief's "honest no-call" principle -- those genomes are
  simply not used as ground truth for that antibiotic, not mapped onto a
  binary label.
- **Genome quality gate** (BV-BRC `genome` collection, CheckM-derived):
  `genome_quality == "Good"`, `checkm_completeness >= 95`,
  `checkm_contamination <= 5`, assembly length in `[4,000,000, 6,200,000]`
  bp. This mirrors, and is stricter than, the assembly QC gate already
  enforced at inference time in `src/fasta.js` / `src/predictor.js`
  `targetGate`.
- **Sampling**: deterministic. For each antibiotic x {Resistant,
  Susceptible} bucket, candidate genome_ids are ordered by
  `sha256(genome_id)` (a stable pseudo-random shuffle, not a plain
  alphabetical sort -- alphabetically-first genome_ids in BV-BRC tend to be
  one deposit batch from one study, which would undermine cohort diversity
  before de-duplication even runs) and the first `--target-per-class`
  (default 25) that pass the quality gate are kept.
- **FASTA reconstruction**: BV-BRC's bulk FTP mirror (`ftp.bvbrc.org`) is
  not reachable from this project's build environment (DNS resolves, the
  connection itself times out). Genome FASTA is instead reconstructed from
  the `genome_sequence` REST collection, which serves the identical
  per-contig sequences as the FTP `.fna` files, one contig record at a
  time, and rebuilt into standard 70-column FASTA.
- **Result**: 414 genomes selected at `--target-per-class 100`
  (`--pool-multiplier 5`, the default). Exact selection, per-genome quality
  metadata, and every laboratory AST label are pinned in
  `cohort_manifest.json`.

## 2. AMR gene/mutation calling: AMRFinderPlus

- **Tool**: NCBI AMRFinderPlus, the challenge brief's required default
  annotation tool. Public domain, unrestricted
  (<https://github.com/ncbi/amr>).
- **Pinned version**: AMRFinderPlus **4.2.7**, database version
  **2026-05-15.1**.
- **Install** (reproduce with):
  ```
  conda create -n amrfinder -c conda-forge -c bioconda ncbi-amrfinderplus
  conda activate amrfinder
  amrfinder -u   # fetches and pins the database into the conda env's default location
  ```
- **Invocation**: `amrfinder -n <genome.fna> -O Escherichia -o <out.tsv>`
  (nucleotide mode, core AMR gene + point-mutation search; `--plus`, which
  adds virulence/stress/biocide screening irrelevant to this predictor, is
  omitted in the bulk cohort scan to keep per-genome runtime down -- the
  live single-genome demo path in `src/amrfinder.js` still uses `--plus`
  for a more complete one-off report).
- **Runtime**: ~20-35s/genome on a 2-core host; `run_amrfinder_batch.sh` is
  resumable (skips genomes that already have a TSV) so it tolerates
  interruption.

## 3. De-duplication / grouping: Mash

Module 02 of the brief requires a de-duplication step based on sequence
homology so identical or near-identical genomes cannot appear in both
training and test. `build_groups.py`:

1. Sketches every genome with **Mash** (k=21, sketch size 10000 -- Mash's
   recommended defaults for bacterial whole-genome comparison).
2. Computes all-vs-all Mash distance (approximates 1 - ANI for related
   genomes).
3. Applies single-linkage clustering: any two genomes with Mash distance
   below the threshold are merged into one `group_id`.
4. **Threshold: 0.01** (~99% genome-wide ANI), chosen empirically, not
   guessed -- and the first threshold tried (0.02) is a useful cautionary
   tale worth keeping in this document. Single-linkage clustering chains
   transitively (A-B and B-C merge even if A-C is far apart), so at 0.02
   the initial 102-genome cohort collapsed into just **5** clusters (sizes
   43/41/10/5/3) -- useless for a grouped split, since one held-out fold
   would just be one mega-cluster. Sweeping the threshold against this
   cohort's own pairwise Mash distances showed the chaining transition:

   | threshold | groups | largest cluster |
   |---|---|---|
   | 0.001 | 91 | 7 |
   | 0.003 | 71 | 19 |
   | 0.005 | 56 | 25 |
   | 0.008 | 45 | 25 |
   | 0.01  | 35 | 25 |
   | 0.015 | 14 | 43 |
   | 0.02  | 5  | 43 |

   For the initial 102-genome threshold sweep, 0.01 was the largest threshold
   before chaining accelerated sharply (14 vs. 35 groups going from 0.015 to
   0.01). The expanded 414-genome cohort realizes **54 groups**, with a
   largest single-linkage cluster of 112 genomes. The threshold was kept fixed
   before retraining rather than tuned against held-out performance; the
   larger cluster and resulting fold imbalance remain limitations to report.
   Re-run
   `build_groups.py --threshold <value>` and inspect the printed
   percentiles/group-size distribution before trusting a different value on
   a different or larger cohort -- the right threshold is a property of the
   actual pairwise-distance distribution, not a fixed constant. See
   `data/groups.json` for the realized group-size distribution on this
   cohort.
5. `group_id` is the column `scripts/train-baseline.js` uses for the
   grouped train/calibration/test split -- the same clustering answers
   both the de-duplication requirement and the "genetically related group"
   split requirement, by design.

## 4. Feature table: `data/features.csv`

`build_features.js` reuses `src/config.js`'s `ANTIBIOTICS` marker regex
patterns and `src/features.js`'s `extractAntibioticFeatures` function
directly -- not a reimplementation -- so training features and live
inference features are computed by identical code. Schema:

```
sample_id,group_id,antibiotic,label,marker_count,mutation_count,target_confirmed
```

`label` is `1` for `Resistant`, `0` for `Susceptible`. `marker_count` /
`mutation_count` are raw (uncapped) counts of AMRFinderPlus hits matching
that antibiotic's marker patterns, split by evidence category (known
gene vs. known point mutation). `target_confirmed` is `1` when the
antibiotic's required molecular target context is confirmed; in this
BV-BRC *E. coli* cohort it is fixed at `1`, while live FASTA-only
inference now detects the required target locus signatures directly from
the uploaded assembly when no GFF is supplied.

## 5. Training and calibration: `scripts/train-baseline.js`

- One independently-fit regularized logistic regression per antibiotic.
- **3-way grouped split**: groups are deterministically assigned to test
  (20%), calibration (20% of the remainder), and train (the rest). No
  `group_id` appears in more than one split.
- **Calibration**: thresholds for `likely_to_fail` / `likely_to_work` are
  chosen on the calibration split only (never on test), searching for the
  smallest/largest threshold that reaches >=85% precision on that class,
  falling back to a fixed 0.67/0.33 band when calibration support is too
  thin to trust. This directly ties the no-call band to measured
  performance instead of a guessed constant.
- **Reported metrics** (on the held-out test split only): balanced
  accuracy, resistant/susceptible recall, F1, AUROC, PR-AUC (average
  precision), Brier score, a 5-bin reliability table, no-call rate, and
  accuracy among called (non-no-call) predictions. AUROC/PR-AUC/Brier are
  computed on the continuous probability for every test row (threshold-
  independent); the recall/F1/balanced-accuracy figures are computed on
  called predictions only, alongside the no-call rate, so a model can't
  inflate them by abstaining on everything.

## 6. Wiring into the live app

`src/predictor.js` loads `models/<antibioticId>.json` at startup if present
and uses its trained weights and calibrated thresholds; if no trained
artifact exists yet for an antibiotic, it falls back to the illustrative
placeholder weights in `src/config.js`. Every prediction reports which one
produced it via the `modelSource` field (`trained_baseline:<timestamp>` or
`heuristic_placeholder`), so the report never silently presents a
placeholder as a measured result.

## Reproducing from scratch

```bash
conda create -n amrfinder -c conda-forge -c bioconda ncbi-amrfinderplus
conda create -n bioutils -c conda-forge -c bioconda mash
conda run -n amrfinder amrfinder -u

python3 data/scripts/fetch_bvbrc_cohort.py --target-per-class 100
bash data/scripts/run_amrfinder_batch.sh
conda run -n bioutils python3 data/scripts/build_groups.py --threshold 0.01
node data/scripts/build_features.js
node scripts/train-baseline.js data/features.csv ciprofloxacin
node scripts/train-baseline.js data/features.csv ceftriaxone
node scripts/train-baseline.js data/features.csv gentamicin
```

## Realized results (this cohort, this run)

| Antibiotic | train/calib/test groups | test n (called) | no-call rate | balanced acc. | resistant recall | susceptible recall | F1 | AUROC | PR-AUC | Brier |
|---|---|---|---|---|---|---|---|---|---|---|
| ciprofloxacin | 30/11/11 | 158 (148) | 0.063 | 0.958 | 0.983 | 0.933 | 0.983 | 0.987 | 0.996 | 0.029 |
| ceftriaxone | 24/8/9 | 71 (71) | 0.000 | 0.972 | 0.945 | 1.000 | 0.972 | 0.973 | 0.991 | 0.068 |
| gentamicin | 32/11/11 | 151 (151) | 0.000 | 0.903 | 0.964 | 0.842 | 0.864 | 0.947 | 0.922 | 0.078 |

Regenerate with `node scripts/train-baseline.js data/features.csv <antibiotic>`; full artifacts (thresholds, per-bin reliability, feature weights) are in `models/<antibiotic>.json`.

**Read these numbers skeptically, not as a headline.** Held-out test sets are now 71-158 rows across 9-11 genetic groups, which is substantially more informative than the initial 17-24-row evaluation but still an internal grouped split rather than an external validation cohort. The 54 Mash groups are also uneven (the largest contains 112 genomes), so lineage composition can still move these metrics. AMR-gene-based logistic regression genuinely does score very high on well-characterized *E. coli* + these three drugs in the published literature, which is consistent with what happened here, but this cohort is not large enough to certify clinical performance -- see "Known limits" below and the brief's own note: *"published baseline models perform strongly for some well-documented bacteria and antibiotics, but results depend on label quality, class balance, genetic similarity between samples, and how the data is split."*

**A genuine, honest finding worth flagging rather than hiding:** expanding the cohort revised the ciprofloxacin `marker_count` coefficient from the initial model's slight negative value (-0.20) to a positive value (+0.54); `mutation_count` remains more strongly positive (+2.26). That is exactly why the earlier coefficient was documented as provisional rather than presented as settled biology. The current artifact reports what this cohort learned, while the held-out metrics and evidence gate -- not a biological story attached to one fitted coefficient -- should carry the demo claim.

## Known limits of this cohort (state them, don't hide them)

- 414 genomes / ~100 genomes per class-bucket is still below the brief's
  organizer-recommended 1,000-3,000 genome scale. It is enough to prove
  the full real-data path end-to-end (download -> QC -> AMRFinderPlus ->
  grouping -> calibrated training -> honest held-out evaluation), and the
  larger held-out folds here (71-158 rows vs. the initial 17-24) are
  meaningfully more informative, but still not enough for the resulting
  per-drug metrics to establish real-world performance. Re-running with a
  larger `--target-per-class`
  is the direct way to scale this up; the bottleneck is AMRFinderPlus
  wall-clock time on a 2-core host (~25-35s/genome), not the data
  availability -- BV-BRC has 15,000+ E. coli genomes with laboratory AMR
  phenotypes for ciprofloxacin/gentamicin alone.
- The live target-context gate now uses explicit target-locus evidence:
  imported GFF annotation when supplied, otherwise a conservative FASTA
  scan for the required target locus signatures. The cohort feature table
  records this as `target_confirmed`, but the current BV-BRC training rows
  are all supported *E. coli* contexts and therefore do not estimate
  performance on target-missing assemblies.
- No organizer-pinned hidden test set exists for this team; `test`
  metrics in each `models/<antibiotic>.json` are this pipeline's own
  held-out grouped split, not an external hidden evaluation.
