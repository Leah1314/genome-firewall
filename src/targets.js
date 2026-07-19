const { ANTIBIOTICS } = require("./config");

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

// Motifs are literal 13-residue substrings taken directly from the real
// E. coli K-12 MG1655 reference proteins (NCBI RefSeq GCF_000005845.2), not
// guessed or reconstructed from memory -- an earlier motif set for gyrA/parC
// turned out to be largely fabricated and failed against real sequence (see
// git history). gyrA/parC motifs are also chosen well clear of the QRDR
// (~residues 67-106), the classic fluoroquinolone-resistance mutation
// hotspot (e.g. gyrA S83L), so a resistant strain's point mutation there
// doesn't make its own target-presence check fail -- presence and mutation
// are separate evidence channels (this gate vs. AMRFinderPlus POINT hits).
const FASTA_TARGET_SIGNATURES = {
  gyrA: {
    label: "gyrA",
    kind: "protein",
    minMatches: 2,
    motifs: [/DAKTGRETIIVHE/i, /TEQQAQAILDLRL/i, /ANGTVKKTVLTEF/i],
  },
  parC: {
    label: "parC",
    kind: "protein",
    minMatches: 2,
    motifs: [/AVVISALPHQVSG/i, /LASERKMNNLLKK/i, /RMLMFPVSDLPQL/i],
  },
  "ftsI / PBP3": {
    label: "ftsI / PBP3",
    kind: "protein",
    minMatches: 2,
    motifs: [/S[ST]VK/i, /KTGTA/i, /GVKAAIKGYRIAI/i],
  },
  rpsL: {
    label: "rpsL",
    kind: "protein",
    minMatches: 2,
    motifs: [/QLVRKPRARKVAK/i, /FEVTSYIGGEGHN/i, /GVKDRKQARSKYG/i],
  },
  "16S rRNA": {
    label: "16S rRNA",
    kind: "dna",
    minMatches: 2,
    motifs: [/AGAGTTTGATC[AC]TGGCTCAG/i, /CCTACGGG[AGT]GGC[AG]GCAG/i, /ACGGGCGGTGTGTACA/i],
  },
};

function parseAttributes(text) {
  const decode = (value) => {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  };
  return Object.fromEntries(
    String(text || "")
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const separator = part.includes("=") ? "=" : " ";
        const index = part.indexOf(separator);
        if (index < 0) return [part.toLowerCase(), ""];
        return [
          part.slice(0, index).trim().toLowerCase(),
          decode(part.slice(index + separator.length).trim().replace(/^"|"$/g, "")),
        ];
      }),
  );
}

function parseGffTargets(text) {
  if (!String(text || "").trim()) return [];
  const genes = new Map();
  for (const line of String(text).split(/\r?\n/)) {
    if (!line.trim() || line.startsWith("#")) continue;
    const columns = line.split("\t");
    if (columns.length < 9) continue;
    const [seqid, source, type, start, end, , strand, , rawAttributes] = columns;
    if (!/gene|cds|rrna/i.test(type)) continue;
    const attributes = parseAttributes(rawAttributes);
    const symbol = attributes.gene || attributes.name || attributes.locus_tag || attributes.id || "";
    const product = attributes.product || attributes.description || "";
    if (!symbol && !product) continue;
    const key = `${symbol.toLowerCase()}|${product.toLowerCase()}`;
    if (!genes.has(key)) {
      genes.set(key, {
        symbol,
        product,
        seqid,
        source: source || "GFF annotation",
        type,
        start: Number(start) || null,
        end: Number(end) || null,
        strand,
      });
    }
  }
  return [...genes.values()];
}

function requirementMatched(requirement, gene) {
  const text = `${gene.symbol || ""} ${gene.product || ""}`;
  return requirement.patterns.some((pattern) => pattern.test(text));
}

function reverseComplement(sequence) {
  return [...String(sequence || "").toUpperCase()].reverse().map((base) => COMPLEMENT[base] || "N").join("");
}

function translateFrame(sequence, offset = 0) {
  let protein = "";
  for (let index = offset; index + 2 < sequence.length; index += 3) {
    protein += CODON_TABLE[sequence.slice(index, index + 3)] || "X";
  }
  return protein;
}

// Real genes translate as one uninterrupted run with no in-frame stop codon.
// Splitting on "*" and requiring every matched motif to fall within the same
// segment means a hit actually reflects one candidate coding region, not an
// arbitrary combination of motifs scattered anywhere in the genome -- e.g.
// two motifs 600,000 bp apart in unrelated proteins no longer count together.
const MIN_ORF_SEGMENT_LENGTH = 50;

function proteinSegments(protein) {
  return protein.split("*").filter((segment) => segment.length >= MIN_ORF_SEGMENT_LENGTH);
}

function targetHitFromFasta(requirement, records) {
  const signature = FASTA_TARGET_SIGNATURES[requirement.label];
  if (!signature) return null;
  for (const record of records || []) {
    const sequence = String(record.sequence || "").toUpperCase().replace(/U/g, "T");
    const searchSpaces = signature.kind === "dna"
      ? [{ sequence, strand: "+" }, { sequence: reverseComplement(sequence), strand: "-" }]
      : [0, 1, 2].flatMap((frame) => [
        { sequence: translateFrame(sequence, frame), strand: "+", frame: frame + 1 },
        { sequence: translateFrame(reverseComplement(sequence), frame), strand: "-", frame: frame + 1 },
      ]);
    for (const space of searchSpaces) {
      const segments = signature.kind === "dna" ? [space.sequence] : proteinSegments(space.sequence);
      for (const segment of segments) {
        const matchedMotifs = signature.motifs.filter((motif) => motif.test(segment));
        if (matchedMotifs.length >= signature.minMatches) {
          return {
            symbol: signature.label.split(" / ")[0],
            product: requirement.label,
            seqid: record.id,
            source: "FASTA target scan",
            type: signature.kind === "dna" ? "rRNA locus signature" : "translated coding-locus signature",
            start: null,
            end: null,
            strand: space.strand,
            frame: space.frame || null,
            signatureMatches: matchedMotifs.length,
          };
        }
      }
    }
  }
  return null;
}

function buildTargetEvidenceFromAnnotations(gffText) {
  const annotations = parseGffTargets(gffText);
  return Object.fromEntries(ANTIBIOTICS.map((antibiotic) => {
    const matched = [];
    const missing = [];
    for (const requirement of antibiotic.targetRequirements) {
      const hit = annotations.find((gene) => requirementMatched(requirement, gene));
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

function buildTargetEvidence(gffText, records = []) {
  return String(gffText || "").trim()
    ? buildTargetEvidenceFromAnnotations(gffText)
    : buildTargetEvidenceFromFasta(records);
}

module.exports = { parseGffTargets, buildTargetEvidence, buildTargetEvidenceFromFasta };
