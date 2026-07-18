(function attachGenomeFirewallEngine(global) {
  const ANTIBIOTICS = [
    {
      id: "ciprofloxacin",
      label: "Ciprofloxacin",
      target: "DNA gyrase / topoisomerase IV",
      targetRequirements: [
        { label: "gyrA", patterns: [/\bgyrA\b/i, /DNA gyrase subunit A/i] },
        { label: "parC", patterns: [/\bparC\b/i, /topoisomerase IV subunit A/i] },
      ],
      markers: [/^qnr/i, /gyrA/i, /parC/i, /aac\(6['’-]?\)-Ib-cr/i],
      intercept: -2.2,
      markerWeight: 3.1,
      mutationWeight: 1.25,
    },
    {
      id: "ceftriaxone",
      label: "Ceftriaxone",
      target: "Penicillin-binding proteins",
      targetRequirements: [
        { label: "ftsI / PBP3", patterns: [/\bftsI\b/i, /penicillin[- ]binding protein 3/i, /\bPBP3\b/i] },
      ],
      markers: [/blaCTX-M/i, /blaCMY/i, /blaSHV/i, /ESBL/i],
      intercept: -2,
      markerWeight: 3,
      mutationWeight: 0.8,
    },
    {
      id: "gentamicin",
      label: "Gentamicin",
      target: "30S ribosomal subunit",
      targetRequirements: [
        { label: "rpsL", patterns: [/\brpsL\b/i, /30S ribosomal protein S12/i] },
        { label: "16S rRNA", patterns: [/\brrs[A-Z0-9]*\b/i, /16S ribosomal RNA/i] },
      ],
      markers: [/aac\(3/i, /aac\(6/i, /ant\(2/i, /aph\(2/i, /16S/i],
      intercept: -2.1,
      markerWeight: 2.95,
      mutationWeight: 1,
    },
  ];

  // Mirrors src/targets.js's FASTA_TARGET_SIGNATURES/reverseComplement/
  // translateFrame/targetHitFromFasta exactly, so the GitHub Pages preview
  // (no backend available) detects target loci the same way the Node
  // pipeline does when only a FASTA is supplied.
  const CODON_TABLE = {
    TTT: "F", TTC: "F", TTA: "L", TTG: "L", TCT: "S", TCC: "S", TCA: "S", TCG: "S",
    TAT: "Y", TAC: "Y", TAA: "*", TAG: "*", TGT: "C", TGC: "C", TGA: "*", TGG: "W",
    CTT: "L", CTC: "L", CTA: "L", CTG: "L", CCT: "P", CCC: "P", CCA: "P", CCG: "P",
    CAT: "H", CAC: "H", CAA: "Q", CAG: "Q", CGT: "R", CGC: "R", CGA: "R", CGG: "R",
    ATT: "I", ATC: "I", ATA: "I", ATG: "M", ACT: "T", ACC: "T", ACA: "T", ACG: "T",
    AAT: "N", AAC: "N", AAA: "K", AAG: "K", AGT: "S", AGC: "S", AGA: "R", AGG: "R",
    GTT: "V", GTC: "V", GTA: "V", GTG: "V", GCT: "A", GCC: "A", GCA: "A", GCG: "A",
    GAT: "D", GAC: "D", GAA: "E", GAG: "E", GGT: "G", GGC: "G", GGA: "G", GGG: "G",
  };

  const COMPLEMENT = { A: "T", C: "G", G: "C", T: "A", U: "A", R: "N", Y: "N", S: "N", W: "N", K: "N", M: "N", B: "N", D: "N", H: "N", V: "N", N: "N" };

  const FASTA_TARGET_SIGNATURES = {
    gyrA: {
      label: "gyrA",
      kind: "protein",
      minMatches: 2,
      motifs: [/MG[ILV]D[IV]R/i, /GDSA[AV]YDT[IV]/i, /EGDSA[AV]YDT/i, /HGDASIYDT/i],
    },
    parC: {
      label: "parC",
      kind: "protein",
      minMatches: 2,
      motifs: [/MSD[IV][ILV]?Q/i, /GDSA[AV]YDT[IV]?/i, /PLRGK[ILV]L/i, /GYG[KR]K/i],
    },
    "ftsI / PBP3": {
      label: "ftsI / PBP3",
      kind: "protein",
      minMatches: 2,
      motifs: [/S[ST]VK/i, /KTGTA/i, /S[GN]N/i],
    },
    rpsL: {
      label: "rpsL",
      kind: "protein",
      minMatches: 2,
      motifs: [/MPTINQLVRK/i, /DVTA[AV]{0,2}E/i, /GPK[KR]P/i, /RPSL/i],
    },
    "16S rRNA": {
      label: "16S rRNA",
      kind: "dna",
      minMatches: 2,
      motifs: [/AGAGTTTGATC[AC]TGGCTCAG/i, /CCTACGGG[AGT]GGC[AG]GCAG/i, /ACGGGCGGTGTGTACA/i],
    },
  };

  function reverseComplement(sequence) {
    return [...String(sequence || "").toUpperCase()].reverse().map((base) => COMPLEMENT[base] || "N").join("");
  }

  function translateFrame(sequence, offset) {
    let protein = "";
    for (let index = offset; index + 2 < sequence.length; index += 3) {
      protein += CODON_TABLE[sequence.slice(index, index + 3)] || "X";
    }
    return protein;
  }

  function targetHitFromFasta(requirement, records) {
    const signature = FASTA_TARGET_SIGNATURES[requirement.label];
    if (!signature) return null;
    for (const record of records || []) {
      const sequence = String(record.sequence || "").toUpperCase().replace(/U/g, "T");
      const searchSpaces = signature.kind === "dna"
        ? [{ sequence: sequence, strand: "+" }, { sequence: reverseComplement(sequence), strand: "-" }]
        : [0, 1, 2].flatMap((frame) => [
          { sequence: translateFrame(sequence, frame), strand: "+", frame: frame + 1 },
          { sequence: translateFrame(reverseComplement(sequence), frame), strand: "-", frame: frame + 1 },
        ]);
      for (const space of searchSpaces) {
        const matchedMotifs = signature.motifs.filter((motif) => motif.test(space.sequence));
        if (matchedMotifs.length >= signature.minMatches) {
          return {
            symbol: signature.label.split(" / ")[0],
            product: requirement.label,
            seqid: record.id,
            source: "FASTA target scan",
            type: signature.kind === "dna" ? "rRNA locus signature" : "translated coding-locus signature",
            strand: space.strand,
            frame: space.frame || null,
            signatureMatches: matchedMotifs.length,
          };
        }
      }
    }
    return null;
  }

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

  function parseGffTargets(text) {
    const genes = [];
    for (const line of String(text || "").split(/\r?\n/)) {
      if (!line.trim() || line.startsWith("#")) continue;
      const columns = line.split("\t");
      if (columns.length < 9 || !/gene|cds|rrna/i.test(columns[2])) continue;
      const attributes = Object.fromEntries(columns[8].split(";").map((part) => {
        const [key, ...rest] = part.trim().split("=");
        return [String(key || "").toLowerCase(), rest.join("=")];
      }));
      genes.push({
        symbol: attributes.gene || attributes.name || attributes.locus_tag || attributes.id || "",
        product: attributes.product || attributes.description || "",
        seqid: columns[0],
        source: columns[1] || "GFF annotation",
        type: columns[2],
      });
    }
    return genes;
  }

  function buildTargetEvidenceFromAnnotations(gffText) {
    const annotations = parseGffTargets(gffText);
    return Object.fromEntries(ANTIBIOTICS.map((antibiotic) => {
      const matched = [];
      const missing = [];
      for (const requirement of antibiotic.targetRequirements) {
        const hit = annotations.find((gene) => requirement.patterns.some((pattern) => pattern.test(`${gene.symbol} ${gene.product}`)));
        if (hit) matched.push({ requirement: requirement.label, ...hit });
        else missing.push(requirement.label);
      }
      const assessed = Boolean(String(gffText || "").trim());
      return [antibiotic.id, {
        assessed,
        pass: assessed && missing.length === 0,
        status: !assessed ? "not_assessed" : missing.length ? "target_incomplete" : "target_confirmed",
        matched,
        missing,
        rationale: !assessed
          ? "No genome annotation was supplied, so molecular target presence was not assessed."
          : missing.length
            ? `Required target evidence is missing: ${missing.join(", ")}.`
            : `Required target loci were detected in the supplied annotation: ${matched.map((item) => item.requirement).join(", ")}.`,
      }];
    }));
  }

  function buildTargetEvidenceFromFasta(records) {
    const assessed = Array.isArray(records) && records.some((record) => record.sequence);
    return Object.fromEntries(ANTIBIOTICS.map((antibiotic) => {
      const matched = [];
      const missing = [];
      for (const requirement of antibiotic.targetRequirements) {
        const hit = targetHitFromFasta(requirement, records);
        if (hit) matched.push({ requirement: requirement.label, ...hit });
        else missing.push(requirement.label);
      }
      return [antibiotic.id, {
        assessed,
        pass: assessed && missing.length === 0,
        status: !assessed ? "not_assessed" : missing.length ? "target_incomplete" : "target_confirmed",
        matched,
        missing,
        rationale: !assessed
          ? "No FASTA sequence was available, so molecular target presence was not assessed."
          : missing.length
            ? `Required target locus signatures were not detected in the FASTA assembly: ${missing.join(", ")}.`
            : `Required target locus signatures were detected directly from the FASTA assembly: ${matched.map((item) => item.requirement).join(", ")}.`,
      }];
    }));
  }

  function buildTargetEvidence(gffText, records) {
    return String(gffText || "").trim()
      ? buildTargetEvidenceFromAnnotations(gffText)
      : buildTargetEvidenceFromFasta(records || []);
  }

  function targetGate(genome, targetEvidence, antibioticId) {
    if (genome.qc === "fail") {
      return { pass: false, status: "insufficient_genome", rationale: "Genome quality is too low to establish target context." };
    }
    if (genome.totalBases < 3_500_000 || genome.totalBases > 6_500_000) {
      return { pass: false, status: "size_out_of_range", rationale: "Assembly size is outside the supported species range." };
    }
    return targetEvidence?.[antibioticId] || {
      pass: false,
      assessed: false,
      status: "not_assessed",
      matched: [],
      missing: [],
      rationale: "No genome annotation was supplied, so molecular target presence was not assessed.",
    };
  }

  function predict(antibiotic, context) {
    const gate = targetGate(context.genome, context.targetEvidence, antibiotic.id);
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
    if (context.genome.qc !== "fail" && evidence.length && probabilityOfFailure >= 0.67) {
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

  function buildResult(genome, hits, readerMode, targetEvidence = {}, hasGff = false) {
    const context = { genome, hits, readerMode, targetEvidence };
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
      reader: {
        mode: readerMode,
        hitCount: hits.length,
        targetAnnotation: hasGff ? "imported_gff" : "fasta_scan",
      },
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

  function analyze({ fastaText, amrTsv = "", gffText = "" }) {
    const records = parseFasta(fastaText);
    const genome = summarizeGenome(records);
    const hits = amrTsv.trim() ? parseAmrFinderTsv(amrTsv) : [];
    return buildResult(
      genome,
      hits,
      hits.length || amrTsv.trim() ? "imported_amrfinder" : "fasta_only",
      buildTargetEvidence(gffText, records),
      Boolean(gffText.trim()),
    );
  }

  function demo() {
    const hits = [
      { id: "demo_1", gene: "blaCTX-M-15", name: "Extended-spectrum beta-lactamase", subtype: "AMR", method: "ALLELE", identity: 99.8, coverage: 100, source: "AMRFinderPlus" },
      { id: "demo_2", gene: "qnrS1", name: "Quinolone resistance protein QnrS1", subtype: "AMR", method: "ALLELE", identity: 99.1, coverage: 100, source: "AMRFinderPlus" },
    ];
    const gffText = [
      "contig_1\tdemo\tgene\t2000\t4500\t.\t+\t.\tID=gyrA;gene=gyrA;product=DNA gyrase subunit A",
      "contig_1\tdemo\tgene\t5000\t7200\t.\t+\t.\tID=parC;gene=parC;product=Topoisomerase IV subunit A",
      "contig_1\tdemo\tgene\t8000\t9800\t.\t+\t.\tID=ftsI;gene=ftsI;product=Penicillin-binding protein 3",
      "contig_1\tdemo\tgene\t11000\t11400\t.\t+\t.\tID=rpsL;gene=rpsL;product=30S ribosomal protein S12",
      "contig_1\tdemo\trRNA\t12000\t13500\t.\t+\t.\tID=rrsA;gene=rrsA;product=16S ribosomal RNA",
    ].join("\n");
    return buildResult(
      { contigs: 1, totalBases: 4_500_000, n50: 4_500_000, gcPercent: 50, ambiguousPercent: 0, qc: "pass" },
      hits,
      "imported_amrfinder",
      buildTargetEvidence(gffText),
      true,
    );
  }

  global.GenomeFirewallEngine = { analyze, demo };
})(window);
