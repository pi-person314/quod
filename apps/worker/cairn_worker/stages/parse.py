"""Stage 1 — Parse (Phase A1, 90 min).

PyMuPDF extraction into Span records: text, page, bbox, font, size, bold,
italic, block, line. Group spans into paragraphs by vertical gap and
indentation. Emit parsed/<doc_id>.jsonl. Font size and weight changes are the
cheapest reliable signal for where a theorem environment starts and ends.

Accept: on three test PDFs, span count is within 2% of the PDF's own text layer
and no page returns zero spans. Log a per-document quality score; anything
under settings.min_parse_quality is flagged "unsupported" in the UI rather than
silently producing garbage.

Fallback: if a book fails, drop it from the demo set rather than fixing the parser.
"""

from __future__ import annotations

from pathlib import Path

from cairn_worker.models import Span


def parse_pdf(pdf_path: Path) -> tuple[list[Span], float, int]:
    """Returns (spans, quality_score in [0, 1], page_count)."""
    raise NotImplementedError("A1")
