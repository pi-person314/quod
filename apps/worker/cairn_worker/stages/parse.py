"""Stage 1 — Parse (Phase A1). PyMuPDF spans + paragraph grouping + quality."""

from __future__ import annotations

import logging
from pathlib import Path

import pymupdf as fitz

from cairn_worker.models import Span

log = logging.getLogger(__name__)

# PyMuPDF span flags: bit 1 italic, bit 4 bold.
_FLAG_ITALIC = 1 << 1
_FLAG_BOLD = 1 << 4


def text_layer_span_count(pdf_path: Path) -> tuple[int, int]:
    """Raw PyMuPDF text-span count and page count (the accept baseline)."""
    doc = fitz.open(pdf_path)
    n = 0
    for page in doc:
        for block in page.get_text("dict")["blocks"]:
            if block.get("type") != 0:
                continue
            for line in block["lines"]:
                n += sum(1 for s in line["spans"] if (s.get("text") or "").strip())
    pages = doc.page_count
    doc.close()
    return n, pages


def _is_bold(font: str, flags: int) -> bool:
    fl = font.lower()
    return bool(flags & _FLAG_BOLD) or "bold" in fl or "black" in fl or fl.endswith("-bd")


def _is_italic(font: str, flags: int) -> bool:
    fl = font.lower()
    return bool(flags & _FLAG_ITALIC) or "italic" in fl or "oblique" in fl


def _extract_spans(doc: fitz.Document) -> list[Span]:
    spans: list[Span] = []
    line_global = 0
    for page_i, page in enumerate(doc):
        page_no = page_i + 1
        for bi, block in enumerate(page.get_text("dict")["blocks"]):
            if block.get("type") != 0:
                continue
            for line in block["lines"]:
                for s in line["spans"]:
                    text = s.get("text") or ""
                    if not text.strip():
                        continue
                    x0, y0, x1, y1 = (float(v) for v in s["bbox"])
                    font = s.get("font") or ""
                    flags = int(s.get("flags") or 0)
                    spans.append(
                        Span(
                            text=text,
                            page=page_no,
                            bbox=(x0, y0, x1, y1),
                            font=font,
                            size=float(s.get("size") or 0),
                            bold=_is_bold(font, flags),
                            italic=_is_italic(font, flags),
                            block=bi,
                            line=line_global,
                        )
                    )
                line_global += 1
    return spans


def _group_paragraphs(spans: list[Span]) -> None:
    """Assign para ids by vertical gap and indentation, in place."""
    if not spans:
        return
    by_page: dict[int, list[int]] = {}
    for i, s in enumerate(spans):
        by_page.setdefault(s.page, []).append(i)

    para = 0
    for page, idxs in sorted(by_page.items()):
        idxs.sort(key=lambda i: (spans[i].bbox[1], spans[i].bbox[0]))
        prev: Span | None = None
        page_para_start = para
        for i in idxs:
            s = spans[i]
            if prev is None:
                spans[i].para = para
                prev = s
                continue
            gap = s.bbox[1] - prev.bbox[3]
            thresh = max(prev.size, s.size, 1.0) * 0.85
            indent_jump = abs(s.bbox[0] - prev.bbox[0]) > 12
            new_block = s.block != prev.block
            if gap > thresh or (indent_jump and gap > thresh * 0.4) or (new_block and gap > 2):
                para += 1
            spans[i].para = para
            prev = s
        if idxs:
            para = max(para, page_para_start) + 1


def quality_score(spans: list[Span], page_count: int, raw_chars: int) -> float:
    if page_count <= 0:
        return 0.0
    pages_with = {s.page for s in spans}
    coverage = len(pages_with) / page_count
    empty_pages = page_count - len(pages_with)
    extracted = sum(len(s.text) for s in spans)
    density = 1.0 if raw_chars <= 0 else min(1.0, extracted / raw_chars)
    # Penalize empty pages hard — A1 forbids silent zero-span pages.
    empty_pen = 1.0 if empty_pages == 0 else max(0.0, 1.0 - empty_pages / page_count)
    return max(0.0, min(1.0, 0.55 * coverage + 0.25 * density + 0.20 * empty_pen))


def parse_pdf(pdf_path: Path) -> tuple[list[Span], float, int]:
    """Returns (spans, quality_score in [0, 1], page_count)."""
    path = Path(pdf_path)
    doc = fitz.open(path)
    raw_chars = sum(len(page.get_text()) for page in doc)
    spans = _extract_spans(doc)
    page_count = doc.page_count
    doc.close()
    _group_paragraphs(spans)
    q = quality_score(spans, page_count, raw_chars)
    empty = [p for p in range(1, page_count + 1) if not any(s.page == p for s in spans)]
    log.info(
        "%s: %d spans, %d pages, quality %.3f%s",
        path.name,
        len(spans),
        page_count,
        q,
        f" empty_pages={empty}" if empty else "",
    )
    return spans, q, page_count
