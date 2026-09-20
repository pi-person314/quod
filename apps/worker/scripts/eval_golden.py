#!/usr/bin/env python3
"""Score parse / segment / anchors / edges against fixtures/golden/analysis-ch3.json."""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from quod_worker.stages.anchors import find_anchors
from quod_worker.stages.edges import extract_edges_offline
from quod_worker.stages.parse import parse_pdf, text_layer_span_count
from quod_worker.stages.segment import nodes_from_spans

GOLDEN = REPO / "fixtures" / "golden" / "analysis-ch3.json"
PDF = REPO / "fixtures" / "golden" / "analysis-ch3.pdf"


def _load_golden() -> dict:
    return json.loads(GOLDEN.read_text(encoding="utf-8"))


def _norm(s: str | None) -> str:
    return (s or "").strip().lower()


def cmd_parse(pdfs: list[Path]) -> int:
    failed = 0
    for pdf in pdfs:
        spans, quality, pages = parse_pdf(pdf)
        raw, raw_pages = text_layer_span_count(pdf)
        empty = [p for p in range(1, pages + 1) if not any(s.page == p for s in spans)]
        delta = abs(len(spans) - raw) / max(raw, 1)
        ok_count = delta <= 0.02
        ok_empty = not empty
        ok_q = quality >= 0.8
        print(
            f"{pdf.name}: spans {len(spans)} vs text-layer {raw} "
            f"(delta {delta:.2%}) pages={pages} empty={empty} quality={quality:.3f}"
        )
        if not (ok_count and ok_empty and ok_q):
            failed += 1
            print(f"  FAIL count={ok_count} no_empty={ok_empty} quality={ok_q}")
    return 1 if failed else 0


def _align_nodes(pred, gold):
    """Map pred id -> gold id via label, else kind+page for unlabeled."""
    gold_by_label = {_norm(n["label"]): n for n in gold if n.get("label")}
    gold_unlab = [n for n in gold if not n.get("label")]
    used = set()
    mapping = {}
    leftover_pred = []
    for p in pred:
        if p.label and _norm(p.label) in gold_by_label:
            g = gold_by_label[_norm(p.label)]
            mapping[str(p.id)] = g["id"]
            used.add(g["id"])
        else:
            leftover_pred.append(p)
    for p in leftover_pred:
        hit = next((g for g in gold_unlab if g["id"] not in used and g["kind"] == p.kind and g["page"] == p.page), None)
        if hit:
            mapping[str(p.id)] = hit["id"]
            used.add(hit["id"])
    return mapping


def cmd_segment() -> int:
    gold = _load_golden()
    spans, quality, _ = parse_pdf(PDF)
    pred = nodes_from_spans(spans, gold["document"]["id"], ctx=None)
    mapping = _align_nodes(pred, gold["nodes"])
    gold_ids = {n["id"] for n in gold["nodes"]}
    pred_matched = set(mapping.values())
    tp = len(pred_matched & gold_ids)
    prec = tp / len(pred) if pred else 0.0
    rec = tp / len(gold["nodes"]) if gold["nodes"] else 0.0
    kinds_g = Counter(n["kind"] for n in gold["nodes"])
    kinds_p = Counter(n.kind for n in pred)
    all_kinds = sorted(set(kinds_g) | set(kinds_p))
    print("kind              gold  pred")
    for k in all_kinds:
        print(f"  {k:16} {kinds_g[k]:4}  {kinds_p[k]:4}")
    print(f"nodes pred={len(pred)} gold={len(gold['nodes'])} P={prec:.3f} R={rec:.3f} parse_q={quality:.3f}")
    missing = [n["label"] or n["kind"] for n in gold["nodes"] if n["id"] not in pred_matched]
    extra = [p.label or p.kind for p in pred if str(p.id) not in mapping]
    if missing:
        print("missing:", missing)
    if extra:
        print("extra:", extra)
    return 0 if prec > 0.85 and rec > 0.85 else 1


