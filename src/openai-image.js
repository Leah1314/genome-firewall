// Optional multimodal Decision Report add-on: renders one audited
// prediction as a schematic evidence diagram via OpenAI image generation.
// Same safety contract as src/openai-report.js: this module only ever reads
// already-audited structured fields (never raw sequence, never a free-form
// model decision) and cannot change a decision, invent evidence, or depict
// anything but a labeled diagram -- the prompt explicitly forbids
// photorealistic or organism-modification imagery to stay inside the
// challenge's strictly-defensive scope.

const IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL || "gpt-image-2";

function imageAgentConfigured() {
  return Boolean(process.env.OPENAI_API_KEY);
}

// Evidence gene/protein names ultimately trace back to an uploaded
// AMRFinderPlus TSV, which a caller could hand-edit. They only ever end up
// inside an image prompt (no code execution path), but strip anything
// that isn't plausible gene-name text so a crafted "gene name" can't turn
// into free-form prompt text.
function sanitizeLabel(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/[^\w ./()'-]/g, "")
    .slice(0, 60)
    .trim();
}

function buildPrompt(prediction) {
  const decisionText = prediction.decision.replaceAll("_", " ");
  const evidenceText = prediction.evidence.length
    ? prediction.evidence.map((item) => `${sanitizeLabel(item.gene || item.name)} (${sanitizeLabel(item.category.replaceAll("_", " "))})`).join(", ")
    : "no drug-specific marker detected";

  return [
    "Flat 2D vector infographic in a clean scientific-poster style, white background, sans-serif labels, no photorealism, no gradients meant to look like a photo.",
    `Title text at top: "${sanitizeLabel(prediction.antibiotic)} - ${sanitizeLabel(decisionText)}".`,
    `Three labeled boxes connected left-to-right by simple arrows: box 1 is a stylized DNA-helix icon labeled "Detected evidence: ${evidenceText}"; box 2 is labeled "Molecular target: ${sanitizeLabel(prediction.target)}"; box 3 is a result badge labeled "${sanitizeLabel(decisionText)}, ${Math.round(prediction.confidence * 100)}% confidence".`,
    `Small footnote text reading "Evidence type: ${sanitizeLabel(prediction.evidenceCategory.replaceAll("_", " "))}".`,
    "Small footer banner reading exactly: 'Research decision support. Confirm with standard laboratory testing.'",
    "This must be a strictly schematic, diagrammatic infographic: icons, boxes, arrows, and text only. Do not depict a photorealistic or lifelike bacterium, virus, or cell. Do not depict gene editing, organism engineering, DNA synthesis, or any organism modification. Do not depict laboratory equipment performing genetic modification.",
  ].join(" ");
}

async function generateEvidenceDiagram(prediction) {
  if (!imageAgentConfigured()) {
    return { configured: false, model: IMAGE_MODEL, image: null };
  }

  const response = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: IMAGE_MODEL,
      prompt: buildPrompt(prediction),
      size: "1024x1024",
      n: 1,
    }),
    signal: AbortSignal.timeout(60_000),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error?.message || "OpenAI image generation failed.");
  const b64 = payload.data?.[0]?.b64_json;
  if (!b64) throw new Error("The image agent returned no image data.");
  return { configured: true, model: IMAGE_MODEL, image: `data:image/png;base64,${b64}` };
}

module.exports = { generateEvidenceDiagram, imageAgentConfigured, buildPrompt, sanitizeLabel };
