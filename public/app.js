const form = document.querySelector("#analysis-form");
const fastaInput = document.querySelector("#fasta-file");
const amrInput = document.querySelector("#amr-file");
const fastaName = document.querySelector("#fasta-name");
const amrName = document.querySelector("#amr-name");
const analyzeButton = document.querySelector("#analyze-button");
const demoButton = document.querySelector("#demo-button");
const errorElement = document.querySelector("#form-error");
const results = document.querySelector("#results");
const reportAgentButton = document.querySelector("#report-agent-button");
const reportAgentStatus = document.querySelector("#report-agent-status");
const reportAgentOutput = document.querySelector("#report-agent-output");
let currentAnalysis = null;

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
    const tags = prediction.evidence.length
      ? prediction.evidence.map((item) => `<span class="evidence-tag">${escapeHtml(item.gene || item.name)} · ${escapeHtml(item.category.replaceAll("_", " "))}</span>`).join("")
      : `<span class="evidence-tag">No drug-specific marker surfaced</span>`;
    return `
      <article class="prediction">
        <div class="drug-name">
          <strong>${escapeHtml(prediction.antibiotic)}</strong>
          <small>${escapeHtml(prediction.target)}</small>
        </div>
        <div>
          <span class="call ${callClass(prediction.decision)}">${callLabel(prediction.decision)}</span>
          <div class="confidence">${Math.round(prediction.confidence * 100)}% confidence · ${Math.round(prediction.probabilityOfFailure * 100)}% failure estimate</div>
        </div>
        <div class="evidence-copy">
          ${escapeHtml(prediction.explanation)}
          <div class="evidence-category">${escapeHtml(evidenceCategoryLabel(prediction.evidenceCategory))}</div>
          <div class="evidence-tags">${tags}</div>
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

async function requestAnalysis(endpoint, options) {
  errorElement.textContent = "";
  analyzeButton.disabled = true;
  demoButton.disabled = true;
  analyzeButton.textContent = "Analyzing…";
  try {
    const response = await fetch(endpoint, options);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Analysis failed.");
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

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const fastaFile = fastaInput.files[0];
  if (!fastaFile) {
    errorElement.textContent = "Choose a FASTA file first.";
    return;
  }
  if (fastaFile.size > 12 * 1024 * 1024) {
    errorElement.textContent = "FASTA upload must be 12 MB or smaller for this prototype.";
    return;
  }
  const [fastaText, amrTsv] = await Promise.all([
    fastaFile.text(),
    amrInput.files[0] ? amrInput.files[0].text() : Promise.resolve(""),
  ]);
  requestAnalysis("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fastaText, amrTsv, species: "Escherichia coli" }),
  });
});

demoButton.addEventListener("click", () => requestAnalysis("/api/demo"));

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
        <p class="model-note">Metrics computed on the held-out test groups only — never used for training or threshold calibration. Trained ${new Date(model.trainedAt).toLocaleString()}.</p>
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

fetch("/api/health")
  .then((response) => response.json())
  .then((health) => {
    reportAgentButton.disabled = !health.reportAgentConfigured;
    reportAgentStatus.textContent = health.reportAgentConfigured
      ? "OpenAI Report Agent is ready. It receives audited JSON, never raw sequence."
      : "Optional: set OPENAI_API_KEY to enable the bounded reviewer brief.";
    imageAgentReady = Boolean(health.imageAgentConfigured);
  })
  .catch(() => {
    reportAgentButton.disabled = true;
    reportAgentStatus.textContent = "Report Agent status unavailable.";
  });
