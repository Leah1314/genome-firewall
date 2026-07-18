const { readFile, writeFile, mkdir } = require("node:fs/promises");
const path = require("node:path");

function sigmoid(value) {
  if (value < -30) return 0;
  if (value > 30) return 1;
  return 1 / (1 + Math.exp(-value));
}

function parseCsv(text) {
  const records = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"' && quoted && text[index + 1] === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(cell.trim());
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(cell.trim());
      if (row.some(Boolean)) records.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  row.push(cell.trim());
  if (row.some(Boolean)) records.push(row);
  const headers = records.shift() || [];
  return records.map((cells) => Object.fromEntries(headers.map((header, index) => [header, cells[index] || ""])));
}

// Deterministic 3-way grouped split: no group_id ever appears in more than one
// of {train, calibration, test}. Calibration is used only to pick the
// likely-to-fail / likely-to-work thresholds; test is held out from both
// training and threshold selection, so its metrics are an honest estimate.
function groupedSplit(rows) {
  const groups = [...new Set(rows.map((row) => row.group_id))].sort();
  if (groups.length < 3) throw new Error("At least three distinct group_id values are required for train, validation, and test splits.");
  const testGroups = new Set(groups.filter((_, index) => index % 5 === 0));
  const remaining = groups.filter((group) => !testGroups.has(group));
  const calibrationGroups = new Set(remaining.filter((_, index) => index % 4 === 0));
  const trainGroups = new Set(remaining.filter((group) => !calibrationGroups.has(group)));
  return {
    train: rows.filter((row) => trainGroups.has(row.group_id)),
    calibration: rows.filter((row) => calibrationGroups.has(row.group_id)),
    test: rows.filter((row) => testGroups.has(row.group_id)),
    trainGroups: trainGroups.size,
    calibrationGroups: calibrationGroups.size,
    testGroups: testGroups.size,
  };
}

function rawScore(row, model, features) {
  return model.intercept + features.reduce(
    (sum, feature) => sum + (Number(row[feature]) || 0) * model.weights[feature],
    0,
  );
}

function trainLogistic(rows, features, iterations = 3000, learningRate = 0.04, l2 = 0.01) {
  const weights = Array(features.length).fill(0);
  const trainable = features.map((feature) => new Set(rows.map((row) => Number(row[feature]) || 0)).size > 1);
  let intercept = 0;
  for (let step = 0; step < iterations; step += 1) {
    const gradient = Array(features.length).fill(0);
    let interceptGradient = 0;
    for (const row of rows) {
      const values = features.map((feature) => Number(row[feature]) || 0);
      const error = sigmoid(intercept + values.reduce((sum, value, index) => sum + value * weights[index], 0)) - Number(row.label);
      interceptGradient += error;
      values.forEach((value, index) => {
        if (trainable[index]) gradient[index] += error * value;
      });
    }
    intercept -= learningRate * interceptGradient / rows.length;
    weights.forEach((weight, index) => {
      if (trainable[index]) weights[index] -= learningRate * (gradient[index] / rows.length + l2 * weight);
    });
  }
  return { intercept, weights: Object.fromEntries(features.map((feature, index) => [feature, weights[index]])) };
}

function score(row, model, features) {
  return model.intercept + features.reduce((sum, feature) => sum + (Number(row[feature]) || 0) * model.weights[feature], 0);
}

function withProbabilities(rows, model, features) {
  return rows.map((row) => ({
    probability: sigmoid(score(row, model, features)),
    label: Number(row.label),
  }));
}

// Pick the smallest high threshold (and largest low threshold) that hits a
// target precision on calibration data, so the no-call band width reflects
// measured performance rather than a fixed guess. Falls back to a
// conservative default when calibration data is too sparse to trust.
function calibrateThresholds(calibrationScored, targetPrecision = 0.85, minSupport = 8) {
  const candidates = [];
  for (let t = 0.5; t <= 0.95; t += 0.05) candidates.push(Number(t.toFixed(2)));

  let highThreshold = 0.67;
  for (const t of candidates) {
    const called = calibrationScored.filter((row) => row.probability >= t);
    if (called.length < minSupport) continue;
    const precision = called.filter((row) => row.label === 1).length / called.length;
    if (precision >= targetPrecision) { highThreshold = t; break; }
  }

  let lowThreshold = 0.33;
  for (const t of [...candidates].reverse()) {
    const called = calibrationScored.filter((row) => row.probability <= 1 - t);
    if (called.length < minSupport) continue;
    const precision = called.filter((row) => row.label === 0).length / called.length;
    if (precision >= targetPrecision) { lowThreshold = Number((1 - t).toFixed(2)); break; }
  }

  if (lowThreshold >= highThreshold) {
    return { highThreshold: 0.67, lowThreshold: 0.33, note: "Calibration data too sparse or too separable to derive distinct thresholds; used the 0.67/0.33 default band." };
  }
  return { highThreshold, lowThreshold, note: `Thresholds chosen for >=${Math.round(targetPrecision * 100)}% precision on the calibration split.` };
}

