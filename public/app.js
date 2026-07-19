const form = document.querySelector("#analysis-form");
const fastaInput = document.querySelector("#fasta-file");
const amrInput = document.querySelector("#amr-file");
const gffInput = document.querySelector("#gff-file");
const fastaName = document.querySelector("#fasta-name");
const amrName = document.querySelector("#amr-name");
const gffName = document.querySelector("#gff-name");
const analyzeButton = document.querySelector("#analyze-button");
const demoButton = document.querySelector("#demo-button");
const errorElement = document.querySelector("#form-error");
const results = document.querySelector("#results");
const reportAgentButton = document.querySelector("#report-agent-button");
const reportAgentStatus = document.querySelector("#report-agent-status");
const reportAgentOutput = document.querySelector("#report-agent-output");
let currentAnalysis = null;
const isStaticHost = window.location.hostname.endsWith("github.io");

function formatNumber(value) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value);
}

function escapeHtml(value) {
  const node = document.createElement("div");
  node.textContent = String(value ?? "");
  return node.innerHTML;
}

function callLabel(decision) {
  return {
    likely_to_fail: "Likely to fail",
    likely_to_work: "Likely to work",
    no_call: "No-call",
  }[decision] || decision;
}

function callClass(decision) {
  return { likely_to_fail: "fail", likely_to_work: "work", no_call: "no-call" }[decision] || "no-call";
}

function evidenceCategoryLabel(category) {
  return {
    known_gene_or_mutation: "Evidence: known resistance gene or DNA change",
    statistical_association_only: "Evidence: statistical association only — not a confirmed biological cause",
    no_known_signal: "Evidence: no known resistance signal detected",
  }[category] || category;
}

function render(result) {
  currentAnalysis = result;
  reportAgentOutput.hidden = true;
  reportAgentOutput.textContent = "";
  document.querySelector("#analysis-meta").innerHTML = `${escapeHtml(result.analysisId)}<br>${new Date(result.createdAt).toLocaleString()}`;
  document.querySelector("#reader-badge").textContent = result.reader.mode.replaceAll("_", " ");
  const summaries = [
    ["Assembly", result.genome.qc.toUpperCase()],
    ["Genome size", `${formatNumber(result.genome.totalBases / 1_000_000)} Mb`],
    ["AMR evidence", `${result.reader.hitCount} hits`],
    ["No-call rate", `${Math.round(result.predictions.filter((item) => item.decision === "no_call").length / result.predictions.length * 100)}%`],
  ];
  document.querySelector("#summary-grid").innerHTML = summaries.map(([label, value]) => `
    <div class="summary-item"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>
  `).join("");

  document.querySelector("#prediction-list").innerHTML = result.predictions.map((prediction) => {
    const evidenceTags = prediction.evidence.length
      ? prediction.evidence.map((item) => `<span class="evidence-tag">${escapeHtml(item.gene || item.name)} · ${escapeHtml(item.category.replaceAll("_", " "))}</span>`).join("")
      : `<span class="evidence-tag">No drug-specific marker surfaced</span>`;
    const targetTags = (prediction.targetGate.matched || [])
      .map((item) => `<span class="evidence-tag target-tag">Target confirmed · ${escapeHtml(item.requirement)}</span>`)
      .join("");
    return `
      <article class="prediction">
        <div class="drug-name">
          <strong>${escapeHtml(prediction.antibiotic)}</strong>
          <small>${escapeHtml(prediction.target)}</small>
          <small>${prediction.modelSource === "trained_artifact" ? "Calibrated model artifact" : "Bundled integration baseline"}</small>
        </div>
        <div>
          <span class="call ${callClass(prediction.decision)}">${callLabel(prediction.decision)}</span>
          <div class="confidence">${Math.round(prediction.confidence * 100)}% confidence · ${Math.round(prediction.probabilityOfFailure * 100)}% failure estimate</div>
        </div>
        <div class="evidence-copy">
          ${escapeHtml(prediction.explanation)}
          <div class="evidence-category">${escapeHtml(evidenceCategoryLabel(prediction.evidenceCategory))}</div>
          <div class="evidence-tags">${evidenceTags}${targetTags}</div>
          <div class="evidence-image-block">
            <button class="text-button evidence-image-button" type="button" data-antibiotic-id="${escapeHtml(prediction.antibioticId)}">Generate evidence diagram</button>
            <p class="evidence-image-status" hidden></p>
            <img class="evidence-image-output" alt="Schematic evidence diagram for ${escapeHtml(prediction.antibiotic)}" hidden />
          </div>
        </div>
      </article>`;
  }).join("");

  document.querySelector("#audit-title").textContent = result.audit.passed ? "Guardrails passed" : "Review required";
  document.querySelector("#audit-policy").textContent = result.audit.policy;
  document.querySelector("#audit-flags").innerHTML = result.audit.flags.length
    ? result.audit.flags.map((flag) => `<div class="audit-flag">${escapeHtml(flag.message)}</div>`).join("")
    : `<div class="audit-flag clean">No policy or evidence integrity violations detected.</div>`;
  document.querySelector("#disclaimer").textContent = result.disclaimer;
  results.hidden = false;
  results.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function requestAnalysis(endpoint, options, staticFallback) {
  errorElement.textContent = "";
  analyzeButton.disabled = true;
  demoButton.disabled = true;
  analyzeButton.textContent = "Analyzing…";
  try {
    let payload;
    if (isStaticHost) {
      payload = staticFallback();
    } else {
      const response = await fetch(endpoint, options);
      payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Analysis failed.");
    }
    render(payload);
  } catch (error) {
    errorElement.textContent = error.message;
  } finally {
    analyzeButton.disabled = false;
    demoButton.disabled = false;
    analyzeButton.textContent = "Run analysis";
  }
}

fastaInput.addEventListener("change", () => {
  fastaName.textContent = fastaInput.files[0]?.name || "Choose quality-checked FASTA";
});
amrInput.addEventListener("change", () => {
  amrName.textContent = amrInput.files[0]?.name || "Attach TSV when the local scanner is unavailable";
});
gffInput.addEventListener("change", () => {
  gffName.textContent = gffInput.files[0]?.name || "Attach GFF3 to confirm molecular target loci";
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const fastaFile = fastaInput.files[0];
  if (!fastaFile) {
    errorElement.textContent = "Choose a FASTA file first.";
    return;
  }
  if (fastaFile.size > 12 * 1024 * 1024) {
    errorElement.textContent = "FASTA upload must be 12 MB or smaller.";
    return;
  }
  const [fastaText, amrTsv, gffText] = await Promise.all([
    fastaFile.text(),
    amrInput.files[0] ? amrInput.files[0].text() : Promise.resolve(""),
    gffInput.files[0] ? gffInput.files[0].text() : Promise.resolve(""),
  ]);
  requestAnalysis("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fastaText, amrTsv, gffText, species: "Escherichia coli" }),
  }, () => window.GenomeFirewallEngine.analyze({ fastaText, amrTsv, gffText }));
});

