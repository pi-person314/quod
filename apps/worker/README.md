# cairn-worker — Session A

Takes a directory of PDFs and produces a populated Postgres with nodes, edges
and anchors. Never touches React or the instantiation prompts.

## Setup

```bash
cd apps/worker
python -m venv .venv && . .venv/Scripts/activate   # Windows; use .venv/bin/activate elsewhere
pip install -e ".[dev]"
cairn-worker --help
```

Reads `.env` from the repo root (`DATABASE_URL`, `OPENAI_API_KEY`,
`MODEL_FAST`, `WEB_BASE_URL`).

## Pipeline

```
cairn-worker ingest <dir-or-pdf> [--corpus-id UUID] [--corpus-name NAME] [--force]
cairn-worker ingest --fixtures                    # A5: load fixtures/golden/*, no parsing
cairn-worker parse  <pdf> --out parsed/           # A1 only: emit parsed/<doc_id>.jsonl
cairn-worker load-fixtures                        # same as ingest --fixtures
cairn-worker dump-demo [--out PATH]               # A5: write fixtures/demo.dump
cairn-worker db-init                              # apply packages/contracts/schema.sql
```

Re-ingest is idempotent: a document is keyed on `(corpus_id, sha256)` and a
second run over the same file is a no-op once it is `ready`. `--force`
rebuilds its graph in place instead of stacking a second copy beside it.
Omitting `--corpus-id` reuses the corpus with the same `--corpus-name`.

Stages (`cairn_worker/stages/`), each one a function `(ctx, ...) -> ...` that
writes `ingest_progress` at its boundary:

| # | Stage | Phase | Model | Output |
|---|---|---|---|---|
| 1 | `parse`   | A1 | — | `Span` records, per-document quality score |
| 2 | `segment` | A2 | Luna (batched 20, cached chapter prefix) | `nodes` rows |
| 3 | `anchors` | A3 | — | `anchors` rows; explicit ones resolved by label |
| 4 | `edges`   | A4 | Luna, only for unclaimed spans | `edges` rows tagged by extractor |
| 5 | `resolve` | C3 | — (HTTP to `POST /api/intel/resolve`) | `nodes.entity_id`, `entities` |
| 6 | `bake`    | C1 | — (HTTP to `POST /api/intel/bake`) | `cards` rows, `anchors.card_id` |

Stages 5 and 6 are Session C's handlers; the worker only calls them. Until
they exist, they return 501 and the pipeline logs and continues.

## Models

`cairn_worker/models.py` mirrors `packages/contracts/types.ts` field for
field. If you change one, change the other in the same commit and run
`pnpm test:contracts`.

Coordinates: bboxes are PyMuPDF space (points, origin top-left, y down),
pages are 1-indexed. See CONTRACTS.md.

## Scripts (Session A)

| Script | Purpose |
|--------|---------|
| `scripts/bbox_helper.py` | Find bboxes for a substring on a PDF page (A0) |
| `scripts/build_a0_golden.py` | Regenerate `fixtures/golden/*` demo corpus + PDFs |
| `scripts/eval_golden.py` | A1–A4 gates vs `analysis-ch3.json` (`parse|segment|anchors|edges|all`) |
