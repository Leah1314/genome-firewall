# Genome Firewall Agents

The agents are bounded software roles in one deterministic pipeline. The language model never controls the biological classifier and never receives permission to suggest organism modifications.

## 1. Genome Reader Agent

**Input:** one FASTA assembly, declared species, optional AMRFinderPlus TSV.

**Responsibilities:** parse FASTA, reject malformed input, calculate assembly QC, run AMRFinderPlus when available, normalize hits, and record tool provenance.

**Hard stop:** unsupported species, malformed FASTA, or assembly QC failure prevents a susceptible call.

**Implementation:** `src/fasta.js`, `src/amrfinder.js`, and the first half of `src/pipeline.js`.

## 2. Antibiotic Failure Predictor Agent

**Input:** normalized AMR hits, genome QC, supported-species context, and one model artifact per antibiotic.

**Responsibilities:** build drug-specific features, calculate failure probability, and keep each antibiotic model independently replaceable. At startup it loads `models/<antibiotic>.json` -- trained on a real BV-BRC + AMRFinderPlus + Mash cohort, see `data/README.md` -- when present, and falls back to the illustrative placeholder weights in `src/config.js` otherwise. Every prediction reports which one produced it (`modelSource`).

**Hard stop:** a probability alone cannot bypass evidence or target gates.

**Implementation:** `src/config.js` and `src/predictor.js`. Training pipeline: `data/scripts/`, `scripts/train-baseline.js`.

## 3. Evidence Auditor Agent

**Input:** every proposed drug call and its evidence bundle.

**Responsibilities:** enforce the target-context gate, disable susceptible calls after an incomplete scan, require traceable evidence for failure calls, and force no-call when evidence is insufficient.

**Hard stop:** any integrity error marks the report for human review.

**Implementation:** `src/auditor.js`.

## 4. Decision Report Agent

**Input:** audited structured predictions only.

**Responsibilities:** translate the structured result into concise clinician-facing language, preserve evidence categories, state uncertainty, and show the laboratory-confirmation warning.

**Hard stop:** it cannot add a drug recommendation, dosage, organism modification, or claim not present in the structured evidence.

**Implementation:** `public/app.js` and `src/openai-report.js` (bounded text summary via the OpenAI Responses API, JSON-in only).

## 5. Multimodal Evidence Diagram Agent (optional)

**Input:** one audited prediction (drug, decision, target, evidence gene/mutation names, confidence, evidence category) only -- never raw sequence, never free-form model output folded back in.

**Responsibilities:** render a schematic infographic (detected evidence -> molecular target -> decision + confidence) via OpenAI image generation, so the demo can show, not just state, the evidence chain behind a call.

**Hard stop:** the prompt is template-built from already-audited fields and explicitly forbids photorealistic organism imagery and any depiction of gene editing, organism engineering, or synthesis -- it renders a diagram of an existing call, never a new one, and never anything that could read as organism design.

**Implementation:** `src/openai-image.js`, wired through `POST /api/evidence-image` in `server.js` and the "Generate evidence diagram" button in `public/app.js`. Optional: requires `OPENAI_API_KEY`, same as the text Report Agent.

## Orchestration contract

```text
FASTA + species
      │
      ▼
Genome Reader ── normalized AMR evidence + QC
      │
      ▼
Per-drug Predictors ── probability + supporting hits
      │
      ▼
Evidence Auditor ── target gate + no-call + policy flags
      │
      ▼
Decision Report ── human-readable, traceable output
```

Every stage writes structured data. There is no free-form agent-to-agent biological instruction channel.
