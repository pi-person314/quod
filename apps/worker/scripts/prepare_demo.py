"""Build and verify the four-document demo snapshot in disposable databases.

Uses process DATABASE_URL only; never snapshots an existing user's corpus.
"""
from pathlib import Path
from time import perf_counter
from uuid import uuid4

import psycopg
from psycopg import sql
from psycopg.conninfo import conninfo_to_dict, make_conninfo
from quod_worker import db
from quod_worker.config import REPO_ROOT, settings
from quod_worker.fixtures import load_golden, write_dump

def main():
    options = conninfo_to_dict(settings.database_url)
    names = [f"cairn_demo_{uuid4().hex}" for _ in range(2)]
    created = []
    with psycopg.connect(settings.database_url, autocommit=True) as admin:
        try:
            for name in names:
                admin.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(name)))
                created.append(name)
            def connection(name):
                return psycopg.connect(make_conninfo(**{**options, "dbname": name}), autocommit=True)
            out = REPO_ROOT / "fixtures/demo.dump"
            with connection(names[0]) as conn:
                db.apply_schema(conn)
                counts = load_golden(conn, REPO_ROOT / "apps/web/demo", "Linear algebra demonstration")
                assert counts["documents"] == 4
                write_dump(conn, out)
            started = perf_counter()
            with connection(names[1]) as conn:
                db.apply_schema(conn)
                conn.execute(out.read_text(encoding="utf-8"))
                count, readable = conn.execute("SELECT count(*),count(pdf_bytes) FROM documents WHERE status='ready'").fetchone()
                assert count == readable == 4
                assert conn.execute("SELECT count(*) FROM cards c JOIN anchors a ON a.card_id=c.id").fetchone()[0] >= 50
                conn.execute(out.read_text(encoding="utf-8"))
                assert conn.execute("SELECT count(*) FROM documents").fetchone()[0] == 4
            elapsed = perf_counter() - started
            assert elapsed < 30, f"Restore exceeded 30s: {elapsed:.2f}s"
            print(f"Four-document snapshot generated; PDFs/cards and repeat restore verified in {elapsed:.2f}s; {out.stat().st_size} bytes")
        finally:
            for name in created:
                admin.execute(sql.SQL("DROP DATABASE {} WITH (FORCE)").format(sql.Identifier(name)))

if __name__ == "__main__":
    main()
