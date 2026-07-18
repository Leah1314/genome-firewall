const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadEngine() {
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(
    readFileSync(path.join(__dirname, "..", "public", "static-engine.js"), "utf8"),
    context,
  );
  return context.window.GenomeFirewallEngine;
}

test("GitHub Pages demo produces traceable calls", () => {
  const result = loadEngine().demo();
  assert.equal(result.genome.qc, "pass");
  assert.deepEqual(
    Array.from(result.predictions, (prediction) => prediction.decision),
    ["likely_to_fail", "likely_to_fail", "likely_to_work"],
  );
  assert.equal(result.predictions[0].evidence[0].source, "AMRFinderPlus");
});

test("GitHub Pages FASTA-only analysis disables susceptible calls", () => {
  const fastaText = `>static_demo\n${"ACGT".repeat(1_000_000)}`;
  const result = loadEngine().analyze({ fastaText });
  assert.equal(result.reader.mode, "fasta_only");
  assert.ok(result.predictions.every((prediction) => prediction.decision !== "likely_to_work"));
});

const CODON = {
  H: "CAT", G: "GGT", D: "GAT", A: "GCT", S: "TCT", I: "ATT",
  Y: "TAT", T: "ACT", M: "ATG", R: "CGT",
};

function dnaFor(aminoAcids) {
  return [...aminoAcids].map((aa) => CODON[aa]).join("");
}

function randomDnaSequence(length, seed) {
  const bases = "ACGT";
  let state = seed;
  const next = () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state;
  };
  let sequence = "";
  for (let i = 0; i < length; i += 1) sequence += bases[next() % 4];
  return sequence;
}

test("GitHub Pages FASTA-only target scan mirrors the backend: no false positive on random genome-scale DNA", () => {
  const fastaText = `>random_genome\n${randomDnaSequence(3_600_000, 5)}`;
  const result = loadEngine().analyze({ fastaText });
  assert.ok(result.predictions.every((prediction) => prediction.targetGate.status !== "target_confirmed"));
});

test("GitHub Pages FASTA-only target scan detects a gyrA-like signature embedded in an assembly", () => {
  const motifDna = `${dnaFor("HGDASIYDT")}${randomDnaSequence(300, 7)}${dnaFor("MGIDIR")}`;
  const fastaText = `>embedded_target\n${randomDnaSequence(1_800_000, 3)}${motifDna}${randomDnaSequence(1_800_000, 4)}`;
  const result = loadEngine().analyze({ fastaText });
  const cipro = result.predictions.find((prediction) => prediction.antibioticId === "ciprofloxacin");
  assert.ok(cipro.targetGate.matched.some((item) => item.requirement === "gyrA"));
});
