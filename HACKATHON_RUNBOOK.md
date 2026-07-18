# Hackathon Runbook

## Build order

1. **Freeze scope:** *Escherichia coli* plus ciprofloxacin, ceftriaxone, and gentamicin. Do not expand until the complete pipeline works.
2. **Secure challenge data:** export organizer-pinned BV-BRC laboratory AMR labels and sequence-homology group IDs. Keep a data manifest with license, date, filters, and label mapping.
3. **Generate features:** run one pinned AMRFinderPlus version/database across every assembly. Convert hits into a sample-by-feature matrix and add explicit target-locus detection.
4. **Prevent leakage:** cluster genomes by sequence similarity or use organizer-provided relatedness groups. Split by group before any fitting or calibration.
5. **Train per drug:** regularized logistic regression first. Only add DNABERT-2, HyenaDNA, or ESM-2 embeddings if they improve held-out grouped performance.
6. **Calibrate and abstain:** fit probability calibration on validation groups, choose two thresholds for resistant/susceptible calls, and return no-call between them.
7. **Evaluate honestly:** balanced accuracy, class recalls, F1, PR-AUC, AUROC, Brier score, reliability plot, no-call rate, and accuracy among called samples.
8. **Demo one strong story:** load a held-out case, show AMRFinderPlus evidence, compare the early prediction with the hidden lab label, and explain why the system abstains on an uncertain case.

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

1. Install and pin AMRFinderPlus so raw FASTA works on the demo machine.
2. Obtain the organizer-pinned BV-BRC cohort and train the first genuinely measured model.
3. Add explicit target-locus detection; the current species + QC proxy must stay visibly labeled until replaced.
4. Add an OpenAI structured explanation endpoint for plain-language summaries and optional image/report interpretation. It must consume audited JSON and cannot alter decisions.
5. Containerize and deploy only after local FASTA → report works twice on held-out examples.

## Pitch sentence

“Genome Firewall is a defensive early-warning layer that predicts which antibiotics may fail from a bacterial genome, shows the evidence behind every call, and refuses to guess when the genome or model is uncertain.”
