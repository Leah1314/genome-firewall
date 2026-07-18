function auditPredictions(predictions, context) {
  const flags = [];
  if (context.genomeSummary.qc !== "pass") {
    flags.push({ severity: "warning", message: "Assembly QC is not a clean pass; interpret all calls cautiously." });
  }
  if (context.readerMode === "fasta_only") {
    flags.push({ severity: "warning", message: "AMRFinderPlus is unavailable and no TSV was imported; susceptible calls are disabled." });
  }
  for (const prediction of predictions) {
    if (prediction.decision === "likely_to_fail" && !prediction.evidence.length) {
      flags.push({ severity: "error", message: `${prediction.antibiotic}: failure call has no traceable evidence.` });
    }
    if (prediction.decision === "likely_to_work" && !prediction.targetGate.pass) {
      flags.push({ severity: "error", message: `${prediction.antibiotic}: susceptible call bypassed its target gate.` });
    }
  }
  return {
    passed: !flags.some((flag) => flag.severity === "error"),
    flags,
    policy: "Defensive prediction only. No organism design, treatment selection, or autonomous clinical action.",
  };
}

module.exports = { auditPredictions };
