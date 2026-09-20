from uuid import uuid4

from cairn_worker.stages.parse import _extract_spans
from cairn_worker.stages.segment import nodes_from_spans


class Page:
    def get_text(self, mode):
        def span(text, bold=False):
            return dict(text=text, font="Times", flags=16 if bold else 0,
                        size=12, bbox=[10, 20, 300, 40])
        return {"blocks": [{"type": 0, "lines": [
            {"spans": [span("Theorem", True), span(" "), span("2.4. A result.", True)]},
            {"spans": [span("Proposition 1.5, applied to this map, gives the conclusion.")]},
            {"spans": [span("Theorem 2.3(ii) supplies a basis.")]},
            {"spans": [span("Problem 5. Apply the result.")]},
        ]}]}


def test_separate_whitespace_runs_preserve_words_and_reference_lines_are_not_headings():
    spans = _extract_spans([Page()])
    assert spans[0].text == "Theorem "
    assert len(spans) == 5
    nodes = nodes_from_spans(spans, uuid4())
    assert [node.label for node in nodes] == ["Theorem 2.4", "Problem 5"]
    assert "Proposition 1.5" in nodes[0].statement_md
    assert "Theorem 2.3(ii)" in nodes[0].statement_md


def test_named_reference_wraps_across_lines_with_separate_hit_boxes(tmp_path):
    import pymupdf
    from cairn_worker.stages.parse import parse_pdf
    from cairn_worker.stages.anchors import find_anchors
    path = tmp_path / "wrapped-name.pdf"
    with pymupdf.open() as pdf:
        page = pdf.new_page()
        page.insert_text((40, 60), "Problem 1. Use the dimension", fontsize=12)
        page.insert_text((40, 77), "theorem to calculate the kernel.", fontsize=12)
        pdf.save(path)
    spans, _, _ = parse_pdf(path)
    doc = uuid4()
    anchors = find_anchors(spans, nodes_from_spans(spans, doc), doc, path)
    hits = [anchor for anchor in anchors if anchor.surface == "the dimension theorem"]
    assert len(hits) == 2
    assert all(a.bbox[3] - a.bbox[1] < 20 for a in hits)
