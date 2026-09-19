# Session C independent execution draft

Status: proposed plan, not implemented. Assumption: A and B have not started; existing scaffold is available. Budgets are working targets for one C owner, not guarantees.

## User constraints added before execution

- Maximum authorized API spending for this work: USD 500 total, not a throughput rate and not an automatically renewing monthly allowance. Account-level enforcement has not been configured by this agent.
- Do not access `.env` at all: no reading, sourcing, editing, or commands that implicitly load it. Live execution must use an independently supplied process environment without opening this file.
- Before paid calls, establish spending enforcement and accounting for concurrent/in-flight requests. A shared project hard limit is account-side protection; it is monthly and propagation can allow overshoot, so also enforce a conservative application budget with headroom. A's calls must participate before claiming a pipeline-wide application cap.
- No paid API calls have been made during prerequisite checks. Node and pnpm are installed; Docker CLI exists but its daemon socket was unavailable during the check.

## Requirements and boundaries

Deliver C0–C5 intelligence with contract-compatible endpoints, preserve fixture mode, and prepare sponsor evidence. C6 voice is optional. C7 submission preparation is mandatory but depends on integrated screenshots for completion. Source: `sessions/C.md`.

Own `packages/intel/`, intel route handlers, and the explicitly C-assigned search endpoint. Keep logic in the package and routes thin. Respect A's schema/worker and B's reader ownership; record cross-owner requests in `INTEGRATION.md` during execution. Do not change frozen contracts unilaterally. Sources: `CONTRACTS.md`, `CLAUDE.md`.

Choose direct execution with this order: independent test data + C0, C1, C2/C3, C4, C5 measurement; collect C7 evidence throughout, attempt C6 last. Bring run attribution and cache boundaries forward, while preserving an unoptimized benchmark configuration.

## 1. Establish a runnable baseline and explicit handoffs (30–60 minutes)

- Create `sess/c-intel` when execution begins; install using the pinned pnpm version in `package.json`, configure environment, start `docker-compose.yml` services, and verify DB schema and TS baseline. Verify environment variables reach both Next and standalone scripts: copying `.env` alone does not prove loading.
- Verify configured model access, structured-output behavior, embedding dimensions, and current pricing against official documentation/account access before paid evaluations. Treat comments in `packages/intel/llm.ts` as unverified scaffold assumptions. No new dependencies without explicit authorization; use installed libraries and built-in facilities where possible.
- Prepare a small hand-authored corpus under proposed `packages/intel/evals/data/`, validated against `packages/contracts/types.ts`. Include a theorem split into clauses, a second-document restatement with different notation, a near-miss with different hypotheses, invoking paragraphs, anchors, and a dependency chain. Grow to 20 instantiation cases plus 20 chapter nodes and three deliberate restatements.
- Add proposed C-owned seed/evaluation scripts. Seed a dedicated test corpus into the existing schema. Use `FIXTURES_DIR` from `apps/web/lib/fixtures.ts` to exercise fixture mode with contract-shaped C test data; keep extra evaluation annotations separate from fixture envelopes. Do not populate A's golden directory with pretend final data.
- Record requests for A: real golden corpus, invoking paragraph and page symbol context, ingestion-to-index timing, idempotent ingestion, and common run metadata on Python ledger rows. Record requests for B: preserve route shapes, render original-statement fallback, confidence presentation, and later viewport/voice integration.
- Critical context seam: `anchors` in `packages/contracts/schema.sql` stores surface text and coordinates, not invoking paragraphs or a page symbol table. Tests can pass this context directly. Live bake needs an agreed persisted source from A. Nodes enclosing an anchor may supply partial context, but missing context must trigger original-statement fallback, never fabricated rewriting. Any schema change remains A-owned and requires the shared decision process.

Exit: services and package typecheck run; private corpus validates and seeds reproducibly; missing live context is documented. Development can proceed without parser or reader.

## 2. Finish C0 before paid prompt iteration (45–60 minutes)

Work in `packages/intel/llm.ts` and `packages/intel/scripts/cost-report.ts`.

- Verify 50 synthetic `logCall` writes, disjoint cached/uncached token accounting, totals by stage, and run-isolated reports.
- Prevent unknown pricing from silently appearing as free usage; distinguish missing usage and failed/incomplete/refused responses from successful zero-cost output.
- Add consistent metadata for run ID, prompt version, optimization configuration, and evaluation versus production. Carry attribution through embedding calls too.
- Test malformed output, incomplete response, provider failure, and ledger failure behavior with controlled responses. Perform one small live structured-output and embedding smoke test after configuration is verified.

Exit: exact synthetic counts/totals pass, report excludes unrelated runs, and every successful paid call path is instrumented.

## 3. Deliver C1 as a CLI-to-database slice (2–3 hours)

Proposed files: `packages/intel/prompts/instantiate.ts`, `packages/intel/bake.ts`, `packages/intel/evals/instantiate/`; existing route: `apps/web/app/api/intel/bake/route.ts`.

- Implement card generation as a function of target statement, clauses, invoking paragraph, and both symbol tables. Run directly from a script before introducing HTTP integration.
- Validate JSON with existing contracts, verify selected clause IDs exist, check substitutions against supplied local context, and preserve hypotheses and source citation. Human-review mathematical correctness; a string check alone cannot establish equivalence.
- Use original source text with valid clause selection and no substitutions whenever context or output validation fails. Missing context must not prevent all cards from baking.
- Implement persistence with one card per anchor and consistent anchor linkage, then the route. Add explicit fixture mode that makes no provider calls.
- Establish cache identity using relevant source/local context plus prompt/model version; initially keep cache bypass available for baseline measurements. Avoid schema changes by using existing baked-card persistence where adequate; log any necessary durable metadata request for A.

