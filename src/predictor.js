const { ANTIBIOTICS, SUPPORTED_SPECIES } = require("./config");
const { extractAntibioticFeatures } = require("./features");

function sigmoid(value) {
  return 1 / (1 + Math.exp(-value));
}

function artifactProbability(artifact, features) {
  const values = {
    marker_count: features.markerCount,
    mutation_count: features.mutationCount,
    target_confirmed: features.targetConfirmed,
  };
  const score = artifact.model.intercept + artifact.featureNames.reduce(
    (sum, name) => sum + (Number(values[name]) || 0) * artifact.model.weights[name],
    0,
  );
  return sigmoid(artifact.calibration.intercept + artifact.calibration.slope * score);
}

function targetGate({ species, genomeSummary, targetEvidence }, antibioticId) {
  const profile = SUPPORTED_SPECIES[String(species || "").toLowerCase()];
  if (!profile) return { pass: false, status: "unsupported_species", rationale: "Species is outside the validated scope." };
  if (genomeSummary.qc === "fail") return { pass: false, status: "insufficient_genome", rationale: "Genome quality is too low to establish target context." };
  const [min, max] = profile.expectedGenomeRange;
  if (genomeSummary.totalBases < min || genomeSummary.totalBases > max) {
    return { pass: false, status: "size_out_of_range", rationale: "Assembly size is outside the supported species range." };
  }
  return targetEvidence?.[antibioticId] || {
    pass: false,
    assessed: false,
    status: "not_assessed",
    matched: [],
    missing: [],
    rationale: "No genome annotation was supplied, so molecular target presence was not assessed.",
  };
}

function predictAntibiotic(antibiotic, context) {
  const gate = targetGate(context, antibiotic.id);
  const features = extractAntibioticFeatures(antibiotic, context.hits, gate);
  const evidence = features.evidence;
  const geneCount = features.markerCount;
  const mutationCount = features.mutationCount;
  const rawScore = antibiotic.intercept
    + antibiotic.markerWeight * Math.min(geneCount, 2)
    + antibiotic.mutationWeight * Math.min(mutationCount, 2);
  const artifact = context.models?.[antibiotic.id];
  const probabilityOfFailure = Number((artifact
    ? artifactProbability(artifact, features)
    : sigmoid(rawScore)).toFixed(3));
  const thresholds = artifact?.thresholds || { susceptible: 0.33, resistant: 0.67 };

  let decision = "no_call";
  let reason = gate.rationale;
  if (context.genomeSummary.qc !== "fail" && evidence.length && probabilityOfFailure >= thresholds.resistant) {
    decision = "likely_to_fail";
    reason = "Known AMR evidence raises the estimated probability of antibiotic failure.";
  } else if (gate.pass && context.readerMode === "amrfinder" && probabilityOfFailure <= thresholds.susceptible) {
    decision = "likely_to_work";
    reason = "No relevant marker was detected in a completed AMRFinderPlus scan and the target gate passed.";
  } else if (gate.pass && context.readerMode === "imported_amrfinder" && probabilityOfFailure <= thresholds.susceptible) {
    decision = "likely_to_work";
    reason = "No relevant marker was detected in the imported AMRFinderPlus result and the target gate passed.";
  } else if (gate.pass && !evidence.length) {
    reason = "No relevant marker is visible, but a complete AMRFinderPlus result is required before a susceptible call.";
  }

  const distance = Math.abs(probabilityOfFailure - 0.5) * 2;
  const confidence = decision === "no_call" ? Math.min(0.49, distance) : Math.min(0.96, 0.55 + distance * 0.4);
  return {
    antibiotic: antibiotic.label,
    antibioticId: antibiotic.id,
    decision,
    probabilityOfFailure,
    confidence: Number(confidence.toFixed(2)),
    target: antibiotic.target,
    targetGate: gate,
    modelSource: artifact ? "trained_artifact" : "bundled_baseline",
    modelVersion: artifact ? `schema-${artifact.schemaVersion}` : "integration-baseline-v1",
    decisionThresholds: thresholds,
    evidence,
    explanation: reason,
  };
}

function runPredictions(context) {
  return ANTIBIOTICS.map((antibiotic) => predictAntibiotic(antibiotic, context));
}

module.exports = { runPredictions, targetGate };
