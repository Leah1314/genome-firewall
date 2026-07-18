#!/usr/bin/env python3
"""
Build sequence-homology groups for the Genome Firewall cohort using Mash.

Module 02 of the challenge brief requires a de-duplication / clustering step
based on sequence homology before any train/test split, so that identical or
near-identical genomes cannot appear on both sides of the split. This script:

  1. Sketches every downloaded genome with Mash (k=21, sketch size 10000 --
     Mash's own recommended defaults for bacterial whole-genome comparison).
  2. Computes all-vs-all Mash distances (Mash distance approximates
     1 - Average Nucleotide Identity for closely related genomes).
  3. Reports the distance distribution so the clustering threshold is chosen
     from the cohort's own data, not an arbitrary guess.
  4. Applies single-linkage clustering at a configurable Mash-distance
     threshold: any two genomes closer than the threshold are merged into
     the same group. Connected components become group_id values.
  5. Writes data/groups.csv (genome_id,group_id) and data/groups.json with
     the threshold, its justification, and per-group genome counts.

Threshold default: 0.01 Mash distance (~99% whole-genome ANI), chosen
empirically on this cohort, not guessed. Single-linkage clustering chains
transitively (A-B and B-C merge even if A-C is far apart), so a threshold
that looks reasonable in isolation can still collapse the whole cohort into
a few giant clusters if enough close pairs exist to bridge them. That is
exactly what happened when this was first tried at 0.02: 102 genomes
collapsed into 5 clusters (sizes 43/41/10/5/3) -- useless for a grouped
split, since one held-out fold would just be one mega-cluster. Sweeping the
threshold against this cohort's own pairwise distances showed the chaining
transition:

    threshold  groups  largest cluster
    0.001      91      7
    0.003      71      19
    0.005      56      25
    0.008      45      25
    0.01       35      25
    0.015      14      43
    0.02        5      43

0.01 is the largest threshold before chaining accelerates sharply (14 vs 35
groups going from 0.015 to 0.01), giving 35 groups with no cluster larger
than 25/102 genomes -- enough distinct genetic backgrounds that a held-out
test fold isn't dominated by one clonal group, while still merging genomes
within roughly the same sequence type. Re-run with --threshold and inspect
the printed percentiles/group-size distribution before trusting any other
value on a different or larger cohort; the right threshold is a property of
the actual pairwise-distance distribution, not a fixed constant.

Usage:
  bash data/scripts/build_groups.py --threshold 0.01
"""
import argparse
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
GENOME_DIR = ROOT / "data" / "raw" / "genomes"
SKETCH_DIR = ROOT / "data" / "raw" / "mash"
GROUPS_CSV = ROOT / "data" / "groups.csv"
GROUPS_JSON = ROOT / "data" / "groups.json"


def run(cmd):
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"Command failed: {' '.join(cmd)}\n{result.stderr}")
    return result.stdout


def sketch_and_distance():
    SKETCH_DIR.mkdir(parents=True, exist_ok=True)
    fastas = sorted(GENOME_DIR.glob("*.fna"))
    if not fastas:
        raise RuntimeError(f"No genomes found in {GENOME_DIR}")
    sketch_base = SKETCH_DIR / "cohort"
    print(f"Sketching {len(fastas)} genomes with Mash (k=21, sketch size 10000) ...")
    run(["mash", "sketch", "-k", "21", "-s", "10000", "-o", str(sketch_base)] + [str(f) for f in fastas])
    print("Computing all-vs-all Mash distances ...")
    dist_output = run(["mash", "dist", f"{sketch_base}.msh", f"{sketch_base}.msh"])
    return dist_output


def genome_id_from_path(path_str):
    return Path(path_str).stem


def parse_distances(dist_output):
    pairs = []
    for line in dist_output.strip().splitlines():
        ref, query, distance, p_value, shared = line.split("\t")
        pairs.append((genome_id_from_path(ref), genome_id_from_path(query), float(distance)))
    return pairs


def print_histogram(pairs):
    off_diagonal = [d for a, b, d in pairs if a != b]
    if not off_diagonal:
        print("Only one genome in the cohort; no pairwise distances to report.")
        return
    off_diagonal.sort()
    n = len(off_diagonal)
    percentiles = [1, 5, 10, 25, 50]
    print("Pairwise Mash distance percentiles (smallest = most related):")
    for p in percentiles:
        idx = min(n - 1, int(n * p / 100))
        print(f"  p{p}: {off_diagonal[idx]:.5f}")
    print(f"  min: {off_diagonal[0]:.5f}  max: {off_diagonal[-1]:.5f}  n_pairs: {n}")


class UnionFind:
    def __init__(self, items):
        self.parent = {item: item for item in items}

    def find(self, item):
        while self.parent[item] != item:
            self.parent[item] = self.parent[self.parent[item]]
            item = self.parent[item]
        return item

    def union(self, a, b):
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            self.parent[ra] = rb


def cluster(pairs, threshold):
    genome_ids = sorted({a for a, b, d in pairs} | {b for a, b, d in pairs})
    uf = UnionFind(genome_ids)
    for a, b, d in pairs:
        if a != b and d <= threshold:
            uf.union(a, b)
    roots = {gid: uf.find(gid) for gid in genome_ids}
    root_to_group = {}
    groups = {}
    for gid in genome_ids:
        root = roots[gid]
        if root not in root_to_group:
            root_to_group[root] = f"grp_{len(root_to_group) + 1:04d}"
        groups[gid] = root_to_group[root]
    return groups


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--threshold", type=float, default=0.01,
                         help="Mash distance threshold for merging two genomes into one group (default: 0.01, see module docstring for how this was chosen)")
    args = parser.parse_args()

    dist_output = sketch_and_distance()
    pairs = parse_distances(dist_output)
    print_histogram(pairs)

    groups = cluster(pairs, args.threshold)
    group_sizes = {}
    for gid, group_id in groups.items():
        group_sizes[group_id] = group_sizes.get(group_id, 0) + 1

    with open(GROUPS_CSV, "w") as f:
        f.write("genome_id,group_id\n")
        for gid in sorted(groups):
            f.write(f"{gid},{groups[gid]}\n")

    summary = {
        "tool": "mash",
        "mashVersion": run(["mash", "--version"]).strip(),
        "sketchParams": {"k": 21, "sketchSize": 10000},
        "threshold": args.threshold,
        "thresholdRationale": (
            "0.01 Mash distance (~99% genome-wide ANI), chosen empirically: it is the "
            "largest threshold before single-linkage chaining collapses the cohort into a "
            "few giant clusters (0.02 produced only 5 clusters for 102 genomes). See the "
            "module docstring in data/scripts/build_groups.py and data/README.md for the "
            "full threshold sweep and justification."
        ),
        "genomeCount": len(groups),
        "groupCount": len(group_sizes),
        "groupSizeDistribution": sorted(group_sizes.values(), reverse=True),
    }
    GROUPS_JSON.write_text(json.dumps(summary, indent=2))
    print(f"\n{len(groups)} genomes -> {len(group_sizes)} groups at threshold {args.threshold}")
    print(f"Wrote {GROUPS_CSV} and {GROUPS_JSON}")


if __name__ == "__main__":
    sys.exit(main())
