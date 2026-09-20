# Cairn integration audit — 2026-09-19

## Parallel card preparation — 2026-09-20

### Other ingest stages and progress

Segmentation and named dependency analysis now run up to three bounded model batches
concurrently, each with its own budget/ledger connection. Results are applied in
input order; graph cycle checks remain on the caller thread. Resolution allows four
adjudication batches concurrently. Repeated PDF reference searches reuse rectangles
within the same parse. Models, prompts, and validation thresholds remain unchanged.

Progress now reports PDF pages read, result details analyzed, results saved, references
located, dependency references checked, search retrieval counts, pair comparisons,
citation matching and index refresh. Concurrent completion notifications are serialized.

A fresh **browser upload** of the supplied textbook completed in 169.912 seconds,
including redirect and PDF render: segmentation about 18.2s, dependency analysis 2.3s,
resolution 71.5s, baking 64.3s. This run generated 29 card-model calls, compared with
21 in the earlier isolated bake check; live inference and enrichment vary, so the
22-second bake measurement below is not a guaranteed duration. The upload displayed
the detailed counters and reached the reader without runtime errors. All 20 worker
tests and 87 intelligence tests, database integration, typechecks and production build
pass. Evidence: `.session-tools/ingest-progress-results.json`; runner:
`apps/web/scripts/ingest-progress-acceptance.ts`. The disposable verification corpus
was deleted while its cost records were retained.

Baking now runs at most four cards concurrently and publishes a completed/total
counter after successful persistence. Progress writes are ordered; failures stop
scheduling new cards and drain in-flight work. Unresolved references are excluded
from the total. Both upload progress and the waiting reader display the counter,
including linked-document backfills. Model prompts and card validation are unchanged.

Fresh live verification on a disposable copy of the latest textbook prepared all
41 cards in **21.896 seconds**, with 21 provider calls totaling 75.654 seconds of
provider latency and $0.117384 recorded cost. The previous sequential upload spent
roughly 77 seconds on the same textbook's card preparation; these are separate live
runs, not a controlled provider-latency benchmark. Browser/SSE progress reached
41/41 with no runtime errors. The verification corpus was removed; spending records
remain. All 86 intelligence tests, workspace typecheck and isolated production build
pass. The reproducible runner is `apps/web/scripts/bake-parallel-acceptance.ts`;
local measurements are in `.session-tools/bake-parallel-results.json`.

## Reported PDF and reader repairs — 2026-09-19

The supplied textbook and pset exposed gaps that fixture acceptance did not cover.
Worker schema initialization now serializes concurrent DDL; corpus ingestion is
serialized to prevent stale resolution snapshots. TeX whitespace runs are preserved,
and wrapped citations no longer become false theorem headings. Existing uploads were
reprocessed in place: both textbook copies now have 22 results/proofs; pset4 has five problems.

The outline follows page and vertical position, groups entries by page, and labels
unnamed proofs. Nested duplicate reference overlays collapse into one hit target.
Missing generated cards fall back to the original source statement; unresolved
references have a normal popover instead of an error toast. Resolution runs bounded
parallel batches and reports progress. The repaired 22-node textbook resolve stage
took approximately 85 seconds; ingestion still includes model-backed card preparation.

Contextual citation matching uses invoking text, corpus-scoped candidates, a confidence
threshold, and a verified verbatim source excerpt. It handles differently numbered
lecture citations and source-label typos without equating exercises with prerequisites.
All seven citations in the supplied pset now link (eight overlays because one wraps):
dimension theorem/rank–nullity → Theorem 2.4; exchange lemma → Theorem 2.3;
Proposition 7 → Proposition 1.5; Proposition 9 → Theorem 2.3(ii);
Theorem 3.5 → Corollary 3.5; Theorem 3.4 → Theorem 3.4. Cards use the actual source label.
Newly resolved references in earlier documents are also baked after later uploads.

Validation: 19 worker tests, 84 intelligence tests, workspace typecheck and isolated
production build pass; four concurrent fresh-database schema initializations pass.
Real database retry/reprocess, source-card fallback/unmatched-popover browser checks,
and worker-to-intelligence integration including outage recovery pass. These repairs
do not supersede the broader quality limitations or the original A4 benchmark below.

The fixture reader is complete. **The whole project is not yet fully accepted.**
All three sessions are merged into `main` (audit baseline `19801c5`). This audit
fixed integration defects and separated runnable code from missing quality evidence.
Percentages would conflate fixture implementation with live semantic acceptance;
the phase-by-phase results below show what is actually done.

