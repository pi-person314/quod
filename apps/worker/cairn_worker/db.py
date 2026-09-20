"""Postgres access. One connection per pipeline run; stages receive it via ctx."""

from __future__ import annotations

import json
from uuid import UUID

import psycopg

from cairn_worker.config import SCHEMA_SQL, settings
from cairn_worker.models import Anchor, Card, Doc, Edge, Entity, IngestStage, Node


def connect() -> psycopg.Connection:
    return psycopg.connect(settings.database_url, autocommit=True)


def apply_schema(conn: psycopg.Connection) -> None:
    """Apply packages/contracts/schema.sql. Idempotent; safe to call every run."""
    conn.execute(SCHEMA_SQL.read_text(encoding="utf-8"))
    for migration in sorted((SCHEMA_SQL.parent / "migrations").glob("*.sql")):
        conn.execute(migration.read_text(encoding="utf-8"))


def set_progress(
    conn: psycopg.Connection,
    doc_id: UUID,
    stage: IngestStage,
    nodes_done: int = 0,
    total: int = 0,
    message: str | None = None,
) -> None:
    """Write the row the SSE route (GET /api/corpus/:id/events) polls. Call at every stage boundary."""
    conn.execute(
        """
        INSERT INTO ingest_progress (doc_id, stage, nodes_done, total, message, updated_at)
        VALUES (%s, %s, %s, %s, %s, now())
        ON CONFLICT (doc_id) DO UPDATE
          SET stage = EXCLUDED.stage, nodes_done = EXCLUDED.nodes_done,
              total = EXCLUDED.total, message = EXCLUDED.message, updated_at = now()
        """,
        (doc_id, stage, nodes_done, total, message),
    )


def insert_node(conn: psycopg.Connection, n: Node) -> None:
    conn.execute(
        """
        INSERT INTO nodes (id, doc_id, kind, label, title, statement_md, clauses, symbols, page, bbox, entity_id, confidence)
        VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb, %s::jsonb, %s, %s, %s, %s)
        ON CONFLICT (id) DO NOTHING
        """,
        (
            n.id,
            n.doc_id,
            n.kind,
            n.label,
            n.title,
            n.statement_md,
            json.dumps([c.model_dump() for c in n.clauses]),
            json.dumps([s.model_dump() for s in n.symbols]),
            n.page,
            list(n.bbox),
            n.entity_id,
            n.confidence,
        ),
    )


def insert_anchor(conn: psycopg.Connection, a: Anchor) -> None:
    conn.execute(
        """
        INSERT INTO anchors (id, doc_id, page, bbox, surface, target_node_id, target_entity_id, card_id)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (id) DO NOTHING
        """,
        (a.id, a.doc_id, a.page, list(a.bbox), a.surface, a.target_node_id, a.target_entity_id, a.card_id),
    )


def insert_edge(conn: psycopg.Connection, e: Edge) -> None:
    conn.execute(
        """
        INSERT INTO edges (src, dst, kind, extractor, confidence)
        VALUES (%s, %s, %s, %s, %s)
        ON CONFLICT (src, dst, kind) DO NOTHING
        """,
        (e.src, e.dst, e.kind, e.extractor, e.confidence),
    )


def clear_doc_graph(conn: psycopg.Connection, doc_id: UUID) -> None:
    """Drop everything A produced for one document. Edges, anchors and cards cascade."""
    conn.execute("DELETE FROM nodes WHERE doc_id = %s", (doc_id,))
    conn.execute("DELETE FROM anchors WHERE doc_id = %s", (doc_id,))


def doc_status(conn: psycopg.Connection, doc_id: UUID) -> str | None:
    row = conn.execute("SELECT status FROM documents WHERE id = %s", (doc_id,)).fetchone()
    return row[0] if row else None


# ---- Fixture loading (A5 --fixtures) --------------------------------------


def upsert_corpus(conn: psycopg.Connection, corpus_id: UUID, name: str) -> None:
    conn.execute(
        "INSERT INTO corpora (id, name) VALUES (%s, %s) ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name",
        (corpus_id, name),
    )


def upsert_document(conn: psycopg.Connection, d: Doc) -> None:
    conn.execute(
        """
        INSERT INTO documents (id, corpus_id, title, filename, file_hash, page_count, quality, status)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (id) DO UPDATE
          SET title = EXCLUDED.title, filename = EXCLUDED.filename, file_hash = EXCLUDED.file_hash,
              page_count = EXCLUDED.page_count, quality = EXCLUDED.quality, status = EXCLUDED.status
        """,
        (d.id, d.corpus_id, d.title, d.filename, d.file_hash, d.page_count, d.quality, d.status),
    )


def upsert_entity(conn: psycopg.Connection, e: Entity, *, with_canonical: bool = False) -> None:
    """Insert without canonical_node_id first; nodes do not exist yet on a cold load."""
    conn.execute(
        """
        INSERT INTO entities (id, corpus_id, canonical_node_id, name)
        VALUES (%s, %s, %s, %s)
        ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name
        """,
        (e.id, e.corpus_id, e.canonical_node_id if with_canonical else None, e.name),
    )


def set_entity_canonical(conn: psycopg.Connection, entity_id: UUID, node_id: UUID | None) -> None:
    conn.execute("UPDATE entities SET canonical_node_id = %s WHERE id = %s", (node_id, entity_id))


def insert_card(conn: psycopg.Connection, c: Card) -> None:
    conn.execute(
        """
        INSERT INTO cards (id, anchor_id, headline, instantiated_md, full_md, substitutions,
                           clause_ids, gloss, source_doc_id, source_page)
        VALUES (%s, %s, %s, %s, %s, %s::jsonb, %s::jsonb, %s, %s, %s)
        ON CONFLICT (id) DO NOTHING
        """,
        (
            c.id,
            c.anchor_id,
            c.headline,
            c.instantiated_md,
            c.full_md,
            json.dumps([s.model_dump(by_alias=True) for s in c.substitutions]),
            json.dumps(c.clause_ids),
            c.gloss,
            c.source.doc_id,
            c.source.page,
        ),
    )


def set_anchor_card(conn: psycopg.Connection, anchor_id: UUID, card_id: UUID) -> None:
    conn.execute("UPDATE anchors SET card_id = %s WHERE id = %s", (card_id, anchor_id))
