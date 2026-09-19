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

_(none yet)_

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