function decisionFor(probability, thresholds) {
  if (probability >= thresholds.highThreshold) return "likely_to_fail";
  if (probability <= thresholds.lowThreshold) return "likely_to_work";
  return "no_call";
}

// Rank-based AUROC (Mann-Whitney U / Wilcoxon rank-sum), threshold-independent.
function auroc(scored) {
  const positives = scored.filter((row) => row.label === 1);
  const negatives = scored.filter((row) => row.label === 0);
  if (!positives.length || !negatives.length) return null;
  const ranked = [...scored].sort((a, b) => a.probability - b.probability);
  const ranks = new Array(ranked.length);
  let index = 0;
  while (index < ranked.length) {
    let end = index;
    while (end + 1 < ranked.length && ranked[end + 1].probability === ranked[index].probability) end += 1;
    const averageRank = (index + 1 + end + 1) / 2;
    for (let i = index; i <= end; i += 1) ranks[i] = averageRank;
    index = end + 1;
  }
  let positiveRankSum = 0;
  ranked.forEach((row, i) => { if (row.label === 1) positiveRankSum += ranks[i]; });
  const u = positiveRankSum - (positives.length * (positives.length + 1)) / 2;
  return Number((u / (positives.length * negatives.length)).toFixed(3));
}

// Average precision (a standard, dependency-free PR-AUC approximation):
// step through predictions from highest to lowest score, integrating
// precision at each recall increment contributed by a true positive.
function prAuc(scored) {
  const positives = scored.filter((row) => row.label === 1).length;
  if (!positives) return null;
  const sorted = [...scored].sort((a, b) => b.probability - a.probability);
  let truePositives = 0;
  let falsePositives = 0;
  let area = 0;
  let previousRecall = 0;
  for (const row of sorted) {
    if (row.label === 1) truePositives += 1; else falsePositives += 1;
    const precision = truePositives / (truePositives + falsePositives);
    const recall = truePositives / positives;
    if (row.label === 1) {
      area += precision * (recall - previousRecall);
      previousRecall = recall;
    }
  }
  return Number(area.toFixed(3));
}

function reliabilityBins(scored, binCount = 5) {
  const bins = Array.from({ length: binCount }, (_, i) => ({
    rangeLow: Number((i / binCount).toFixed(2)),
    rangeHigh: Number(((i + 1) / binCount).toFixed(2)),
    count: 0,
    meanPredicted: 0,
    empiricalRate: 0,
  }));
  scored.forEach((row) => {
    const binIndex = Math.min(binCount - 1, Math.floor(row.probability * binCount));
    bins[binIndex].count += 1;
    bins[binIndex].meanPredicted += row.probability;
    bins[binIndex].empiricalRate += row.label;
  });
  return bins.map((bin) => ({
    ...bin,
    meanPredicted: bin.count ? Number((bin.meanPredicted / bin.count).toFixed(3)) : null,
    empiricalRate: bin.count ? Number((bin.empiricalRate / bin.count).toFixed(3)) : null,
  }));
}

function evaluate(testRows, model, features, thresholds) {
  if (!testRows.length) return { sampleCount: 0 };
  const scored = withProbabilities(testRows, model, features);
  const brierScore = Number((scored.reduce((sum, row) => sum + (row.probability - row.label) ** 2, 0) / scored.length).toFixed(3));

  const decisions = scored.map((row) => ({ ...row, decision: decisionFor(row.probability, thresholds) }));
  const called = decisions.filter((row) => row.decision !== "no_call");
  const noCallRate = Number(((decisions.length - called.length) / decisions.length).toFixed(3));

  const resistantCalled = called.filter((row) => row.label === 1);
  const susceptibleCalled = called.filter((row) => row.label === 0);
  const resistantRecall = resistantCalled.length ? Number((resistantCalled.filter((row) => row.decision === "likely_to_fail").length / resistantCalled.length).toFixed(3)) : null;
  const susceptibleRecall = susceptibleCalled.length ? Number((susceptibleCalled.filter((row) => row.decision === "likely_to_work").length / susceptibleCalled.length).toFixed(3)) : null;
  const calledAccuracy = called.length ? Number((called.filter((row) => (row.decision === "likely_to_fail") === (row.label === 1)).length / called.length).toFixed(3)) : null;
  const balancedAccuracy = resistantRecall !== null && susceptibleRecall !== null ? Number(((resistantRecall + susceptibleRecall) / 2).toFixed(3)) : null;

  const truePositives = called.filter((row) => row.decision === "likely_to_fail" && row.label === 1).length;
  const predictedPositives = called.filter((row) => row.decision === "likely_to_fail").length;
  const precisionResistant = predictedPositives ? truePositives / predictedPositives : null;
  const f1Resistant = precisionResistant !== null && resistantRecall !== null && (precisionResistant + resistantRecall) > 0
    ? Number((2 * precisionResistant * resistantRecall / (precisionResistant + resistantRecall)).toFixed(3))
    : null;

  return {
    sampleCount: testRows.length,
    calledCount: called.length,
    noCallRate,
    calledAccuracy,
    balancedAccuracy,
    resistantRecall,
    susceptibleRecall,
    f1Resistant,
    auRoc: auroc(scored),
    prAuc: prAuc(scored),
    brierScore,
    reliabilityBins: reliabilityBins(scored),
  };
}

