# ciprofloxacin baseline model card

## Intended use

Research-only early warning for antibiotic failure in the explicitly supported species. Predictions require AMRFinderPlus evidence, genome QC, target-locus confirmation for likely-to-work calls, and confirmation by phenotypic AST and qualified clinical review.

## Training design

- Model: L2-regularized logistic regression
- Split: deterministic group-level train / calibration / test
- Groups: 30 train, 11 calibration, 11 test
- Calibration: threshold calibration fitted on the calibration split only
- Abstention thresholds: likely-to-work <= 0.1; likely-to-fail >= 0.67; otherwise no-call

## Held-out test metrics

- Samples: 158
- Balanced accuracy: 0.958
- Resistant recall: 0.983
- Susceptible recall: 0.933
- Resistant F1: 0.983
- AUROC: 0.987
- PR-AUC: 0.996
- Brier score: 0.029
- No-call rate: 0.063
- Accuracy among called samples: 0.973

## Limitations

These metrics describe only the supplied grouped test set. They do not establish clinical validity, transportability across sites, or performance on unseen species, lineages, sequencing platforms, or resistance mechanisms.
