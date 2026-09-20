from types import SimpleNamespace
from uuid import uuid4

import httpx
import pytest
from cairn_worker import llm
from cairn_worker.models import Node
from cairn_worker.stages import remote
from cairn_worker.stages.edges import extract_edges_offline

def node(label, statement, page=1, kind="theorem"):
    return Node(id=uuid4(), doc_id=DOC, kind=kind, label=label, title=None,
                statement_md=statement, clauses=[], symbols=[], page=page,
                bbox=[0, 0, 100, 100], entity_id=None, confidence=1)

DOC = uuid4()

def test_fixture_labels_do_not_create_unsupported_edges():
    nodes = [node("Definition 3.1", "An unrelated definition.", kind="definition"),
             node("Theorem 3.14", "Every prime greater than two is odd.", page=2),
             node("Lemma 3.15", "A statement with no reference.", page=3)]
    assert extract_edges_offline(nodes, []) == []

def test_explicit_reference_generalizes_beyond_golden_labels():
    a = node("Theorem 98.17", "A result.")
    b = node("Lemma 99.2", "Lemma 99.2 follows by Theorem 98.17.", page=2)
    edges = extract_edges_offline([a, b], [])
    assert [(e.src, e.dst, e.extractor) for e in edges] == [(b.id, a.id, "deterministic")]

def test_unavailable_intelligence_cannot_report_success(monkeypatch):
    def unavailable(*args, **kwargs):
        raise httpx.ConnectError("offline")
    monkeypatch.setattr(remote.httpx, "post", unavailable)
    with pytest.raises(httpx.ConnectError):
        remote.resolve(uuid4(), [uuid4()])

def test_paid_calls_require_explicit_opt_in(monkeypatch):
    monkeypatch.delenv("CAIRN_LIVE_API", raising=False)
    monkeypatch.setattr(llm, "_openai", lambda: pytest.fail("provider must not be constructed"))
    with pytest.raises(RuntimeError, match="disabled"):
        llm.call_model(None, stage="eval", input="hello")

def test_missing_usage_and_unknown_prices_are_not_free():
    with pytest.raises(ValueError, match="Missing usage"):
        llm.to_ledger_usage(SimpleNamespace(usage=None))
    with pytest.raises(ValueError, match="pricing"):
        llm.estimate_cost_usd("unknown", llm.LedgerUsage(1, 1))


def test_node_ids_survive_reingest_but_remain_document_scoped():
    from cairn_worker.models import Span
    from cairn_worker.stages.segment import nodes_from_spans
    spans = [Span(text="Theorem 91.1. A documented mathematical statement.", page=1,
                  bbox=[20, 30.125, 400, 50.875], font="Times", size=12,
                  bold=False, italic=False, block=0, line=0)]
    first = nodes_from_spans(spans, DOC)
    assert len(first) == 1
    assert [node.id for node in first] == [node.id for node in nodes_from_spans(spans, DOC)]
    assert first[0].id != nodes_from_spans(spans, uuid4())[0].id
