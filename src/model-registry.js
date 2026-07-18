const { readFile } = require("node:fs/promises");
const path = require("node:path");

async function loadModel(antibioticId, modelsDir = path.join(__dirname, "..", "models")) {
  try {
    const artifact = JSON.parse(await readFile(path.join(modelsDir, `${antibioticId}.json`), "utf8"));
    const allowedFeatures = new Set(["marker_count", "mutation_count", "target_confirmed"]);
    if (
      artifact.schemaVersion !== 2
      || artifact.antibiotic !== antibioticId
      || !Array.isArray(artifact.featureNames)
      || !artifact.model?.weights
      || artifact.calibration?.method !== "platt"
      || artifact.featureNames.some((name) => !allowedFeatures.has(name))
      || !Number.isFinite(artifact.thresholds?.susceptible)
      || !Number.isFinite(artifact.thresholds?.resistant)
    ) throw new Error(`Invalid model artifact for ${antibioticId}.`);
    return artifact;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function loadModelRegistry(antibiotics, modelsDir) {
  const entries = await Promise.all(antibiotics.map(async (antibiotic) => [
    antibiotic.id,
    await loadModel(antibiotic.id, modelsDir),
  ]));
  return Object.fromEntries(entries);
}

module.exports = { loadModel, loadModelRegistry };
