const test = require("node:test");
const assert = require("node:assert/strict");
const { buildTargetEvidenceFromFasta } = require("../src/targets");

// One codon per amino acid -- enough to build DNA for positive controls.
// Doesn't need to be biologically typical, just a valid codon per residue.
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

// Filler whose length is always a multiple of 3, so a motif placed right
// after it lands on a known, controllable codon boundary in frame 0.
function inFrameFiller(length, seed) {
  const bases = randomDnaSequence(Math.ceil(length / 3) * 3, seed);
  return bases;
}

test("FASTA target scan does not false-positive on genome-scale random DNA", () => {
  // Realistic E. coli-sized genome (4.6 Mb across two contigs) with no real
  // gyrA/parC/ftsI/rpsL/16S sequence at all. If any target reports
  // "confirmed" here, the motifs aren't locus-specific -- they're noise
  // matches inflated by scanning all 6 reading frames at genome scale.
  const records = [
    { id: "contig_1", sequence: randomDnaSequence(2_300_000, 1) },
    { id: "contig_2", sequence: randomDnaSequence(2_300_000, 2) },
  ];
  const result = buildTargetEvidenceFromFasta(records);
  for (const evidence of Object.values(result)) {
    assert.equal(evidence.matched.length, 0);
    assert.equal(evidence.status, "target_incomplete");
  }
});

test("FASTA target scan detects a gyrA signature embedded in an assembly", () => {
  // All three real gyrA motifs (see src/targets.js -- literal substrings of
  // the actual E. coli K-12 MG1655 GyrA protein, NCBI GCF_000005845.2),
  // co-located as one contiguous ORF -- confirms the scan fires on real
  // signal, not just correctly staying silent on noise.
  const motifDna = `${dnaFor("DAKTGRETIIVHE")}${dnaFor("TEQQAQAILDLRL")}${dnaFor("ANGTVKKTVLTEF")}`;
  const records = [
    { id: "contig_1", sequence: `${inFrameFiller(500, 3)}${motifDna}${randomDnaSequence(500, 4)}` },
  ];
  const result = buildTargetEvidenceFromFasta(records);
  assert.ok(result.ciprofloxacin.matched.some((item) => item.requirement === "gyrA"));
});

test("FASTA target scan requires matches to be co-located in one ORF, not scattered across the genome", () => {
  // Regression test for a real bug: one gyrA motif and one parC motif,
  // placed far apart and separated by an in-frame stop codon so they fall
  // in different translated segments. Neither gene has 2 of its own motifs
  // in the same segment, so neither should be confirmed -- even though,
  // under the old whole-frame-string scan, this exact combination was
  // enough to wrongly report parC as detected on a real reference genome.
  const segment1 = `${inFrameFiller(200, 11)}${dnaFor("DAKTGRETIIVHE")}`; // one gyrA motif only
  const stop = "TAA"; // in-frame stop codon: forces a new ORF segment after this point
  const segment2 = `${inFrameFiller(300, 12)}${dnaFor("AVVISALPHQVSG")}${inFrameFiller(300, 13)}`; // one parC motif only
  const records = [{ id: "contig_1", sequence: `${segment1}${stop}${segment2}${randomDnaSequence(200, 14)}` }];
  const result = buildTargetEvidenceFromFasta(records);
  assert.equal(result.ciprofloxacin.matched.some((item) => item.requirement === "gyrA"), false);
  assert.equal(result.ciprofloxacin.matched.some((item) => item.requirement === "parC"), false);
});