function modelCard(artifact) {
  const metric = artifact.validation;
  const groups = artifact.groupedSplit;
  return `# ${artifact.antibiotic} baseline model card

## Intended use

Research-only early warning for antibiotic failure in the explicitly supported species. Predictions require AMRFinderPlus evidence, genome QC, target-locus confirmation for likely-to-work calls, and confirmation by phenotypic AST and qualified clinical review.

## Training design

- Model: L2-regularized logistic regression
- Split: deterministic group-level train / calibration / test
- Groups: ${groups.trainGroups} train, ${groups.calibrationGroups} calibration, ${groups.testGroups} test
- Calibration: threshold calibration fitted on the calibration split only
- Abstention thresholds: likely-to-work <= ${artifact.thresholds.lowThreshold}; likely-to-fail >= ${artifact.thresholds.highThreshold}; otherwise no-call

## Held-out test metrics

- Samples: ${metric.sampleCount}
- Balanced accuracy: ${metric.balancedAccuracy ?? "not estimable"}
- Resistant recall: ${metric.resistantRecall ?? "not estimable"}
- Susceptible recall: ${metric.susceptibleRecall ?? "not estimable"}
- Resistant F1: ${metric.f1Resistant ?? "not estimable"}
- AUROC: ${metric.auRoc ?? "not estimable"}
- PR-AUC: ${metric.prAuc ?? "not estimable"}
- Brier score: ${metric.brierScore}
- No-call rate: ${metric.noCallRate}
- Accuracy among called samples: ${metric.calledAccuracy ?? "not estimable"}

## Limitations

These metrics describe only the supplied grouped test set. They do not establish clinical validity, transportability across sites, or performance on unseen species, lineages, sequencing platforms, or resistance mechanisms.
`;
}

async function main() {
  const input = process.argv[2];
  const antibiotic = process.argv[3];
  if (!input || !antibiotic) throw new Error("Usage: node scripts/train-baseline.js <features.csv> <antibiotic-id>");
  const rows = parseCsv(await readFile(input, "utf8")).filter((row) => row.antibiotic === antibiotic);
  if (rows.length < 20) throw new Error("At least 20 labeled rows are required for this baseline trainer.");
  if (rows.some((row) => row.label !== "0" && row.label !== "1")) throw new Error("Labels must be binary values 0 or 1.");
  const required = new Set(["sample_id", "group_id", "antibiotic", "label"]);
  const features = Object.keys(rows[0]).filter((header) => !required.has(header));
  if (!features.length) throw new Error("At least one numeric feature column is required.");
  const split = groupedSplit(rows);
  const model = trainLogistic(split.train, features);

  const calibrationScored = withProbabilities(split.calibration.length ? split.calibration : split.train, model, features);
  const thresholds = calibrateThresholds(calibrationScored);

  const artifact = {
    schemaVersion: 2,
    antibiotic,
    trainedAt: new Date().toISOString(),
    featureNames: features,
    groupedSplit: { trainGroups: split.trainGroups, calibrationGroups: split.calibrationGroups, testGroups: split.testGroups },
    model,
    thresholds,
    validation: evaluate(split.test, model, features, thresholds),
  };
  const outputDir = path.join(__dirname, "..", "models");
  await mkdir(outputDir, { recursive: true });
  const output = path.join(outputDir, `${antibiotic}.json`);
  const cardOutput = path.join(outputDir, `${antibiotic}.model-card.md`);
  await Promise.all([
    writeFile(output, JSON.stringify(artifact, null, 2)),
    writeFile(cardOutput, modelCard(artifact)),
  ]);
  console.log(`Wrote ${output}`);
  console.log(JSON.stringify(artifact.validation, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { parseCsv, groupedSplit, trainLogistic, evaluate, calibrateThresholds };
