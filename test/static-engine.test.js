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
