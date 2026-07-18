# ceftriaxone baseline model card

## Intended use

Research-only early warning for antibiotic failure in the explicitly supported species. Predictions require AMRFinderPlus evidence, genome QC, target-locus confirmation for likely-to-work calls, and confirmation by phenotypic AST and qualified clinical review.

## Training design

- Model: L2-regularized logistic regression
- Split: deterministic group-level train / calibration / test
- Groups: 13 train, 5 calibration, 5 test
- Calibration: threshold calibration fitted on the calibration split only
- Abstention thresholds: likely-to-work <= 0.33; likely-to-fail >= 0.67; otherwise no-call

## Held-out test metrics

- Samples: 17
- Balanced accuracy: 0.955
- Resistant recall: 0.909
- Susceptible recall: 1
- Resistant F1: 0.952
- AUROC: 0.955
- PR-AUC: 0.976
- Brier score: 0.065
- No-call rate: 0
- Accuracy among called samples: 0.941

## Limitations

These metrics describe only the supplied grouped test set. They do not establish clinical validity, transportability across sites, or performance on unseen species, lineages, sequencing platforms, or resistance mechanisms.
