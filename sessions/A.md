# Session A — Ingestion and graph construction

**Owns:** `apps/worker/`, `packages/contracts/`, `fixtures/`.
**Branch:** `sess/a-ingest`.
**Deliverable:** a command that takes a directory of PDFs and produces a
populated Postgres with nodes, edges and anchors. Never touches React or the
instantiation prompts.

Each phase ends with an executable acceptance test. Do not advance until it
passes. If a phase overruns its budget by 50%, ship the fallback named in that
phase and move on.

## Start here

```bash
git checkout -b sess/a-ingest
cp .env.example .env            # fill OPENAI_API_KEY
pnpm install && pnpm infra:up   # Postgres + Elasticsearch; schema auto-applies
cd apps/worker && python -m venv .venv && . .venv/Scripts/activate && pip install -e ".[dev]"
quod-worker --help
```

Pre-vet five candidate demo books before touching code: LaTeX-produced PDFs
only, real text layer, no scans. The demo corpus is four documents (a
textbook, lecture notes, a pset, slides) for a proof-heavy course.

## Phase A0 — Contracts and fixtures (45 min) — **everyone is blocked on this**

`packages/contracts/types.ts` and `schema.sql` are already written to the spec;
review them, then spend the time on fixtures. Hand-author
`fixtures/golden/analysis-ch3.json` (20 nodes, 30 edges, 15 anchors, 15 cards
from one real chapter, with its PDF beside it) and `fixtures/golden/pset4.json`
(6 nodes, three of which deliberately restate chapter theorems under different
names and share their `entity_id`). Bboxes must be real PyMuPDF coordinates;
B1 verifies them visually. **Commit and push to main immediately.**

Accept: `pnpm test:contracts` validates every fixture.

## Phase A1 — Parse layer (90 min)

PyMuPDF extraction into `Span` (`quod_worker/models.py`): text, page, bbox,
font, size, bold, italic, block, line. Group spans into paragraphs by vertical
gap and indentation. Emit `parsed/<doc_id>.jsonl` via `quod-worker parse`.

Accept: on three test PDFs, span count is within 2% of the PDF's own text
layer and no page returns zero spans. Log a per-document quality score;
under 0.8 => `status = 'unsupported'`, never silent garbage.
Fallback: if a book fails, drop it from the demo set rather than fixing the parser.

## Phase A2 — Segmentation (2h)

Regex pass first: numbered environment headers, `Proof.` markers, QED
terminators (~80% of nodes for free). Then Luna over each candidate block,
batched 20 at a time through `quod_worker/llm.py`, returning kind, title,
clause decomposition, symbols introduced (use `json_schema` for strict JSON).
Keep the chapter context in `instructions` byte-identical across the batch and
pass one `prompt_cache_key` per chapter so cached input hits.
Write nodes to Postgres; call `db.set_progress` as they land so B's ingest
screen shows the growing list.

Accept: on the golden chapter, precision and recall against the fixture both
exceed 0.85. Print a confusion table by kind. This number gates everything
downstream.

## Phase A3 — Anchor detection (75 min)

Explicit (`Theorem 3.4`, `Lemma 2.1(ii)`), soft (`the previous lemma`, `as
above`), named (`the spectral theorem`). Record bboxes. Resolve explicit ones
locally by label match; leave soft and named with `target_node_id = null` for C.

Accept: every anchor in the golden fixture is found, bboxes round-trip through
the reader's coordinate transform within 2px, explicit resolution > 0.95.

## Phase A4 — Edge extraction (90 min)

Four extractors in cost order (deterministic, heuristic, notation, llm); only
spans no earlier extractor claimed reach the LLM. Tag every edge with its
extractor for the Token Company write-up.

Accept: acyclic after removing `restates`; every theorem in the golden chapter
has an edge; edge F1 against fixture > 0.75.

## Phase A5 — Pipeline hardening (60 min)

Progress at every stage boundary (already wired in `pipeline.py`; make it
granular). Idempotent re-ingest keyed on file hash (started in
`register_document`). A `--fixtures` mode that loads `fixtures/golden/*` into
Postgres and skips parsing. Pre-ingest the four demo documents and snapshot to
`fixtures/demo.dump`.

Accept: `make demo-db` restores a working corpus from scratch in under 30
seconds on a laptop with no network.

## Phase A6 — Buffer and support (remainder)

Stop building. Support B and C, improve segmentation on whichever demo
document looks worst on screen, own the database snapshot through the final
integration.

## Risks you own

- Segmentation quality too low on real books -> choose demo books from
  LaTeX-produced PDFs only; pre-vet five candidates.
- Live parse fails during the demo -> `fixtures/demo.dump` pre-ingested; the
  on-camera upload uses a small document only.
