from uuid import uuid4

from quod_worker.models import Node, Span
from quod_worker.stages.edges import extract_edges_offline
from quod_worker.stages.segment import nodes_from_spans

DOC = uuid4()


def node(label, text, kind="theorem", title=None, page=1, doc=DOC):
    return Node(id=uuid4(), doc_id=doc, kind=kind, label=label, title=title,
                statement_md=text, clauses=[], symbols=[], page=page,
                bbox=[10, 10, 500, 50], entity_id=None, confidence=1)


def pairs(nodes):
    return {(e.src, e.dst, e.kind) for e in extract_edges_offline(nodes, [])}


def test_distinctive_defined_operator_is_used_without_symbol_enrichment():
    definition = node("Definition 82.1", r"Definition 82.1. $\operatorname{ann} M = \{r : rM=0\}$.", "definition")
    theorem = node("Theorem 83.9", r"Theorem 83.9. The ideal $\operatorname{ann} N$ annihilates $N$.", page=2)
    assert pairs([definition, theorem]) == {(theorem.id, definition.id, "depends_on")}


def test_shared_variable_and_future_definition_are_not_dependencies():
    theorem = node("Theorem 12", "Theorem 12. A property of T.")
    definition = node("Definition 14", r"Definition 14. $T = U$.", "definition", page=2)
    assert pairs([theorem, definition]) == set()


def test_operator_redefinition_shadows_the_earlier_definition():
    first = node("Definition 1", r"Definition 1. $\ker T = \{x:Tx=0\}$.", "definition")
    second = node("Definition 2", r"Definition 2. $\ker S = \{y:Sy=0\}$.", "definition", page=2)
    theorem = node("Theorem 3", r"Theorem 3. Use $\ker R$.", page=3)
    edges = pairs([first, second, theorem])
    assert (theorem.id, second.id, "depends_on") in edges
    assert not any(src == theorem.id and dst == first.id for src, dst, _ in edges)


def test_generic_named_theorem_and_ambiguous_title():
    compact = node("Theorem 4", "Every open cover has a finite subcover.", title="Compact Cover")
    application = node("Lemma 9", "By the compact-cover theorem, a finite subcover exists.", "lemma", page=2)
    assert pairs([compact, application]) == {(application.id, compact.id, "depends_on")}
    duplicate = node("Theorem 6", "Another scoped version.", title="Compact Cover")
    assert pairs([compact, duplicate, application]) == set()


def test_generic_word_is_not_a_named_theorem_reference():
    dimension = node("Theorem 4", "A statement.", title="Dimension Theorem")
    other = node("Theorem 5", "Isomorphisms preserve dimension.", page=2)
    assert pairs([dimension, other]) == set()


def test_restatement_language_is_not_an_ordinary_dependency():
    first = node("Theorem 52", "A result.")
    second = node("Proposition 81", "Proposition 81. This restates Theorem 52.", "proposition", page=2)
    assert pairs([first, second]) == {(second.id, first.id, "restates")}


def test_labels_do_not_cross_document_boundaries():
    first = node("Theorem 1", "A result.")
    other = node("Theorem 1", "A different result.", doc=uuid4())
    use = node("Lemma 2", "By Theorem 1, the conclusion follows.", "lemma", page=2)
    assert pairs([first, other, use]) == {(use.id, first.id, "depends_on")}


def test_remark_references_are_not_attached_to_the_preceding_theorem():
    lines = ["Theorem 91. A standalone result.", "Remark. See Theorem 82 for a different subject.", "Theorem 92. Another result."]
    spans = [Span(text=text, page=1, bbox=[10, 10+i*20, 500, 25+i*20], font="Times", size=12,
                  bold=False, italic=False, block=0, line=i) for i, text in enumerate(lines)]
    nodes = nodes_from_spans(spans, DOC)
    assert len(nodes) == 2
    assert "Remark" not in nodes[0].statement_md
    assert "Theorem 82" not in nodes[0].statement_md


def test_explicitly_defined_term_supports_literal_uses_not_compound_names():
    definition = node("Definition 7", "Definition 7. The degree of $P$ is its highest exponent.", "definition")
    use = node("Theorem 8", "The degree of a product adds.", page=2)
    unrelated = node("Theorem 9", "The degree-bound theorem applies.", page=3)
    assert pairs([definition, use, unrelated]) == {(use.id, definition.id, "depends_on")}


def test_problem_sets_segment_and_page_boxes_do_not_include_other_pages():
    spans = [Span(text="Problem 1. Establish a bound.", page=1, bbox=[10, 600, 500, 620], font="Times", size=12,
                  bold=False, italic=False, block=0, line=0),
             Span(text="Continue the calculation.", page=2, bbox=[10, 20, 500, 40], font="Times", size=12,
                  bold=False, italic=False, block=0, line=1)]
    [problem] = nodes_from_spans(spans, DOC)
    assert problem.kind == "example" and problem.label == "Problem 1"
    assert problem.bbox == (10, 600, 500, 620)
    assert "Continue the calculation" in problem.statement_md


def test_pdf_anchor_uses_reference_geometry_instead_of_entire_line(tmp_path):
    import pymupdf
    from quod_worker.stages.parse import parse_pdf
    from quod_worker.stages.anchors import find_anchors
    path = tmp_path / "geometry.pdf"
    with pymupdf.open() as pdf:
        page = pdf.new_page()
        page.insert_text((50, 60), "Theorem 72. A result.")
        page.insert_text((50, 100), "Lemma 83. By Theorem 72, the conclusion follows.")
        expected = page.search_for("Theorem 72")[1]
        pdf.save(path)
    spans, _, _ = parse_pdf(path)
    nodes = nodes_from_spans(spans, DOC)
    anchors = find_anchors(spans, nodes, DOC, path)
    anchor = next(a for a in anchors if a.surface == "Theorem 72" and a.bbox[1] > 70)
    assert max(abs(a-b) for a,b in zip(anchor.bbox, expected)) < .01
    assert anchor.bbox[0] > 50
