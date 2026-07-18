# Genome Firewall

Genome Firewall is a defensive antibiotic-failure early-warning system for the OpenAI × Hack-Nation challenge. It accepts one quality-checked *Escherichia coli* FASTA assembly, AMRFinderPlus evidence, and a matching GFF3 annotation, then returns a drug-level `likely to fail`, `likely to work`, or `no-call` report with traceable evidence.

This is research decision support, not a diagnostic device or treatment recommendation. Every output must be confirmed with standard antimicrobial susceptibility testing and qualified clinical review.

## Run it

```bash
npm start
```

Open `http://127.0.0.1:4180`. Choose **Load example case** for the fastest end-to-end demo.

Public GitHub Pages preview: `https://leah1314.github.io/genome-firewall/`. On Pages, FASTA and AMRFinderPlus TSV analysis runs locally in the browser; the optional OpenAI Report Agent requires the Node backend.

No npm installation is required. The server uses Node.js built-ins and serves a local API and web interface.

## What works now

- FASTA parsing and deterministic assembly QC.
- One explicitly supported species: *Escherichia coli*.
- Automatic AMRFinderPlus execution when the `amrfinder` command is installed.
- Import of a standard AMRFinderPlus TSV when the scanner is not installed on the app host.
- Separate risk logic for ciprofloxacin, ceftriaxone, and gentamicin.
- Explicit drug-target detection from GFF3, confidence, no-call, evidence provenance, and policy audit.
- A zero-dependency grouped train/validation/test logistic-regression trainer with Platt calibration, validation-selected abstention thresholds, held-out metrics, and model-card export.
- Automatic schema-v2 model-artifact loading in the Node API, with the model source exposed in every drug-level result.
- Responsive decision-report interface and a bundled non-biological example case.
- Optional OpenAI Responses API Report Agent that receives audited JSON only and cannot alter classifier decisions.

## Verify it

```bash
npm run check
curl http://127.0.0.1:4180/api/health
```

## Reproducible AMR environment

AMRFinderPlus is intentionally not bundled into the browser build. Create the pinned Bioconda environment on the analysis machine:

```bash
conda env create -f environment-amrfinder.yml
conda activate genome-firewall-amr
npm run amr:check
```

Build the feature table from a local cohort manifest:

```bash
npm run features:generate -- data/manifest.tsv data/generated/features.csv
```

The manifest contract and required provenance are documented in [data/README.md](./data/README.md).

## Train and evaluate a baseline

Prepare one CSV with these required columns:

```text
sample_id,group_id,antibiotic,label,marker_count,mutation_count
```

`group_id` must be a genetic cluster or sequence-homology group, not a random row ID. Then run:

```bash
node scripts/train-baseline.js data/features.csv ciprofloxacin
```

The script writes a JSON model artifact and Markdown model card under `models/`. Related genomes stay in one split. The model is fitted on training groups, Platt calibration and no-call thresholds are fitted on validation groups, and final metrics are reported once on test groups. Metrics include class recalls, balanced accuracy, resistant precision/F1, AUROC, PR-AUC, Brier score, reliability bins, no-call rate, and accuracy among called predictions.

The Node API automatically serves a matching schema-v2 artifact from `models/`. GitHub Pages remains a browser-only preview and visibly uses the bundled integration baseline because it cannot execute the native AMRFinderPlus or load server-side trained artifacts.

## Honest current limits

- The included coefficients are an executable baseline for integration testing; they are not claimed to be clinically validated or calibrated on the hidden challenge set.
- A complete analysis requires a matching GFF3 annotation to confirm drug targets. Without it, likely-to-work calls are disabled.
- A complete FASTA scan requires AMRFinderPlus on the host. On GitHub Pages, upload the matching TSV because browsers cannot execute the native scanner.
- GFF target presence establishes context only; it does not prove target function or phenotypic susceptibility.
- The project deliberately does not generate organism modifications, optimize pathogens, prescribe antibiotics, or make autonomous treatment decisions.

See [AGENTS.md](./AGENTS.md) for the product agents and [HACKATHON_RUNBOOK.md](./HACKATHON_RUNBOOK.md) for the team execution order.
