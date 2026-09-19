"""cairn-worker CLI. `python -m cairn_worker --help` also works."""

from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path
from uuid import UUID

from cairn_worker import db
from cairn_worker.pipeline import PipelineContext, ensure_corpus, register_document, run_document


def _pdfs(target: Path) -> list[Path]:
    if target.is_file():
        return [target]
    return sorted(p for p in target.iterdir() if p.suffix.lower() == ".pdf")


def cmd_ingest(args: argparse.Namespace) -> int:
    pdfs = _pdfs(Path(args.target))
    if not pdfs:
        print(f"no PDFs under {args.target}", file=sys.stderr)
        return 2
    with db.connect() as conn:
        db.apply_schema(conn)
        corpus_id = ensure_corpus(conn, args.corpus_id, args.corpus_name)
        print(f"corpus {corpus_id}")
        failed = 0
        for pdf in pdfs:
            doc_id = register_document(conn, corpus_id, pdf)
            print(f"  {pdf.name} -> {doc_id}")
            try:
                run_document(PipelineContext(conn=conn, corpus_id=corpus_id, doc_id=doc_id, pdf_path=pdf))
            except Exception:  # noqa: BLE001 — already logged; keep going for the other docs
                failed += 1
    return 1 if failed else 0


def cmd_parse(args: argparse.Namespace) -> int:
    """A1 only: parse one PDF and emit parsed/<stem>.jsonl without touching Postgres."""
    from cairn_worker.stages.parse import parse_pdf

    pdf = Path(args.pdf)
    spans, quality, page_count = parse_pdf(pdf)
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / f"{pdf.stem}.jsonl"
    with out.open("w", encoding="utf-8") as f:
        for s in spans:
            f.write(s.model_dump_json() + "\n")
    print(f"{pdf.name}: {len(spans)} spans, {page_count} pages, quality {quality:.2f} -> {out}")
    return 0


def cmd_db_init(_args: argparse.Namespace) -> int:
    with db.connect() as conn:
        db.apply_schema(conn)
    print("schema applied")
    return 0


def main(argv: list[str] | None = None) -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    p = argparse.ArgumentParser(prog="cairn-worker", description="Cairn ingest pipeline (Session A)")
    sub = p.add_subparsers(dest="cmd", required=True)

    ingest = sub.add_parser("ingest", help="ingest a PDF or a directory of PDFs into Postgres")
    ingest.add_argument("target")
    ingest.add_argument("--corpus-id", type=UUID, default=None)
    ingest.add_argument("--corpus-name", default="demo")
    ingest.set_defaults(fn=cmd_ingest)

    parse = sub.add_parser("parse", help="A1: emit parsed/<doc>.jsonl for one PDF, no database")
    parse.add_argument("pdf")
    parse.add_argument("--out", default="parsed")
    parse.set_defaults(fn=cmd_parse)

    init = sub.add_parser("db-init", help="apply packages/contracts/schema.sql")
    init.set_defaults(fn=cmd_db_init)

    args = p.parse_args(argv)
    sys.exit(args.fn(args))