## Session A

| Phase | Completed and verified | Remaining |
|---|---|---|
| A0 contracts/fixtures | Two valid envelopes: 26 nodes, 35 edges, 15 anchors/cards, 3 entities. | Most chapter statement fields are placeholders; this is not a vetted real-book benchmark. |
| A1 parsing | Three PDFs: 0% span-count discrepancy, no empty pages, quality 0.994–0.996. | Five real source candidates have not been vetted. |
| A2 segmentation | Golden chapter: 20/20 nodes, precision/recall 1.000 offline. Numbered problems now segment (6/6 in the sample pset); remarks no longer leak into the preceding result, and cross-page boxes use only the starting page. | Broader real-book quality remains unmeasured. |
| A3 anchors | Finds 15/15 annotated anchors; explicit resolution 28/29 = 0.966. Actual PDF text geometry now gives reference-sized boxes: 41/41 detected references across both sample PDFs match text rectangles with 0px discrepancy. | Detection recall does not establish precision; broader documents remain untested. |
| A4 edges | Defined operators and terms, generic named references, scoped labels and explicit restatements. Original F1 improved **0.390 → 0.627** (P 0.762, R 0.533). Separate source-evidence development evaluation: 21/24, no extras, F1 0.933. | **Original >0.75 gate still fails**; some original annotations are unsupported. The new evaluation does not replace it or establish held-out textbook quality. |
| A5 hardening | Four-document snapshot includes PDFs and 50 linked cards. Fresh/repeat restore: 0.85s. In-process A→C→Postgres passes. **Live HTTP upload → worker → resolve → bake → browser passes:** 20 nodes, 36 anchors, 34 cards, ready/done, original PDF bytes, scoped search, duplicate ID and no runtime errors. Failed uploads can retry under the same document ID; parsed node IDs survive re-ingestion. Concurrent retry database checks pass. | Broader real-book coverage remains. |
| A6 integration support | Byte storage, snapshot, failure propagation and shared spending handoffs implemented. | Support live quality evaluation. |

The former A4 score was 0.789 because the extractor explicitly referenced golden
labels such as `Theorem 3.14` and `Lemma 3.15`, invented dependencies from proximity,
and tagged an offline rule as `llm`. Those rules also affected arbitrary uploads.
After removing them, the unchanged benchmark gives 11 edges: precision 0.727,
recall 0.267, F1 0.390. The threshold was not lowered; `eval_golden.py all` still
exposes this failure. New tests verify that unrelated theorems sharing those labels
remain unconnected and that actual references with other numbers still resolve.
A subsequent improvement pass raises the unchanged score to 16/21 correct edges
out of 30 expected: precision 0.762, recall 0.533, F1 0.627. The graph remains
acyclic; 4/5 theorems have an incident edge. `fixtures/evals/dependencies.json`
separately records 24 manually reviewed source-backed connections, literal
evidence excerpts, the source PDF hash and invalid-original-annotation examples.
It scores 21/24 with no extras (F1 0.933). This is a development evaluation,
not independent annotation or a replacement for the original acceptance gate.

## Session B

**B0–B6: all seven frontend phases are implemented and previously fixture-accepted.**
Current typechecks, production builds, fixture validation and in-process API checks
pass. The audit fixed corpus-scoped search, uploaded-document tracing/search,
database-reader serialization, duplicate upload handling and the Costs panel.

Historical `.cairn-sessions/FRONTEND-RESULT.md` evidence includes 300 physical
coordinate checks (maximum 0.01474px), 50 hover cards, a 200-node map at 60.3fps,
selection, dwell, upload/SSE, empty/error states and screenshots. These are prior
fixture results. Fresh checks now pass 300 PDF coordinates (same 0.01474px maximum),
50 hover cards, physical selection, error/retry states and four-document upload/SSE.
The original 200-node zoom check fell to 11.9fps; batching edge paths and excluding
hidden labels now yields 30.9fps, above the 30fps gate. These are local fixture
measurements. Private-artboard fidelity remains unverified.

## Session C

