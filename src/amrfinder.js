const { execFile } = require("node:child_process");
const { mkdtemp, writeFile, readFile, rm } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const path = require("node:path");

const HEADER_ALIASES = {
  gene: ["gene symbol", "gene", "element symbol"],
  name: ["protein name", "element name", "name"],
  subtype: ["subtype", "element subtype"],
  method: ["method", "element subtype"],
  identity: ["% identity to reference sequence", "% identity", "identity"],
  coverage: ["% coverage of reference sequence", "% coverage", "coverage"],
};

function normalizeHeader(value) {
  return String(value || "").trim().toLowerCase();
}

function findColumn(headers, aliases) {
  return headers.findIndex((header) => aliases.includes(normalizeHeader(header)));
}

function parseAmrFinderTsv(text) {
  const lines = String(text || "").split(/\r?\n/).filter((line) => line.trim() && !line.startsWith("##"));
  if (!lines.length) return [];
  const headers = lines[0].replace(/^#/, "").split("\t");
  const indexes = Object.fromEntries(
    Object.entries(HEADER_ALIASES).map(([key, aliases]) => [key, findColumn(headers, aliases)]),
  );
  if (indexes.gene < 0 && indexes.name < 0) {
    throw new Error("AMRFinderPlus TSV must contain a Gene symbol or Protein name column.");
  }

  return lines.slice(1).map((line, index) => {
    const values = line.split("\t");
    const read = (key) => indexes[key] >= 0 ? values[indexes[key]] || "" : "";
    const identity = Number.parseFloat(read("identity"));
    const coverage = Number.parseFloat(read("coverage"));
    return {
      id: `amr_${index + 1}`,
      gene: read("gene").trim(),
      name: read("name").trim(),
      subtype: read("subtype").trim(),
      method: read("method").trim(),
      identity: Number.isFinite(identity) ? identity : null,
      coverage: Number.isFinite(coverage) ? coverage : null,
      source: "AMRFinderPlus",
    };
  }).filter((hit) => hit.gene || hit.name);
}

function commandAvailable(command) {
  return new Promise((resolve) => {
    execFile("sh", ["-c", `command -v ${command}`], (error) => resolve(!error));
  });
}

async function runAmrFinder(fastaText, organism = "Escherichia") {
  if (!(await commandAvailable("amrfinder"))) {
    return { available: false, hits: [], version: null };
  }

  const dir = await mkdtemp(path.join(tmpdir(), "genome-firewall-"));
  const fastaPath = path.join(dir, "genome.fasta");
  const outputPath = path.join(dir, "amrfinder.tsv");
  try {
    await writeFile(fastaPath, fastaText, "utf8");
    await new Promise((resolve, reject) => {
      execFile(
        "amrfinder",
        ["-n", fastaPath, "-O", organism, "-o", outputPath, "--plus"],
        { timeout: 120_000, maxBuffer: 10 * 1024 * 1024 },
        (error, stdout, stderr) => error ? reject(new Error(stderr || error.message)) : resolve(stdout),
      );
    });
    return { available: true, hits: parseAmrFinderTsv(await readFile(outputPath, "utf8")), version: "local" };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

module.exports = { parseAmrFinderTsv, runAmrFinder };
