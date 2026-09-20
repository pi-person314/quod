# Cairn integration audit — 2026-09-19

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
| A2 segmentation | Golden chapter: 20/20 nodes, precision/recall 1.000 offline. | Live clause/symbol enrichment and real-book quality unmeasured. |
| A3 anchors | Finds 15/15 annotated anchors; explicit resolution 28/29 = 0.966. | 36 total detections, so recall is not precision. A-specific physical overlay acceptance was not rerun. |
| A4 edges | Generic reference/notation extraction; misleading label-specific rules removed. | **Quality gate fails:** F1 0.390 versus required >0.75; 4/5 theorems have an incident edge. |
| A5 hardening | Four-document snapshot includes PDFs and 50 linked cards. Fresh/repeat restore: 0.85s. In-process A→C→Postgres passes. **Live HTTP upload → worker → resolve → bake → browser passes:** 20 nodes, 36 anchors, 34 cards, ready/done, original PDF bytes, scoped search, duplicate ID and no runtime errors. Failed uploads can retry under the same document ID; parsed node IDs survive re-ingestion. Concurrent retry database checks pass. | Broader real-book coverage remains. |
| A6 integration support | Byte storage, snapshot, failure propagation and shared spending handoffs implemented. | Support live quality evaluation. |

The former A4 score was 0.789 because the extractor explicitly referenced golden
labels such as `Theorem 3.14` and `Lemma 3.15`, invented dependencies from proximity,
and tagged an offline rule as `llm`. Those rules also affected arbitrary uploads.
After removing them, the unchanged benchmark gives 11 edges: precision 0.727,
recall 0.267, F1 0.390. The threshold was not lowered; `eval_golden.py all` still
exposes this failure. New tests verify that unrelated theorems sharing those labels
remain unconnected and that actual references with other numbers still resolve.
A source-grounded benchmark and semantic extraction evaluation are still needed.

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
| C1 instantiation | Validated notation rewriting, clause IDs, original-statement fallback, persisted/idempotent baking. | Existing 20/20 eval replays supplied answers: it does not prove the live 17/20 target. Composite notation remains conservatively unsupported. |
| C2 search | Real Elasticsearch mapping, indexing, vector reuse, hybrid queries and scope checks with controlled vectors. | Four-document semantic top-1 acceptance with real embeddings. |
| C3 resolution | Transactional persistence, stale-snapshot rejection, three controlled restatements and false-merge safeguards tested. Explicit deterministic mode merges exact statements only. | Live semantic equivalence quality. Exact-string mode does not meet the semantic target. |
| C4 trace/forward | Bounded traversal, Postgres path, read state, PageRank and selected-passage matching tested. Synthetic SQL trace: 70.7ms. | Human-reviewed real-proof latency acceptance; the synthetic timing is not that evaluation. |
| C5 cost reduction | Result/embedding reuse, reports, comparison validation and reader ledger display. | **No measured ≥60% full-pipeline savings**, and no savings claim. |
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

Passed: 75 intelligence tests; 3 PCM conversion tests; 2 HTTP-origin tests; 6 Python regression tests; workspace typechecks;
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

**Not passed:** A4's original quality gate; broad live C1/C2/C3 semantic acceptance;
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
