# gentamicin baseline model card

## Intended use

Research-only early warning for antibiotic failure in the explicitly supported species. Predictions require AMRFinderPlus evidence, genome QC, target-locus confirmation for likely-to-work calls, and confirmation by phenotypic AST and qualified clinical review.

## Training design

- Model: L2-regularized logistic regression
- Split: deterministic group-level train / calibration / test
- Groups: 20 train, 7 calibration, 7 test
- Calibration: threshold calibration fitted on the calibration split only
- Abstention thresholds: likely-to-work <= 0.1; likely-to-fail >= 0.67; otherwise no-call

## Held-out test metrics

- Samples: 23
- Balanced accuracy: 1
- Resistant recall: 1
- Susceptible recall: 1
- Resistant F1: 1
- AUROC: 1
- PR-AUC: 1
- Brier score: 0.032
- No-call rate: 0
- Accuracy among called samples: 1

## Limitations

These metrics describe only the supplied grouped test set. They do not establish clinical validity, transportability across sites, or performance on unseen species, lineages, sequencing platforms, or resistance mechanisms.
