const { readFile, writeFile, mkdir } = require("node:fs/promises");
const path = require("node:path");
const { runAmrFinder } = require("../src/amrfinder");
const { ANTIBIOTICS, SUPPORTED_SPECIES } = require("../src/config");
const { extractAntibioticFeatures } = require("../src/features");
const { buildTargetEvidence } = require("../src/targets");

function parseTsv(text) {
  const lines = String(text || "").split(/\r?\n/).filter((line) => line.trim() && !line.startsWith("#"));
  if (!lines.length) throw new Error("Manifest is empty.");
  const headers = lines.shift().split("\t").map((header) => header.trim());
  return lines.map((line) => {
    const values = line.split("\t");
    return Object.fromEntries(headers.map((header, index) => [header, values[index]?.trim() || ""]));
  });
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function resolveInput(baseDir, value) {
  return path.isAbsolute(value) ? value : path.resolve(baseDir, value);
}

async function main() {
  const manifestPath = process.argv[2];
  const outputPath = process.argv[3] || path.join("data", "generated", "features.csv");
  if (!manifestPath) {
    throw new Error("Usage: node scripts/generate-features.js <manifest.tsv> [output.csv]");
  }
  const absoluteManifest = path.resolve(manifestPath);
  const baseDir = path.dirname(absoluteManifest);
  const samples = parseTsv(await readFile(absoluteManifest, "utf8"));
  const required = ["sample_id", "group_id", "species", "fasta_path", "gff_path"];
  for (const column of required) {
    if (!samples.every((sample) => sample[column])) throw new Error(`Manifest column ${column} is required for every sample.`);
  }

  const rows = [];
  for (const [index, sample] of samples.entries()) {
    const speciesProfile = SUPPORTED_SPECIES[sample.species.toLowerCase()];
    if (!speciesProfile) throw new Error(`${sample.sample_id}: unsupported species ${sample.species}.`);
    const fastaText = await readFile(resolveInput(baseDir, sample.fasta_path), "utf8");
    const gffText = await readFile(resolveInput(baseDir, sample.gff_path), "utf8");
    const scan = await runAmrFinder(fastaText, speciesProfile.amrFinderOrganism);
    if (!scan.available) throw new Error("amrfinder is not installed or not available on PATH.");
    const targetEvidence = buildTargetEvidence(gffText);

    for (const antibiotic of ANTIBIOTICS) {
      const label = sample[antibiotic.id];
      if (label !== "0" && label !== "1") continue;
      const features = extractAntibioticFeatures(antibiotic, scan.hits, targetEvidence[antibiotic.id]);
      rows.push({
        sample_id: sample.sample_id,
        group_id: sample.group_id,
        antibiotic: antibiotic.id,
        label,
        marker_count: features.markerCount,
        mutation_count: features.mutationCount,
        target_confirmed: features.targetConfirmed,
      });
    }
    console.log(`[${index + 1}/${samples.length}] ${sample.sample_id}: ${scan.hits.length} AMRFinderPlus hits`);
  }

  if (!rows.length) throw new Error("No labeled antibiotic rows were generated.");
  const columns = Object.keys(rows[0]);
  const csv = [columns.join(","), ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(","))].join("\n");
  const absoluteOutput = path.resolve(outputPath);
  await mkdir(path.dirname(absoluteOutput), { recursive: true });
  await writeFile(absoluteOutput, `${csv}\n`);
  console.log(`Wrote ${rows.length} drug-level rows to ${absoluteOutput}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
