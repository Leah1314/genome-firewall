#!/usr/bin/env python3
"""
Build a fixed, documented, repeatable Genome Firewall training cohort from BV-BRC.

The organizer challenge brief expects a fixed challenge dataset pinned by the
organizers. No such pinned file was provided to this team, so this script pins
its own reproducible cohort: it queries the public BV-BRC Data API on a fixed
date, writes every selected genome_id, its laboratory-measured AMR phenotypes,
and its quality metadata into data/cohort_manifest.json, and downloads the
matching genome FASTA files. Re-running this script with the same arguments
against the same manifest reproduces the same cohort; re-downloading only the
FASTA files (--from-manifest) is fully deterministic even if BV-BRC content
changes upstream, because the manifest is the pinned source of truth once written.

Compliance with the challenge brief:
  - Species: Escherichia coli only (NCBI taxon_id 562), matching
    src/config.js SUPPORTED_SPECIES.
  - Antibiotics: ciprofloxacin, ceftriaxone, gentamicin, matching
    src/config.js ANTIBIOTICS. (Module 02 scope: "a few antibiotics well".)
  - Labels: evidence == "Laboratory Method" only. BV-BRC's genome_amr
    collection also contains "Computational Method" (model-generated MIC
    predictions) rows; the brief explicitly excludes those.
  - Only Resistant / Susceptible rows are kept as ground truth. Intermediate
    and any other AST category are dropped rather than force-labeled, in
    keeping with the brief's "honest no-call" principle -- those genomes are
    simply not used as training/eval ground truth for that antibiotic.
  - Genome quality: CheckM-based BV-BRC quality flags (genome_quality,
    checkm_completeness, checkm_contamination) plus an assembly-size band
    around the E. coli reference size, mirroring the assembly QC gate
    already enforced at inference time in src/fasta.js.

Data source: BV-BRC (bv-brc.org), formerly PATRIC. BV-BRC data are produced
with U.S. federal funding and are freely available for use; see
https://www.bv-brc.org/docs/policies_privacy/. This script is read-only
against the public REST API (https://www.bv-brc.org/api/) -- no credentials,
no bulk FTP (blocked from this sandbox; the REST API is used to reconstruct
FASTA instead of the FTP mirror).

Usage:
  python3 data/scripts/fetch_bvbrc_cohort.py --target-per-class 25
  python3 data/scripts/fetch_bvbrc_cohort.py --from-manifest data/cohort_manifest.json
"""
import argparse
import hashlib
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

API_BASE = "https://www.bv-brc.org/api"
TAXON_ID = 562  # NCBI taxonomy id for Escherichia coli
ANTIBIOTICS = ["ciprofloxacin", "ceftriaxone", "gentamicin"]
KEEP_PHENOTYPES = {"Resistant", "Susceptible"}
MAX_ROWS = 20000  # comfortably above the largest single-antibiotic result count observed (~15.8k)
# Assembly QC band: matches src/config.js SUPPORTED_SPECIES expectedGenomeRange
# but tightened, since we additionally require CheckM completeness/contamination.
MIN_GENOME_LEN = 4_000_000
MAX_GENOME_LEN = 6_200_000
MIN_COMPLETENESS = 95.0
MAX_CONTAMINATION = 5.0

ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT / "data"
GENOME_DIR = DATA_DIR / "raw" / "genomes"
MANIFEST_PATH = DATA_DIR / "cohort_manifest.json"


def fetch_amr_labels(antibiotic):
    """Fetch every laboratory-measured genome_amr row for one antibiotic in E. coli.

    NOTE: BV-BRC's Solr-backed API silently returns zero rows for this
    collection when the two-argument `limit(start,count)` form is combined
    with a multi-field select() and start=0 beyond a few hundred rows (a
    server-side quirk, reproduced independently of client). The single-
    argument `limit(count)` form does not have this problem and every
    antibiotic used here has well under MAX_ROWS results, so one request
    per antibiotic is sufficient and avoids the broken pagination path.
    """
    rql = (
        f"and(eq(taxon_id,{TAXON_ID}),"
        f"eq(evidence,Laboratory Method),"
        f"eq(antibiotic,{antibiotic}))"
    )
    fields = "genome_id,genome_name,antibiotic,resistant_phenotype,laboratory_typing_method,testing_standard,pmid"
    rows = api_get_raw(f"genome_amr/?{rql}&select({fields})&limit({MAX_ROWS})")
    return rows


def api_get_raw(query_suffix, retries=3):
    url = f"{API_BASE}/{query_suffix}".replace(" ", "%20")
    last_error = None
    for attempt in range(retries):
        try:
            request = urllib.request.Request(url, headers={"Accept": "application/json"})
            with urllib.request.urlopen(request, timeout=60) as response:
                return json.loads(response.read())
        except (urllib.error.URLError, TimeoutError) as error:
            last_error = error
            time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"BV-BRC API request failed after {retries} attempts: {url}") from last_error


