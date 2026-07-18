const test = require("node:test");
const assert = require("node:assert/strict");
const { parseFasta, summarizeGenome } = require("../src/fasta");
const { parseAmrFinderTsv } = require("../src/amrfinder");
const { analyzeGenome } = require("../src/pipeline");
const { safeReportInput } = require("../src/openai-report");

const demoFasta = `>demo\n${"ACGT".repeat(1_000_000)}`;
const header = "#Gene symbol\tProtein name\tElement subtype\tMethod\t% Coverage of reference sequence\t% Identity to reference sequence";

test("FASTA parser rejects non-FASTA input", () => {
  assert.throws(() => parseFasta("ACGT"), /not FASTA/);
});

test("genome summary calculates deterministic QC", () => {
  const summary = summarizeGenome(parseFasta(demoFasta));
  assert.equal(summary.totalBases, 4_000_000);
  assert.equal(summary.qc, "pass");
  assert.equal(summary.gcPercent, 50);
});

test("AMRFinderPlus TSV parser normalizes evidence", () => {
  const hits = parseAmrFinderTsv(`${header}\nqnrS1\tQnrS1\tAMR\tALLELE\t100\t99.2`);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].gene, "qnrS1");
  assert.equal(hits[0].identity, 99.2);
});

test("known marker can produce a traceable likely-fail call", async () => {
  const result = await analyzeGenome({
    fastaText: demoFasta,
    amrTsv: `${header}\nqnrS1\tQnrS1 quinolone resistance protein\tAMR\tALLELE\t100\t99.2`,
    forceImported: true,
  });
  const cipro = result.predictions.find((item) => item.antibioticId === "ciprofloxacin");
  assert.equal(cipro.decision, "likely_to_fail");
  assert.equal(cipro.evidence.length, 1);
  assert.equal(result.audit.passed, true);
});

test("FASTA-only mode never makes a likely-to-work call", async () => {
  const result = await analyzeGenome({ fastaText: demoFasta, forceImported: true });
  assert.ok(result.predictions.every((item) => item.decision !== "likely_to_work"));
  assert.equal(result.reader.mode, "fasta_only");
});

test("Report Agent input excludes raw sequence data", async () => {
  const result = await analyzeGenome({ fastaText: demoFasta, forceImported: true });
  const safeInput = safeReportInput({ ...result, fastaText: demoFasta });
  assert.equal(Object.hasOwn(safeInput, "fastaText"), false);
  assert.equal(JSON.stringify(safeInput).includes(demoFasta.slice(0, 100)), false);
});
