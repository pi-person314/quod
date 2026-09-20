"""Exercise A -> C route handlers -> Postgres without a listening web server.

The HTTP transport is replaced by an in-process TypeScript route harness.
No model calls; a random corpus is deleted after verification.
"""
import json
import os
import subprocess
from uuid import uuid4
from cairn_worker import db
from cairn_worker.config import REPO_ROOT
from cairn_worker.pipeline import PipelineContext, ensure_corpus, register_document, run_document
from cairn_worker.stages import remote

corpus_id = uuid4()
environment = {**os.environ, "USE_FIXTURES": "0", "CAIRN_INTELLIGENCE_MODE": "deterministic", "CAIRN_LIVE_API": "0",
               "DATABASE_URL": os.environ.get("DATABASE_URL", "postgresql://cairn:cairn@localhost:5432/cairn")}
os.environ["CAIRN_LIVE_API"] = "0"
def route(path, body):
    result = subprocess.run(["node", "--import", "tsx", "scripts/worker-intel-check.ts"],
        cwd=REPO_ROOT / "apps/web", env=environment, input=json.dumps({"path": path, "body": body}),
        text=True, capture_output=True, timeout=60)
    if result.returncode:
        raise RuntimeError(result.stderr)
    return json.loads(result.stdout)

with db.connect() as conn:
    db.apply_schema(conn)
    ensure_corpus(conn, corpus_id, "Isolated A-B-C integration check")
    original_post = remote._post
    try:
        remote._post = route
        pdf = REPO_ROOT / "fixtures/golden/analysis-ch3.pdf"
        doc_id = register_document(conn, corpus_id, pdf)
        context = PipelineContext(conn, corpus_id, doc_id, pdf)
        run_document(context)
        assert conn.execute("SELECT status,pdf_bytes IS NOT NULL FROM documents WHERE id=%s", (doc_id,)).fetchone() == ("ready", True)
        assert conn.execute("SELECT stage FROM ingest_progress WHERE doc_id=%s", (doc_id,)).fetchone()[0] == "done"
        count = conn.execute("SELECT count(*) FROM nodes WHERE doc_id=%s", (doc_id,)).fetchone()[0]
        assert count == 20
        assert conn.execute("SELECT count(*) FROM cards c JOIN anchors a ON a.id=c.anchor_id WHERE a.doc_id=%s", (doc_id,)).fetchone()[0] > 0
        assert register_document(conn, corpus_id, pdf) == doc_id
        run_document(context)
        assert conn.execute("SELECT count(*) FROM nodes WHERE doc_id=%s", (doc_id,)).fetchone()[0] == count
        def fail(*args):
            raise RuntimeError("Injected C outage")
        remote._post = fail
        try:
            run_document(context, force=True)
            raise AssertionError("Outage was swallowed")
        except RuntimeError as error:
            assert "Injected C outage" in str(error)
        assert conn.execute("SELECT status FROM documents WHERE id=%s", (doc_id,)).fetchone()[0] == "error"
        remote._post = route
        run_document(context)
        assert conn.execute("SELECT status FROM documents WHERE id=%s", (doc_id,)).fetchone()[0] == "ready"
        assert conn.execute("SELECT count(*) FROM llm_calls WHERE corpus_id=%s OR doc_id=%s", (corpus_id, doc_id)).fetchone()[0] == 0
        print("PASS: real parsing, 20 nodes, C route resolution/baking, PDF storage, idempotent reingest, outage propagation, recovery; zero paid calls. HTTP/browser transport not exercised.")
    finally:
        remote._post = original_post
        conn.execute("DELETE FROM corpora WHERE id=%s", (corpus_id,))
