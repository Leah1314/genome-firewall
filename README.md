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
- A zero-dependency grouped-split logistic-regression trainer for labeled feature tables.
- Responsive decision-report interface and a bundled non-biological example case.
- Optional OpenAI Responses API Report Agent that receives audited JSON only and cannot alter classifier decisions.

## Verify it

```bash
npm run check
curl http://127.0.0.1:4180/api/health
```

## Train a baseline

Prepare one CSV with these required columns:

```text
sample_id,group_id,antibiotic,label,marker_count,mutation_count
```

`group_id` must be a genetic cluster or sequence-homology group, not a random row ID. Then run:

```bash
node scripts/train-baseline.js data/features.csv ciprofloxacin
```

The script writes a model artifact and held-out grouped-split metrics under `models/`. Before presenting model quality, extend evaluation to include balanced accuracy, resistant and susceptible recall, F1, PR-AUC, AUROC, Brier score, calibration bins, no-call rate, and accuracy on called predictions.

## Honest current limits

- The included coefficients are an executable baseline for integration testing; they are not claimed to be clinically validated or calibrated on the hidden challenge set.
- The current target gate uses supported-species identity plus assembly QC as a transparent proxy. A production submission should add explicit target-locus detection from an annotation pipeline.
- A complete FASTA-only scan requires AMRFinderPlus on the host. Without it, upload the matching TSV; otherwise susceptible calls are disabled.
- The project deliberately does not generate organism modifications, optimize pathogens, prescribe antibiotics, or make autonomous treatment decisions.

See [AGENTS.md](./AGENTS.md) for the product agents and [HACKATHON_RUNBOOK.md](./HACKATHON_RUNBOOK.md) for the team execution order.
