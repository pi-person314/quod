"""Stage 3 — Anchor detection (Phase A3, 75 min).

Scan all text for reference surfaces: explicit ("Theorem 3.4", "Lemma 2.1(ii)"),
soft ("the previous lemma", "as above"), and named ("the spectral theorem").
Record each with its bbox so Session B can decorate it. Resolve explicit ones
locally by label match against this document's nodes; leave soft and named
ones with target_node_id=None for Session C's resolver.

Accept: every anchor in the golden fixture is found, bboxes round-trip through
the reader's coordinate transform within 2px, and explicit resolution accuracy
exceeds 0.95.
"""

from __future__ import annotations

from cairn_worker.models import Anchor, Node, Span
from cairn_worker.pipeline import PipelineContext


def detect_anchors(ctx: PipelineContext, spans: list[Span], nodes: list[Node]) -> list[Anchor]:
    raise NotImplementedError("A3")
