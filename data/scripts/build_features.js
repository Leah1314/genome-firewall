#!/usr/bin/env node
// Build data/features.csv from the downloaded cohort, its AMRFinderPlus TSVs,
// and its Mash-derived groups -- in the exact schema scripts/train-baseline.js
// expects: sample_id,group_id,antibiotic,label,marker_count,mutation_count.
//
// Marker/mutation counting reuses src/config.js's ANTIBIOTICS regex patterns
// and src/predictor.js's matchesMarker/classifyEvidence functions directly
// (not a reimplementation), so the exact same evidence logic that produced
// the training features is what runs at inference time in src/predictor.js.
//
// Usage: node data/scripts/build_features.js

const { readFile, readdir, writeFile } = require("node:fs/promises");
const path = require("node:path");
const { ANTIBIOTICS } = require("../../src/config");
const { parseAmrFinderTsv } = require("../../src/amrfinder");
const { matchesMarker, classifyEvidence } = require("../../src/predictor");

const ROOT = path.join(__dirname, "..", "..");
const MANIFEST_PATH = path.join(ROOT, "data", "cohort_manifest.json");
const GROUPS_PATH = path.join(ROOT, "data", "groups.csv");
const AMRFINDER_DIR = path.join(ROOT, "data", "raw", "amrfinder");
const OUTPUT_PATH = path.join(ROOT, "data", "features.csv");

async function loadGroups() {
  const text = await readFile(GROUPS_PATH, "utf8");
  const lines = text.trim().split(/\r?\n/).slice(1);
  const groups = new Map();
  for (const line of lines) {
    const [genomeId, groupId] = line.split(",");
    groups.set(genomeId, groupId);
  }
  return groups;
}

async function loadHits(genomeId) {
  const tsvPath = path.join(AMRFINDER_DIR, `${genomeId}.tsv`);
  try {
    const text = await readFile(tsvPath, "utf8");
    return parseAmrFinderTsv(text);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function countEvidence(hits, antibiotic) {
  const evidence = hits.filter((hit) => matchesMarker(hit, antibiotic.markers)).map(classifyEvidence);
  return {
    markerCount: evidence.filter((category) => category === "known_gene").length,
    mutationCount: evidence.filter((category) => category === "known_mutation").length,
  };
}

async function main() {
  const manifest = JSON.parse(await readFile(MANIFEST_PATH, "utf8"));
  const groups = await loadGroups();
  const scanned = new Set((await readdir(AMRFINDER_DIR)).filter((f) => f.endsWith(".tsv")).map((f) => f.replace(/\.tsv$/, "")));

  const rows = ["sample_id,group_id,antibiotic,label,marker_count,mutation_count"];
  let skippedNoScan = 0;
  let skippedNoGroup = 0;
  let written = 0;

  for (const genomeId of Object.keys(manifest.genomes)) {
    if (!scanned.has(genomeId)) { skippedNoScan += 1; continue; }
    const groupId = groups.get(genomeId);
    if (!groupId) { skippedNoGroup += 1; continue; }
    const hits = await loadHits(genomeId);
    if (!hits) { skippedNoScan += 1; continue; }

    const record = manifest.genomes[genomeId];
    for (const labelRow of record.labels) {
      const antibiotic = ANTIBIOTICS.find((entry) => entry.id === labelRow.antibiotic);
      if (!antibiotic) continue;
      if (labelRow.resistant_phenotype !== "Resistant" && labelRow.resistant_phenotype !== "Susceptible") continue;
      const label = labelRow.resistant_phenotype === "Resistant" ? 1 : 0;
      const { markerCount, mutationCount } = countEvidence(hits, antibiotic);
      rows.push(`${genomeId},${groupId},${antibiotic.id},${label},${markerCount},${mutationCount}`);
      written += 1;
    }
  }

  await writeFile(OUTPUT_PATH, rows.join("\n") + "\n");
  console.log(`Wrote ${written} rows to ${OUTPUT_PATH}`);
  if (skippedNoScan) console.log(`Skipped ${skippedNoScan} genomes with no AMRFinderPlus TSV yet.`);
  if (skippedNoGroup) console.log(`Skipped ${skippedNoGroup} genomes with no group assignment (run build_groups.py first).`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
