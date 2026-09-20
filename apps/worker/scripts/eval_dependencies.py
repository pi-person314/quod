"""Source-evidence evaluation; keeps the original golden gate unchanged."""
import json
import hashlib
from pathlib import Path

from quod_worker.stages.parse import parse_pdf
from quod_worker.stages.segment import nodes_from_spans
from quod_worker.stages.anchors import find_anchors
from quod_worker.stages.edges import extract_edges_offline

ROOT = Path(__file__).resolve().parents[3]


def main():
    manifest = json.loads((ROOT / "fixtures/evals/dependencies.json").read_text())
    assert hashlib.sha256((ROOT / manifest["source"]).read_bytes()).hexdigest() == manifest["source_sha256"], "Source PDF changed; review annotations before scoring"
    spans, _, _ = parse_pdf(ROOT / manifest["source"])
    nodes = nodes_from_spans(spans, "00000000-0000-4000-8000-000000000011")
    labels = {n.id: n.label or n.kind for n in nodes}
    text = {n.label or n.kind: n.statement_md for n in nodes}
    expected = set()
    for src, dst, kind, evidence in manifest["edges"]:
        assert evidence in text[src], f"Annotation evidence absent: {src}: {evidence}"
        assert dst in text, f"Missing target: {dst}"
        expected.add((src, dst, kind))
    edges = extract_edges_offline(nodes, find_anchors(spans, nodes, nodes[0].doc_id))
    predicted = {(labels[e.src], labels[e.dst], e.kind) for e in edges}
    tp = len(predicted & expected)
    report = {"scope": manifest["scope"], "expected": len(expected), "predicted": len(predicted),
              "precision": tp / len(predicted), "recall": tp / len(expected),
              "f1": 2 * tp / (len(predicted) + len(expected)),
              "missing": sorted(expected - predicted), "extra": sorted(predicted - expected)}
    out = ROOT / ".cairn-sessions/current-quality"
    out.mkdir(parents=True, exist_ok=True)
    (out / "dependencies-source.json").write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))
    return 0 if report["f1"] > .75 else 1


if __name__ == "__main__":
    raise SystemExit(main())
