from contextlib import nullcontext
from types import SimpleNamespace
from uuid import uuid4

import httpx
import pytest
from quod_worker import llm
from quod_worker.models import Node
from quod_worker.stages import remote
from quod_worker.stages.edges import extract_edges_offline

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
    from quod_worker.models import Span
    from quod_worker.stages.segment import nodes_from_spans
    spans = [Span(text="Theorem 91.1. A documented mathematical statement.", page=1,
                  bbox=[20, 30.125, 400, 50.875], font="Times", size=12,
                  bold=False, italic=False, block=0, line=0)]
    first = nodes_from_spans(spans, DOC)
    assert len(first) == 1
    assert [node.id for node in first] == [node.id for node in nodes_from_spans(spans, DOC)]
    assert first[0].id != nodes_from_spans(spans, uuid4())[0].id


def test_live_segmentation_failure_is_not_silent_success(monkeypatch):
    from cairn_worker.stages import segment
    monkeypatch.setenv("CAIRN_INTELLIGENCE_MODE", "live")
    def unavailable(*args, **kwargs):
        raise RuntimeError("Live API calls are disabled")
    monkeypatch.setattr(segment, "call_model", unavailable)
    monkeypatch.setattr(segment.db, "set_progress", lambda *a, **kw: None)
    monkeypatch.setattr(segment.db, "connect", lambda: nullcontext(None))
    ctx = SimpleNamespace(conn=None, doc_id=DOC, corpus_id=uuid4())
    with pytest.raises(RuntimeError, match="Model segmentation failed.*disabled"):
        segment._luna_enrich(ctx, [{"kind": "theorem", "statement": "A result."}])


def test_deterministic_segmentation_never_attempts_a_paid_call(monkeypatch):
    from cairn_worker.stages import segment
    monkeypatch.setenv("CAIRN_INTELLIGENCE_MODE", "deterministic")
    monkeypatch.setattr(segment, "call_model", lambda *a, **kw: pytest.fail("unexpected paid call"))
    segment._luna_enrich(SimpleNamespace(doc_id=DOC), [{"kind": "theorem", "statement": "A result."}])


def test_empty_segmentation_cannot_report_ready():
    from cairn_worker.stages.segment import segment
    with pytest.raises(ValueError, match="No supported mathematical environments"):
        segment(SimpleNamespace(doc_id=DOC), [])


def test_live_edge_failure_is_not_silent_success(monkeypatch):
    from cairn_worker.stages import edges
    def unavailable(*args, **kwargs):
        raise RuntimeError("provider unavailable")
    monkeypatch.setattr(edges, "call_model", unavailable)
    monkeypatch.setattr(edges.db, "set_progress", lambda *a, **kw: None)
    monkeypatch.setattr(edges.db, "connect", lambda: nullcontext(None))
    ctx = SimpleNamespace(conn=None, doc_id=DOC, corpus_id=uuid4())
    with pytest.raises(RuntimeError, match="Model relation extraction failed.*provider unavailable"):
        source = node("Theorem 1", "By the earlier result.")
        anchor = SimpleNamespace(surface="earlier result", doc_id=DOC, page=1, bbox=[1, 1, 10, 10])
        edges._llm_named(ctx, [source], [anchor], [], set())


def test_worker_callbacks_need_no_extra_credentials(monkeypatch):
    from cairn_worker.stages import remote
    import httpx

    calls = []
    def post(url, **kwargs):
        calls.append(kwargs)
        return httpx.Response(200, json={"decisions": []}, request=httpx.Request("POST", url))
    monkeypatch.setattr(remote.httpx, "post", post)
    assert remote._post("/api/intel/resolve", {"corpus_id": "test"}) == {"decisions": []}
    assert "headers" not in calls[0]


def test_worker_surfaces_resolution_error(monkeypatch):
    from cairn_worker.stages import remote
    import httpx
    import pytest

    def post(url, **kwargs):
        return httpx.Response(503, json={"error": "Resolution could not index statements."}, request=httpx.Request("POST", url))
    monkeypatch.setattr(remote.httpx, "post", post)
    with pytest.raises(RuntimeError, match="Resolution could not index statements"):
        remote._post("/api/intel/resolve", {})
