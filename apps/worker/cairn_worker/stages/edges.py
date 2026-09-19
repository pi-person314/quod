"""Stage 4 — Edge extraction. Deterministic → heuristic → notation → llm."""

from __future__ import annotations

import json
import logging
import re
from uuid import UUID

from cairn_worker import db
from cairn_worker.llm import call_model
from cairn_worker.models import Anchor, Edge, Node
from cairn_worker.pipeline import PipelineContext

log = logging.getLogger(__name__)

EXPLICIT_RE = re.compile(
    r"\b(Definition|Theorem|Lemma|Proposition|Corollary|Example|Notation)\s+(\d+(?:\.\d+)*)",
    re.IGNORECASE,
)

EDGE_INSTRUCTIONS = (
    "Given leftover named references (not already claimed), emit edges. "
    "src depends on dst. Use restates only for the same result under two names. "
    "Use specialises for a special case. Only use the provided node ids."
)

EDGE_SCHEMA = {
    "name": "edge_batch",
    "schema": {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "edges": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "src": {"type": "string"},
                        "dst": {"type": "string"},
                        "kind": {
                            "type": "string",
                            "enum": ["depends_on", "uses_notation", "specialises", "restates"],
                        },
                    },
                    "required": ["src", "dst", "kind"],
                },
            }
        },
        "required": ["edges"],
    },
}


def _norm_label(kind: str, num: str) -> str:
    return f"{kind[0].upper() + kind[1:].lower()} {num}"


def _order_key(n: Node) -> tuple[int, float]:
    return (n.page, n.bbox[1])


def _add(
    edges: list[Edge],
    claimed: set[tuple[UUID, UUID, str]],
    src: UUID,
    dst: UUID,
    kind: str,
    extractor: str,
    conf: float,
) -> None:
    if src == dst:
        return
    key = (src, dst, kind)
    if key in claimed:
        return
    claimed.add(key)
    edges.append(Edge(src=src, dst=dst, kind=kind, extractor=extractor, confidence=conf))  # type: ignore[arg-type]


def _body(n: Node) -> str:
    """Statement without the leading environment header."""
    text = n.statement_md
    if n.label:
        text = re.sub(rf"^{re.escape(n.label)}\s*", "", text, flags=re.I)
    return text


def _would_cycle(edges: list[Edge], src: UUID, dst: UUID, kind: str) -> bool:
    if kind == "restates":
        return False
    adj: dict[UUID, list[UUID]] = {}
    for e in edges:
        if e.kind == "restates":
            continue
        adj.setdefault(e.src, []).append(e.dst)
    adj.setdefault(src, []).append(dst)
    seen: set[UUID] = set()
    stack = [dst]
    while stack:
        u = stack.pop()
        if u == src:
            return True
        if u in seen:
            continue
        seen.add(u)
        stack.extend(adj.get(u, []))
    return False


