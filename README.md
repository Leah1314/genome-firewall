# Genome Firewall

Genome Firewall is a defensive antibiotic-failure early-warning prototype for the OpenAI × Hack-Nation challenge. It accepts one quality-checked *Escherichia coli* FASTA assembly, incorporates AMRFinderPlus evidence, and returns a drug-level `likely to fail`, `likely to work`, or `no-call` report with traceable evidence.

This is research decision support, not a diagnostic device or treatment recommendation. Every output must be confirmed with standard antimicrobial susceptibility testing and qualified clinical review.

## Run it

```bash
npm start
```

Open `http://127.0.0.1:4180`. Choose **Load example case** for the fastest end-to-end demo.

No npm installation is required. The server uses Node.js built-ins and serves a local API and web interface.

## What works now

- FASTA parsing and deterministic assembly QC.
- One explicitly supported species: *Escherichia coli*.
- Automatic AMRFinderPlus execution when the `amrfinder` command is installed.
- Import of a standard AMRFinderPlus TSV when the scanner is not installed on the app host.
- Separate risk logic for ciprofloxacin, ceftriaxone, and gentamicin.
- Target-context gate, confidence, no-call, evidence provenance, and policy audit.
- A real BV-BRC + AMRFinderPlus + Mash data pipeline (see [data/README.md](./data/README.md)) that pins a reproducible *E. coli* cohort from laboratory-measured AST results, groups it by genetic relatedness, and feeds a grouped-split, calibrated logistic-regression trainer.
- `src/predictor.js` automatically loads a trained `models/<antibiotic>.json` artifact when one exists and reports `modelSource` (`trained_baseline:*` vs `heuristic_placeholder`) on every prediction, so the report never silently presents a placeholder as a measured result.
- Responsive decision-report interface and a bundled non-biological example case.
- Optional OpenAI Responses API Report Agent that receives audited JSON only and cannot alter classifier decisions.
- Optional OpenAI image-generation Evidence Diagram Agent (`src/openai-image.js`, `POST /api/evidence-image`): renders one audited prediction as a schematic evidence -> target -> decision infographic. Template-built prompt, audited fields only, explicitly forbids photorealistic or organism-modification imagery. Set `OPENAI_API_KEY` (and optionally `OPENAI_IMAGE_MODEL`, default `gpt-image-2`) to enable.

## Verify it

```bash
npm run check
curl http://127.0.0.1:4180/api/health
```

## Train a baseline

`data/README.md` documents the full, repeatable path from BV-BRC + AMRFinderPlus + Mash to `data/features.csv` in the required schema:

```text
sample_id,group_id,antibiotic,label,marker_count,mutation_count
```

`group_id` is a Mash sequence-homology cluster, not a random row ID (see `data/scripts/build_groups.py`). To (re)train after regenerating `data/features.csv`:

```bash
node scripts/train-baseline.js data/features.csv ciprofloxacin
node scripts/train-baseline.js data/features.csv ceftriaxone
node scripts/train-baseline.js data/features.csv gentamicin
```

The script performs a 3-way grouped split (train / calibration / held-out test, no `group_id` in more than one split), fits calibrated no-call thresholds on the calibration split, and reports on the held-out test split only: balanced accuracy, resistant/susceptible recall, F1, AUROC, PR-AUC, Brier score, a 5-bin reliability table, no-call rate, and accuracy among called predictions. `src/predictor.js` picks up the resulting `models/<antibiotic>.json` automatically, and the same numbers are shown live in the demo's "Model performance on held-out data" panel via `GET /api/model-info`.

Current realized results (102-genome cohort, see "Realized results" in [data/README.md](./data/README.md) for the full table and — importantly — why these small-test-set numbers should be read skeptically rather than as a headline): balanced accuracy 0.955-1.00, AUROC 0.955-1.00 across the three antibiotics, on held-out test folds of only 17-24 genomes each.

## Honest current limits

- The real-data cohort behind the current `models/*.json` is a 102-genome, ~25-per-class-bucket BV-BRC sample (see "Known limits of this cohort" in [data/README.md](./data/README.md)) -- enough to exercise the full pipeline honestly, not enough to claim confident real-world performance. No coefficients are presented as clinically validated.
- No organizer-pinned hidden test set was provided to this team; reported metrics are this pipeline's own held-out grouped split, not an external hidden evaluation.
- The current target gate uses supported-species identity plus assembly QC as a transparent proxy. A production submission should add explicit target-locus detection from an annotation pipeline.
- A complete FASTA-only scan requires AMRFinderPlus on the host. Without it, upload the matching TSV; otherwise susceptible calls are disabled.
- The project deliberately does not generate organism modifications, optimize pathogens, prescribe antibiotics, or make autonomous treatment decisions.

See [AGENTS.md](./AGENTS.md) for the product agents and [HACKATHON_RUNBOOK.md](./HACKATHON_RUNBOOK.md) for the team execution order.
