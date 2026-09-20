# Session C — Intelligence, cross-document resolution, sponsor integrations

**Owns:** `packages/intel/`, `apps/web/app/api/intel/*`, the Elasticsearch
index, the cost instrumentation, the voice layer.
**Branch:** `sess/c-intel`.
**Deliverable:** everything that makes the graph smart, plus three of the six
sponsor submissions. Most independent surface area, least UI risk, so this
session absorbs the sponsor work.

## Start here

```bash
git checkout -b sess/c-intel
cp .env.example .env            # fill OPENAI_API_KEY
pnpm install && pnpm infra:up   # Postgres (schema auto-applied) + Elasticsearch
pnpm --filter @quod/intel typecheck
```

`packages/intel/llm.ts` already has `callModel()` (OpenAI Responses API, strict
JSON via `jsonSchema`, `promptCacheKey`), `embed()`, `logCall()` and a pricing
table; `scripts/cost-report.ts` is the C0 acceptance script. Your route
handlers are shells in `apps/web/app/api/intel/*/route.ts`; they validate the
request against `@quod/contracts` and return 501. Fixture mode
(`USE_FIXTURES=1`) must keep working in your handlers too — read
`apps/web/lib/fixtures.ts`.

Note the worker <-> web seam in CONTRACTS.md: the Python worker calls your
`POST /api/intel/resolve` and `POST /api/intel/bake`; your handlers read and
write Postgres directly. A's Luna calls go through `quod_worker/llm.py`,
which writes the same `llm_calls` rows.

## Phase C0 — LLM wrapper and cost ledger (45 min)

Verify `llm.ts`: re-pull pricing at the venue (Sol is on promo through
2026-11-21 and the lineup moved twice this summer), check the cached-token
split, ledger insert. Build this before any prompt, because retrofitting
instrumentation at hour 20 is how the Token Company submission gets dropped.
Skip the Batch API despite its 50% discount: it can take 24 hours.

Accept: `pnpm --filter @quod/intel cost-report` prints total cost grouped by
stage, and a synthetic run of 50 calls (use `logCall` directly) is logged
accurately.

## Phase C1 — Instantiation prompt (2h)

Given the target node's statement, the invoking paragraph, and the symbol
tables of both, produce a `Card`: which clause is in use (`clause_ids`), the
statement rewritten in local notation (`instantiated_md`), the substitution
list, a one-line plain gloss. Strict JSON out. Build a 20-case eval set from
`fixtures/golden` and iterate against it, not against vibes. Then implement
`POST /api/intel/bake` so the worker can trigger it per document.

Accept: clause selection correct in at least 17 of 20, and no substitution
introduces a symbol absent from the invoking page. This is the quality bar the
whole demo rests on.
Fallback (risk register): if under bar, degrade to showing the original
statement with the relevant clause highlighted and no rewriting.

## Phase C2 — Elasticsearch index and hybrid search (90 min)

Index every node with statement text, label, title, symbols, document, kind.
Hybrid query: BM25 over text + dense vector over OpenAI statement embeddings
(`embed()` in `llm.ts`, `text-embedding-3-small`), RRF-fused. Expose
`GET /api/search`.

Accept: searching "rank nullity" returns the right node top-1 across all four
demo documents even where the phrase never appears verbatim.

## Phase C3 — Cross-document entity resolution (2h)

For each unresolved node, top 8 candidates from ES, then one batched Sol
call returning `same | different | specialisation` plus confidence. Union-find
the positives into `entities`. Resolve soft and named anchors against entities
rather than nodes. Confidence threshold 0.8; below it B draws a dashed
underline. Manual allowlist for the four demo documents is acceptable.

Accept: on `pset4.json`, all three deliberately-restated theorems resolve to
their textbook nodes with confidence above 0.8, and zero false merges among
the 20 chapter nodes.

## Phase C4 — Trace and forward link endpoints (90 min)

`POST /api/intel/trace`: extract mentioned entities from the selection, walk
backward with a recursive CTE capped at depth 4 and breadth 3, filter against
`read_node_ids`, return an ordered chain with a one-line reason per hop.
`GET /api/intel/forward/:entity_id`: downstream nodes ranked by PageRank over
reversed edges.

Accept: tracing a known hard proof in the demo corpus returns a chain a human
agrees with, in under 800ms.

## Phase C5 — Cost reduction and the measurement (75 min)

Cached input across all batched calls, keeping the shared chapter prefix
byte-stable and keyed with `prompt_cache_key` so it actually hits (verify
`cache_read_tokens` is non-zero in the ledger). Content-hash cache so
re-ingesting a document costs nothing. Batch-size tuning. Then run the full
pipeline twice on the same book, optimisations off and on, and produce a table
of tokens and dollars by stage (tag runs via `meta`). That table is the Token
Company submission.

Accept: measured end-to-end reduction of at least 60% with C1 and C3 evals
unchanged.

## Phase C6 — Voice companion (90 min, cut first if behind)

Deepgram streaming STT on push-to-talk, scoped to entities visible in the
viewport. One Sol call with that narrow context, answer spoken back with
Deepgram TTS. Barge-in supported.

Accept: "what was that theorem again" while a page is open returns a spoken
correct answer in under 3 seconds.

## Phase C7 — Sponsor write-ups (60 min, at hour 21, not 23.5)

Seven submissions from one shared body: Dropbox (primary; F3 + F7 is literally
their prompt), Elastic (ES for recall + search bar), Token Company (the C5
table), OpenAI (the whole model stack; judged on how creatively the API powers
the experience and how Codex helped you build it — needs a concrete line on
how Codex changed the process, not just what shipped), Deepgram (F8), Long
Lake (grounded output, page citations), Ramp (saves students time). Each gets
its own framing paragraph and screenshot.
Include the prior-art paragraph (ScholarPhi / Semantic Reader, TheoremGraph,
KnowTeX) as a strength, not a defence.