| Phase | Completed and verified | Remaining |
|---|---|---|
| C0 accounting | Shared durable Python/TypeScript reservations; 50-call synthetic ledger and four-connection race pass. | Actual provider billing/cache behavior unmeasured. |
| C1 instantiation | Validated notation rewriting, clause IDs, original-statement fallback, persisted/idempotent baking. **Live model responses now pass 20/20 clause selections and 20/20 rewrites** through the real bake route; no answer replays. | Cases are authored development mathematics, not source-PDF clause-selection acceptance. Composite notation remains conservatively unsupported. |
| C2 search | Live four-document search now ranks the right theorem first for both “rank nullity” and its kernel/image paraphrase, even though the theorem name is absent from the statement. Readable operator text plus bounded paraphrasing of short unmatched queries improves retrieval. | Authored-corpus coverage only. Cold unmatched-query expansion took 5.65s; direct paraphrase query took 1.07s. Broader quality/latency evaluation remains. |
| C3 resolution | Live four-document evaluation now merges 3/3 notation restatements with confidence 1.0 and makes zero false merges among 21 distinct source statements. Accepted equivalence now creates restatement edges for graph traversal. | Broader/source-PDF semantic equivalence quality; the original pset contains problem requests rather than three complete restatements. |
| C4 trace/forward | Bounded traversal, Postgres path, read state and PageRank tested. Actual parsed sample proof reaches the expected theorem/kernel/image prerequisites in 41–298ms over five HTTP checks. | Independent review of hard real-textbook proofs remains. |
| C5 cost reduction | Live C1 bake: $0.072484 first run, $0 warm repeat, identical cards. Fresh sample PDF pipeline: $0.427567 first ingest, zero paid calls on duplicate upload, identical graph/cards. | These are warm reuse measurements. **No measured ≥60% cold full-pipeline optimization comparison**, and no such savings claim. |
| C6 voice, optional | Reader controls, visible context, citations, bounded relay, PCM capture, streamed playback and cancellation. Controlled browser and actual WebSocket checks pass. Latest live Deepgram→Sol→Deepgram turn recognized the question and cited its source; first speech at 3.192s from recording release, including final recognition. **User accepted this latency and requested no further tuning.** | Broader spoken correctness is not established by one turn. The original strict <3s target is slightly exceeded. |
| C7 submissions | Seven sponsor drafts. | Final evidence/screenshots and eligibility checks; nothing submitted. |

## Changes made by this audit

- Worker C-service failures now propagate into ingestion errors rather than `ready`.
- CLI imports, fixture loading and the four-document dump preserve PDF bytes.
- Database reader data strips raw PDF buffers through the public `Doc` schema.
- Duplicate live uploads reuse the existing document; abnormal worker exits fail.
- Search is corpus-scoped and includes fixture uploads; trace and viewport-answer
  routes also see uploads. Actual selected text can match a unique containing node.
- C's fixture trace route exposes the known authored proof trace. Its fallback is
  restricted to that passage rather than arbitrary selections on the page.
- `/api/intel/costs` and the Costs panel display recorded nonsynthetic usage.
- Python and TypeScript reserve spending atomically before model requests, disable
  retries, bound requests, reject unknown pricing/missing usage, retain uncertain
  reservations, and block further calls after an overrun.
- Worker configuration no longer reads `.env`; guarded/isolated verification
  launchers prevent implicit credential-file loading.
- Removed hardcoded golden edge answers and incorrect LLM attribution.

## Verification performed

Passed: 77 intelligence tests; 3 PCM conversion tests; 2 HTTP-origin tests; 17 Python regression tests; workspace typechecks;
golden contract validation; four local demo fixtures with 49 nodes/50 cards;
production compilation; environment-file-free isolated production build.

Real Postgres checks pass for three controlled restatements, 20 linked cards,
repeat baking, stale-snapshot rejection and 50 synthetic ledger rows. Real ES
protocol checks pass with controlled embeddings. Budget checks cover historical
spend, default denial, exhaustion, settlement, overrun blocking and contention.

The actual C route handlers pass an in-process integration with A: parse PDF,
persist 20 nodes, resolve/bake, retain PDF bytes, skip identical re-ingest,
propagate an injected service outage, and recover on retry. Zero paid calls.
Separate frontend route checks pass for uploaded-document search/trace, corpus
isolation, invalid IDs, raw-PDF exclusion and synthetic-cost exclusion.
The four-document snapshot restores and re-restores in 0.85s in disposable databases.

**Not passed:** A4's original quality gate; broad real-book C1/C2/C3 semantic acceptance;
C5 measured savings; broad C6 spoken correctness. One live voice turn passes and
the user accepted its 3.192s latency. Full database upload over HTTP now passes.

## External limits

