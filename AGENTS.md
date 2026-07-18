# Genome Firewall Agents

The agents are bounded software roles in one deterministic pipeline. The language model never controls the biological classifier and never receives permission to suggest organism modifications.

## 1. Genome Reader Agent

**Input:** one FASTA assembly, declared species, optional AMRFinderPlus TSV.

**Responsibilities:** parse FASTA, reject malformed input, calculate assembly QC, run AMRFinderPlus when available, normalize hits, and record tool provenance.

**Hard stop:** unsupported species, malformed FASTA, or assembly QC failure prevents a susceptible call.

**Implementation:** `src/fasta.js`, `src/amrfinder.js`, and the first half of `src/pipeline.js`.

## 2. Antibiotic Failure Predictor Agent

**Input:** normalized AMR hits, genome QC, supported-species context, and one model artifact per antibiotic.

**Responsibilities:** build drug-specific features, calculate failure probability, and keep each antibiotic model independently replaceable.

**Hard stop:** a probability alone cannot bypass evidence or target gates.

**Implementation:** `src/config.js` and `src/predictor.js`.

## 3. Evidence Auditor Agent

**Input:** every proposed drug call and its evidence bundle.

**Responsibilities:** enforce the target-context gate, disable susceptible calls after an incomplete scan, require traceable evidence for failure calls, and force no-call when evidence is insufficient.

**Hard stop:** any integrity error marks the report for human review.

**Implementation:** `src/auditor.js`.

## 4. Decision Report Agent

**Input:** audited structured predictions only.

**Responsibilities:** translate the structured result into concise clinician-facing language, preserve evidence categories, state uncertainty, and show the laboratory-confirmation warning.

**Hard stop:** it cannot add a drug recommendation, dosage, organism modification, or claim not present in the structured evidence.

**Implementation:** `public/app.js`. An OpenAI explanation call can later be inserted behind a strict JSON schema, but should never change the classifier output.

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