def cmd_anchors() -> int:
    gold = _load_golden()
    spans, _, _ = parse_pdf(PDF)
    nodes = nodes_from_spans(spans, gold["document"]["id"], ctx=None)
    pred = find_anchors(spans, nodes, gold["document"]["id"])
    gold_keys = [(_norm(a["surface"]), a["page"]) for a in gold["anchors"]]
    pred_bag = [(_norm(a.surface), a.page) for a in pred]
    found = 0
    used = [False] * len(pred_bag)
    for gk in gold_keys:
        for i, pk in enumerate(pred_bag):
            if used[i]:
                continue
            if pk == gk:
                used[i] = True
                found += 1
                break
    recall = found / len(gold_keys) if gold_keys else 0.0
    explicit_gold = [a for a in gold["anchors"] if a.get("target_node_id")]
    # explicit resolution among predicted explicit that match a gold explicit surface
    gold_by_label = {_norm(n["label"]): n["id"] for n in gold["nodes"] if n.get("label")}
    mapping = _align_nodes(nodes, gold["nodes"])
    rev = {v: k for k, v in mapping.items()}
    correct = 0
    considered = 0
    for a in pred:
        if a.target_node_id is None:
            continue
        considered += 1
        gold_node = next((g for g in gold["anchors"] if _norm(g["surface"]) == _norm(a.surface) and g["page"] == a.page), None)
        if gold_node and gold_node.get("target_node_id"):
            pred_gold_id = mapping.get(str(a.target_node_id))
            if pred_gold_id == gold_node["target_node_id"]:
                correct += 1
        elif a.surface and _norm(a.surface) in gold_by_label:
            # header-as-anchor resolved to that node
            if mapping.get(str(a.target_node_id)) == gold_by_label[_norm(a.surface)]:
                correct += 1
    acc = correct / considered if considered else 0.0
    print(f"anchors found {found}/{len(gold_keys)} recall={recall:.3f} pred={len(pred)}")
    print(f"explicit resolution {correct}/{considered} acc={acc:.3f}")
    missing = []
    for gk in gold_keys:
        if gk not in pred_bag:
            missing.append(gk)
    if missing:
        print("missing surfaces:", missing)
    return 0 if found == len(gold_keys) and acc > 0.95 else 1


def _acyclic(edges, restates_ok=True) -> bool:
    adj = defaultdict(list)
    for e in edges:
        if restates_ok and getattr(e, "kind", e.get("kind") if isinstance(e, dict) else None) == "restates":
            continue
        src = str(e.src) if hasattr(e, "src") else e["src"]
        dst = str(e.dst) if hasattr(e, "dst") else e["dst"]
        adj[src].append(dst)
    state = {}

    def visit(u):
        state[u] = 1
        for v in adj.get(u, []):
            if state.get(v) == 1:
                return True
            if v not in state and visit(v):
                return True
        state[u] = 2
        return False

    return not any(visit(u) for u in list(adj) if u not in state)


def cmd_edges() -> int:
    gold = _load_golden()
    spans, _, _ = parse_pdf(PDF)
    nodes = nodes_from_spans(spans, gold["document"]["id"], ctx=None)
    anchors = find_anchors(spans, nodes, gold["document"]["id"])
    pred = extract_edges_offline(nodes, anchors, ctx=None)
    mapping = _align_nodes(nodes, gold["nodes"])
    gold_pairs = {
        (e["src"], e["dst"], e["kind"])
        for e in gold["edges"]
    }
    pred_pairs = set()
    for e in pred:
        gs, gd = mapping.get(str(e.src)), mapping.get(str(e.dst))
        if gs and gd:
            pred_pairs.add((gs, gd, e.kind))
    tp = len(pred_pairs & gold_pairs)
    prec = tp / len(pred_pairs) if pred_pairs else 0.0
    rec = tp / len(gold_pairs) if gold_pairs else 0.0
    f1 = 0.0 if prec + rec == 0 else 2 * prec * rec / (prec + rec)
    acyclic = _acyclic(pred)
    gold_theorems = [n for n in gold["nodes"] if n["kind"] == "theorem"]
    incident = set()
    for e in pred:
        incident.add(str(e.src))
        incident.add(str(e.dst))
    th_ok = 0
    for t in gold_theorems:
        pid = next((pid for pid, gid in mapping.items() if gid == t["id"]), None)
        if pid and pid in incident:
            th_ok += 1
    print(f"edges pred={len(pred)} aligned={len(pred_pairs)} gold={len(gold_pairs)} P={prec:.3f} R={rec:.3f} F1={f1:.3f}")
    print(f"acyclic={acyclic} theorems_with_edge={th_ok}/{len(gold_theorems)}")
    ok = acyclic and th_ok == len(gold_theorems) and f1 > 0.75
    return 0 if ok else 1


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser()
    p.add_argument("what", choices=["parse", "segment", "anchors", "edges", "all"])
    p.add_argument("pdfs", nargs="*", type=Path)
    args = p.parse_args(argv)
    rc = 0
    if args.what in ("parse", "all"):
        pdfs = args.pdfs or [
            PDF,
            REPO / "fixtures" / "golden" / "pset4.pdf",
        ]
        rc |= cmd_parse(pdfs)
    if args.what in ("segment", "all"):
        rc |= cmd_segment()
    if args.what in ("anchors", "all"):
        rc |= cmd_anchors()
    if args.what in ("edges", "all"):
        rc |= cmd_edges()
    return rc


if __name__ == "__main__":
    sys.exit(main())
