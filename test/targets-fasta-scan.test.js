const test = require("node:test");
const assert = require("node:assert/strict");
const { buildTargetEvidenceFromFasta } = require("../src/targets");

// One codon per amino acid -- enough to reverse-translate a motif string
// into DNA for a positive control. Doesn't need to be biologically typical,
// just a valid codon for each residue.
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

test("FASTA target scan detects a gyrA-like signature embedded in an assembly", () => {
  // Two independent gyrA motifs (HGDASIYDT and MGIDIR) reverse-translated to
  // DNA and embedded in an otherwise random contig -- confirms the scan
  // actually fires on real signal, not just correctly staying silent on noise.
  const motifDna = `${dnaFor("HGDASIYDT")}${randomDnaSequence(300, 7)}${dnaFor("MGIDIR")}`;
  const records = [
    { id: "contig_1", sequence: `${randomDnaSequence(500, 3)}${motifDna}${randomDnaSequence(500, 4)}` },
  ];
  const result = buildTargetEvidenceFromFasta(records);
  assert.ok(result.ciprofloxacin.matched.some((item) => item.requirement === "gyrA"));
});
