"""Phase A5 — load fixtures/golden/* into Postgres and snapshot the demo corpus.

The loader is the demo fallback path: it skips parsing entirely, so
`USE_FIXTURES=0` can still serve a real corpus out of Postgres.

The snapshot is plain SQL written by us rather than `pg_dump` output, so
`make demo-db` needs no client tooling whose version must match the server.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from uuid import UUID

import psycopg
from pydantic import BaseModel

from cairn_worker import db
from cairn_worker.config import FIXTURES_DIR
from cairn_worker.models import Anchor, Card, Doc, Edge, Entity, Node

log = logging.getLogger(__name__)

GOLDEN_DIR = FIXTURES_DIR / "golden"
DEMO_DUMP = FIXTURES_DIR / "demo.dump"

# Corpora are emitted before the tables that point at them; entities and
# anchors are patched afterwards because they close reference cycles.
_DUMP_TABLES = [
    ("corpora", "id, name"),
    ("documents", "id, corpus_id, title, filename, file_hash, page_count, quality, status, pdf_bytes"),
    ("entities", "id, corpus_id, name"),
    ("nodes", "id, doc_id, kind, label, title, statement_md, clauses, symbols, page, bbox, entity_id, confidence"),
    ("edges", "src, dst, kind, extractor, confidence"),
    ("anchors", "id, doc_id, page, bbox, surface, target_node_id, target_entity_id"),
    ("cards", "id, anchor_id, headline, instantiated_md, full_md, substitutions, clause_ids, gloss, source_doc_id, source_page"),
    ("ingest_progress", "doc_id, stage, nodes_done, total, message"),
]


class GoldenFixture(BaseModel):
    """Envelope of one fixtures/golden/<name>.json. Mirrors GoldenFixture in types.ts."""

    document: Doc
    pdf: str | None = None
    nodes: list[Node] = []
    edges: list[Edge] = []
    anchors: list[Anchor] = []
    cards: list[Card] = []
    entities: list[Entity] = []


def read_golden(golden_dir: Path = GOLDEN_DIR) -> list[GoldenFixture]:
    """Parse every golden file through the Python mirror of the contracts."""
    files = sorted(p for p in golden_dir.glob("*.json"))
    return [GoldenFixture.model_validate_json(p.read_text(encoding="utf-8")) for p in files]


def load_golden(conn: psycopg.Connection, golden_dir: Path = GOLDEN_DIR, corpus_name: str = "golden") -> dict[str, int]:
    """Load every golden fixture into Postgres. Idempotent: re-running replaces the graph."""
    fixtures = read_golden(golden_dir)
    if not fixtures:
        raise FileNotFoundError(f"no fixtures in {golden_dir}")

    counts = {"documents": 0, "nodes": 0, "edges": 0, "anchors": 0, "cards": 0, "entities": 0}

    for corpus_id in {f.document.corpus_id for f in fixtures}:
        db.upsert_corpus(conn, corpus_id, corpus_name)

    # Entities first (nodes.entity_id references them) but without
    # canonical_node_id, which points the other way.
    for fx in fixtures:
        for e in fx.entities:
            db.upsert_entity(conn, e)
            counts["entities"] += 1

    for fx in fixtures:
        db.upsert_document(conn, fx.document)
        if fx.pdf:
            pdf_path = (golden_dir / fx.pdf).resolve()
            if not pdf_path.is_relative_to(golden_dir.resolve()):
                raise ValueError("Fixture PDF must remain inside its fixture directory")
            conn.execute("UPDATE documents SET pdf_bytes=%s WHERE id=%s", (pdf_path.read_bytes(), fx.document.id))
        db.clear_doc_graph(conn, fx.document.id)
        counts["documents"] += 1

    for fx in fixtures:
        for n in fx.nodes:
            db.insert_node(conn, n)
            counts["nodes"] += 1

    for fx in fixtures:
        for e in fx.entities:
            if e.canonical_node_id:
                db.set_entity_canonical(conn, e.id, e.canonical_node_id)

    for fx in fixtures:
        for e in fx.edges:
            db.insert_edge(conn, e)
            counts["edges"] += 1

    # Anchors land with card_id null; cards reference anchors, so the link is
    # written once both rows exist.
    card_links: list[tuple[UUID, UUID]] = []
    for fx in fixtures:
        for a in fx.anchors:
            if a.card_id:
                card_links.append((a.id, a.card_id))
            a = a.model_copy(update={"card_id": None})
            db.insert_anchor(conn, a)
            counts["anchors"] += 1

    for fx in fixtures:
        for c in fx.cards:
            db.insert_card(conn, c)
            counts["cards"] += 1

    known_cards = {c.id for fx in fixtures for c in fx.cards}
    for anchor_id, card_id in card_links:
        if card_id in known_cards:
            db.set_anchor_card(conn, anchor_id, card_id)

    for fx in fixtures:
        db.set_progress(conn, fx.document.id, "done", nodes_done=len(fx.nodes), total=len(fx.nodes))

    return counts


def write_dump(conn: psycopg.Connection, out: Path = DEMO_DUMP) -> int:
    """Snapshot every corpus as re-runnable plain SQL. Returns the statement count."""
    cur = psycopg.ClientCursor(conn)
    lines: list[str] = [
        "-- Cairn demo corpus snapshot (A5). Generated by `cairn-worker dump-demo`.",
        "-- Restore with `make demo-db`; apply packages/contracts/schema.sql first.",
        "BEGIN;",
    ]

    corpus_ids = [r[0] for r in conn.execute("SELECT id FROM corpora ORDER BY created_at, id").fetchall()]
    if not corpus_ids:
        raise RuntimeError("no corpora to dump")
    # Deleting the corpora cascades through documents, nodes, edges, anchors
    # and cards, so the dump is safe to apply on top of an existing database.
    lines.append(cur.mogrify("DELETE FROM corpora WHERE id = ANY(%s);", (corpus_ids,)))

    statements = 1
    for table, cols in _DUMP_TABLES:
        col_list = [c.strip() for c in cols.split(",")]
        rows = conn.execute(f"SELECT {cols} FROM {table}").fetchall()  # noqa: S608 — column list is a literal above
        for row in rows:
            values = [json.dumps(v) if _is_jsonb(table, c) else v for c, v in zip(col_list, row)]
            placeholders = ", ".join("%s::jsonb" if _is_jsonb(table, c) else "%s" for c in col_list)
            lines.append(
                cur.mogrify(
                    f"INSERT INTO {table} ({cols}) VALUES ({placeholders});",  # noqa: S608
                    tuple(values),
                )
            )
            statements += 1

    # Cycle-closing columns, patched once every row exists.
    for entity_id, node_id in conn.execute(
        "SELECT id, canonical_node_id FROM entities WHERE canonical_node_id IS NOT NULL"
    ).fetchall():
        lines.append(cur.mogrify("UPDATE entities SET canonical_node_id = %s WHERE id = %s;", (node_id, entity_id)))
        statements += 1
    for anchor_id, card_id in conn.execute("SELECT id, card_id FROM anchors WHERE card_id IS NOT NULL").fetchall():
        lines.append(cur.mogrify("UPDATE anchors SET card_id = %s WHERE id = %s;", (card_id, anchor_id)))
        statements += 1

    lines.append("COMMIT;")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return statements


def _is_jsonb(table: str, column: str) -> bool:
    return (table, column) in {
        ("nodes", "clauses"),
        ("nodes", "symbols"),
        ("cards", "substitutions"),
        ("cards", "clause_ids"),
    }