No OpenAI or Deepgram credentials were supplied to the agent's process environment.
A root `.env` exists, but `INTEGRATION.md` records the user's prohibition on all
`.env` access, including implicit framework loading. It was not opened. Isolated
builds explicitly exclude environment files. The user privately started the live
server with their configuration; provider checks go through its HTTP/WebSocket
routes. The private artboards remain inaccessible.

The user started the live server on port 3003; the agent's isolated fixture server
runs on port 3004. Earlier policy rejections of database-server startup were
resolved by the user's private launcher. Live upload testing exposed numeric
mapping conflicts in Elasticsearch, stale nodes after failed re-ingestion, and
truncated large model responses. Explicit numeric mappings, complete-corpus
index synchronization and bounded adjudication batches address those failures.
Final transport acceptance passes, including real model calls, 34 persisted cards,
SSE completion, PDF byte preservation, browser rendering and corpus-scoped search.
The reader now offers stored-PDF retry and follows pending ingestion via SSE.
The retry helper atomically resets progress and dispatches once under concurrent
requests. The real browser retry also passes: stored PDF, native worker dispatch,
same document ID, SSE-driven refresh, cross-origin rejection and no runtime errors.
The empty-PDF retry test makes zero provider calls. Final production build and
workspace typechecks pass. The private launcher's next invocation also retains the current server
when its ingestion-status request fails; a failed poll no longer implies idle.

Current evidence: `.cairn-sessions/current-browser/transport-results.json`,
`live-voice-streaming-results.json`, `playback-results.json`, `retry-results.json`, and the browser
interaction/physical/ingest reports in that directory. At the end of this live
check, nonsynthetic ledger estimates total **$2.021039**; the $500 guard remains.
That was the earlier integration snapshot; later quality checks add paid ledger
rows. Use the Costs panel for the current total.
These are application estimates, not provider invoices. One interrupted call
retains a $1.523840 reservation rather than being assumed free.

## Reproduction

Use explicit process variables, not credential-file loading. Install the worker in
a Python environment with `pip install -e 'apps/worker[dev]'`. Database checks need
process `DATABASE_URL`; search uses `ELASTICSEARCH_URL` or localhost:9200.

```text
pnpm typecheck
pnpm test:contracts
pnpm --filter @cairn/intel test
pnpm --filter @cairn/intel test:db
pnpm --filter @cairn/intel test:search
pnpm --filter @cairn/intel test:budget
python -m pytest apps/worker/tests -q
python apps/worker/scripts/check_integration.py
python apps/worker/scripts/prepare_demo.py
pnpm --filter @cairn/web exec tsx scripts/integration-acceptance.ts
node apps/web/scripts/isolated-verification.mjs build
```

`prepare_demo.py` uses/deletes only its own random databases. The worker integration
check uses/deletes its own random corpus and replaces HTTP transport with a route
harness. The original edge gate is reproducible with:

```text
python apps/worker/scripts/eval_golden.py all fixtures/golden/analysis-ch3.pdf fixtures/golden/pset4.pdf apps/web/demo/demo-0.pdf
```

Database-backed offline mode: `USE_FIXTURES=0`,
`CAIRN_INTELLIGENCE_MODE=deterministic`, `DATABASE_URL`,
`CAIRN_WORKER_COMMAND` pointing to the installed executable, and `WEB_BASE_URL`
pointing to the web server. This means lexical search, exact-statement equivalence
and original-statement cards. Default fixtures prefer A's two golden documents;
set `FIXTURES_DIR` to absolute `apps/web/demo` for B's four-document demonstration.

Apply `packages/contracts/migrations/001_api_budget.sql` after the core schema.
Worker `db-init` and new Docker databases apply it automatically; existing Docker
databases need it applied explicitly. The shared row defaults disabled and cannot
exceed $500. Reconcile its opening balance with any spending outside `llm_calls`
before enabling. Paid operation additionally requires process `CAIRN_LIVE_API=1`
and `OPENAI_API_KEY`. This is an application guard, not a provider-account hard cap.
Unknown outcomes retain reservations until reconciled. Speech now uses a bounded
server relay. The local budget row was enabled under the recorded $500
authorization after verifying zero calls, reservations and opening balance;
the ceiling was preserved. Paid calls still require explicit process opt-in and
credentials. Testing servers use `CAIRN_LIVE_API=0`.

No credential-file access, deployment, submission or push was performed during
this audit. Live API tests now produce actual ledger rows; consult the Costs panel
for updated totals. Changes are in the working tree for review.
