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
  A: "GCT", R: "CGT", N: "AAT", D: "GAT", C: "TGT", Q: "CAA", E: "GAA", G: "GGT",
  H: "CAT", I: "ATT", L: "CTT", K: "AAA", M: "ATG", F: "TTT", P: "CCT", S: "TCT",
  T: "ACT", W: "TGG", Y: "TAT", V: "GTT",
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

function inFrameFiller(length, seed) {
  return randomDnaSequence(Math.ceil(length / 3) * 3, seed);
}

test("GitHub Pages FASTA-only target scan mirrors the backend: no false positive on random genome-scale DNA", () => {
  const fastaText = `>random_genome\n${randomDnaSequence(3_600_000, 5)}`;
  const result = loadEngine().analyze({ fastaText });
  assert.ok(result.predictions.every((prediction) => prediction.targetGate.status !== "target_confirmed"));
});

test("GitHub Pages FASTA-only target scan detects a gyrA signature embedded in an assembly", () => {
  // Real gyrA motifs (see public/static-engine.js / src/targets.js), all
  // three co-located as one ORF.
  const motifDna = `${dnaFor("DAKTGRETIIVHE")}${dnaFor("TEQQAQAILDLRL")}${dnaFor("ANGTVKKTVLTEF")}`;
  const fastaText = `>embedded_target\n${inFrameFiller(1_800_000, 3)}${motifDna}${randomDnaSequence(1_800_000, 4)}`;
  const result = loadEngine().analyze({ fastaText });
  const cipro = result.predictions.find((prediction) => prediction.antibioticId === "ciprofloxacin");
  assert.ok(cipro.targetGate.matched.some((item) => item.requirement === "gyrA"));
});

test("GitHub Pages FASTA-only target scan requires co-located matches, not scattered ones", () => {
  // Same regression as the backend: one gyrA motif and one parC motif, far
  // apart and separated by an in-frame stop codon, must not combine into a
  // false "confirmed" result for either gene. Padded to a QC-passing genome
  // size (3.5-6.5 Mb) so the target gate actually reaches target evidence
  // instead of short-circuiting on assembly size first.
  const segment1 = `${inFrameFiller(200, 11)}${dnaFor("DAKTGRETIIVHE")}`;
  const stop = "TAA";
  const segment2 = `${inFrameFiller(300, 12)}${dnaFor("AVVISALPHQVSG")}${inFrameFiller(300, 13)}`;
  const fastaText = `>scattered_motifs\n${inFrameFiller(1_800_000, 15)}${segment1}${stop}${segment2}${randomDnaSequence(1_800_000, 14)}`;
  const result = loadEngine().analyze({ fastaText });
  const cipro = result.predictions.find((prediction) => prediction.antibioticId === "ciprofloxacin");
  assert.equal(cipro.targetGate.matched.some((item) => item.requirement === "gyrA"), false);
  assert.equal(cipro.targetGate.matched.some((item) => item.requirement === "parC"), false);
});
