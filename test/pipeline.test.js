const test = require("node:test");
const assert = require("node:assert/strict");
const { parseFasta, summarizeGenome } = require("../src/fasta");
const { parseAmrFinderTsv } = require("../src/amrfinder");
const { analyzeGenome } = require("../src/pipeline");
const { safeReportInput } = require("../src/openai-report");
const { parseGffTargets, buildTargetEvidence } = require("../src/targets");
const { parseCsv, groupedSplit, trainLogistic, fitPlatt, evaluate } = require("../scripts/train-baseline");
const { runPredictions } = require("../src/predictor");

const demoFasta = `>demo\n${"ACGT".repeat(1_000_000)}`;
const header = "#Gene symbol\tProtein name\tElement subtype\tMethod\t% Coverage of reference sequence\t% Identity to reference sequence";
const targetGff = [
  "##gff-version 3",
  "demo\tunit\tgene\t1\t100\t.\t+\t.\tID=gyrA;gene=gyrA;product=DNA gyrase subunit A",
  "demo\tunit\tgene\t101\t200\t.\t+\t.\tID=parC;gene=parC;product=Topoisomerase IV subunit A",
  "demo\tunit\tgene\t201\t300\t.\t+\t.\tID=ftsI;gene=ftsI;product=Penicillin-binding protein 3",
  "demo\tunit\tgene\t301\t400\t.\t+\t.\tID=rpsL;gene=rpsL;product=30S ribosomal protein S12",
  "demo\tunit\trRNA\t401\t500\t.\t+\t.\tID=rrsA;gene=rrsA;product=16S ribosomal RNA",
].join("\n");

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

test("GFF parser confirms explicit molecular target loci", () => {
  assert.equal(parseGffTargets(targetGff).length, 5);
  const evidence = buildTargetEvidence(targetGff);
  assert.equal(evidence.ciprofloxacin.status, "target_confirmed");
  assert.equal(evidence.ceftriaxone.pass, true);
  assert.equal(evidence.gentamicin.matched.length, 2);
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

test("susceptible call requires explicit target annotation", async () => {
  const noTarget = await analyzeGenome({ fastaText: demoFasta, amrTsv: header, forceImported: true });
  assert.ok(noTarget.predictions.every((item) => item.decision !== "likely_to_work"));

  const withTargets = await analyzeGenome({ fastaText: demoFasta, amrTsv: header, gffText: targetGff, forceImported: true });
  assert.ok(withTargets.predictions.every((item) => item.decision === "likely_to_work"));
  assert.ok(withTargets.predictions.every((item) => item.targetGate.status === "target_confirmed"));
});

test("Report Agent input excludes raw sequence data", async () => {
  const result = await analyzeGenome({ fastaText: demoFasta, forceImported: true });
  const safeInput = safeReportInput({ ...result, fastaText: demoFasta });
  assert.equal(Object.hasOwn(safeInput, "fastaText"), false);
  assert.equal(JSON.stringify(safeInput).includes(demoFasta.slice(0, 100)), false);
});

test("baseline trainer keeps related groups in one split and reports abstention metrics", () => {
  const csv = ["sample_id,group_id,antibiotic,label,marker_count", ...Array.from({ length: 30 }, (_, index) => {
    const label = index % 2;
    return `s${index},g${Math.floor(index / 3)},ciprofloxacin,${label},${label}`;
  })].join("\n");
  const rows = parseCsv(csv);
  const split = groupedSplit(rows);
  const membership = new Map();
  for (const [name, members] of Object.entries({ train: split.train, validation: split.validation, test: split.test })) {
    members.forEach((row) => {
      assert.ok(!membership.has(row.group_id) || membership.get(row.group_id) === name);
      membership.set(row.group_id, name);
    });
  }
  const model = trainLogistic(split.train, ["marker_count"], 500);
  const calibration = fitPlatt(split.validation, model, ["marker_count"], 300);
  const result = evaluate(split.test, model, ["marker_count"], calibration);
  assert.equal(result.sampleCount, split.test.length);
  assert.equal(result.reliabilityBins.length, 5);
  assert.ok(result.auroc >= 0.5);
  assert.ok(result.noCallRate >= 0 && result.noCallRate <= 1);
});

test("runtime predictor consumes calibrated schema-v2 model artifacts", () => {
  const artifact = {
    schemaVersion: 2,
    featureNames: ["marker_count", "mutation_count", "target_confirmed"],
    model: { intercept: -5, weights: { marker_count: 10, mutation_count: 0, target_confirmed: 0 } },
    calibration: { method: "platt", intercept: 0, slope: 1 },
    thresholds: { susceptible: 0.2, resistant: 0.8 },
  };
  const predictions = runPredictions({
    species: "Escherichia coli",
    genomeSummary: { qc: "pass", totalBases: 4_000_000 },
    hits: [{ gene: "qnrS1", name: "QnrS1", subtype: "AMR", method: "ALLELE" }],
    readerMode: "imported_amrfinder",
    targetEvidence: buildTargetEvidence(targetGff),
    models: { ciprofloxacin: artifact },
  });
  const cipro = predictions.find((item) => item.antibioticId === "ciprofloxacin");
  assert.equal(cipro.modelSource, "trained_artifact");
  assert.equal(cipro.decision, "likely_to_fail");
  assert.deepEqual(cipro.decisionThresholds, artifact.thresholds);
});
