# @cairn/intel — Session C

Everything that makes the graph smart, plus the cost instrumentation and the
voice layer. Route handlers under `apps/web/app/api/intel/*` import from here
and stay thin.

## Offline verification

```sh
pnpm --filter @cairn/intel test
pnpm --filter @cairn/intel eval:offline
pnpm --filter @cairn/intel fixtures:generate
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
- `budget.ts`: pure $500-total reservation/settlement transitions. These are NOT
  a durable spending guard. Live calls remain disabled pending shared enforcement.
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
  cancellation/barge-in control. See its README for B's wiring and live limitations.
- `artifacts/submissions.md`: seven sponsor drafts and required evidence, with
  primary-source prior-art citations; nothing has been submitted.

## Service verification

```sh
COMPOSE_DISABLE_ENV_FILE=1 docker compose --env-file /dev/null up -d
DATABASE_URL=postgres://cairn:cairn@localhost:5432/cairn pnpm --filter @cairn/intel test:db
ELASTICSEARCH_URL=http://localhost:9200 pnpm --filter @cairn/intel test:search
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

- Shared durable budget proposal: `artifacts/budget-proposal.md`. No shared schema
  changes or paid calls yet; credentials must never be loaded from `.env`.
- A's invoking paragraphs/local symbol tables and real golden corpus.
- Live C1/C3 evaluations, four-document semantic-search acceptance, and
  reader/worker integration. Protocol tests used synthetic statements/local vectors.
- Composite substitutions and clause collapsing: current rewrites only rename
  single-letter/LaTeX-command symbols and retain the complete source statement.
- Real-proof trace latency acceptance remains; unmatched vague selections return
  an empty chain unless a resolved source anchor identifies the dependency.
- Full-pipeline content caching and measured >=60% savings. Reusing embeddings
  does not make repeated adjudication/model calls free.
- Voice's real providers/browser/latency checks, B's controls, integrated screenshots,
  and final sponsor eligibility/evidence. Speech remains disabled pending its budget.

Passing synthetic answer replays does not establish live clause-selection quality,
mathematical equivalence or measured savings. No new dependencies were introduced.
