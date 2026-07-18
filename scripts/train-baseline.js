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

function groupedSplit(rows) {
  const groups = [...new Set(rows.map((row) => row.group_id))].sort();
  if (groups.length < 3) throw new Error("At least three distinct group_id values are required for train, validation, and test splits.");
  const testGroups = new Set(groups.filter((_, index) => index % 5 === 0));
  const validationGroups = new Set(groups.filter((_, index) => index % 5 === 1));
  const train = rows.filter((row) => !testGroups.has(row.group_id) && !validationGroups.has(row.group_id));
  const validation = rows.filter((row) => validationGroups.has(row.group_id));
  const test = rows.filter((row) => testGroups.has(row.group_id));
  if (!train.length || !validation.length || !test.length) throw new Error("Each grouped split must contain at least one row.");
  const hasBothLabels = (members) => new Set(members.map((row) => Number(row.label))).size === 2;
  if (![train, validation, test].every(hasBothLabels)) {
    throw new Error("Each grouped split must contain both resistant and susceptible labels; add groups or revise the predeclared grouping strategy.");
  }
  return {
    train,
    validation,
    test,
    groupCounts: {
      train: groups.length - testGroups.size - validationGroups.size,
      validation: validationGroups.size,
      test: testGroups.size,
    },
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
  let intercept = 0;
  for (let step = 0; step < iterations; step += 1) {
    const gradient = Array(features.length).fill(0);
    let interceptGradient = 0;
    for (const row of rows) {
      const values = features.map((feature) => Number(row[feature]) || 0);
      const error = sigmoid(intercept + values.reduce((sum, value, index) => sum + value * weights[index], 0)) - Number(row.label);
      interceptGradient += error;
      values.forEach((value, index) => { gradient[index] += error * value; });
    }
    intercept -= learningRate * interceptGradient / rows.length;
    weights.forEach((weight, index) => {
      weights[index] -= learningRate * (gradient[index] / rows.length + l2 * weight);
    });
  }
  return { intercept, weights: Object.fromEntries(features.map((feature, index) => [feature, weights[index]])) };
}

function fitPlatt(rows, model, features, iterations = 1500, learningRate = 0.03) {
  let slope = 1;
  let intercept = 0;
  for (let step = 0; step < iterations; step += 1) {
    let slopeGradient = 0;
    let interceptGradient = 0;
    for (const row of rows) {
      const score = rawScore(row, model, features);
      const error = sigmoid(intercept + slope * score) - Number(row.label);
      slopeGradient += error * score;
      interceptGradient += error;
    }
    slope -= learningRate * slopeGradient / rows.length;
    intercept -= learningRate * interceptGradient / rows.length;
  }
  return { method: "platt", slope, intercept };
}

function predictProbability(row, model, features, calibration = { slope: 1, intercept: 0 }) {
  return sigmoid(calibration.intercept + calibration.slope * rawScore(row, model, features));
}

function aucRoc(items) {
  const positives = items.filter((item) => item.label === 1);
  const negatives = items.filter((item) => item.label === 0);
  if (!positives.length || !negatives.length) return null;
  let wins = 0;
  for (const positive of positives) {
    for (const negative of negatives) {
      wins += positive.probability === negative.probability ? 0.5 : Number(positive.probability > negative.probability);
    }
  }
  return wins / (positives.length * negatives.length);
}

function aucPr(items) {
  const positives = items.filter((item) => item.label === 1).length;
  if (!positives) return null;
  const sorted = [...items].sort((a, b) => b.probability - a.probability);
  let truePositives = 0;
  let falsePositives = 0;
  let previousRecall = 0;
  let area = 0;
  for (const item of sorted) {
    if (item.label) truePositives += 1;
    else falsePositives += 1;
    const recall = truePositives / positives;
    const precision = truePositives / (truePositives + falsePositives);
    area += (recall - previousRecall) * precision;
    previousRecall = recall;
  }
  return area;
}

function evaluate(rows, model, features, calibration, thresholds = { susceptible: 0.33, resistant: 0.67 }) {
  const items = rows.map((row) => ({
    label: Number(row.label),
    probability: predictProbability(row, model, features, calibration),
  }));
  const counts = {
    trueResistant: 0,
    falseResistant: 0,
    trueSusceptible: 0,
    falseSusceptible: 0,
    noCallResistant: 0,
    noCallSusceptible: 0,
  };
  let squaredError = 0;
  for (const item of items) {
    squaredError += (item.probability - item.label) ** 2;
    if (item.probability >= thresholds.resistant) {
      if (item.label) counts.trueResistant += 1;
      else counts.falseResistant += 1;
    } else if (item.probability <= thresholds.susceptible) {
      if (item.label) counts.falseSusceptible += 1;
      else counts.trueSusceptible += 1;
    } else if (item.label) counts.noCallResistant += 1;
    else counts.noCallSusceptible += 1;
  }
  const divide = (numerator, denominator) => denominator ? numerator / denominator : null;
  const noCall = counts.noCallResistant + counts.noCallSusceptible;
  const resistantRecall = divide(counts.trueResistant, counts.trueResistant + counts.falseSusceptible + counts.noCallResistant);
  const susceptibleRecall = divide(counts.trueSusceptible, counts.trueSusceptible + counts.falseResistant + counts.noCallSusceptible);
  const precision = divide(counts.trueResistant, counts.trueResistant + counts.falseResistant);
  const called = items.length - noCall;
  const reliabilityBins = Array.from({ length: 5 }, (_, index) => {
    const lower = index / 5;
    const upper = (index + 1) / 5;
    const bin = items.filter((item) => item.probability >= lower && (index === 4 ? item.probability <= upper : item.probability < upper));
    return {
      lower,
      upper,
      count: bin.length,
      meanPredicted: bin.length ? bin.reduce((sum, item) => sum + item.probability, 0) / bin.length : null,
      observedFailureRate: bin.length ? bin.reduce((sum, item) => sum + item.label, 0) / bin.length : null,
    };
  });
  const round = (value) => value === null ? null : Number(value.toFixed(4));
  return {
    sampleCount: items.length,
    confusion: counts,
    resistantRecall: round(resistantRecall),
    susceptibleRecall: round(susceptibleRecall),
    balancedAccuracy: round(resistantRecall === null || susceptibleRecall === null ? null : (resistantRecall + susceptibleRecall) / 2),
    resistantPrecision: round(precision),
    resistantF1: round(precision === null || resistantRecall === null || precision + resistantRecall === 0 ? null : 2 * precision * resistantRecall / (precision + resistantRecall)),
    auroc: round(aucRoc(items)),
    prAuc: round(aucPr(items)),
    brierScore: round(squaredError / items.length),
    noCallRate: round(noCall / items.length),
    calledAccuracy: round(divide(counts.trueResistant + counts.trueSusceptible, called)),
    reliabilityBins: reliabilityBins.map((bin) => ({
      ...bin,
      meanPredicted: round(bin.meanPredicted),
      observedFailureRate: round(bin.observedFailureRate),
    })),
  };
}

function selectThresholds(rows, model, features, calibration) {
  let best = null;
  for (let susceptible = 0.1; susceptible <= 0.45; susceptible += 0.05) {
    for (let resistant = 0.55; resistant <= 0.9; resistant += 0.05) {
      const thresholds = { susceptible: Number(susceptible.toFixed(2)), resistant: Number(resistant.toFixed(2)) };
      const result = evaluate(rows, model, features, calibration, thresholds);
      if (result.calledAccuracy === null || result.balancedAccuracy === null) continue;
      const utility = result.calledAccuracy * 0.55 + result.balancedAccuracy * 0.35 - result.noCallRate * 0.1;
      if (!best || utility > best.utility) best = { thresholds, utility };
    }
  }
  return best?.thresholds || { susceptible: 0.33, resistant: 0.67 };
}

function modelCard(artifact) {
  const metric = artifact.testMetrics;
  return `# ${artifact.antibiotic} baseline model card

## Intended use

Research-only early warning for antibiotic failure in the explicitly supported species. Predictions require AMRFinderPlus evidence, genome QC, target-locus confirmation for likely-to-work calls, and confirmation by phenotypic AST and qualified clinical review.

## Training design

- Model: L2-regularized logistic regression
- Split: deterministic group-level train / validation / test
- Groups: ${artifact.groupedSplit.train} train, ${artifact.groupedSplit.validation} validation, ${artifact.groupedSplit.test} test
- Calibration: Platt scaling fitted on validation groups only
- Abstention thresholds: susceptible <= ${artifact.thresholds.susceptible}; resistant >= ${artifact.thresholds.resistant}; otherwise no-call

## Held-out test metrics

- Samples: ${metric.sampleCount}
- Balanced accuracy: ${metric.balancedAccuracy ?? "not estimable"}
- Resistant recall: ${metric.resistantRecall ?? "not estimable"}
- Susceptible recall: ${metric.susceptibleRecall ?? "not estimable"}
- Resistant F1: ${metric.resistantF1 ?? "not estimable"}
- AUROC: ${metric.auroc ?? "not estimable"}
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
  const calibration = fitPlatt(split.validation, model, features);
  const thresholds = selectThresholds(split.validation, model, features, calibration);
  const artifact = {
    schemaVersion: 2,
    antibiotic,
    trainedAt: new Date().toISOString(),
    featureNames: features,
    groupedSplit: split.groupCounts,
    model,
    calibration,
    thresholds,
    validationMetrics: evaluate(split.validation, model, features, calibration, thresholds),
    testMetrics: evaluate(split.test, model, features, calibration, thresholds),
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
  console.log(`Wrote ${cardOutput}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { parseCsv, groupedSplit, trainLogistic, fitPlatt, evaluate, selectThresholds };
