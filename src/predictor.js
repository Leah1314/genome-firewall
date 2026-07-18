const { ANTIBIOTICS, SUPPORTED_SPECIES } = require("./config");

function sigmoid(value) {
  return 1 / (1 + Math.exp(-value));
}

function matchesMarker(hit, patterns) {
  const haystack = `${hit.gene || ""} ${hit.name || ""} ${hit.subtype || ""}`;
  return patterns.some((pattern) => pattern.test(haystack));
}

function classifyEvidence(hit) {
  const text = `${hit.name || ""} ${hit.subtype || ""} ${hit.method || ""}`;
  return /point|mutation|variant|SNP/i.test(text) ? "known_mutation" : "known_gene";
}

function targetGate({ species, genomeSummary }) {
  const profile = SUPPORTED_SPECIES[String(species || "").toLowerCase()];
  if (!profile) return { pass: false, status: "unsupported_species", rationale: "Species is outside the validated scope." };
  if (genomeSummary.qc === "fail") return { pass: false, status: "insufficient_genome", rationale: "Genome quality is too low to establish target context." };
  const [min, max] = profile.expectedGenomeRange;
  if (genomeSummary.totalBases < min || genomeSummary.totalBases > max) {
    return { pass: false, status: "size_out_of_range", rationale: "Assembly size is outside the supported species range." };
  }
  return {
    pass: true,
    status: "species_qc_proxy",
    rationale: "Target context is provisionally supported by species identity and assembly QC; confirm target loci in the production pipeline.",
  };
}

function predictAntibiotic(antibiotic, context) {
  const gate = targetGate(context);
  const evidence = context.hits
    .filter((hit) => matchesMarker(hit, antibiotic.markers))
    .map((hit) => ({ ...hit, category: classifyEvidence(hit) }));
  const geneCount = evidence.filter((hit) => hit.category === "known_gene").length;
  const mutationCount = evidence.filter((hit) => hit.category === "known_mutation").length;
  const rawScore = antibiotic.intercept
    + antibiotic.markerWeight * Math.min(geneCount, 2)
    + antibiotic.mutationWeight * Math.min(mutationCount, 2);
  const probabilityOfFailure = Number(sigmoid(rawScore).toFixed(3));

  let decision = "no_call";
  let reason = gate.rationale;
  if (gate.pass && evidence.length && probabilityOfFailure >= 0.67) {
    decision = "likely_to_fail";
    reason = "Known AMR evidence raises the estimated probability of antibiotic failure.";
  } else if (gate.pass && context.readerMode === "amrfinder" && probabilityOfFailure <= 0.33) {
    decision = "likely_to_work";
    reason = "No relevant marker was detected in a completed AMRFinderPlus scan and the target gate passed.";
  } else if (gate.pass && context.readerMode === "imported_amrfinder" && probabilityOfFailure <= 0.33) {
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
    evidence,
    explanation: reason,
  };
}

function runPredictions(context) {
  return ANTIBIOTICS.map((antibiotic) => predictAntibiotic(antibiotic, context));
}

module.exports = { runPredictions, targetGate };