demoButton.addEventListener("click", () => requestAnalysis(
  "/api/demo",
  undefined,
  () => window.GenomeFirewallEngine.demo(),
));

reportAgentButton.addEventListener("click", async () => {
  if (!currentAnalysis) return;
  reportAgentButton.disabled = true;
  reportAgentStatus.textContent = "Generating a bounded summary from audited results…";
  try {
    const response = await fetch("/api/explain", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ analysis: currentAnalysis }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Report generation failed.");
    reportAgentOutput.textContent = payload.text;
    reportAgentOutput.hidden = false;
    reportAgentStatus.textContent = `Generated with ${payload.model}; classifier output unchanged.`;
  } catch (error) {
    reportAgentStatus.textContent = error.message;
  } finally {
    reportAgentButton.disabled = false;
  }
});

// Reliability (calibration) plot: mean predicted probability vs. empirical
// resistant rate per bin, against a dashed y=x reference (perfect
// calibration). The brief's Success Criteria names this explicitly
// ("Brier score and a reliability plot") -- the bins were already computed
// by scripts/train-baseline.js and shipped via /api/model-info, just never
// drawn. Empty bins (count 0) are skipped. A plain-text readout underneath
// keeps every value reachable without hovering.
function reliabilityChartSvg(bins, antibioticId) {
  const width = 220;
  const height = 168;
  const padding = { top: 10, right: 10, bottom: 22, left: 26 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const toX = (value) => padding.left + value * plotWidth;
  const toY = (value) => padding.top + (1 - value) * plotHeight;

  const points = bins.filter((bin) => bin.count > 0);
  if (!points.length) return "";

  const linePath = points
    .map((bin, index) => `${index === 0 ? "M" : "L"} ${toX(bin.meanPredicted).toFixed(1)} ${toY(bin.empiricalRate).toFixed(1)}`)
    .join(" ");

  const dots = points.map((bin) => {
    const cx = toX(bin.meanPredicted).toFixed(1);
    const cy = toY(bin.empiricalRate).toFixed(1);
    const title = `${Math.round(bin.rangeLow * 100)}–${Math.round(bin.rangeHigh * 100)}% predicted bin: mean predicted ${Math.round(bin.meanPredicted * 100)}%, actual resistant rate ${Math.round(bin.empiricalRate * 100)}% (n=${bin.count})`;
    return `
      <circle class="reliability-hit" cx="${cx}" cy="${cy}" r="12"><title>${escapeHtml(title)}</title></circle>
      <circle class="reliability-dot" cx="${cx}" cy="${cy}" r="4.5"><title>${escapeHtml(title)}</title></circle>`;
  }).join("");

  return `
    <figure class="reliability-chart-figure">
      <svg class="reliability-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Reliability plot for ${escapeHtml(antibioticId)}: predicted probability versus actual resistant rate">
        <line class="reliability-diagonal" x1="${toX(0)}" y1="${toY(0)}" x2="${toX(1)}" y2="${toY(1)}" />
        <line class="reliability-axis" x1="${padding.left}" y1="${padding.top}" x2="${padding.left}" y2="${height - padding.bottom}" />
        <line class="reliability-axis" x1="${padding.left}" y1="${height - padding.bottom}" x2="${width - padding.right}" y2="${height - padding.bottom}" />
        <path class="reliability-line" d="${linePath}" fill="none" />
        ${dots}
        <text class="reliability-tick" x="${padding.left}" y="${height - padding.bottom + 13}">0%</text>
        <text class="reliability-tick" x="${width - padding.right}" y="${height - padding.bottom + 13}" text-anchor="end">100%</text>
        <text class="reliability-tick reliability-axis-label" x="${padding.left + plotWidth / 2}" y="${height - 2}" text-anchor="middle">Predicted</text>
        <text class="reliability-tick reliability-axis-label" x="-${padding.top + plotHeight / 2}" y="10" text-anchor="middle" transform="rotate(-90)">Actual</text>
      </svg>
      <figcaption>
        <span class="reliability-key reliability-key-line">Model</span>
        <span class="reliability-key reliability-key-diagonal">Perfect calibration</span>
      </figcaption>
      <ul class="reliability-table">
        ${points.map((bin) => `<li><span>${Math.round(bin.rangeLow * 100)}–${Math.round(bin.rangeHigh * 100)}% predicted</span><span>${Math.round(bin.empiricalRate * 100)}% actual (n=${bin.count})</span></li>`).join("")}
      </ul>
    </figure>`;
}

function renderModelInfo(info) {
  const antibioticLabels = Object.fromEntries(info.coverage.antibiotics.map((a) => [a.id, a.label]));
  document.querySelector("#coverage-statement").textContent =
    `Covers: ${info.coverage.species.join(", ")} × ${info.coverage.antibiotics.map((a) => a.label).join(", ")}. ${info.coverage.statement}`;

  document.querySelector("#model-grid").innerHTML = info.models.map((model) => {
    const label = antibioticLabels[model.antibioticId] || model.antibioticId;
    if (!model.trained) {
      return `
        <article class="model-card model-card-untrained">
          <strong>${escapeHtml(label)}</strong>
          <p>Not yet trained on real data — using the illustrative placeholder weights in <code>src/config.js</code> until <code>models/${escapeHtml(model.antibioticId)}.json</code> exists.</p>
        </article>`;
    }
    const v = model.validation;
    const metrics = [
      ["Balanced accuracy", v.balancedAccuracy],
      ["Resistant recall", v.resistantRecall],
      ["Susceptible recall", v.susceptibleRecall],
      ["F1 (resistant)", v.f1Resistant],
      ["AUROC", v.auRoc],
      ["PR-AUC", v.prAuc],
      ["Brier score", v.brierScore],
      ["No-call rate", v.noCallRate],
    ];
    return `
      <article class="model-card">
        <div class="model-card-head">
          <strong>${escapeHtml(label)}</strong>
          <span class="model-source-tag">trained_baseline</span>
        </div>
        <p class="model-split">Grouped split — train: ${model.groupedSplit.trainGroups} groups · calibration: ${model.groupedSplit.calibrationGroups} groups · held-out test: ${model.groupedSplit.testGroups} groups (${v.sampleCount} rows, ${v.calledCount} called)</p>
        <div class="model-metric-grid">
          ${metrics.map(([metricLabel, value]) => `
            <div><span>${escapeHtml(metricLabel)}</span><strong>${value === null || value === undefined ? "—" : value}</strong></div>
          `).join("")}
        </div>
        ${v.reliabilityBins ? reliabilityChartSvg(v.reliabilityBins, model.antibioticId) : ""}
        <p class="model-note">Metrics computed on the held-out test groups only — never used for training or threshold calibration. Trained ${new Date(model.trainedAt).toLocaleString()}.</p>
      </article>`;
  }).join("");
}

function renderHeldOutCases(payload) {
  document.querySelector("#held-out-grid").innerHTML = payload.antibiotics.map((antibiotic) => {
    if (!antibiotic.available) {
      return `
        <article class="held-out-card held-out-card-empty">
          <strong>${escapeHtml(antibiotic.antibioticLabel)}</strong>
          <p>No trained model or held-out split available yet.</p>
        </article>`;
    }
    const rows = antibiotic.cases.map((item) => {
      const correctness = item.correct === null ? "abstained" : item.correct ? "correct" : "wrong";
      const correctnessLabel = item.correct === null ? "No-call" : item.correct ? "Matched lab result" : "Missed lab result";
      const featureSummary = Object.entries(item.features).map(([name, value]) => `${name.replaceAll("_", " ")} ${value}`).join(" · ");
      return `
        <div class="held-out-case-row">
          <div class="held-out-case-id">
            <strong>${escapeHtml(item.sampleId)}</strong>
            <small>${escapeHtml(item.groupId)} · ${escapeHtml(featureSummary)}</small>
          </div>
          <span class="call ${callClass(item.decision)}">${callLabel(item.decision)}</span>
          <span class="held-out-true-label">Lab result: ${item.trueLabel}</span>
          <span class="held-out-correctness held-out-correctness-${correctness}">${correctnessLabel}</span>
        </div>`;
    }).join("");
    return `
      <article class="held-out-card">
        <strong>${escapeHtml(antibiotic.antibioticLabel)}</strong>
        <div class="held-out-case-list">${rows}</div>
      </article>`;
  }).join("");
}

let imageAgentReady = false;

document.querySelector("#prediction-list").addEventListener("click", async (event) => {
  const button = event.target.closest(".evidence-image-button");
  if (!button || !currentAnalysis) return;
  const block = button.closest(".evidence-image-block");
  const status = block.querySelector(".evidence-image-status");
  const output = block.querySelector(".evidence-image-output");
  status.hidden = false;
  status.textContent = imageAgentReady
    ? "Generating a schematic evidence diagram from audited results…"
    : "Optional: set OPENAI_API_KEY to enable evidence diagrams.";
  if (!imageAgentReady) return;
  button.disabled = true;
  try {
    const response = await fetch("/api/evidence-image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ analysis: currentAnalysis, antibioticId: button.dataset.antibioticId }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Diagram generation failed.");
    output.src = payload.image;
    output.hidden = false;
    status.textContent = `Generated with ${payload.model}; diagram only, classifier output unchanged.`;
  } catch (error) {
    status.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

fetch("/api/model-info")
  .then((response) => response.json())
  .then(renderModelInfo)
  .catch(() => {
    document.querySelector("#coverage-statement").textContent = "Model performance data unavailable.";
  });

fetch("/api/held-out-cases")
  .then((response) => response.json())
  .then(renderHeldOutCases)
  .catch(() => {
    document.querySelector("#held-out-grid").innerHTML = "<p>Held-out case data unavailable.</p>";
  });

fetch("/api/health")
  .then((response) => response.json())
  .then((health) => {
    reportAgentButton.disabled = !health.reportAgentConfigured;
    reportAgentStatus.textContent = health.staticHost
      ? "GitHub Pages preview: analysis runs locally; the optional OpenAI brief requires the backend."
      : health.reportAgentConfigured
      ? "OpenAI Report Agent is ready. It receives audited JSON, never raw sequence."
      : "Optional: set OPENAI_API_KEY to enable the bounded reviewer brief.";
    imageAgentReady = Boolean(health.imageAgentConfigured);
  })
  .catch(() => {
    reportAgentButton.disabled = true;
    reportAgentStatus.textContent = "Report Agent status unavailable.";
  });
