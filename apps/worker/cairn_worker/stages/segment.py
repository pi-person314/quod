"""Stage 2 — Segment (Phase A2, 2h).

Regex pass first: numbered environment headers (Theorem 3.4., Definition 2.1),
"Proof." markers, QED terminators. Gets ~80% of nodes for free. Then Luna over
each candidate block, batched 20 at a time via cairn_worker.llm.call_model,
returning kind, title, clause decomposition and the symbols the node
introduces. Keep the chapter context byte-stable with one prompt_cache_key
per chapter so cached input hits. Write nodes to Postgres and call
db.set_progress with a nodes_done count as they land.

Accept: on the golden chapter, precision and recall against
fixtures/golden/analysis-ch3.json both exceed 0.85. Print a confusion table by
kind. This is the number that gates everything downstream.
"""

from __future__ import annotations

from cairn_worker.models import Node, Span
from cairn_worker.pipeline import PipelineContext


def segment(ctx: PipelineContext, spans: list[Span]) -> list[Node]:
    raise NotImplementedError("A2")
