const { ANTIBIOTICS, SUPPORTED_SPECIES } = require("./config");
const { extractAntibioticFeatures } = require("./features");

function sigmoid(value) {
  return 1 / (1 + Math.exp(-value));
}

// Trained per-antibiotic model artifacts (see scripts/train-baseline.js and
// data/README.md) override the placeholder heuristic weights in config.js
// when present. Loaded once at startup; a missing artifact is expected and
// silently falls back so the app keeps working before training has run.
function loadTrainedModel(antibioticId) {
  try {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    return require(`../models/${antibioticId}.json`);
  } catch (error) {
    return null;
  }
}

const TRAINED_MODELS = Object.fromEntries(ANTIBIOTICS.map((a) => [a.id, loadTrainedModel(a.id)]));

function matchesMarker(hit, patterns) {
  const haystack = `${hit.gene || ""} ${hit.name || ""} ${hit.subtype || ""}`;
  return patterns.some((pattern) => pattern.test(haystack));
}

function classifyEvidence(hit) {
  const text = `${hit.name || ""} ${hit.subtype || ""} ${hit.method || ""}`;
  return /point|mutation|variant|SNP/i.test(text) ? "known_mutation" : "known_gene";
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

function scoreEvidence(antibiotic, features) {
  const trained = TRAINED_MODELS[antibiotic.id];
  if (trained) {
    const weights = trained.model.weights;
    const featureNames = trained.featureNames || Object.keys(weights);
    const rawScore = trained.model.intercept + featureNames.reduce(
      (sum, name) => sum + (weights[name] || 0) * (features[name] || 0),
      0,
    );
    return {
      probabilityOfFailure: Number(sigmoid(rawScore).toFixed(3)),
      highThreshold: trained.thresholds.highThreshold,
      lowThreshold: trained.thresholds.lowThreshold,
      modelSource: `trained_baseline:${trained.trainedAt}`,
    };
  }
  const rawScore = antibiotic.intercept
    + antibiotic.markerWeight * Math.min(features.marker_count || 0, 2)
    + antibiotic.mutationWeight * Math.min(features.mutation_count || 0, 2);
  return {
    probabilityOfFailure: Number(sigmoid(rawScore).toFixed(3)),
    highThreshold: 0.67,
    lowThreshold: 0.33,
    modelSource: "heuristic_placeholder",
  };
}

// The brief requires every result to state which of three evidence types
// backs it: (i) a known resistance gene/DNA change was detected, (ii) the
// model found only a statistical association, or (iii) no known resistance
// signal was found. This predictor's decision gate (below) never allows a
// likely_to_fail call without at least one curated AMRFinderPlus hit, so
// "statistical_association_only" is structurally unreachable today -- kept
// here, rather than removed, so an honest label exists if a future model
// (e.g. a k-mer or embedding classifier) adds evidence that isn't a named
// gene/mutation.
function evidenceCategory(evidenceList, decision) {
  if (evidenceList.length) return "known_gene_or_mutation";
  if (decision === "likely_to_fail") return "statistical_association_only";
  return "no_known_signal";
}

function predictAntibiotic(antibiotic, context) {
  const gate = targetGate(context, antibiotic.id);
  const extracted = extractAntibioticFeatures(antibiotic, context.hits, gate);
  const evidence = extracted.evidence;
  const modelFeatures = {
    marker_count: extracted.markerCount,
    mutation_count: extracted.mutationCount,
    target_confirmed: extracted.targetConfirmed,
  };
  const { probabilityOfFailure, highThreshold, lowThreshold, modelSource } = scoreEvidence(antibiotic, modelFeatures);

  const scanDescription = context.readerMode === "amrfinder" ? "a completed AMRFinderPlus scan" : "the imported AMRFinderPlus result";

  let decision = "no_call";
  let reason = gate.rationale;
  if (context.genomeSummary.qc !== "fail" && evidence.length && probabilityOfFailure >= highThreshold) {
    decision = "likely_to_fail";
    reason = "Known AMR evidence raises the estimated probability of antibiotic failure.";
  } else if (gate.pass && (context.readerMode === "amrfinder" || context.readerMode === "imported_amrfinder") && probabilityOfFailure <= lowThreshold) {
    decision = "likely_to_work";
    reason = evidence.length
      ? `A marker was detected in ${scanDescription}, but the calibrated model estimates a low probability of failure from this evidence alone and the target gate passed.`
      : `No relevant marker was detected in ${scanDescription} and the target gate passed.`;
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
    evidence,
    evidenceCategory: evidenceCategory(evidence, decision),
    explanation: reason,
    modelSource,
  };
}

function runPredictions(context) {
  return ANTIBIOTICS.map((antibiotic) => predictAntibiotic(antibiotic, context));
}

module.exports = { runPredictions, targetGate, matchesMarker, classifyEvidence };
