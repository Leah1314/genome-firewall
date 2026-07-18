const http = require("node:http");
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const { analyzeGenome } = require("./src/pipeline");
const { generateReportBrief, reportAgentConfigured } = require("./src/openai-report");
const { generateEvidenceDiagram, imageAgentConfigured } = require("./src/openai-image");
const { ANTIBIOTICS, SUPPORTED_SPECIES } = require("./src/config");

const PORT = Number(process.env.PORT || 4180);
const PUBLIC_DIR = path.join(__dirname, "public");
const MAX_BODY_BYTES = 16 * 1024 * 1024;

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function json(response, status, payload) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("Upload is larger than 16 MB."));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch {
        reject(new Error("Request body must be valid JSON."));
      }
    });
    request.on("error", reject);
  });
}

async function demoAnalysis() {
  const fastaText = `>GF_DEMO_ECOLI_NONBIOLOGICAL_SEQUENCE\n${"ACGT".repeat(1_125_000)}`;
  const amrTsv = [
    "#Protein identifier\tContig id\tStart\tStop\tStrand\tGene symbol\tSequence name\tScope\tElement type\tElement subtype\tClass\tSubclass\tMethod\tTarget length\tReference sequence length\t% Coverage of reference sequence\t% Identity to reference sequence\tAlignment length\tAccession of closest sequence\tName of closest sequence\tHMM id\tHMM description",
    "demo_1\tcontig_1\t100\t900\t+\tblaCTX-M-15\tExtended-spectrum beta-lactamase\tcore\tAMR\tAMR\tbeta-lactam\tcephalosporin\tALLELE\t800\t800\t100\t99.8\t800\tDEMO\tCTX-M family beta-lactamase\t\t",
    "demo_2\tcontig_1\t1200\t1600\t+\tqnrS1\tQuinolone resistance protein QnrS1\tcore\tAMR\tAMR\tquinolone\tfluoroquinolone\tALLELE\t400\t400\t100\t99.1\t400\tDEMO\tQnrS1\t\t",
  ].join("\n");
  const gffText = [
    "##gff-version 3",
    "contig_1\tdemo\tgene\t2000\t4500\t.\t+\t.\tID=gyrA;gene=gyrA;product=DNA gyrase subunit A",
    "contig_1\tdemo\tgene\t5000\t7200\t.\t+\t.\tID=parC;gene=parC;product=Topoisomerase IV subunit A",
    "contig_1\tdemo\tgene\t8000\t9800\t.\t+\t.\tID=ftsI;gene=ftsI;product=Penicillin-binding protein 3",
    "contig_1\tdemo\tgene\t11000\t11400\t.\t+\t.\tID=rpsL;gene=rpsL;product=30S ribosomal protein S12",
    "contig_1\tdemo\trRNA\t12000\t13500\t.\t+\t.\tID=rrsA;gene=rrsA;product=16S ribosomal RNA",
  ].join("\n");
  return analyzeGenome({ fastaText, amrTsv, gffText, species: "Escherichia coli", forceImported: true });
}

async function loadModelInfo(antibioticId) {
  try {
    const raw = await readFile(path.join(__dirname, "models", `${antibioticId}.json`), "utf8");
    const artifact = JSON.parse(raw);
    return {
      antibioticId,
      trained: true,
      trainedAt: artifact.trainedAt,
      groupedSplit: artifact.groupedSplit,
      thresholds: artifact.thresholds,
      validation: artifact.validation,
    };
  } catch {
    return { antibioticId, trained: false };
  }
}

async function modelInfoResponse() {
  return {
    coverage: {
      species: Object.values(SUPPORTED_SPECIES).map((profile) => profile.label),
      antibiotics: ANTIBIOTICS.map((a) => ({ id: a.id, label: a.label, target: a.target })),
      statement: "This prototype covers exactly the species and antibiotics listed here. Every other organism and drug is out of scope and must return no-call or be rejected upstream.",
    },
    models: await Promise.all(ANTIBIOTICS.map((a) => loadModelInfo(a.id))),
  };
}

async function serveStatic(request, response) {
  const requestPath = new URL(request.url, `http://${request.headers.host}`).pathname;
  const relative = requestPath === "/" ? "index.html" : requestPath.replace(/^\/+/, "");
  const filePath = path.resolve(PUBLIC_DIR, relative);
  if (!filePath.startsWith(PUBLIC_DIR)) return json(response, 403, { error: "Forbidden" });
  try {
    const body = await readFile(filePath);
    response.writeHead(200, {
      "Content-Type": CONTENT_TYPES[path.extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    response.end(body);
  } catch {
    json(response, 404, { error: "Not found" });
  }
}

const server = http.createServer(async (request, response) => {
  try {
    if (request.method === "GET" && request.url === "/api/health") {
      return json(response, 200, {
        status: "ok",
        service: "genome-firewall",
        reportAgentConfigured: reportAgentConfigured(),
        imageAgentConfigured: imageAgentConfigured(),
      });
    }
    if (request.method === "GET" && request.url === "/api/demo") {
      return json(response, 200, await demoAnalysis());
    }
    if (request.method === "GET" && request.url === "/api/model-info") {
      return json(response, 200, await modelInfoResponse());
    }
    if (request.method === "POST" && request.url === "/api/analyze") {
      const body = await readJsonBody(request);
      if (!body.fastaText) return json(response, 400, { error: "A FASTA file is required." });
      const result = await analyzeGenome({
        fastaText: body.fastaText,
        amrTsv: body.amrTsv || "",
        gffText: body.gffText || "",
        species: body.species || "Escherichia coli",
      });
      return json(response, 200, result);
    }
    if (request.method === "POST" && request.url === "/api/explain") {
      const body = await readJsonBody(request);
      if (!body.analysis?.audit?.passed || !Array.isArray(body.analysis?.predictions)) {
        return json(response, 400, { error: "Only a completed, audited analysis can be summarized." });
      }
      return json(response, 200, await generateReportBrief(body.analysis));
    }
    if (request.method === "POST" && request.url === "/api/evidence-image") {
      const body = await readJsonBody(request);
      if (!body.analysis?.audit?.passed || !Array.isArray(body.analysis?.predictions)) {
        return json(response, 400, { error: "Only a completed, audited analysis can be visualized." });
      }
      const prediction = body.analysis.predictions.find((item) => item.antibioticId === body.antibioticId);
      if (!prediction) return json(response, 400, { error: "That antibiotic is not in this analysis." });
      return json(response, 200, await generateEvidenceDiagram(prediction));
    }
    if (request.method === "GET") return serveStatic(request, response);
    json(response, 405, { error: "Method not allowed" });
  } catch (error) {
    json(response, 400, { error: error.message || "Analysis failed." });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Genome Firewall running at http://127.0.0.1:${PORT}`);
});
