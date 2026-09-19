#!/usr/bin/env python3
"""Find PyMuPDF bboxes for label text on a PDF page. A0 fixture authoring aid."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import fitz


def find_text_bboxes(pdf_path: Path, page_num: int, needle: str) -> list[dict]:
    doc = fitz.open(pdf_path)
    if page_num < 1 or page_num > doc.page_count:
        raise ValueError(f"page {page_num} out of range 1..{doc.page_count}")
    page = doc[page_num - 1]
    hits: list[dict] = []
    needle_lower = needle.lower()
    for block in page.get_text("dict")["blocks"]:
        if block.get("type") != 0:
            continue
        for line in block["lines"]:
            line_text = "".join(s["text"] for s in line["spans"]).strip()
            if needle_lower in line_text.lower():
                xs, ys = [], []
                for s in line["spans"]:
                    x0, y0, x1, y1 = s["bbox"]
                    xs.extend([x0, x1])
                    ys.extend([y0, y1])
                hits.append({"text": line_text, "bbox": [min(xs), min(ys), max(xs), max(ys)]})
    doc.close()
    return hits


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser()
    p.add_argument("pdf")
    p.add_argument("--page", type=int, required=True)
    p.add_argument("--needle", required=True, help="substring to search on the page")
    args = p.parse_args(argv)
    hits = find_text_bboxes(Path(args.pdf), args.page, args.needle)
    print(json.dumps(hits, indent=2))
    return 0 if hits else 1


if __name__ == "__main__":
    sys.exit(main())