def fetch_genome_quality(genome_ids):
    """Batch-fetch CheckM/assembly quality metadata for a set of genome_ids."""
    ids = sorted(genome_ids)
    fields = "genome_id,genome_name,genome_status,genome_quality,genome_length,contigs,checkm_completeness,checkm_contamination"
    quality = {}
    batch_size = 200
    for offset in range(0, len(ids), batch_size):
        batch = ids[offset:offset + batch_size]
        id_list = ",".join(batch)
        query = f"genome/?in(genome_id,({id_list}))&select({fields})&limit({len(batch)})"
        rows = api_get_raw(query)
        for row in rows:
            quality[row["genome_id"]] = row
    return quality


def passes_quality(record):
    if not record:
        return False
    if str(record.get("genome_quality", "")).strip().lower() != "good":
        return False
    completeness = record.get("checkm_completeness")
    contamination = record.get("checkm_contamination")
    length = record.get("genome_length")
    if completeness is None or contamination is None or length is None:
        return False
    if completeness < MIN_COMPLETENESS or contamination > MAX_CONTAMINATION:
        return False
    if length < MIN_GENOME_LEN or length > MAX_GENOME_LEN:
        return False
    return True


def fetch_genome_fasta(genome_id):
    """Reconstruct a FASTA file from BV-BRC's genome_sequence records.

    BV-BRC's FTP mirror (ftp.bvbrc.org) is not reachable from this sandbox
    network, so this uses the REST API's genome_sequence collection, which
    returns the same per-contig sequences served over FTP as .fna files.
    """
    fields = "accession,description,sequence"
    rows = api_get_raw(f"genome_sequence/?eq(genome_id,{genome_id})&select({fields})&limit(20000)")
    if not rows:
        return None
    lines = []
    for row in rows:
        header = f">{row['accession']} {row.get('description', '')}".rstrip()
        lines.append(header)
        sequence = row["sequence"]
        for start in range(0, len(sequence), 70):
            lines.append(sequence[start:start + 70])
    return "\n".join(lines) + "\n"


def deterministic_shuffle_key(value):
    """Stable pseudo-random sort key so the candidate pool isn't just the first
    alphabetical genome_id block (which tends to be one deposit batch / one
    study and would undermine cohort diversity before de-duplication even runs)."""
    return hashlib.sha256(value.encode()).hexdigest()


def stratified_candidate_pool(labels_by_antibiotic, pool_size):
    """For each antibiotic x phenotype, take a deterministic but shuffled candidate pool."""
    pools = {}
    for antibiotic, rows in labels_by_antibiotic.items():
        for phenotype in ("Resistant", "Susceptible"):
            matching = sorted(
                {row["genome_id"] for row in rows if row.get("resistant_phenotype") == phenotype},
                key=deterministic_shuffle_key,
            )
            pools[(antibiotic, phenotype)] = matching[:pool_size]
    return pools


