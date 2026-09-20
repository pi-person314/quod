"""Stage 2 — Segment: regex environments, then Luna over candidate blocks."""

from __future__ import annotations

import json
import logging
import re
from uuid import UUID, uuid5

from cairn_worker import db
from cairn_worker.llm import call_model
from cairn_worker.models import Clause, Node, NodeKind, Span, SymbolEntry
from cairn_worker.pipeline import PipelineContext

log = logging.getLogger(__name__)

KIND_WORD: dict[str, NodeKind] = {
    "definition": "definition",
    "theorem": "theorem",
    "lemma": "lemma",
    "proposition": "proposition",
    "corollary": "corollary",
    "example": "example",
    "notation": "notation",
    "proof": "proof",
}

HEADER_RE = re.compile(
    r"(?P<kind>Definition|Theorem|Lemma|Proposition|Corollary|Example|Notation)\s+"
    r"(?P<num>\d+(?:\.\d+)*)\b"
    r"(?:\s*\((?P<title>[^)]+)\))?",
    re.IGNORECASE,
)
PROOF_RE = re.compile(r"^\s*Proof\b\.?", re.IGNORECASE)
QED_RE = re.compile(r"\b(QED|□|∎|qed)\b", re.IGNORECASE)

SEGMENT_INSTRUCTIONS = (
    "You classify mathematical environments from a textbook chapter. "
    "For each candidate, return kind, an optional short title (or null), "
    "clause decomposition, and symbols the node introduces. "
    "Keep statements faithful to the source text. Do not invent labels."
)

SEGMENT_SCHEMA = {
    "name": "segment_batch",
    "schema": {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "nodes": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "index": {"type": "integer"},
                        "kind": {
                            "type": "string",
                            "enum": [
                                "definition",
                                "theorem",
                                "lemma",
                                "proposition",
                                "corollary",
                                "example",
                                "proof",
                                "notation",
                            ],
                        },
                        "title": {"type": ["string", "null"]},
                        "clauses": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "additionalProperties": False,
                                "properties": {
                                    "id": {"type": "string"},
                                    "text": {"type": "string"},
                                },
                                "required": ["id", "text"],
                            },
                        },
                        "symbols": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "additionalProperties": False,
                                "properties": {
                                    "sym": {"type": "string"},
                                    "role": {"type": "string"},
                                },
                                "required": ["sym", "role"],
                            },
                        },
                        "confidence": {"type": "number"},
                    },
                    "required": ["index", "kind", "title", "clauses", "symbols", "confidence"],
                },
            }
        },
        "required": ["nodes"],
    },
}


def _union_bbox(spans: list[Span]) -> tuple[float, float, float, float]:
    return (
        min(s.bbox[0] for s in spans),
        min(s.bbox[1] for s in spans),
        max(s.bbox[2] for s in spans),
        max(s.bbox[3] for s in spans),
    )


def _page_lines(spans: list[Span]) -> list[tuple[int, str, list[Span]]]:
    """(page, line_text, spans_on_line) in reading order."""
    groups: dict[tuple[int, int], list[Span]] = {}
    for s in spans:
        groups.setdefault((s.page, s.line), []).append(s)
    out: list[tuple[int, str, list[Span]]] = []
    for (page, _ln), ssp in sorted(groups.items(), key=lambda kv: (kv[0][0], min(x.bbox[1] for x in kv[1]), kv[0][1])):
        ssp.sort(key=lambda x: x.bbox[0])
        out.append((page, "".join(x.text for x in ssp), ssp))
    return out


def find_candidates(spans: list[Span]) -> list[dict]:
    """Regex pass: numbered headers, Proof. markers, QED terminators."""
    lines = _page_lines(spans)
    starts: list[tuple[int, dict]] = []
    for i, (page, text, ssp) in enumerate(lines):
        if PROOF_RE.match(text.strip()):
            starts.append(
                (
                    i,
                    {
                        "kind": "proof",
                        "label": None,
                        "title": None,
                        "page": page,
                        "header_spans": ssp,
                    },
                )
            )
            continue
        m = HEADER_RE.match(text.strip())
        if m:
            kind = KIND_WORD[m.group("kind").lower()]
            label = f"{m.group('kind').capitalize()} {m.group('num')}"
            # Title-case the kind word to match fixtures ("Theorem 3.4")
            label = f"{m.group('kind')[0].upper() + m.group('kind')[1:].lower()} {m.group('num')}"
            title = (m.group("title") or "").strip() or None
            starts.append((i, {"kind": kind, "label": label, "title": title, "page": page, "header_spans": ssp}))

    cands: list[dict] = []
    for j, (i, meta) in enumerate(starts):
        end = starts[j + 1][0] if j + 1 < len(starts) else len(lines)
        block_lines = lines[i:end]
        # Trim trailing QED-only line from next env, keep it on this block
        texts = [t for _, t, _ in block_lines]
        body_spans: list[Span] = []
        for _p, _t, ssp in block_lines:
            body_spans.extend(ssp)
        statement = " ".join(t.strip() for t in texts if t.strip())
        cands.append(
            {
                **meta,
                "statement": statement,
                "spans": body_spans,
                "bbox": _union_bbox(body_spans) if body_spans else _union_bbox(meta["header_spans"]),
            }
        )
    return cands


