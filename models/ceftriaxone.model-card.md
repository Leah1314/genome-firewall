# ceftriaxone baseline model card

## Intended use

Research-only early warning for antibiotic failure in the explicitly supported species. Predictions require AMRFinderPlus evidence, genome QC, target-locus confirmation for likely-to-work calls, and confirmation by phenotypic AST and qualified clinical review.

## Training design

- Model: L2-regularized logistic regression
- Split: deterministic group-level train / calibration / test
- Groups: 24 train, 8 calibration, 9 test
- Calibration: threshold calibration fitted on the calibration split only
- Abstention thresholds: likely-to-work <= 0.15; likely-to-fail >= 0.5; otherwise no-call

## Held-out test metrics

- Samples: 71
- Balanced accuracy: 0.972
- Resistant recall: 0.945
- Susceptible recall: 1
- Resistant F1: 0.972
- AUROC: 0.973
- PR-AUC: 0.991
- Brier score: 0.068
- No-call rate: 0
- Accuracy among called samples: 0.958

## Limitations

These metrics describe only the supplied grouped test set. They do not establish clinical validity, transportability across sites, or performance on unseen species, lineages, sequencing platforms, or resistance mechanisms.
