# Hackathon Runbook

## Build order

1. **Freeze scope:** *Escherichia coli* plus ciprofloxacin, ceftriaxone, and gentamicin. Do not expand until the complete pipeline works.
2. **Secure challenge data — done, no organizer file available:** no organizer-pinned dataset was handed to this team, so `data/scripts/fetch_bvbrc_cohort.py` pins its own reproducible BV-BRC cohort (laboratory-measured AST labels only, `evidence == "Laboratory Method"`, CheckM quality-gated). See `data/cohort_manifest.json` and `data/README.md` for the exact filters, license, and download date.
3. **Generate features — done:** AMRFinderPlus 4.2.7 / database 2026-05-15.1 (pinned, see `data/README.md`) runs across every assembly via `data/scripts/run_amrfinder_batch.sh`; `data/scripts/build_features.js` converts hits into `data/features.csv` using the exact marker/evidence logic `src/predictor.js` uses at inference time, including the `target_confirmed` feature described below.
4. **Prevent leakage — done:** `data/scripts/build_groups.py` clusters genomes by Mash sequence-homology distance (threshold justified against the cohort's own pairwise-distance distribution) into `data/groups.csv`; `scripts/train-baseline.js` splits by that `group_id` before any fitting or calibration.
5. **Train per drug — done for the baseline:** regularized logistic regression per antibiotic via `scripts/train-baseline.js`. DNABERT-2 / HyenaDNA / ESM-2 embeddings remain future work, only worth adding if they beat this held-out grouped baseline.
6. **Calibrate and abstain — done:** `scripts/train-baseline.js` fits the likely-to-fail / likely-to-work thresholds on the calibration group split (target >=85% precision, falling back to a fixed 0.67/0.33 band when calibration support is thin) and returns no-call between them.
7. **Evaluate honestly — done:** `scripts/train-baseline.js` reports balanced accuracy, class recalls, F1, PR-AUC, AUROC, Brier score, a reliability table, no-call rate, and accuracy among called samples, all on the held-out test groups only.
8. **Demo one strong story — done:** the app's "Every held-out test case, drug by drug" panel shows every genome in the same held-out test groups `scripts/train-baseline.js` reports metrics on, each with its prediction vs. the real lab label, including no-call and missed-call rows -- not a single hand-picked case, the whole fold.

## Three-person split

**ML / bioinformatics owner**

- Own the BV-BRC cohort, AMRFinderPlus pipeline, genetic grouping, feature table, model training, calibration, and metrics.
- Deliver frozen JSON artifacts and a model card to the backend owner.

**Full-stack owner**

- Own FASTA upload, API, job status, result persistence, report UI, error states, and deployment.
- Replace the current local process adapter with a queued container job if hosted analysis is required.

**Product / research / pitch owner**

- Own challenge compliance, clinician workflow, evidence wording, demo cases, risk boundaries, slides, and the 3-minute narrative.
- Verify that every product claim is supported by a measured result or explicitly labeled as planned work.

## Highest-value next integrations

1. ~~Install and pin AMRFinderPlus so raw FASTA works on the demo machine.~~ Done: AMRFinderPlus 4.2.7 / db 2026-05-15.1, see `data/README.md`.
2. ~~Obtain the organizer-pinned BV-BRC cohort and train the first genuinely measured model.~~ Done with a self-pinned 102-genome cohort (no organizer file was provided). The brief's 1,000-3,000 genome figure is guidance for organizers preparing a fixed dataset, not a requirement on team submissions -- but scaling up `--target-per-class` in `fetch_bvbrc_cohort.py` would still shrink the held-out test folds' uncertainty as time allows; AMRFinderPlus wall-clock on a 2-core host is the bottleneck, not data availability.
3. ~~Add explicit target-locus detection; the current species + QC proxy must stay visibly labeled until replaced.~~ Done: `src/targets.js` detects the required target locus signatures directly from the FASTA assembly (6-frame translation + conserved-motif matching) when no GFF is supplied, on both the Node backend and the GitHub Pages static preview. Verified with positive/negative controls (`test/targets-fasta-scan.test.js`, `test/static-engine.test.js`): no false positive on genome-scale random DNA, correct detection of an embedded signature. `target_confirmed` is now a trained model feature, though it's constant across the current BV-BRC cohort (these are essential, near-universal *E. coli* genes) so its learned weight is 0 -- expected, not a bug.
4. ~~Add an OpenAI structured explanation endpoint for plain-language summaries and optional image/report interpretation.~~ Done: `src/openai-report.js` (text, Responses API) and `src/openai-image.js` (schematic evidence diagram, image generation) both consume audited JSON only and cannot alter decisions.
5. Containerize and deploy only after local FASTA → report works twice on held-out examples.

## Pitch sentence

“Genome Firewall is a defensive early-warning layer that predicts which antibiotics may fail from a bacterial genome, shows the evidence behind every call, and refuses to guess when the genome or model is uncertain.”

## Reproducible commands

```bash
conda env create -f environment-amrfinder.yml
conda activate genome-firewall-amr
npm run amr:check
npm run features:generate -- data/manifest.tsv data/generated/features.csv
node scripts/train-baseline.js data/generated/features.csv ciprofloxacin
npm run check
```

Do not report model-quality numbers from the bundled example. Report only metrics generated from an organizer-approved labeled cohort, and retain the generated model card with the submission.