def _luna_enrich(ctx: PipelineContext | None, cands: list[dict]) -> None:
    if not cands or ctx is None:
        return
    batch_size = 20
    chapter_key = f"segment:{ctx.doc_id if ctx else 'eval'}"
    for off in range(0, len(cands), batch_size):
        chunk = cands[off : off + batch_size]
        payload = [
            {"index": i, "label": c.get("label"), "kind_guess": c["kind"], "text": c["statement"][:2000]}
            for i, c in enumerate(chunk)
        ]
        user = "Classify these candidate environments.\n" + json.dumps(payload, ensure_ascii=False)
        try:
            conn = ctx.conn if ctx is not None else None
            text, _ = call_model(
                conn,
                stage="segment",
                input=user,
                instructions=SEGMENT_INSTRUCTIONS,
                prompt_cache_key=chapter_key,
                json_schema=SEGMENT_SCHEMA,
                max_output_tokens=4096,
                doc_id=ctx.doc_id if ctx else None,
                corpus_id=ctx.corpus_id if ctx else None,
                meta={"batch": off // batch_size, "n": len(chunk)},
            )
            parsed = json.loads(text)
            by_i = {int(n["index"]): n for n in parsed.get("nodes", [])}
        except Exception as e:  # noqa: BLE001 — regex remains source of labels
            log.warning("Luna segment batch failed (%s); using regex kinds", e)
            continue
        for i, c in enumerate(chunk):
            n = by_i.get(i)
            if not n:
                continue
            kind = n.get("kind")
            if kind in KIND_WORD.values():
                # Keep regex kind for labeled envs; allow Luna to set proof/unlabeled
                if c["label"] is None:
                    c["kind"] = kind
                elif c["kind"] != kind:
                    log.debug("luna kind %s != regex %s for %s; keeping regex", kind, c["kind"], c["label"])
            if n.get("title") and not c.get("title"):
                c["title"] = n["title"]
            if n.get("clauses"):
                c["clauses"] = [Clause(id=x["id"], text=x["text"]) for x in n["clauses"]]
            if n.get("symbols"):
                c["symbols"] = [SymbolEntry(sym=x["sym"], role=x["role"]) for x in n["symbols"]]
            if isinstance(n.get("confidence"), (int, float)):
                c["confidence"] = float(n["confidence"])


def nodes_from_spans(spans: list[Span], doc_id, ctx: PipelineContext | None = None) -> list[Node]:
    cands = find_candidates(spans)
    for c in cands:
        c.setdefault("clauses", [Clause(id="i", text=c["statement"][:500])])
        c.setdefault("symbols", [])
        c.setdefault("confidence", 0.85)
    _luna_enrich(ctx, cands)
    nodes: list[Node] = []
    for index, c in enumerate(cands):
        nodes.append(
            Node(
                id=uuid5(UUID(str(doc_id)), f"node:{c['page']}:{index}:{c.get('label') or c['kind']}"),
                doc_id=doc_id,
                kind=c["kind"],
                label=c.get("label"),
                title=c.get("title"),
                statement_md=c["statement"],
                clauses=c.get("clauses") or [],
                symbols=c.get("symbols") or [],
                page=c["page"],
                bbox=c["bbox"],
                entity_id=None,
                confidence=min(1.0, max(0.0, float(c.get("confidence", 0.85)))),
            )
        )
    return nodes


def segment(ctx: PipelineContext, spans: list[Span]) -> list[Node]:
    nodes = nodes_from_spans(spans, ctx.doc_id, ctx)
    total = len(nodes)
    for i, n in enumerate(nodes, start=1):
        db.insert_node(ctx.conn, n)
        db.set_progress(ctx.conn, ctx.doc_id, "segment", nodes_done=i, total=total, message=n.label or n.kind)
    return nodes