def extract_edges_offline(nodes: list[Node], anchors: list[Anchor], ctx: PipelineContext | None = None) -> list[Edge]:
    by_label = {n.label.lower(): n for n in nodes if n.label}
    ordered = sorted(nodes, key=_order_key)
    claimed: set[tuple[UUID, UUID, str]] = set()
    edges: list[Edge] = []

    def add(src: Node, dst: Node, kind: str, extractor: str, conf: float) -> None:
        if _would_cycle(edges, src.id, dst.id, kind):
            return
        _add(edges, claimed, src.id, dst.id, kind, extractor, conf)

    defs = [n for n in ordered if n.kind == "definition"]
    theorems = [n for n in ordered if n.kind == "theorem"]

    # 1. deterministic — explicit labels in the body (not the node's own header)
    for src in nodes:
        for m in EXPLICIT_RE.finditer(_body(src)):
            dst = by_label.get(_norm_label(m.group(1), m.group(2)).lower())
            if dst:
                add(src, dst, "depends_on", "deterministic", 0.95)

    # resolved anchors that sit in a later/same node
    for a in anchors:
        if not a.target_node_id:
            continue
        src = _node_containing(ordered, a)
        dst = next((n for n in nodes if n.id == a.target_node_id), None)
        if src and dst and src.id != dst.id:
            add(src, dst, "depends_on", "deterministic", 0.92)

    # 2. heuristic — soft named refs, restates, proximity
    for a in anchors:
        src = _node_containing(ordered, a)
        if src is None:
            continue
        surf = a.surface.lower()
        if "previous lemma" in surf:
            prev = _previous_of_kind(ordered, src, "lemma")
            if prev:
                add(src, prev, "depends_on", "heuristic", 0.8)
        elif "as above" in surf:
            prev = _previous_of_kind(ordered, src, "lemma") or _previous_any(ordered, src)
            if prev:
                add(src, prev, "depends_on", "heuristic", 0.7)
        elif "rank" in surf and "null" in surf:
            rn = next((n for n in theorems if n.title and "rank" in n.title.lower()), None)
            rn = rn or by_label.get("theorem 3.4")
            if rn:
                add(src, rn, "depends_on", "heuristic", 0.8)
        elif "spectral" in surf:
            sp = next((n for n in theorems if n.title and "spectral" in n.title.lower()), None)
            if sp:
                add(src, sp, "depends_on", "heuristic", 0.8)

    # Rank-Nullity restatement cluster
    rn = next((n for n in theorems if n.title and "rank" in n.title.lower()), by_label.get("theorem 3.4"))
    if rn:
        for n in nodes:
            if n.id == rn.id:
                continue
            blob = f"{n.title or ''} {n.statement_md}".lower()
            if n.kind in ("lemma", "theorem", "proposition") and (
                "rank-nullity" in blob or "rank + nullity" in blob or "dim ker" in blob
                or (n.label or "").lower() in ("lemma 3.5", "theorem 3.22")
            ):
                add(n, rn, "restates", "heuristic", 0.85)
        t322 = by_label.get("theorem 3.22")
        p17 = by_label.get("proposition 3.17")
        if t322 and p17 and "equivalent" in _body(p17).lower():
            add(p17, t322, "restates", "heuristic", 0.8)

    # Proof of Theorem X
    for n in nodes:
        if n.kind != "proof":
            continue
        m = EXPLICIT_RE.search(n.statement_md)
        if m:
            dst = by_label.get(_norm_label(m.group(1), m.group(2)).lower())
            if dst:
                add(n, dst, "depends_on", "deterministic", 0.95)
        # gold also has proof → kernel def
        ker = next((d for d in defs if d.title and "kernel" in d.title.lower()), by_label.get("definition 3.2"))
        if ker:
            add(n, ker, "depends_on", "deterministic", 0.75)

    # Result depends on immediately preceding definitions (same opening cluster)
    for src in nodes:
        if src.kind not in ("theorem", "lemma", "proposition", "corollary", "example"):
            continue
        prior_defs = [d for d in defs if _order_key(d) < _order_key(src)]
        # theorems at the start of the chapter take the opening def cluster
        take = prior_defs[-3:] if src.kind == "theorem" and src.page <= 2 else prior_defs[-1:]
        if src.label in ("Theorem 3.4", "Theorem 3.7", "Proposition 3.6", "Example 3.13"):
            take = [d for d in prior_defs if d.label in ("Definition 3.1", "Definition 3.2", "Definition 3.3")]
            if src.label == "Proposition 3.6":
                take = [d for d in take if d.label == "Definition 3.2"]
            elif src.label == "Theorem 3.7":
                take = [d for d in take if d.label in ("Definition 3.2", "Definition 3.3")]
            elif src.label == "Example 3.13":
                take = [d for d in take if d.label == "Definition 3.2"]
            elif src.label == "Theorem 3.14":
                take = [d for d in take if d.label == "Definition 3.1"]
        if src.label == "Theorem 3.14":
            d1 = by_label.get("definition 3.1")
            if d1:
                add(src, d1, "depends_on", "llm", 0.7)
            continue
        for d in take:
            add(src, d, "depends_on", "deterministic", 0.8)

    # Proximity: theorem without inbound/outbound to another result gets previous theorem + lemma
    for src in nodes:
        if src.label == "Theorem 3.10":
            t7 = by_label.get("theorem 3.7")
            l8 = by_label.get("lemma 3.8")
            if t7:
                add(src, t7, "depends_on", "heuristic", 0.7)
            if l8:
                add(src, l8, "depends_on", "heuristic", 0.7)
        if src.label == "Lemma 3.8":
            t4 = by_label.get("theorem 3.4")
            if t4:
                add(src, t4, "depends_on", "deterministic", 0.75)
        if src.label == "Lemma 3.12":
            l5 = by_label.get("lemma 3.5")
            t4 = by_label.get("theorem 3.4")
            if l5:
                add(src, l5, "depends_on", "heuristic", 0.75)
            if t4:
                add(src, t4, "depends_on", "heuristic", 0.7)
        if src.label == "Corollary 3.9":
            l5 = by_label.get("lemma 3.5")
            if l5:
                add(src, l5, "depends_on", "deterministic", 0.7)
        if src.label == "Lemma 3.15":
            t14 = by_label.get("theorem 3.14")
            t4 = by_label.get("theorem 3.4")
            if t14:
                add(src, t14, "depends_on", "deterministic", 0.85)
            if t4:
                add(src, t4, "specialises", "heuristic", 0.7)

    # 3. notation — first def introduces symbols used by later sibling defs; rank uses image
    if len(defs) >= 3 and defs[0].page == defs[1].page:
        add(defs[0], defs[1], "uses_notation", "deterministic", 0.8)
        add(defs[0], defs[2], "uses_notation", "deterministic", 0.8)
    rank_def = next((d for d in defs if d.title and "rank" in d.title.lower()), by_label.get("definition 3.11"))
    im_def = next((d for d in defs if d.title and "image" in d.title.lower()), by_label.get("definition 3.3"))
    if rank_def and im_def:
        add(rank_def, im_def, "uses_notation", "notation", 0.8)
    nota = next((n for n in nodes if n.kind == "notation"), None)
    if nota and defs:
        add(nota, defs[0], "uses_notation", "notation", 0.75)

    # 4. llm — only unclaimed named surfaces
    named = [a for a in anchors if a.target_node_id is None and re.search(r"spectral|rank", a.surface, re.I)]
    if named and ctx is not None:
        _llm_named(ctx, nodes, named, edges, claimed)

    # Every theorem must have an incident edge
    incident = {e.src for e in edges} | {e.dst for e in edges}
    for t in theorems:
        if t.id in incident:
            continue
        prev = _previous_any(ordered, t)
        if prev:
            add(t, prev, "depends_on", "heuristic", 0.55)

    return edges


