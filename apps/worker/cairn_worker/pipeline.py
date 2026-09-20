"""Orchestrates the five stages for one document and reports progress.

Everything expensive happens here, at ingest. The reader is a cache lookup.
"""

from __future__ import annotations

import hashlib
import logging
from dataclasses import dataclass
from pathlib import Path
from uuid import UUID, uuid4

import psycopg

from cairn_worker import db
from cairn_worker.config import settings

log = logging.getLogger(__name__)


@dataclass
class PipelineContext:
    conn: psycopg.Connection
    corpus_id: UUID
    doc_id: UUID
    pdf_path: Path


def ensure_corpus(conn: psycopg.Connection, corpus_id: UUID | None, name: str) -> UUID:
    if corpus_id is None:
        # Reuse the corpus of the same name, otherwise re-ingesting a file
        # lands in a fresh corpus and the file-hash key never matches (A5).
        row = conn.execute("SELECT id FROM corpora WHERE name = %s ORDER BY created_at LIMIT 1", (name,)).fetchone()
        corpus_id = row[0] if row else uuid4()
    conn.execute(
        "INSERT INTO corpora (id, name) VALUES (%s, %s) ON CONFLICT (id) DO NOTHING",
        (corpus_id, name),
    )
    return corpus_id


def register_document(conn: psycopg.Connection, corpus_id: UUID, pdf_path: Path) -> UUID:
    """Insert the documents row (or reuse it — idempotent on file hash, A5)."""
    file_hash = hashlib.sha256(pdf_path.read_bytes()).hexdigest()
    row = conn.execute(
        "SELECT id FROM documents WHERE corpus_id = %s AND file_hash = %s", (corpus_id, file_hash)
    ).fetchone()
    if row:
        return row[0]
    doc_id = uuid4()
    conn.execute(
        """INSERT INTO documents (id, corpus_id, title, filename, file_hash, pdf_bytes, status)
           VALUES (%s, %s, %s, %s, %s, %s, 'queued')""",
        (doc_id, corpus_id, pdf_path.stem, pdf_path.name, file_hash, pdf_path.read_bytes()),
    )
    return doc_id


def run_document(ctx: PipelineContext, force: bool = False) -> None:
    # Resolution reads the complete corpus. Another upload must not mutate that
    # snapshot while its paid adjudication is running. Different corpora proceed
    # independently; session locks release automatically if a worker crashes.
    key = f"cairn:ingest:{ctx.corpus_id}"
    if not force and db.doc_status(ctx.conn, ctx.doc_id) == "ready":
        return
    db.set_progress(ctx.conn, ctx.doc_id, "queued", message="Waiting for other documents in this corpus.")
    ctx.conn.execute("SELECT pg_advisory_lock(hashtextextended(%s,0))", (key,))
    try:
        _run_document(ctx, force)
    finally:
        ctx.conn.execute("SELECT pg_advisory_unlock(hashtextextended(%s,0))", (key,))


def _run_document(ctx: PipelineContext, force: bool = False) -> None:
    """Parse -> segment -> anchors -> edges -> resolve (C) -> bake (C).

    Re-ingesting the same file is a no-op once the document is ready; pass
    ``force`` to rebuild its graph in place (A5 idempotency).
    """
    # Imported here so stage modules can import PipelineContext without a cycle.
    from cairn_worker.stages import anchors, edges, parse, remote, segment

    conn, doc_id = ctx.conn, ctx.doc_id
    if not force and db.doc_status(conn, doc_id) == "ready":
        log.info("%s already ingested; skipping (use --force to rebuild)", ctx.pdf_path.name)
        return
    # A second pass must replace the old graph, not stack a new one beside it.
    try:
        db.clear_doc_graph(conn, doc_id)
        db.set_progress(conn, doc_id, "parse")
        spans, quality, page_count = parse.parse_pdf(ctx.pdf_path)
        conn.execute(
            "UPDATE documents SET quality = %s, page_count = %s, status = %s WHERE id = %s",
            (quality, page_count, "ingesting" if quality >= settings.min_parse_quality else "unsupported", doc_id),
        )
        if quality < settings.min_parse_quality:
            db.set_progress(conn, doc_id, "error", message=f"parse quality {quality:.2f} < {settings.min_parse_quality}")
            return

        db.set_progress(conn, doc_id, "segment")
        nodes = segment.segment(ctx, spans)

        db.set_progress(conn, doc_id, "anchors", nodes_done=len(nodes), total=len(nodes))
        found = anchors.detect_anchors(ctx, spans, nodes)

        db.set_progress(conn, doc_id, "edges", nodes_done=len(nodes), total=len(nodes))
        edges.extract_edges(ctx, nodes, found)

        db.set_progress(conn, doc_id, "resolve", nodes_done=len(nodes), total=len(nodes))
        remote.resolve(ctx.corpus_id, [n.id for n in nodes])

        db.set_progress(conn, doc_id, "bake", nodes_done=len(nodes), total=len(nodes))
        remote.bake(doc_id)
        # A later upload can resolve references in an earlier document. Prepare
        # those newly linked cards too, while the corpus lock still protects us.
        pending = conn.execute("""SELECT DISTINCT a.doc_id FROM anchors a
            JOIN documents d ON d.id=a.doc_id
            WHERE d.corpus_id=%s AND d.status='ready' AND a.doc_id<>%s
              AND a.card_id IS NULL AND (a.target_node_id IS NOT NULL OR a.target_entity_id IS NOT NULL)""",
            (ctx.corpus_id, doc_id)).fetchall()
        for (other_doc_id,) in pending:
            remote.bake(other_doc_id)

        conn.execute("UPDATE documents SET status = 'ready' WHERE id = %s", (doc_id,))
        db.set_progress(conn, doc_id, "done", nodes_done=len(nodes), total=len(nodes))
    except NotImplementedError as e:
        log.error("stage %s not implemented yet", e)
        db.set_progress(conn, doc_id, "error", message=f"stage {e} not implemented")
        raise
    except Exception as e:  # noqa: BLE001 — surface everything to the ingest screen
        log.exception("ingest failed for %s", doc_id)
        conn.execute("UPDATE documents SET status = 'error' WHERE id = %s", (doc_id,))
        db.set_progress(conn, doc_id, "error", message=str(e)[:500])
        raise
