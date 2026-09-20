"""Stage 4 — Edge extraction. Deterministic → heuristic → notation → llm."""

from __future__ import annotations

import json
import logging
import os
import re
from uuid import UUID

from quod_worker import db
from quod_worker.batches import run_batches
from quod_worker.llm import call_model
from quod_worker.models import Anchor, Edge, Node
from quod_worker.pipeline import PipelineContext

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
        text = re.sub(r"^\([^)]*\)\s*", "", text)
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


def _named_pattern(title: str) -> re.Pattern | None:
    words = re.findall(r"\w+", title.casefold())
    if words and words[-1] in {"theorem", "lemma", "proposition"}:
        words.pop()
    if not words:
        return None
    suffix = r"\s+(?:theorem|lemma|proposition)" if len(words) == 1 else r"(?:\s+theorem)?"
    return re.compile(r"\b" + r"[\s\-–]+".join(map(re.escape, words)) + suffix + r"\b", re.I)


def _defined_operators(node: Node) -> set[str]:
    if node.kind not in {"definition", "notation"}:
        return set()
    # Only distinctive operator names explicitly introduced on the LHS of a
    # definition. A shared variable such as T or x is not a dependency.
    matches = re.findall(r"\$([^$]+)\$", _body(node))
    left = [part.split("=", 1)[0] for part in matches if "=" in part]
    if node.kind == "notation" and re.search(r"\b(?:write|denote)\b", _body(node), re.I):
        left += matches[:1]
    return set(re.findall(r"\\(?:operatorname|mathcal|mathrm)\{[^}]+\}|\\(?:ker|coker|Hom|End|Spec)\b", " ".join(left)))


def _defined_terms(node: Node) -> set[str]:
    if node.kind != "definition":
        return set()
    # Explicit introduction syntax only; never infer a concept from a label.
    text = _body(node).lstrip(". ")
    found = re.match(r"(?:A|An|The)\s+([A-Za-z][A-Za-z -]{1,45}?)\s+(?:of\s+)?\$", text, re.I)
    return {found.group(1).casefold()} if found else set()


def extract_edges_offline(nodes: list[Node], anchors: list[Anchor], ctx: PipelineContext | None = None) -> list[Edge]:
    by_label = {(n.doc_id, n.label.lower()): n for n in nodes if n.label and sum(1 for other in nodes if other.doc_id == n.doc_id and other.label and other.label.lower() == n.label.lower()) == 1}
    ordered = sorted(nodes, key=_order_key)
    claimed: set[tuple[UUID, UUID, str]] = set()
    claimed_anchors: set[UUID] = set()
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
            dst = by_label.get((src.doc_id, _norm_label(m.group(1), m.group(2)).lower()))
            if dst:
                prefix = _body(src)[:m.start()]
                kind = "restates" if re.search(r"(?:equivalent\s+to|restates?)\s*$", prefix, re.I) else "depends_on"
                add(src, dst, kind, "deterministic", 0.95)

    # resolved anchors that sit in a later/same node
    for a in anchors:
        if not a.target_node_id:
            continue
        src = _node_containing(ordered, a)
        dst = next((n for n in nodes if n.id == a.target_node_id), None)
        if src and dst and src.id != dst.id and not any(e.src == src.id and e.dst == dst.id for e in edges):
            add(src, dst, "depends_on", "deterministic", 0.92)
            claimed_anchors.add(a.id)

    # 2. heuristic — only references actually present in a containing node
    for a in anchors:
        src = _node_containing(ordered, a)
        if src is None:
            continue
        surf = a.surface.lower()
        if "previous lemma" in surf:
            prev = _previous_of_kind(ordered, src, "lemma")
            if prev:
                add(src, prev, "depends_on", "heuristic", 0.8)
                claimed_anchors.add(a.id)
        elif "as above" in surf:
            prev = _previous_of_kind(ordered, src, "lemma") or _previous_any(ordered, src)
            if prev:
                add(src, prev, "depends_on", "heuristic", 0.7)
                claimed_anchors.add(a.id)

    # Resolve names from actual theorem titles, including names outside the demo.
    # An ambiguous repeated title never silently selects the first result.
    titled = [(n, _named_pattern(n.title)) for n in nodes if n.title and n.kind in {"theorem", "lemma", "proposition"}]
    for src in ordered:
        matches = [(dst, pattern) for dst, pattern in titled if pattern and dst.doc_id == src.doc_id
                   and dst.id != src.id and pattern.search(_body(src))]
        for dst, pattern in matches:
            if sum(1 for other, p in matches if p.pattern == pattern.pattern) == 1:
                add(src, dst, "depends_on", "heuristic", 0.85)
                for anchor in anchors:
                    if _node_containing(ordered, anchor) == src and pattern.search(anchor.surface):
                        claimed_anchors.add(anchor.id)
        # A theorem's own parenthetical name is a heading, not an unresolved
        # invocation requiring another model call.
        own_name = _named_pattern(src.title) if src.title else None
        if own_name and not own_name.search(_body(src)):
            for anchor in anchors:
                if _node_containing(ordered, anchor) == src and own_name.search(anchor.surface):
                    claimed_anchors.add(anchor.id)

    # Attach uses of defined operators to the nearest preceding definition.
    for src in ordered:
        operators = {}
        terms = {}
        for dst in ordered:
            if dst.doc_id == src.doc_id and _order_key(dst) < _order_key(src):
                for operator in _defined_operators(dst):
                    operators[operator] = dst
                for term in _defined_terms(dst):
                    terms[term] = dst
        for operator, dst in operators.items():
            if re.search(re.escape(operator) + (r"(?![A-Za-z])" if operator[-1].isalpha() else ""), _body(src)):
                if not any(e.src == src.id and e.dst == dst.id for e in edges):
                    add(src, dst, "uses_notation" if src.kind in {"definition", "notation"} else "depends_on", "notation", 0.9)
        for term, dst in terms.items():
            # Exclude compound theorem names (e.g. a term inside X-Y theorem).
            if re.search(r"(?<![\w-])" + re.escape(term) + r"s?(?![\w-])", _body(src), re.I):
                if not any(e.src == src.id and e.dst == dst.id for e in edges):
                    add(src, dst, "uses_notation" if src.kind in {"definition", "notation"} else "depends_on", "notation", 0.85)

    # Notation requires an actual shared symbol and matching role. Numerical
    # labels and proximity alone are not evidence of mathematical dependence.
    for src in ordered:
        for symbol in src.symbols:
            candidates = [d for d in defs if d.doc_id == src.doc_id and _order_key(d) < _order_key(src)
                          and any(s.sym == symbol.sym and s.role == symbol.role for s in d.symbols)]
            if candidates:
                add(src, candidates[-1], "uses_notation", "notation", 0.8)

    # 4. llm — only unclaimed named surfaces
    named = [a for a in anchors if a.target_node_id is None and a.id not in claimed_anchors and _node_containing(ordered, a)]
    if named and ctx is not None and os.environ.get("CAIRN_INTELLIGENCE_MODE") != "deterministic":
        _llm_named(ctx, nodes, named, edges, claimed)

    return edges