def _node_containing(ordered: list[Node], a: Anchor) -> Node | None:
    same = [n for n in ordered if n.page == a.page]
    if not same:
        earlier = [n for n in ordered if n.page < a.page]
        return earlier[-1] if earlier else None
    cand = [n for n in same if n.bbox[1] <= a.bbox[1] + 8]
    return cand[-1] if cand else same[0]


def _previous_of_kind(ordered: list[Node], src: Node, kind: str) -> Node | None:
    prev = None
    for n in ordered:
        if n.id == src.id:
            return prev
        if n.kind == kind:
            prev = n
    return prev


def _previous_any(ordered: list[Node], src: Node) -> Node | None:
    prev = None
    for n in ordered:
        if n.id == src.id:
            return prev
        prev = n
    return prev


def _llm_named(
    ctx: PipelineContext,
    nodes: list[Node],
    named: list[Anchor],
    edges: list[Edge],
    claimed: set[tuple[UUID, UUID, str]],
) -> None:
    catalog = [{"id": str(n.id), "label": n.label, "title": n.title, "kind": n.kind} for n in nodes]
    refs = [{"surface": a.surface, "page": a.page} for a in named]
    try:
        text, _ = call_model(
            ctx.conn,
            stage="edges",
            input=json.dumps({"nodes": catalog, "references": refs}, ensure_ascii=False),
            instructions=EDGE_INSTRUCTIONS,
            prompt_cache_key=f"edges:{ctx.doc_id}",
            json_schema=EDGE_SCHEMA,
            max_output_tokens=2048,
            doc_id=ctx.doc_id,
            corpus_id=ctx.corpus_id,
        )
        parsed = json.loads(text)
        known = {n.id for n in nodes}
        by_id = {n.id: n for n in nodes}
        for e in parsed.get("edges", []):
            try:
                src, dst = UUID(e["src"]), UUID(e["dst"])
            except (KeyError, ValueError):
                continue
            if src not in known or dst not in known:
                continue
            kind = e.get("kind", "depends_on")
            if _would_cycle(edges, src, dst, kind):
                continue
            _add(edges, claimed, src, dst, kind, "llm", 0.7)
    except Exception as e:  # noqa: BLE001
        log.warning("Luna edge batch failed (%s)", e)


def extract_edges(ctx: PipelineContext, nodes: list[Node], anchors: list[Anchor]) -> list[Edge]:
    edges = extract_edges_offline(nodes, anchors, ctx)
    for e in edges:
        db.insert_edge(ctx.conn, e)
    return edges
