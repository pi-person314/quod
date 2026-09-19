"""Stage 4 — Edge extraction (Phase A4, 90 min).

Four extractors in cost order; only spans no earlier extractor claimed reach
the next one:
  1. deterministic — from resolved anchors (explicit "Theorem 3.4" refs)
  2. heuristic     — soft anchors plus proximity ("the previous lemma")
  3. notation      — symbols introduced in node X used in node Y
  4. llm           — named results ("the spectral theorem"), Luna
Tag every edge with its extractor so the Token Company write-up can quantify
what each layer saved.

Accept: graph is acyclic after removing `restates` edges; every theorem in the
golden chapter has at least one inbound or outbound edge; edge F1 against the
fixture exceeds 0.75.
"""

from __future__ import annotations

from cairn_worker.models import Anchor, Edge, Node
from cairn_worker.pipeline import PipelineContext


def extract_edges(ctx: PipelineContext, nodes: list[Node], anchors: list[Anchor]) -> list[Edge]:
    raise NotImplementedError("A4")
