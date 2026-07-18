const { readFile } = require("node:fs/promises");
const path = require("node:path");
const { parseCsv, groupedSplit } = require("../scripts/train-baseline");
const { ANTIBIOTICS } = require("./config");

// Duplicates the small sigmoid/threshold scoring in predictor.js's
// scoreEvidence rather than importing it, since that module only exposes
// per-genome prediction (it needs AMRFinderPlus hits + a target gate, not a
// features.csv row), and re-deriving the same split here from the
// committed features table is enough to show real held-out predictions.
function sigmoid(value) {
  return 1 / (1 + Math.exp(-value));
}

async function loadTrainedModel(antibioticId, modelsDir) {
  try {
    const raw = await readFile(path.join(modelsDir, `${antibioticId}.json`), "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function scoreRow(row, model) {
  const rawScore = model.model.intercept
    + (model.model.weights.marker_count || 0) * Number(row.marker_count || 0)
    + (model.model.weights.mutation_count || 0) * Number(row.mutation_count || 0);
  const probabilityOfFailure = Number(sigmoid(rawScore).toFixed(3));
  const decision = probabilityOfFailure >= model.thresholds.highThreshold
    ? "likely_to_fail"
    : probabilityOfFailure <= model.thresholds.lowThreshold
      ? "likely_to_work"
      : "no_call";
  const trueLabel = row.label === "1" ? "resistant" : "susceptible";
  const correct = decision === "no_call" ? null : (decision === "likely_to_fail") === (trueLabel === "resistant");
  return {
    sampleId: row.sample_id,
    groupId: row.group_id,
    markerCount: Number(row.marker_count || 0),
    mutationCount: Number(row.mutation_count || 0),
    trueLabel,
    probabilityOfFailure,
    decision,
    correct,
  };
}

// Every case returned here comes from the same deterministic grouped split
// scripts/train-baseline.js used to train and evaluate the shipped models,
// so "held-out" is a fact about the split, not a cherry-picked example.
async function heldOutCases({
  featuresPath = path.join(__dirname, "..", "data", "features.csv"),
  modelsDir = path.join(__dirname, "..", "models"),
} = {}) {
  const rows = parseCsv(await readFile(featuresPath, "utf8"));

  return Promise.all(ANTIBIOTICS.map(async (antibiotic) => {
    const antibioticRows = rows.filter((row) => row.antibiotic === antibiotic.id);
    const model = await loadTrainedModel(antibiotic.id, modelsDir);
    if (!model || antibioticRows.length < 3) {
      return { antibioticId: antibiotic.id, antibioticLabel: antibiotic.label, available: false, cases: [] };
    }
    let split;
    try {
      split = groupedSplit(antibioticRows);
    } catch {
      return { antibioticId: antibiotic.id, antibioticLabel: antibiotic.label, available: false, cases: [] };
    }
    return {
      antibioticId: antibiotic.id,
      antibioticLabel: antibiotic.label,
      available: true,
      cases: split.test.map((row) => scoreRow(row, model)),
    };
  }));
}

module.exports = { heldOutCases };
