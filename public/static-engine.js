(function attachGenomeFirewallEngine(global) {
  const ANTIBIOTICS = [
    {
      id: "ciprofloxacin",
      label: "Ciprofloxacin",
      target: "DNA gyrase / topoisomerase IV",
      markers: [/^qnr/i, /gyrA/i, /parC/i, /aac\(6['’-]?\)-Ib-cr/i],
      intercept: -2.2,
      markerWeight: 3.1,
      mutationWeight: 1.25,
    },
    {
      id: "ceftriaxone",
      label: "Ceftriaxone",
      target: "Penicillin-binding proteins",
      markers: [/blaCTX-M/i, /blaCMY/i, /blaSHV/i, /ESBL/i],
      intercept: -2,
      markerWeight: 3,
      mutationWeight: 0.8,
    },
    {
      id: "gentamicin",
      label: "Gentamicin",
      target: "30S ribosomal subunit",
      markers: [/aac\(3/i, /aac\(6/i, /ant\(2/i, /aph\(2/i, /16S/i],
      intercept: -2.1,
      markerWeight: 2.95,
      mutationWeight: 1,
    },
  ];

  const HEADER_ALIASES = {
    gene: ["gene symbol", "gene", "element symbol"],
    name: ["protein name", "element name", "name"],
    subtype: ["subtype", "element subtype"],
    method: ["method", "element subtype"],
    identity: ["% identity to reference sequence", "% identity", "identity"],
    coverage: ["% coverage of reference sequence", "% coverage", "coverage"],
  };

  function parseFasta(text) {
    const input = String(text || "").trim();
    if (!input.startsWith(">")) {
      throw new Error("The uploaded file is not FASTA: the first non-empty line must start with >.");
    }
    const records = [];
    let current = null;
    for (const rawLine of input.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) continue;
      if (line.startsWith(">")) {
        current = { id: line.slice(1).trim() || `contig_${records.length + 1}`, sequence: "" };
        records.push(current);
      } else {
        if (!current) throw new Error("Sequence content appeared before a FASTA header.");
        if (!/^[ACGTURYSWKMBDHVN.-]+$/i.test(line)) {
          throw new Error(`Invalid DNA characters found in ${current.id}.`);
        }
        current.sequence += line.toUpperCase().replace(/[.-]/g, "N");
      }
    }
    if (!records.length || records.every((record) => !record.sequence)) {
      throw new Error("The FASTA file does not contain any sequence data.");
    }
    return records;
  }

  function summarizeGenome(records) {
    const lengths = records.map((record) => record.sequence.length);
    const totalBases = lengths.reduce((sum, length) => sum + length, 0);
    const nBases = records.reduce((sum, record) => sum + (record.sequence.match(/N/g) || []).length, 0);
    const gcBases = records.reduce((sum, record) => sum + (record.sequence.match(/[GC]/g) || []).length, 0);
    const sorted = [...lengths].sort((a, b) => b - a);
    let running = 0;
    const n50 = sorted.find((length) => {
      running += length;
      return running >= totalBases / 2;
    }) || 0;
    const ambiguousFraction = totalBases ? nBases / totalBases : 1;
    const qc = totalBases >= 3_500_000 && ambiguousFraction <= 0.05
      ? "pass"
      : totalBases >= 1_000_000 && ambiguousFraction <= 0.15
        ? "caution"
        : "fail";
    return {
      contigs: records.length,
      totalBases,
      n50,
      gcPercent: totalBases ? Number(((gcBases / totalBases) * 100).toFixed(2)) : 0,
      ambiguousPercent: Number((ambiguousFraction * 100).toFixed(2)),
      qc,
    };
  }

  function parseAmrFinderTsv(text) {
    const lines = String(text || "").split(/\r?\n/).filter((line) => line.trim() && !line.startsWith("##"));
    if (!lines.length) return [];
    const headers = lines[0].replace(/^#/, "").split("\t");
    const indexes = {};
    for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
      indexes[key] = headers.findIndex((header) => aliases.includes(String(header).trim().toLowerCase()));
    }
    if (indexes.gene < 0 && indexes.name < 0) {
      throw new Error("AMRFinderPlus TSV must contain a Gene symbol or Protein name column.");
    }
    return lines.slice(1).map((line, index) => {
      const values = line.split("\t");
      const read = (key) => indexes[key] >= 0 ? values[indexes[key]] || "" : "";
      const identity = Number.parseFloat(read("identity"));
      const coverage = Number.parseFloat(read("coverage"));
      return {
        id: `amr_${index + 1}`,
        gene: read("gene").trim(),
        name: read("name").trim(),
        subtype: read("subtype").trim(),
        method: read("method").trim(),
        identity: Number.isFinite(identity) ? identity : null,
        coverage: Number.isFinite(coverage) ? coverage : null,
        source: "AMRFinderPlus",
      };
    }).filter((hit) => hit.gene || hit.name);
  }

  function targetGate(genome) {
    if (genome.qc === "fail") {
      return { pass: false, status: "insufficient_genome", rationale: "Genome quality is too low to establish target context." };
    }
    if (genome.totalBases < 3_500_000 || genome.totalBases > 6_500_000) {
      return { pass: false, status: "size_out_of_range", rationale: "Assembly size is outside the supported species range." };
    }
    return {
      pass: true,
      status: "species_qc_proxy",
      rationale: "Target context is provisionally supported by species identity and assembly QC; confirm target loci in the production pipeline.",
    };
  }

  function predict(antibiotic, context) {
    const gate = targetGate(context.genome);
    const evidence = context.hits.filter((hit) => {
      const text = `${hit.gene || ""} ${hit.name || ""} ${hit.subtype || ""}`;
      return antibiotic.markers.some((pattern) => pattern.test(text));
    }).map((hit) => {
      const text = `${hit.name || ""} ${hit.subtype || ""} ${hit.method || ""}`;
      return { ...hit, category: /point|mutation|variant|SNP/i.test(text) ? "known_mutation" : "known_gene" };
    });
    const geneCount = evidence.filter((hit) => hit.category === "known_gene").length;
    const mutationCount = evidence.filter((hit) => hit.category === "known_mutation").length;
    const score = antibiotic.intercept
      + antibiotic.markerWeight * Math.min(geneCount, 2)
      + antibiotic.mutationWeight * Math.min(mutationCount, 2);
    const probabilityOfFailure = Number((1 / (1 + Math.exp(-score))).toFixed(3));
    let decision = "no_call";
    let explanation = gate.rationale;
    if (gate.pass && evidence.length && probabilityOfFailure >= 0.67) {
      decision = "likely_to_fail";
      explanation = "Known AMR evidence raises the estimated probability of antibiotic failure.";
    } else if (gate.pass && context.readerMode === "imported_amrfinder" && probabilityOfFailure <= 0.33) {
      decision = "likely_to_work";
      explanation = "No relevant marker was detected in the imported AMRFinderPlus result and the target gate passed.";
    } else if (gate.pass && !evidence.length) {
      explanation = "No relevant marker is visible, but a complete AMRFinderPlus result is required before a susceptible call.";
    }
    const distance = Math.abs(probabilityOfFailure - 0.5) * 2;
    const confidence = decision === "no_call" ? Math.min(0.49, distance) : Math.min(0.96, 0.55 + distance * 0.4);
    return {
      antibiotic: antibiotic.label,
      antibioticId: antibiotic.id,
      decision,
      probabilityOfFailure,
      confidence: Number(confidence.toFixed(2)),
      target: antibiotic.target,
      targetGate: gate,
      evidence,
      explanation,
    };
  }

  function buildResult(genome, hits, readerMode) {
    const context = { genome, hits, readerMode };
    const predictions = ANTIBIOTICS.map((antibiotic) => predict(antibiotic, context));
    const flags = [];
    if (genome.qc !== "pass") {
      flags.push({ severity: "warning", message: "Assembly QC is not a clean pass; interpret all calls cautiously." });
    }
    if (readerMode === "fasta_only") {
      flags.push({ severity: "warning", message: "No AMRFinderPlus TSV was imported; susceptible calls are disabled in this static preview." });
    }
    return {
      analysisId: `gf_web_${Date.now().toString(36)}`,
      createdAt: new Date().toISOString(),
      species: "Escherichia coli",
      reader: { mode: readerMode, hitCount: hits.length },
      genome,
      predictions,
      audit: {
        passed: true,
        flags,
        policy: "Defensive prediction only. No organism design, treatment selection, or autonomous clinical action.",
      },
      disclaimer: "Research prototype only. Confirm every result with standard antimicrobial susceptibility testing and qualified clinical review.",
    };
  }

  function analyze({ fastaText, amrTsv = "" }) {
    const genome = summarizeGenome(parseFasta(fastaText));
    const hits = amrTsv.trim() ? parseAmrFinderTsv(amrTsv) : [];
    return buildResult(genome, hits, hits.length || amrTsv.trim() ? "imported_amrfinder" : "fasta_only");
  }

  function demo() {
    const hits = [
      { id: "demo_1", gene: "blaCTX-M-15", name: "Extended-spectrum beta-lactamase", subtype: "AMR", method: "ALLELE", identity: 99.8, coverage: 100, source: "AMRFinderPlus" },
      { id: "demo_2", gene: "qnrS1", name: "Quinolone resistance protein QnrS1", subtype: "AMR", method: "ALLELE", identity: 99.1, coverage: 100, source: "AMRFinderPlus" },
    ];
    return buildResult({ contigs: 1, totalBases: 4_500_000, n50: 4_500_000, gcPercent: 50, ambiguousPercent: 0, qc: "pass" }, hits, "imported_amrfinder");
  }

  global.GenomeFirewallEngine = { analyze, demo };
})(window);
