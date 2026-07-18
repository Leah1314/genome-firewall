function matchesMarker(hit, patterns) {
  const haystack = `${hit.gene || ""} ${hit.name || ""} ${hit.subtype || ""}`;
  return patterns.some((pattern) => pattern.test(haystack));
}

function classifyEvidence(hit) {
  const text = `${hit.name || ""} ${hit.subtype || ""} ${hit.method || ""}`;
  return /point|mutation|variant|SNP/i.test(text) ? "known_mutation" : "known_gene";
}

function extractAntibioticFeatures(antibiotic, hits, targetEvidence = {}) {
  const evidence = hits
    .filter((hit) => matchesMarker(hit, antibiotic.markers))
    .map((hit) => ({ ...hit, category: classifyEvidence(hit) }));
  return {
    evidence,
    markerCount: evidence.filter((hit) => hit.category === "known_gene").length,
    mutationCount: evidence.filter((hit) => hit.category === "known_mutation").length,
    targetConfirmed: targetEvidence.pass ? 1 : 0,
  };
}

module.exports = { matchesMarker, classifyEvidence, extractAntibioticFeatures };
