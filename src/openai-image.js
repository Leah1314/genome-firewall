// Optional multimodal Decision Report add-on: renders one audited
// prediction as a schematic evidence diagram via OpenAI image generation.
// Same safety contract as src/openai-report.js: this module only ever reads
// already-audited structured fields (never raw sequence, never a free-form
// model decision) and cannot change a decision, invent evidence, or depict
// anything but a labeled diagram -- the prompt explicitly forbids
// photorealistic or organism-modification imagery to stay inside the
// challenge's strictly-defensive scope.

const IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL || "gpt-image-2";
// "low" trades fine-grained rendering detail for materially faster
// generation. These are flat schematic infographics, not photorealistic
// art, so the detail low/medium would sacrifice was never being used.
const IMAGE_QUALITY = process.env.OPENAI_IMAGE_QUALITY || "low";

function imageAgentConfigured() {
  return Boolean(process.env.OPENAI_API_KEY);
}

// Fixed per-decision palette, matching public/styles.css's own tokens
// (--red/--green/--amber for fail/work/no-call, --blue for evidence) so
// repeated generations converge on one visual system instead of the model
// re-inventing colors and icon shapes each call.
const DECISION_COLOR = {
  likely_to_fail: "#a2382f",
  likely_to_work: "#0f7256",
  no_call: "#a65a08",
};
const EVIDENCE_COLOR = "#2d5ca8";
// Fixed and deliberately NOT decision-colored: the lab-confirmation
// requirement doesn't get more or less important based on the model's
// confidence or which way it called, and public/styles.css's own
// .disclaimer treatment is neutral for the same reason -- this matches it.
const DISCLAIMER_COLOR = "#121c1a";

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
  const decisionColor = DECISION_COLOR[prediction.decision] || DECISION_COLOR.no_call;
  const evidenceText = prediction.evidence.length
    ? prediction.evidence.map((item) => `${sanitizeLabel(item.gene || item.name)} (${sanitizeLabel(item.category.replaceAll("_", " "))})`).join(", ")
    : "no drug-specific marker detected";

  return [
    "Flat 2D vector infographic, minimal geometric icon style consistent with a modern product design system -- not organic, not hand-drawn, not painterly. White background, sans-serif labels, no photorealism, no gradients meant to look like a photo.",
    `Title text at top: "${sanitizeLabel(prediction.antibiotic)} - ${sanitizeLabel(decisionText)}".`,
    `Three labeled boxes of equal size connected left-to-right by simple arrows, same rounded-rectangle outline style and stroke width for all three boxes:`,
    `box 1 outlined in ${EVIDENCE_COLOR}, containing a stylized DNA-double-helix icon only (two twisting ribbons with simple rungs, geometric, no other imagery), labeled "Detected evidence: ${evidenceText}";`,
    `box 2 outlined in ${EVIDENCE_COLOR}, containing ONLY a simple hexagonal receptor/binding-site icon (a flat hexagon with 2-3 small rounded notches, abstract, not a creature or organism silhouette), labeled "Molecular target: ${sanitizeLabel(prediction.target)}";`,
    `box 3 outlined in ${decisionColor}, containing a plain circular badge in ${decisionColor} with a simple check mark (if the result is favorable) or X mark (if not) or dash (if uncertain), labeled "${sanitizeLabel(decisionText)}, ${Math.round(prediction.confidence * 100)}% confidence".`,
    `Small footnote text reading "Evidence type: ${sanitizeLabel(prediction.evidenceCategory.replaceAll("_", " "))}".`,
    `Footer banner in solid ${DISCLAIMER_COLOR} with white text, reading exactly: 'Research decision support. Confirm with standard laboratory testing.' This banner's color is always ${DISCLAIMER_COLOR} regardless of the result above -- it must never be red, green, amber, or otherwise tinted to match the decision, because the confirmation requirement does not vary with confidence or outcome.`,
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
      quality: IMAGE_QUALITY,
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
