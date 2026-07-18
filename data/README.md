# Dataset contract

Genome Firewall does not ship biological sequences or clinical labels. Put local inputs outside version control and describe every cohort with a manifest derived from `manifest.example.tsv`.

## Required sample fields

- `sample_id`: stable, de-identified sample identifier.
- `group_id`: sequence-homology or lineage cluster used to prevent train/test leakage.
- `species`: currently only `Escherichia coli`.
- `fasta_path`: assembly FASTA path relative to the manifest.
- `gff_path`: matching GFF3 annotation containing target loci.
- Drug columns: binary phenotypic labels (`1` resistant/failure, `0` susceptible/work); blank means unavailable.

## Provenance fields to record separately

Record the source, license, retrieval date, inclusion filters, label mapping, sequencing platform when known, AMRFinderPlus software version, AMRFinderPlus database version, annotation tool/version, and the code commit that generated features.

Never commit patient identifiers, raw protected health information, organizer-restricted data, or licensed datasets that prohibit redistribution.
