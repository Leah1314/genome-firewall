const VALID_BASES = /^[ACGTURYSWKMBDHVN.-]+$/i;

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
      continue;
    }
    if (!current) throw new Error("Sequence content appeared before a FASTA header.");
    if (!VALID_BASES.test(line)) throw new Error(`Invalid DNA characters found in ${current.id}.`);
    current.sequence += line.toUpperCase().replace(/[.-]/g, "N");
  }

  if (!records.length || records.every((record) => !record.sequence)) {
    throw new Error("The FASTA file does not contain any sequence data.");
  }
  return records;
}

function summarizeGenome(records) {
  const lengths = records.map((record) => record.sequence.length);
  const totalBases = lengths.reduce((sum, length) => sum + length, 0);
  const nBases = records.reduce(
    (sum, record) => sum + (record.sequence.match(/N/g) || []).length,
    0,
  );
  const gcBases = records.reduce(
    (sum, record) => sum + (record.sequence.match(/[GC]/g) || []).length,
    0,
  );
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

module.exports = { parseFasta, summarizeGenome };
