# Data license and attribution

## BV-BRC genome and AMR phenotype data

- Source: Bacterial and Viral Bioinformatics Resource Center (BV-BRC),
  <https://www.bv-brc.org/>, formerly PATRIC (Pathosystems Resource
  Integration Center).
- BV-BRC is developed and hosted with U.S. federal funding (NIAID) and its
  data are freely available for research and public-health use. See
  <https://www.bv-brc.org/docs/policies_privacy/> for BV-BRC's data use and
  citation policy.
- Accessed via the public BV-BRC Data REST API (`https://www.bv-brc.org/api/`),
  read-only, no authentication.
- Cohort pinned: see `data/cohort_manifest.json` for the exact genome_ids,
  laboratory AST records (with `pmid` citations where BV-BRC records one),
  and download date for every genome used to train the models in `models/`.
- Suggested citation: Olson RD, Assaf R, Brettin T, et al. "Introducing the
  Bacterial and Viral Bioinformatics Resource Center (BV-BRC): a
  resource combining PATRIC, IRD and ViPR." *Nucleic Acids Research*,
  2023.

## AMRFinderPlus

- Source: National Center for Biotechnology Information (NCBI),
  <https://github.com/ncbi/amr>.
- Public domain / unrestricted, per the challenge brief and the tool's own
  repository.
- Pinned version used in this project: AMRFinderPlus 4.2.7, reference
  gene/mutation database version 2026-05-15.1. See `data/README.md` for
  install and pin instructions.
- Suggested citation: Feldgarden M, Brover V, Gonzalez-Escalona N, et al.
  "AMRFinderPlus and the Reference Gene Catalog facilitate examination of
  the genomic links among antimicrobial resistance, stress response, and
  virulence." *Scientific Reports*, 2021.

## Mash

- Source: <https://github.com/marbl/Mash>, BSD-3-Clause license.
- Used only for genome-to-genome distance estimation to build
  sequence-homology groups (`data/groups.csv`); no Mash code is bundled in
  this repository, it is installed separately (see `data/README.md`).
- Suggested citation: Ondov BD, Treangen TJ, Melsted P, et al. "Mash: fast
  genome and metagenome distance estimation using MinHash." *Genome
  Biology*, 2016.

## This project's own data artifacts

`data/cohort_manifest.json`, `data/groups.csv`, `data/groups.json`,
`data/features.csv`, and `models/*.json` are derived works produced by this
project's own scripts (`data/scripts/`, `scripts/train-baseline.js`) from
the public sources above, released under the same MIT license as the rest
of this repository (see the root `package.json`).
