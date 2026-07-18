const REPORT_MODEL = process.env.OPENAI_MODEL || "gpt-5.4-mini";

function reportAgentConfigured() {
  return Boolean(process.env.OPENAI_API_KEY);
}

function extractOutputText(payload) {
  if (payload.output_text) return payload.output_text;
  return (payload.output || [])
    .flatMap((item) => item.content || [])
    .filter((item) => item.type === "output_text")
    .map((item) => item.text)
    .join("\n")
    .trim();
}

function safeReportInput(analysis) {
  return {
    species: analysis.species,
    genome: analysis.genome,
    reader: analysis.reader,
    predictions: analysis.predictions.map((prediction) => ({
      antibiotic: prediction.antibiotic,
      decision: prediction.decision,
      confidence: prediction.confidence,
      probabilityOfFailure: prediction.probabilityOfFailure,
      targetGate: prediction.targetGate,
      explanation: prediction.explanation,
      evidence: prediction.evidence.map((item) => ({
        gene: item.gene,
        name: item.name,
        category: item.category,
        source: item.source,
      })),
    })),
    audit: analysis.audit,
    disclaimer: analysis.disclaimer,
  };
}

async function generateReportBrief(analysis) {
  if (!reportAgentConfigured()) {
    return { configured: false, model: REPORT_MODEL, text: null };
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: REPORT_MODEL,
      instructions: [
        "You are the bounded Decision Report Agent for a defensive antimicrobial-resistance research prototype.",
        "Summarize only the supplied audited JSON in plain English for a technical reviewer.",
        "Do not change a decision, invent evidence, recommend an antibiotic, provide a dosage, make a clinical treatment recommendation, or suggest any organism modification.",
        "State which calls have known-gene or known-mutation evidence, identify no-calls, and end with the exact laboratory-confirmation requirement from the disclaimer.",
        "Use at most 140 words.",
      ].join(" "),
      input: JSON.stringify(safeReportInput(analysis)),
      max_output_tokens: 260,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error?.message || "OpenAI report generation failed.");
  const text = extractOutputText(payload);
  if (!text) throw new Error("The report agent returned an empty response.");
  return { configured: true, model: REPORT_MODEL, text };
}

module.exports = { generateReportBrief, reportAgentConfigured, safeReportInput };
