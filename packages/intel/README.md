# @quod/intel — Session C

Everything that makes the graph smart, plus the cost instrumentation and the
voice layer. Route handlers under `apps/web/app/api/intel/*` import from here
and stay thin.

## Offline verification

```sh
pnpm --filter @quod/intel test
pnpm --filter @quod/intel eval:offline
pnpm --filter @quod/intel fixtures:generate
pnpm typecheck
```

These commands do not load `.env`, start Next, or make paid API calls. Route tests
import handlers directly with temporary fixtures. Generated data lives in
`packages/intel/evals/generated`; pass its absolute path as `FIXTURES_DIR` in the
process environment. The examples are synthetic, not source PDFs.

## Implemented surfaces

- `llm.ts`: validated token/cost estimates, injected test transports, attribution,
  incomplete-output handling, default-denied live calls, and opt-in content reuse
  with coalesced concurrent requests. This result cache is process-local and
  bounded; `cache: "off"` disables it for independent evaluations/baselines.
- `budget.ts`: $500-total reservation/settlement helpers plus the durable shared
  Postgres guard in `contracts/migrations/001_api_budget.sql`, used by both runtimes.
  Paid calls default disabled and require explicit process and database opt-in.
- `prompts/instantiate.ts`: strict schema, simultaneous symbol renaming, source
  citations owned by code, original-statement fallback.
- `bake.ts`: injectable baking and atomic Postgres card/link writes; unchanged
  original cards reuse their ID, and changed source text invalidates the output.
  Context can come from an unambiguous paragraph inside an enclosing parsed node;
  absent/ambiguous text or symbols still falls back safely.
- `search.ts`: ES 8.15 BM25+dense retrieval with local RRF; corpus-scoped candidates;
  persisted vectors reused by content/model key. `reuseEmbeddings: false` allows a
  baseline run. Fixture search is lexical.
- `resolve.ts`, `resolution-service.ts`: adjudication validation, confidence-gated
  equivalence groups, specialisation edges, exact named-anchor matching, stale-input
  detection, transactional persistence and post-save index refresh.
- `trace.ts`, `forward.ts`, `graph-store.ts`: bounded graph walks, explicit labels
  or resolved-anchor roots, read flags, downstream reversed-edge PageRank. Live
  tracing fetches prerequisites with a cycle-safe recursive SQL query (depth 4,
  breadth 3), rather than loading the entire corpus graph.
- All C routes support fixtures. Live resolution is gated; live bake currently
  produces original-statement cards while model calls are disabled.
- `cost-comparison.ts`: quality- and scope-checked before/after comparisons.
- `voice/`: viewport-scoped answers, Deepgram adapters, browser push-to-talk,
  bounded server relay and cancellation/barge-in control. Reader wiring is complete;
  see its README for startup and live acceptance limits.
- `artifacts/submissions.md`: seven sponsor drafts and required evidence, with
  primary-source prior-art citations; nothing has been submitted.

## Service verification

```sh
COMPOSE_DISABLE_ENV_FILE=1 docker compose --env-file /dev/null up -d
DATABASE_URL=postgres://cairn:cairn@localhost:5432/cairn pnpm --filter @quod/intel test:db
ELASTICSEARCH_URL=http://localhost:9200 pnpm --filter @quod/intel test:search
```

The DB check creates/removes its own UUID-isolated corpus and synthetic ledger
rows. It checks three persisted restatements, twenty linked cards, stable repeat
baking and fifty ledger inserts. The ES check creates/removes its own test index
with deterministic local vectors; it verifies protocol behavior, not semantic recall.

Cost reports exclude synthetic calls by default. `--run RUN_ID` isolates a run;
`--include-synthetic` includes synthetic rows. Estimates are not billing receipts.
Use matching `meta.run_id` across A and C before comparing whole-pipeline costs.
`cost-compare BASELINE.json OPTIMIZED.json` validates measurement artifacts using
the `Measurement` schema in `cost-comparison.ts`; synthetic evidence, changed
quality, different corpora/settings, and incomplete stage coverage are rejected.

Real Postgres and ES protocol checks have passed. The DB check also verifies
stale-snapshot rejection and synthetic-row filtering in the report. Its synthetic
cross-document SQL trace ran in roughly 7ms locally; this is not a real-proof
or production latency result.

## Remaining acceptance work

- The shared budget migration is implemented and concurrency-tested. Reconcile
  historical spending/provider controls before activation; never load `.env`.
  See the root `PROJECT_STATUS.md` for the superseding integration audit.
- A's invoking paragraphs/local symbol tables and real golden corpus.
- Live C1/C3 evaluations and four-document semantic-search acceptance.
  Reader/worker integration now passes a real provider-backed PDF upload, including
  20 nodes, 34 cards, SSE, search and browser rendering.
- Composite substitutions and clause collapsing: current rewrites only rename
  single-letter/LaTeX-command symbols and retain the complete source statement.
- Real-proof trace latency acceptance remains; unmatched vague selections return
  an empty chain unless a resolved source anchor identifies the dependency.
- Full-pipeline content caching and measured >=60% savings. Reusing embeddings
  does not make repeated adjudication/model calls free.
- Broader voice quality checks and final sponsor eligibility/evidence. One live
  cited voice turn starts speaking at 3.192s, accepted by the user. Reader controls,
  streamed browser playback, cancellation and shared reservations are verified.

Passing synthetic answer replays does not establish live clause-selection quality,
mathematical equivalence or measured savings. The voice relay uses the `ws` package.
