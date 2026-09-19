# CONTRACTS.md — frozen seams between the three sessions

Committed at hour 0. **Changing anything in this file is a synchronous decision
requiring all three sessions.** Additive, optional fields on the API
request/response shapes may be added by the route owner if logged in
`INTEGRATION.md`; the four core types (Node, Edge, Anchor, Card) do not change.

## Repo layout and ownership

| Path | Contents | Owner |
|---|---|---|
| `packages/contracts/` | zod schemas, `schema.sql`, fixture validator | **A** |
| `apps/worker/` | Python ingest pipeline | **A** |
| `fixtures/` | golden corpora + expected outputs | **shared, append-only** (A seeds it) |
| `apps/web/` | Next.js reader | **B** |
| `apps/web/app/api/*` | API route shells and non-intel handlers | **B** owns shape |
| `apps/web/app/api/intel/*` | intel handlers | **C** owns handlers |
| `packages/intel/` | LLM wrapper, prompts, resolution, ES index, cost ledger | **C** |

Ownership is strict. A session that needs a change in another's directory
writes it as an issue in `INTEGRATION.md` and works around it with a stub.
No cross-directory commits.

Branches: `sess/a-ingest`, `sess/b-reader`, `sess/c-intel`. Merge to `main`
only at the three integration checkpoints (hour 6, 12, 17).

## Core types

Source of truth is `packages/contracts/types.ts` (zod). The Python mirror in
`apps/worker/cairn_worker/models.py` must match it field for field.

```jsonc
{
  "Node": {
    "id": "uuid",
    "doc_id": "uuid",
    "kind": "definition|theorem|lemma|proposition|corollary|example|proof|notation",
    "label": "Theorem 3.4",          // null for unnumbered environments
    "title": "Rank-Nullity",         // null when the source gives none
    "statement_md": "Let T: V -> W be linear...",
    "clauses": [{"id": "i", "text": "..."}],
    "symbols": [{"sym": "T", "role": "linear map"}],
    "page": 112,
    "bbox": [72.0, 340.5, 468.0, 412.0],
    "entity_id": "uuid|null",
    "confidence": 0.0
  },
  "Edge": {
    "src": "node uuid",
    "dst": "node uuid",
    "kind": "depends_on|uses_notation|specialises|restates",
    "extractor": "deterministic|heuristic|notation|llm",
    "confidence": 0.0
  },
  "Anchor": {
    "id": "uuid",
    "doc_id": "uuid",
    "page": 340,
    "bbox": [0, 0, 0, 0],
    "surface": "by Theorem 3.4",
    "target_node_id": "uuid|null",
    "target_entity_id": "uuid|null",
    "card_id": "uuid|null"
  },
  "Card": {
    "id": "uuid",
    "anchor_id": "uuid",
    "headline": "Rank-Nullity, clause (ii)",
    "instantiated_md": "dim ker T + dim im T = dim V",
    "full_md": "...",
    "substitutions": [{"from": "A", "to": "T"}],
    "clause_ids": ["ii"],            // clauses in use; [] = whole statement (additive, defaults to [])
    "gloss": "plain-language one-liner for unread nodes",
    "source": {"doc_id": "uuid", "page": 112}
  }
}
```

Edge semantics: `src` **depends on** `dst` (the edge points from the user of a
result to the result). `restates` edges are excluded from acyclicity checks.

Supporting types (`Corpus`, `Doc`, `Entity`, `ReaderState`, `IngestEvent`) are
defined in `types.ts` and needed by fixtures and `schema.sql`; they are less
sacred than the four above but still shared.

### Coordinate convention (read this before B1 or A3)

- `bbox` is `[x0, y0, x1, y1]` in **PDF points, origin top-left, y increasing
  downward** — exactly what PyMuPDF `page.get_text("dict")` returns. No flip.
- `page` is **1-indexed** everywhere (matches what a human reads off the page).
- Reader transform: `scale = renderedPageWidthPx / pageWidthPt`, then
  `px = x * scale`, `py = y * scale`. PDF.js `getViewport({scale: 1})` width
  and height are the page dimensions in points for rotation 0.
- A3 acceptance ("bboxes round-trip within 2px") is measured under this
  transform.

## API surface

