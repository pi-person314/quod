# INTEGRATION.md — cross-session issues and checkpoint log

Append-only. When you need a change in a directory you do not own, add an
issue here, stub around it locally, and keep moving. The owner picks it up at
their next natural pause. Do not commit into another session's directory.

## Issue format

```
### [open|done] <short title>   (from <A|B|C> -> for <A|B|C>, hour N)
What I need, why, and what I stubbed in the meantime.
```

## Issues

### [open] demo.dump holds two documents, not four   (from A -> for A, hour 0)
`fixtures/demo.dump` snapshots the A0 golden pair (chapter + pset). The spec's
four-document demo corpus needs lecture notes and slides; add them to
`fixtures/golden/` (or ingest them live) and re-run `make demo-dump`.

### [open] A0 demo PDFs are generated, not pre-vetted textbook chapter   (from A -> for A/B, hour 0)
`fixtures/golden/analysis-ch3.pdf` and `pset4.pdf` were built by `apps/worker/scripts/build_a0_golden.py` so `pnpm test:contracts` and B1 can proceed without uploaded books. Replace with your LaTeX chapter/pset PDFs and regenerate or hand-edit JSON bboxes when ready.

## Additive contract extensions

Optional fields added to API shapes in `packages/contracts/types.ts` by a route
owner. One line each: field, route, who, why.

_(none yet)_

## Checkpoints

### Checkpoint 1 (hour 6) — fixture-backed reader shows a real instantiated card
- [ ] A: A1–A2 parse and segment
- [ ] B: B0–B1 shell and coordinates
- [ ] C: C0–C1 wrapper and instantiation
- Result:

### Checkpoint 2 (hour 12) — live parse of one real book renders end to end
Hard gate: if this fails, cut to fixtures for the demo and say so in the write-up.
- [ ] A: A3–A4 anchors and edges
- [ ] B: B2–B3 cards and ingest UI
- [ ] C: C2–C3 search and resolution
- Result:

### Checkpoint 3 (hour 17) — feature freeze
- [ ] A: A5 hardening, `fixtures/demo.dump`
- [ ] B: B4–B5 trace and map
- [ ] C: C4–C5 endpoints and cost table
- Result:

## Session C integration notes

### [open] Invoking context for grounded cards (from C -> for A)
C's card generator accepts an invoking paragraph and a local symbol table. The frozen
Anchor and current SQL schema do not persist those inputs. Please propose a persisted
context source or an accessor without changing the core Anchor shape. Until agreed,
Postgres baking produces original-statement cards; tests supply context explicitly.

### [open] Shared spending protection before live calls (from C -> for A)
User ceiling is $500 total. C's default model/embedding transports are disabled.
Pure reservation/settlement transitions are tested, but a shared durable atomic store
and participation by A's Python wrapper remain undecided. A Postgres reservation design
has been proposed to the user; no schema changes have been made. Monthly account limits
are separate from this total-work budget. Unknown outcomes must retain reservations.

### [open] Search indexing and real-corpus acceptance (from C -> for A)
C's ES client provides indexNodes(corpusId, nodes) and corpus-scoped candidate search.
Agree on indexing after segmentation and before resolution, plus metadata refresh after
entity assignment. C-owned synthetic fixtures and answer replays do not replace A's
golden corpus or establish the 17/20 live model acceptance criterion.

### [open] C route fallbacks ready for reader integration (from C -> for B)
Fixture bake/resolve/trace/forward/search handlers now honor USE_FIXTURES and FIXTURES_DIR.
Fixture search is lexical. Trace currently matches explicit in-document labels/titles;
vague selections return an empty chain. read_node_ids produce read flags, per frozen
types. Original cards preserve the complete statement; clause IDs are display hints.
Live resolution remains 503 until spending protection and persistence integration land.
The user forbids all .env access, including implicit framework loading during our tests.

