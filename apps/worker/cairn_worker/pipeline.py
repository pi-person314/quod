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
        corpus_id = uuid4()
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
        """INSERT INTO documents (id, corpus_id, title, filename, file_hash, status)
           VALUES (%s, %s, %s, %s, %s, 'queued')""",
        (doc_id, corpus_id, pdf_path.stem, pdf_path.name, file_hash),
    )
    return doc_id


def run_document(ctx: PipelineContext) -> None:
    """Parse -> segment -> anchors -> edges -> resolve (C) -> bake (C)."""
    # Imported here so stage modules can import PipelineContext without a cycle.
    from cairn_worker.stages import anchors, edges, parse, remote, segment

    conn, doc_id = ctx.conn, ctx.doc_id
    try:
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