| Route | Owner | Contract |
|---|---|---|
| `POST /api/corpus` | B | Creates a corpus. `{name}` -> `{corpus_id}` |
| `POST /api/corpus/:id/docs` | B | Multipart upload, enqueues worker job -> `{doc_ids}` |
| `GET /api/corpus/:id/events` | B | SSE stream of `IngestEvent` `{stage, doc_id, nodes_done, total, node?}` |
| `GET /api/doc/:id/anchors?page=N` | B | Anchors for one page -> `{anchors}`. The reader's hot path |
| `GET /api/card/:anchor_id` | B | Baked `Card`, served from Postgres, **no model call** |
| `GET /api/search?q=` | C | Elasticsearch hybrid query -> `{hits: [{node, score}]}` |
| `POST /api/intel/trace` | C | `{doc_id, selection, page?, read_node_ids?}` -> `{chain: TraceHop[]}` |
| `POST /api/intel/resolve` | C | `{corpus_id, node_ids}` -> `{decisions}`. Called by the worker |
| `POST /api/intel/bake` | C | `{doc_id}` -> `{cards_done}`. Called by the worker at stage 5 (see below) |
| `GET /api/intel/forward/:entity_id` | C | `{entity_id, downstream: [{node, score}]}` ranked by reversed PageRank |

Request/response zod schemas for every route live in `types.ts` under
`// ---- API shapes`. Handlers validate with them; B's fixture mode returns
values that satisfy them.

`TraceResponse.chain` ordering: index 0 is the entity mentioned directly in the
selection, the last element is the innermost prerequisite. B renders index 0
at the top of the stack trace.

Every route serves from `fixtures/golden/*` when `USE_FIXTURES=1`. Keep that
flag working to the end; it is also the demo fallback if the live parser
breaks.

## Worker <-> web seam (decided at scaffold time)

The worker is Python; the instantiation prompt and `llm.ts` are TypeScript.
Two consequences, both deliberate:

1. **Stages 4 and 5 (resolve, bake) are HTTP calls from the worker to C's
   handlers**: `POST /api/intel/resolve` and `POST /api/intel/bake`. C's
   handlers read and write Postgres directly. The worker only orchestrates and
   updates `ingest_progress`.
2. **The `llm_calls` table is the ledger contract, not the wrapper file.**
   `packages/intel/llm.ts` (TS, all of C's calls) and
   `apps/worker/cairn_worker/llm.py` (Python, A's Luna segmentation calls)
   write identical rows. The Token Company cost script groups by `stage`.

## SSE progress

The worker writes `ingest_progress` rows at every stage boundary; B's
`/api/corpus/:id/events` route polls that table and streams `IngestEvent`s.
When a node is committed, the worker may emit an event carrying a summary
`node` (`id, kind, label, title, page`) so the ingest screen can show the
growing theorem list rather than a progress bar.

## Fixtures

`fixtures/golden/<name>.json`, one file per source document, all sharing the
fixture corpus id `00000000-0000-4000-8000-000000000001`. Envelope
(`GoldenFixture` in `types.ts`):

```jsonc
{
  "document": Doc,            // id, corpus_id, title, filename, page_count, ...
  "pdf": "analysis-ch3.pdf",  // path relative to fixtures/golden/, for B1 rendering
  "nodes": Node[], "edges": Edge[], "anchors": Anchor[], "cards": Card[],
  "entities": Entity[]        // may be empty; ids are stable across files
}
```

A0 commits `analysis-ch3.json` (20 nodes, 30 edges, 15 anchors, 15 cards from
one real chapter) plus its PDF, and `pset4.json` (6 nodes, three of which
deliberately restate chapter theorems under different names, sharing
`entity_id` with them). `pnpm test:contracts` validates every file and checks
cross-file referential integrity. Fixtures are append-only after A0.

## Conventions

- Postgres via the single `packages/contracts/schema.sql`, applied
  idempotently (`pnpm db:schema`). `ltree` and recursive CTEs for F4 walks.
- Every model call logs model, input/output tokens, cache reads/writes,
  latency and unit cost into `llm_calls` with a `stage` tag. `input_tokens`
  excludes cache reads so the token columns are disjoint.
- Models are OpenAI throughout: `MODEL_FAST` (gpt-5.6-luna) for bulk
  classification, `MODEL_QUALITY` (gpt-5.6-sol) for instantiation and
  resolution, `EMBEDDING_MODEL` (text-embedding-3-small) for the ES dense
  index. Cached input needs a byte-stable prefix and a `prompt_cache_key`
  per chapter. No Batch API: it can take 24 hours, which is the whole event.
- IDs are UUIDs generated by whoever creates the row. Fixture IDs are
  hand-written and stable.
- Markdown fields (`*_md`) use `$...$` / `$$...$$` for KaTeX.
