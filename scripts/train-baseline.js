const { readFile, writeFile, mkdir } = require("node:fs/promises");
const path = require("node:path");

function sigmoid(value) {
  if (value < -30) return 0;
  if (value > 30) return 1;
  return 1 / (1 + Math.exp(-value));
}

function parseCsv(text) {
  const rows = text.trim().split(/\r?\n/).map((line) => line.split(",").map((cell) => cell.trim()));
  const headers = rows.shift();
  return rows.map((cells) => Object.fromEntries(headers.map((header, index) => [header, cells[index]])));
}

function groupedSplit(rows) {
  const groups = [...new Set(rows.map((row) => row.group_id))].sort();
  const testGroups = new Set(groups.filter((_, index) => index % 5 === 0));
  return {
    train: rows.filter((row) => !testGroups.has(row.group_id)),
    test: rows.filter((row) => testGroups.has(row.group_id)),
    trainGroups: groups.length - testGroups.size,
    testGroups: testGroups.size,
  };
}

function trainLogistic(rows, features, iterations = 3000, learningRate = 0.04, l2 = 0.01) {
  const weights = Array(features.length).fill(0);
  let intercept = 0;
  for (let step = 0; step < iterations; step += 1) {
    const gradient = Array(features.length).fill(0);
    let interceptGradient = 0;
    for (const row of rows) {
      const values = features.map((feature) => Number(row[feature]) || 0);
      const label = Number(row.label);
      const prediction = sigmoid(intercept + values.reduce((sum, value, index) => sum + value * weights[index], 0));
      const error = prediction - label;
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

function metrics(rows, model, features) {
  if (!rows.length) return { sampleCount: 0 };
  let squaredError = 0;
  let correct = 0;
  rows.forEach((row) => {
    const score = model.intercept + features.reduce((sum, feature) => sum + (Number(row[feature]) || 0) * model.weights[feature], 0);
    const probability = sigmoid(score);
    const label = Number(row.label);
    squaredError += (probability - label) ** 2;
    correct += Number((probability >= 0.5) === Boolean(label));
    return { probability, label };
  });
  return {
    sampleCount: rows.length,
    accuracy: Number((correct / rows.length).toFixed(3)),
    brierScore: Number((squaredError / rows.length).toFixed(3)),
    note: "Add balanced accuracy, per-class recall, PR-AUC and reliability bins before judging model quality.",
  };
}

async function main() {
  const input = process.argv[2];
  const antibiotic = process.argv[3];
  if (!input || !antibiotic) {
    throw new Error("Usage: node scripts/train-baseline.js <features.csv> <antibiotic-id>");
  }
  const rows = parseCsv(await readFile(input, "utf8")).filter((row) => row.antibiotic === antibiotic);
  if (rows.length < 20) throw new Error("At least 20 labeled rows are required for this baseline trainer.");
  const required = new Set(["sample_id", "group_id", "antibiotic", "label"]);
  const features = Object.keys(rows[0]).filter((header) => !required.has(header));
  const split = groupedSplit(rows);
  if (!split.test.length || !split.train.length) throw new Error("At least two distinct group_id values are required.");
  const model = trainLogistic(split.train, features);
  const artifact = {
    schemaVersion: 1,
    antibiotic,
    trainedAt: new Date().toISOString(),
    featureNames: features,
    groupedSplit: { trainGroups: split.trainGroups, testGroups: split.testGroups },
    model,
    validation: metrics(split.test, model, features),
  };
  const outputDir = path.join(__dirname, "..", "models");
  await mkdir(outputDir, { recursive: true });
  const output = path.join(outputDir, `${antibiotic}.json`);
  await writeFile(output, JSON.stringify(artifact, null, 2));
  console.log(`Wrote ${output}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