def _node_containing(ordered: list[Node], a: Anchor) -> Node | None:
    candidates = [n for n in ordered if n.doc_id == a.doc_id and n.page == a.page
                  and n.bbox[0] - 2 <= a.bbox[0] and n.bbox[1] - 2 <= a.bbox[1]
                  and n.bbox[2] + 2 >= a.bbox[2] and n.bbox[3] + 2 >= a.bbox[3]]
    return min(candidates, key=lambda n: (n.bbox[2]-n.bbox[0])*(n.bbox[3]-n.bbox[1])) if candidates else None


def _previous_of_kind(ordered: list[Node], src: Node, kind: str) -> Node | None:
    prev = None
    for n in ordered:
        if n.id == src.id:
            return prev
        if n.doc_id == src.doc_id and n.kind == kind:
            prev = n
    return prev


def _previous_any(ordered: list[Node], src: Node) -> Node | None:
    prev = None
    for n in ordered:
        if n.id == src.id:
            return prev
        if n.doc_id == src.doc_id:
            prev = n
    return prev


def _llm_named(
    ctx: PipelineContext,
    nodes: list[Node],
    named: list[Anchor],
    edges: list[Edge],
    claimed: set[tuple[UUID, UUID, str]],
) -> None:
    catalog = [{"id": str(n.id), "label": n.label, "title": n.title, "kind": n.kind, "statement": n.statement_md} for n in nodes]
    refs = [{"surface": a.surface, "page": a.page, "src": str(source.id)} for a in named if (source := _node_containing(nodes, a))]
    def resolve(conn, chunk, off):
        try:
            text, _ = call_model(
                conn,
                stage="edges",
                input=json.dumps({"nodes": catalog, "references": chunk}, ensure_ascii=False),
                instructions=EDGE_INSTRUCTIONS,
                prompt_cache_key=f"edges:{ctx.doc_id}",
                json_schema=EDGE_SCHEMA,
                max_output_tokens=2048,
                doc_id=ctx.doc_id,
                corpus_id=ctx.corpus_id,
            )
            parsed = json.loads(text)
            return parsed.get("edges", [])
        except Exception as error:
            raise RuntimeError(f"Model relation extraction failed: {error}") from error

    for off, candidates in run_batches(ctx, refs, 6, "edges", "Checking dependency references", resolve):
        known = {n.id for n in nodes}
        by_id = {n.id: n for n in nodes}
        for e in candidates:
            try:
                src, dst = UUID(e["src"]), UUID(e["dst"])
            except (KeyError, ValueError):
                continue
            if src not in known or dst not in known or str(src) not in {ref["src"] for ref in refs[off:off + 6]}:
                continue
            kind = e.get("kind", "depends_on")
            if kind not in ("depends_on", "uses_notation", "specialises", "restates"):
                continue
            if _would_cycle(edges, src, dst, kind):
                continue
            _add(edges, claimed, src, dst, kind, "llm", 0.7)


def extract_edges(ctx: PipelineContext, nodes: list[Node], anchors: list[Anchor]) -> list[Edge]:
    edges = extract_edges_offline(nodes, anchors, ctx)
    for e in edges:
        db.insert_edge(ctx.conn, e)
    db.set_progress(ctx.conn, ctx.doc_id, "edges", message=f"Saved {len(edges)} dependency connections")
    return edges
