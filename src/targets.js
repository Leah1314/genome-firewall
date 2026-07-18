const { ANTIBIOTICS } = require("./config");

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

function buildTargetEvidence(gffText) {
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

module.exports = { parseGffTargets, buildTargetEvidence };
