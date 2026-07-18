const { parseFasta, summarizeGenome } = require("./fasta");
const { parseAmrFinderTsv, runAmrFinder } = require("./amrfinder");
const { runPredictions } = require("./predictor");
const { auditPredictions } = require("./auditor");
const { SUPPORTED_SPECIES } = require("./config");
const { buildTargetEvidence } = require("./targets");

async function analyzeGenome({ fastaText, amrTsv = "", gffText = "", species = "Escherichia coli", forceImported = false }) {
  const records = parseFasta(fastaText);
  const genomeSummary = summarizeGenome(records);
  let hits = [];
  let readerMode = "fasta_only";

  if (amrTsv.trim()) {
    hits = parseAmrFinderTsv(amrTsv);
    readerMode = "imported_amrfinder";
  } else if (!forceImported) {
    const profile = SUPPORTED_SPECIES[String(species).toLowerCase()];
    const scan = await runAmrFinder(fastaText, profile?.amrFinderOrganism || "Escherichia");
    if (scan.available) {
      hits = scan.hits;
      readerMode = "amrfinder";
    }
  }

  const targetEvidence = buildTargetEvidence(gffText);
  const context = { species, genomeSummary, hits, readerMode, targetEvidence };
  const predictions = runPredictions(context);
  const audit = auditPredictions(predictions, context);
  return {
    analysisId: `gf_${Date.now().toString(36)}`,
    createdAt: new Date().toISOString(),
    species,
    reader: {
      mode: readerMode,
      hitCount: hits.length,
      targetAnnotation: gffText.trim() ? "imported_gff" : "not_supplied",
    },
    genome: genomeSummary,
    predictions,
    audit,
    disclaimer: "Research prototype only. Confirm every result with standard antimicrobial susceptibility testing and qualified clinical review.",
  };
}

module.exports = { analyzeGenome };