### [open] C3 orchestration and trace update (from C -> for A/B)
Resolution now has a serializable Postgres adapter, stale-snapshot detection and
post-save search metadata refresh. Low-confidence evidence is returned without
merging entities. Trace now also follows resolved anchors across documents.
Default live calls remain disabled; real DB/ES verification is pending because
the image pull failed and the Docker daemon became unavailable.

### [done] C service verification and context fallback update (from C -> for A/B)
Docker recovered. Real Postgres tests now pass for persisted resolution, linked
cards, repeated bake IDs, stale-snapshot rejection, ledger totals and report filtering.
Real Elasticsearch tests pass with deterministic local vectors, including persisted
vector reuse. Trace now uses bounded recursive SQL; synthetic cross-document traces
ran in roughly 7ms locally, not a real-proof latency result.
C can obtain invoking context from a unique paragraph inside a containing parsed
node with an unambiguous symbol table. A need not add a schema field for that case;
incomplete context still falls back and real golden-corpus evaluation remains open.

### [open] Optional voice integration (from C -> for B)
BrowserVoiceCompanion is exported at @cairn/intel/voice/client. Bind start/stop to
push-to-talk and cancel to navigation/unmount. See packages/intel/voice/README.md.
New additive C routes: POST /api/intel/voice/token, /answer, /speak. Request schemas
live in C's voice module; the frozen core contracts are unchanged. Answer requests
carry doc_id, page, visible_node_ids and question. Responses carry answer/citations.
Mocked provider and cancellation tests pass; live speech remains disabled pending
spending controls, runtime credentials, reader wiring and actual audio acceptance.

### [open] C5/C7 evidence handoff (from C -> for A/B)
Content-keyed embedding reuse is persisted in ES; C model-result reuse is bounded
and process-local. Cost comparison requires matching corpus/settings/eval cases and
unchanged quality, and distinguishes cold, repeat, C-only and full-pipeline runs.
No measured savings claim exists yet. Seven submission drafts are prepared in
packages/intel/artifacts/submissions.md; B's screenshots and actual run evidence
must replace the listed gaps before submission. Nothing has been submitted.
### [open] Upload worker dispatch seam (from B -> for A, B0/B3)
B stores uploaded PDF bytes and inserts documents + ingest_progress rows in live mode. Current worker has a CLI but no queue consumer or HTTP dispatch contract. Please add/confirm a consumer for queued documents, or an enqueue endpoint. Until then fixture mode performs real browser PDF text extraction and streams those detected numbered results; it does not claim semantic resolution of uploads. B-owned /api/library and /api/doc/:id/pdf expose reader data and source bytes. Web-local demo fixtures are used only when golden has no JSON; A data is never overwritten.

### [open] Intelligence and measured-cost integration (from B -> for C, B4/B6)
C handlers remain untouched. Web-local client adapters call /api/intel/trace, /api/intel/forward/:entity_id and /api/search and use contract-validated local graph results only in fixture mode if unavailable. Please confirm a read-only cost-report response/endpoint for measured baseline and optimized runs. The UI currently reports no measured comparison rather than invented savings.

### [done] Local CLI upload dispatch adapter (from B -> for A, B3)
B now stores live PDF bytes, inserts queued progress, writes the source to apps/web/.local-data/pdf, and invokes the existing `cairn-worker ingest <path> --corpus-id <id>` CLI through child_process.spawn with shell:false and windowsHide:true. CAIRN_WORKER_COMMAND may specify the native executable. Startup/exit failures become document/progress error states. A service queue remains a deployment integration choice; no live backend validation was possible in the fixture-only checkout. Null progress messages are normalized before IngestEvent validation.

### [done] Cross-session audit and integration repairs (2026-09-19)
The user's explicit cross-session completion request authorizes A/B/C edits in this
audit. See PROJECT_STATUS.md for the full phase-by-phase acceptance state. Added the
shared durable budget migration without changing frozen core response schemas;
both runtimes reserve before paid calls and default to disabled. Worker failures
propagate, CLI/fixture PDFs are retained, duplicate uploads reuse IDs, reader data
excludes PDF byte buffers, uploaded fixtures participate in scoped search/trace,
and the Costs panel reads nonsynthetic ledger rows. Four-document snapshot plus
repeat restore passes in 0.85s. Real A parsing through C route handlers and Postgres
passes in-process, including idempotency, outage propagation and retry recovery.

