from contextlib import contextmanager
from threading import Lock, get_ident
from time import sleep
from types import SimpleNamespace

from quod_worker import batches


def test_parallel_batches_use_separate_connections_and_ordered_results(monkeypatch):
    guard = Lock()
    active = peak = 0
    connections = []
    notifications = []
    caller = get_ident()

    @contextmanager
    def connection():
        nonlocal active, peak
        conn = object()
        with guard:
            connections.append(conn)
            active += 1
            peak = max(peak, active)
        try:
            yield conn
        finally:
            with guard:
                active -= 1

    def progress(conn, doc, stage, *, message):
        assert get_ident() == caller
        notifications.append(message)

    def run(conn, chunk, off):
        assert conn in connections
        sleep(0.04 if off == 0 else 0.01)
        return [value * 2 for value in chunk]

    monkeypatch.setattr(batches.db, "connect", connection)
    monkeypatch.setattr(batches.db, "set_progress", progress)
    result = batches.run_batches(SimpleNamespace(conn=object(), doc_id="doc"), list(range(12)), 2, "segment", "Analyzing", run)
    assert peak == 3 and active == 0
    assert len(set(connections)) == 6
    assert result == [(off, [off * 2, (off + 1) * 2]) for off in range(0, 12, 2)]
    assert notifications == [f"Analyzing: {done} / 12" for done in range(0, 13, 2)]