def build_manifest(target_per_class, pool_multiplier):
    print(f"Querying BV-BRC genome_amr for taxon_id={TAXON_ID}, antibiotics={ANTIBIOTICS} ...")
    labels_by_antibiotic = {}
    for antibiotic in ANTIBIOTICS:
        rows = [row for row in fetch_amr_labels(antibiotic) if row.get("resistant_phenotype") in KEEP_PHENOTYPES]
        labels_by_antibiotic[antibiotic] = rows
        counts = {p: sum(1 for r in rows if r["resistant_phenotype"] == p) for p in KEEP_PHENOTYPES}
        print(f"  {antibiotic}: {len(rows)} laboratory-measured rows {counts}")

    pool_size = target_per_class * pool_multiplier
    pools = stratified_candidate_pool(labels_by_antibiotic, pool_size)
    candidate_ids = sorted({gid for ids in pools.values() for gid in ids})
    print(f"Fetching genome quality metadata for {len(candidate_ids)} candidate genomes ...")
    quality = fetch_genome_quality(candidate_ids)
    passing_ids = {gid for gid, record in quality.items() if passes_quality(record)}
    print(f"  {len(passing_ids)} / {len(candidate_ids)} candidates pass the quality gate")

    selected_ids = set()
    selection_by_bucket = {}
    for (antibiotic, phenotype), ids in pools.items():
        chosen = [gid for gid in ids if gid in passing_ids][:target_per_class]
        selection_by_bucket[f"{antibiotic}:{phenotype}"] = chosen
        selected_ids.update(chosen)
        print(f"  selected {len(chosen)}/{target_per_class} for {antibiotic}/{phenotype}")

    genomes = {}
    for gid in sorted(selected_ids):
        record = quality[gid]
        labels = []
        for antibiotic, rows in labels_by_antibiotic.items():
            for row in rows:
                if row["genome_id"] == gid:
                    labels.append({
                        "antibiotic": antibiotic,
                        "resistant_phenotype": row["resistant_phenotype"],
                        "laboratory_typing_method": row.get("laboratory_typing_method", ""),
                        "testing_standard": row.get("testing_standard", ""),
                        "pmid": row.get("pmid", []),
                    })
        genomes[gid] = {
            "genome_id": gid,
            "genome_name": record.get("genome_name", ""),
            "genome_status": record.get("genome_status", ""),
            "genome_quality": record.get("genome_quality", ""),
            "genome_length": record.get("genome_length"),
            "contigs": record.get("contigs"),
            "checkm_completeness": record.get("checkm_completeness"),
            "checkm_contamination": record.get("checkm_contamination"),
            "labels": labels,
        }

    manifest = {
        "schemaVersion": 1,
        "source": "BV-BRC (bv-brc.org) genome_amr + genome collections via public REST API",
        "sourceUrl": "https://www.bv-brc.org/api/",
        "license": "BV-BRC public data; U.S. federally funded resource, freely available. See https://www.bv-brc.org/docs/policies_privacy/",
        "amrfinderplus": "Cross-referenced separately at feature-generation time; see data/README.md for pinned version.",
        "taxonId": TAXON_ID,
        "species": "Escherichia coli",
        "antibiotics": ANTIBIOTICS,
        "evidenceFilter": "Laboratory Method (excludes BV-BRC Computational Method / model-generated MIC predictions)",
        "phenotypesKept": sorted(KEEP_PHENOTYPES),
        "qualityGate": {
            "genome_quality": "Good",
            "min_checkm_completeness": MIN_COMPLETENESS,
            "max_checkm_contamination": MAX_CONTAMINATION,
            "genome_length_range": [MIN_GENOME_LEN, MAX_GENOME_LEN],
        },
        "targetPerClass": target_per_class,
        "selectionByBucket": selection_by_bucket,
        "genomeCount": len(genomes),
        "genomes": genomes,
    }
    return manifest


def download_genomes(manifest, limit=None):
    GENOME_DIR.mkdir(parents=True, exist_ok=True)
    genome_ids = sorted(manifest["genomes"].keys())
    if limit:
        genome_ids = genome_ids[:limit]
    downloaded = 0
    for index, gid in enumerate(genome_ids, start=1):
        out_path = GENOME_DIR / f"{gid}.fna"
        record = manifest["genomes"][gid]
        if out_path.exists():
            print(f"[{index}/{len(genome_ids)}] {gid} already downloaded, skipping")
            continue
        print(f"[{index}/{len(genome_ids)}] downloading {gid} ({record.get('genome_name', '')}) ...")
        fasta = fetch_genome_fasta(gid)
        if not fasta:
            print(f"  WARNING: no sequence returned for {gid}, skipping")
            continue
        out_path.write_text(fasta)
        record["fastaPath"] = str(out_path.relative_to(ROOT))
        record["fastaSha256"] = hashlib.sha256(fasta.encode()).hexdigest()
        record["fastaBytes"] = len(fasta)
        downloaded += 1
    return downloaded


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--target-per-class", type=int, default=25,
                         help="Genomes to select per antibiotic x {Resistant,Susceptible} bucket (default: 25)")
    parser.add_argument("--pool-multiplier", type=int, default=5,
                         help="Oversampling factor before the quality gate (default: 5)")
    parser.add_argument("--from-manifest", type=str, default=None,
                         help="Skip the API query and only (re)download FASTA for genomes already in this manifest")
    parser.add_argument("--limit-downloads", type=int, default=None,
                         help="Cap the number of genomes downloaded this run (for incremental runs)")
    args = parser.parse_args()

    if args.from_manifest:
        manifest = json.loads(Path(args.from_manifest).read_text())
    else:
        manifest = build_manifest(args.target_per_class, args.pool_multiplier)
        MANIFEST_PATH.write_text(json.dumps(manifest, indent=2, sort_keys=False))
        print(f"Wrote pinned manifest: {MANIFEST_PATH} ({manifest['genomeCount']} genomes)")

    downloaded = download_genomes(manifest, limit=args.limit_downloads)
    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2, sort_keys=False))
    print(f"Downloaded {downloaded} new genome FASTA files. Manifest updated: {MANIFEST_PATH}")


if __name__ == "__main__":
    sys.exit(main())
