# Model artifacts

`scripts/train-baseline.js` writes one schema-v2 JSON artifact and one model card per antibiotic here. The Node API automatically loads a matching artifact at analysis time and reports `trained_artifact` as the model source. If no artifact exists, it uses the visibly labeled bundled integration baseline.

Do not add an artifact to a release unless its model card identifies the cohort, grouped split, held-out metrics, limitations, and exact feature-generation versions.
