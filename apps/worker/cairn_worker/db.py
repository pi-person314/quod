"""Postgres access. One connection per pipeline run; stages receive it via ctx."""

from __future__ import annotations

from uuid import UUID

import psycopg

from cairn_worker.config import SCHEMA_SQL, settings
from cairn_worker.models import IngestStage


def connect() -> psycopg.Connection:
    return psycopg.connect(settings.database_url, autocommit=True)


def apply_schema(conn: psycopg.Connection) -> None:
    """Apply packages/contracts/schema.sql. Idempotent; safe to call every run."""
    conn.execute(SCHEMA_SQL.read_text(encoding="utf-8"))


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