### [open] Acceptance gaps exposed by audit (2026-09-19)
A4's former passing score depended on hardcoded golden theorem numbers and an
offline rule mislabeled as LLM output. Those rules are removed; the unchanged
golden edge gate now honestly fails at F1 0.390. Live semantic model quality,
four-document semantic retrieval, measured >=60% savings and voice remain
unaccepted. Process credentials are absent; the no-.env rule remains respected.
Automatic approval review blocked server starts, even from a verified isolated
copy without environment files; no fresh browser/HTTP acceptance is claimed.

### [done] Voice reader/relay integration and resumed browser testing (2026-09-19)
Supersedes the missing-reader handoff above. The custom Next server supports a
same-origin WebSocket relay; normal dev/start commands use it. Reader push-to-talk
captures visible context, streams bounded PCM and shows cited answers. Navigation
and barge-in cancel capture/playback. Deepgram requests reserve against the same
durable budget as models; direct browser provider tokens remain disabled.
72 intelligence tests and three PCM sample-rate tests pass. Browser capture and
playback with controlled providers and actual WebSocket origin/disabled-live
checks pass. The isolated fixture server starts, but automatic approval review
still rejected a database-backed test server with "blocked by policy".
See packages/intel/voice/README.md for private user-run startup instructions.
The local $500 budget was enabled after verifying zero calls/reservations/opening
balance; testing processes still disable live calls. Real provider quality and
latency remain unmeasured. No credential file was accessed or paid calls made.

### [done] Live local acceptance, superseding earlier blockers (2026-09-19)
The user privately started the isolated database-backed launcher. No agent access
to `.env` occurred. A real HTTP upload now completes parsing, resolution, baking
and reader rendering: 20 nodes, 36 anchors, 34 cards, ready/done, byte-identical
PDF, idempotent duplicate upload, SSE completion and scoped search all pass.
Fixed Elasticsearch numeric mappings, stale corpus-index entries, stable parsed
node IDs, bounded model adjudication and contradictory new-merge handling.
Existing-entity contradictions still stop for review instead of splitting data.

Real Deepgram recognition, Sol answer/citation and streamed Deepgram playback
pass in the browser. Release-to-first-speech measured 3.192s; the user accepted
this and requested no more latency work. Playback-before-completion, navigation
cancellation and same-origin browser requests pass. Total nonsynthetic ledger
estimate after these checks: $2.021039; unresolved reservations remain committed.
The reader now supports stored-PDF retry and SSE progress; concurrent retry
database checks and real browser/native-worker retry pass without provider calls.
Final production build and typechecks pass. See PROJECT_STATUS.md for remaining
quality benchmarks. No push, deployment or external submission in this audit.

### [done] Dependency and live-quality improvement pass
Original dependency F1 is now 0.627 (was 0.390); its >0.75 gate still fails.
A separate source-evidence development manifest scores 21/24 with no extras and
keeps unsupported original annotations documented rather than silently replacing
the original benchmark. Added generic operator/term dependencies, named-theorem
matching, explicit restatement relations, document scoping and remark boundaries.
Numbered problems now segment, multipage nodes use starting-page boxes, and
anchors use PDF substring geometry (41/41 exact rectangle checks on two samples).

Real bake outputs pass 20/20 clauses and rewrites. Real resolution merges 3/3
restatements with zero false merges among 21 source statements and creates graph
edges that the HTTP cross-document trace follows. Four-document live semantic
search passes both tested paraphrases; bounded expansion improves short unmatched
queries but adds cold latency (5.65s here). Authored-case scope remains explicit.
An actual sample proof traces in 41–298ms. Duplicate PDF upload preserves the
graph/cards and costs zero additional calls; this does not establish ≥60% cold
pipeline savings. See packages/intel/artifacts/QUALITY-RESULTS.md.
