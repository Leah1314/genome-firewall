#!/usr/bin/env python3
"""Thin Gradio front end for Genome Firewall.

The challenge brief's Module 03 requires "a working Streamlit or Gradio
demo." Genome Firewall's actual UI is a custom Node.js/HTML app (see
README.md) because it needed a richer decision-report layout than either
framework's file-in/text-out model comfortably gives -- this file exists
to satisfy the brief's literal requirement without duplicating any of the
prediction logic: it is a pure client of the same Node backend the custom
UI talks to (POST /api/analyze, /api/demo), never reimplements FASTA
parsing, AMRFinderPlus parsing, target-locus detection, or scoring.

Run the Node backend first, then this file:

    npm start                      # in one terminal, http://127.0.0.1:4180
    pip install -r requirements-gradio.txt
    python gradio_app.py           # in another terminal
"""

import json
import os
import urllib.error
import urllib.request

import gradio as gr

BACKEND_URL = os.environ.get("GENOME_FIREWALL_BACKEND", "http://127.0.0.1:4180")

DISCLAIMER = (
    "**Research prototype only.** Every result on this page must be confirmed "
    "with standard antimicrobial susceptibility testing and qualified clinical "
    "review before it informs any treatment decision."
)

DECISION_LABEL = {
    "likely_to_fail": "🔴 Likely to fail",
    "likely_to_work": "🟢 Likely to work",
    "no_call": "🟡 No-call",
}

EVIDENCE_LABEL = {
    "known_gene_or_mutation": "Known resistance gene or DNA change detected",
    "statistical_association_only": "Statistical association only — not a confirmed biological cause",
    "no_known_signal": "No known resistance signal detected",
}


def _read_upload(file_obj):
    if file_obj is None:
        return ""
    path = file_obj if isinstance(file_obj, str) else file_obj.name
    with open(path, "r", encoding="utf-8", errors="replace") as handle:
        return handle.read()


def _call_backend(path, payload=None):
    url = f"{BACKEND_URL}{path}"
    try:
        if payload is None:
            request = urllib.request.Request(url, method="GET")
        else:
            body = json.dumps(payload).encode("utf-8")
            request = urllib.request.Request(
                url, data=body, method="POST",
                headers={"Content-Type": "application/json"},
            )
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.URLError as error:
        raise gr.Error(
            f"Could not reach the Genome Firewall backend at {BACKEND_URL}. "
            f"Start it first with `npm start`. ({error})"
        )
    except urllib.error.HTTPError as error:
        detail = json.loads(error.read().decode("utf-8")).get("error", str(error))
        raise gr.Error(f"Backend rejected the request: {detail}")


def _format_result(result):
    lines = [DISCLAIMER, ""]
    genome = result["genome"]
    lines.append(
        f"**Genome:** {result['species']} · QC {genome['qc'].upper()} · "
        f"{genome['totalBases'] / 1_000_000:.2f} Mb · reader mode `{result['reader']['mode']}`"
    )
    lines.append("")
    for prediction in result["predictions"]:
        decision = DECISION_LABEL.get(prediction["decision"], prediction["decision"])
        evidence = EVIDENCE_LABEL.get(prediction["evidenceCategory"], prediction["evidenceCategory"])
        lines.append(f"### {prediction['antibiotic']} — {decision}")
        lines.append(
            f"Confidence: {prediction['confidence'] * 100:.0f}% · "
            f"Estimated failure probability: {prediction['probabilityOfFailure'] * 100:.0f}%"
        )
        lines.append(f"Evidence type: {evidence}")
        lines.append(prediction["explanation"])
        if prediction["evidence"]:
            markers = ", ".join(f"{item.get('gene') or item.get('name')} ({item['category']})" for item in prediction["evidence"])
            lines.append(f"Detected markers: {markers}")
        lines.append("")
    if not result["audit"]["passed"]:
        lines.append("**Guardrail flags:**")
        for flag in result["audit"]["flags"]:
            lines.append(f"- {flag['message']}")
    return "\n".join(lines)


def analyze(fasta_file, amr_file, gff_file):
    if fasta_file is None:
        raise gr.Error("Upload a quality-checked FASTA file first.")
    payload = {
        "fastaText": _read_upload(fasta_file),
        "amrTsv": _read_upload(amr_file),
        "gffText": _read_upload(gff_file),
        "species": "Escherichia coli",
    }
    return _format_result(_call_backend("/api/analyze", payload))


def load_example():
    return _format_result(_call_backend("/api/demo"))


with gr.Blocks(title="Genome Firewall") as demo:
    gr.Markdown("# Genome Firewall")
    gr.Markdown(
        "Defensive antibiotic-failure early-warning research prototype for *Escherichia coli* "
        "(ciprofloxacin, ceftriaxone, gentamicin). This is a thin Gradio client of the same "
        "Node backend the full decision-report UI uses — see README.md for that UI and for "
        "how the underlying model was trained and evaluated."
    )
    gr.Markdown(DISCLAIMER)

    with gr.Row():
        fasta_input = gr.File(label="Quality-checked FASTA (required)", file_types=[".fa", ".fna", ".fasta", ".txt"])
        amr_input = gr.File(label="AMRFinderPlus TSV (optional)", file_types=[".tsv", ".txt"])
        gff_input = gr.File(label="Genome annotation GFF3 (optional, required for likely-to-work calls)", file_types=[".gff", ".gff3", ".txt"])

    with gr.Row():
        analyze_button = gr.Button("Run analysis", variant="primary")
        example_button = gr.Button("Load example case")

    output = gr.Markdown()

    analyze_button.click(analyze, inputs=[fasta_input, amr_input, gff_input], outputs=output)
    example_button.click(load_example, inputs=[], outputs=output)

if __name__ == "__main__":
    demo.launch()
