"""Stage 3 — Anchor detection: explicit / soft / named surfaces."""

from __future__ import annotations

import re
from pathlib import Path
from uuid import uuid4

from cairn_worker import db
from cairn_worker.models import Anchor, Node, Span
from cairn_worker.pipeline import PipelineContext

EXPLICIT_RE = re.compile(
    r"\b(?P<kind>Definition|Theorem|Lemma|Proposition|Corollary|Example|Notation)\s+"
    r"(?P<num>\d+(?:\.\d+)*)"
    r"(?:\s*\((?P<clause>[ivx]+|\d+)\))?",
    re.IGNORECASE,
)
BY_EXPLICIT_RE = re.compile(
    r"\bBy\s+(?P<kind>Definition|Theorem|Lemma|Proposition|Corollary|Example|Notation)\s+"
    r"(?P<num>\d+(?:\.\d+)*)",
    re.IGNORECASE,
)
SOFT = [
    (re.compile(r"\bthe previous lemma\b", re.IGNORECASE), "the previous lemma"),
    (re.compile(r"\bas above\b", re.IGNORECASE), "as above"),
]
NAMED = [
    (re.compile(r"\bthe spectral theorem\b", re.IGNORECASE), "the spectral theorem"),
    (re.compile(r"\bRank[-–—]?Nullity\b", re.IGNORECASE), "Rank-Nullity"),
]
NAMED_RESULT_RE = re.compile(r"\b(?:the\s+)?(?P<name>[A-Za-z][A-Za-z–—-]*)\s+(?:theorem|lemma|proposition|corollary)\b", re.IGNORECASE)
GENERIC_NAMES = {"previous", "preceding", "following", "same", "this", "that", "a", "any", "the", "next", "each", "another", "above", "below", "by", "of", "from"}


def _norm_label(kind: str, num: str) -> str:
    return f"{kind[0].upper() + kind[1:].lower()} {num}"


def _line_groups(spans: list[Span]) -> list[tuple[int, str, list[Span]]]:
    groups: dict[tuple[int, int], list[Span]] = {}
    for s in spans:
        groups.setdefault((s.page, s.line), []).append(s)
    out = []
    for (page, _ln), ssp in sorted(groups.items(), key=lambda kv: (kv[0][0], min(x.bbox[1] for x in kv[1]))):
        ssp.sort(key=lambda x: x.bbox[0])
        out.append((page, "".join(x.text for x in ssp), ssp))
    return out


def _bbox_for_match(text: str, start: int, end: int, ssp: list[Span]) -> tuple[float, float, float, float]:
    """Map a substring range onto span bboxes (best-effort)."""
    pos = 0
    used: list[Span] = []
    for s in ssp:
        nxt = pos + len(s.text)
        if nxt > start and pos < end:
            used.append(s)
        pos = nxt
    if not used:
        used = ssp
    return (
        min(s.bbox[0] for s in used),
        min(s.bbox[1] for s in used),
        max(s.bbox[2] for s in used),
        max(s.bbox[3] for s in used),
    )


def find_anchors(spans: list[Span], nodes: list[Node], doc_id, pdf_path: Path | None = None) -> list[Anchor]:
    by_label = {n.label.lower(): n for n in nodes if n.label}

    found: list[Anchor] = []
    seen: set[tuple[int, str, int, int]] = set()

    def add(page: int, surface: str, bbox, explicit: bool) -> None:
        key = (page, surface.lower(), int(bbox[1]), int(bbox[0]))
        if key in seen:
            return
        seen.add(key)
        target = None
        if explicit:
            # surface may be "By Theorem 3.4" or "Theorem 3.4" or with clause
            m = EXPLICIT_RE.search(surface)
            if m:
                label = _norm_label(m.group("kind"), m.group("num"))
                hit = by_label.get(label.lower())
                target = hit.id if hit else None
        found.append(
            Anchor(
                id=uuid4(),
                doc_id=doc_id,
                page=page,
                bbox=bbox,
                surface=surface,
                target_node_id=target,
                target_entity_id=None,
                card_id=None,
            )
        )

    for page, text, ssp in _line_groups(spans):
        for m in BY_EXPLICIT_RE.finditer(text):
            surface = m.group(0)
            # Canonical "By Theorem 3.4" casing
            surface = f"By {_norm_label(m.group('kind'), m.group('num'))}"
            add(page, surface, _bbox_for_match(text, m.start(), m.end(), ssp), True)
        for m in EXPLICIT_RE.finditer(text):
            surface = _norm_label(m.group("kind"), m.group("num"))
            add(page, surface, _bbox_for_match(text, m.start(), m.end(), ssp), True)
        for cre, surface in SOFT + NAMED:
            for m in cre.finditer(text):
                add(page, m.group(0), _bbox_for_match(text, m.start(), m.end(), ssp), False)
    if pdf_path is not None:
        import pymupdf
        # Span boxes cover entire text runs. Use the PDF's character geometry for
        # each matched reference so an underline does not cover the whole line.
        with pymupdf.open(pdf_path) as pdf:
            # Named citations may wrap across lines ("dimension\ntheorem").
            # Keep a separate hit box on each line instead of covering the intervening page.
            for page in pdf:
                page_text = page.get_text()
                for match in NAMED_RESULT_RE.finditer(page_text):
                    if match.group("name").lower() in GENERIC_NAMES or re.match(r"\s*\d", page_text[match.end():]):
                        continue
                    surface = re.sub(r"\s+", " ", match.group(0))
                    for rect in page.search_for(surface):
                        add(page.number + 1, surface, tuple(rect), False)
            for anchor in found:
                candidates = pdf[anchor.page - 1].search_for(anchor.surface)
                inside = [r for r in candidates if r.x0 >= anchor.bbox[0] - 2 and r.y0 >= anchor.bbox[1] - 2
                          and r.x1 <= anchor.bbox[2] + 2 and r.y1 <= anchor.bbox[3] + 2]
                if len(inside) == 1:
                    anchor.bbox = tuple(inside[0])
    return found


def detect_anchors(ctx: PipelineContext, spans: list[Span], nodes: list[Node]) -> list[Anchor]:
    found = find_anchors(spans, nodes, ctx.doc_id, ctx.pdf_path)
    for a in found:
        db.insert_anchor(ctx.conn, a)
    return found