Exit: at least 17/20 clause selections correct, zero substitutions using absent local symbols, valid source citations, and repeated bake neither duplicates cards nor needlessly regenerates unchanged content. Synthetic success is provisional until repeated on A's real corpus.

## 4. Build C2 and C3 together (3–4 hours)

Proposed files: `packages/intel/search.ts`, `packages/intel/resolve.ts`, `packages/intel/prompts/adjudicate.ts`; existing routes: `apps/web/app/api/search/route.ts`, `apps/web/app/api/intel/resolve/route.ts`.

- Index statements, titles, labels, symbols, kinds, and document/corpus identifiers using node IDs for idempotent upserts. Index current nodes before candidate retrieval and refresh updated entity associations afterward. Confirm this indexing trigger with A.
- Combine BM25 and embedding rankings with RRF. Verify compatibility with the pinned ES service; application-side RRF is a fallback if native fusion is unavailable. Avoid adding an ES dependency by default.
- Restrict resolution candidates to the requested corpus, exclude self, and adjudicate up to eight candidates per unresolved node in a batched call.
- Merge only `same` verdicts meeting the 0.8 threshold. `specialisation` creates a relation, not an equivalence union. Do not force low-confidence candidates into entities; preserve existing resolved links and canonical IDs on repeat runs.
- Resolve named/soft anchors to entities and supply results to bake. Exercise the full seed -> index -> resolve -> bake -> stored-card sequence through HTTP without waiting for B's UI.

Exit: correct rank-nullity top-1 result on the private corpus, three deliberate restatements resolve above 0.8, zero false merges among 20 chapter nodes, corpus isolation, and stable repeat runs. Repeat the official four-document acceptance on A's fixtures when available. A documented demo allowlist is an acceptable fallback, not evidence of general model accuracy.

## 5. Deliver C4 graph endpoints (1.5–2 hours)

Proposed files: `packages/intel/trace.ts`, `packages/intel/forward.ts`; existing handlers under `apps/web/app/api/intel/trace/` and `forward/[entity_id]/`.

- Verify edge orientation from `CONTRACTS.md`: src uses/depends on dst. Build deterministic graph traversal on known nodes before adding selection-to-entity matching.
- Trace with cycle protection, depth at most four, breadth at most three, reader-state filtering, and direct dependency first. Prefer local lookup/cached selection matching on the latency-critical path; benchmark any model-backed path separately.
- Restrict forward candidates to actual downstream nodes, then rank using the specified reversed-edge PageRank. Handle empty graphs and repeated entity occurrences.

Exit: exact expected ordering on known graphs, no cycles/duplicates, correct limits/filtering, and measured full trace request below 800ms on the demo corpus with timing conditions stated. Human agreement on a real proof remains an integration requirement.

## 6. Complete C5 measurement and integration hardening (1.5–2 hours plus integration)

- Benchmark unchanged evaluations and fixed corpus/model/prompt settings with named baseline and optimized runs. Exclude synthetic ledger entries and eval-only calls.
- Tune stable prompt prefixes, caching, batch sizes, and repeated-ingest skips. Measure actual cached tokens; do not infer a provider cache hit from a cache key.
- Report cold first-ingest cost separately from repeated-ingest cost. Verify repeated unchanged C work makes zero model calls; full zero-cost re-ingestion requires A's ingestion cache.
- Produce per-stage calls, tokens, dollars, and latency with quality results. C's standalone figures are scoped to C stages. The required >=60% full-pipeline reduction is only claimable after A's stages are included; if the target is missed, report the measured result.
- Integrate real A fixtures, rerun all semantic gates, and verify B can display stored cards and trace/search output. Coordinate merges at the documented hour 6/12/17 checkpoints.

Exit: real-corpus C1/C3 quality remains at target, cost comparison is reproducible and honestly scoped, and both live and fixture endpoint flows pass. Full reader/worker completion remains pending until those components exist.

## 7. Prepare C7 throughout; attempt C6 only after core acceptance

- Keep an evidence folder under proposed `packages/intel/artifacts/` with evaluation results, latency, example source-grounded cards, architecture notes, run reports, and specific examples of Codex's contribution.
- At hour 21 draft a shared submission body plus sponsor-specific paragraphs from `sessions/C.md`; obtain integrated screenshots from B. The session intro says three of six submissions but C7 lists seven: prepare the listed seven framings while treating final submission ownership and current eligibility as coordination/verification tasks. Do not submit externally as part of implementation.
- Optional C6: prototype speech input -> viewport-scoped answer -> speech output; support interruption. B supplies viewport context and push-to-talk UI. Keep any key server-side. Verify current provider API before implementation. Accept only after correct spoken answer under three seconds and barge-in work in the integrated reader.

## Verification and cut policy

Run package typecheck, workspace typecheck, contract tests, focused deterministic and database/HTTP tests, and web build after integration changes. Use existing scripts from `package.json`; inspect available lint/static analysis configuration rather than inventing nonexistent commands. No need to run parser/UI checks before their implementations exist, but record the gap.

Prioritize reliable cards and cross-document resolution above voice and optional reader features. If a phase exceeds 150% of its budget, use a documented bounded fallback. Preserve original-statement cards, allowlisted demo resolution when needed, and fixture-backed endpoints. Do not present fallback or synthetic results as passing the live quality gates.

First work session: baseline and test corpus -> 50-call ledger test -> one correct generated card -> persist and retrieve it through bake. This is the smallest useful demonstration C can own independently.
