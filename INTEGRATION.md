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

### [open] Upload worker dispatch seam (from B -> for A, B0/B3)
B stores uploaded PDF bytes and inserts documents + ingest_progress rows in live mode. Current worker has a CLI but no queue consumer or HTTP dispatch contract. Please add/confirm a consumer for queued documents, or an enqueue endpoint. Until then fixture mode performs real browser PDF text extraction and streams those detected numbered results; it does not claim semantic resolution of uploads. B-owned /api/library and /api/doc/:id/pdf expose reader data and source bytes. Web-local demo fixtures are used only when golden has no JSON; A data is never overwritten.

### [open] Intelligence and measured-cost integration (from B -> for C, B4/B6)
C handlers remain untouched. Web-local client adapters call /api/intel/trace, /api/intel/forward/:entity_id and /api/search and use contract-validated local graph results only in fixture mode if unavailable. Please confirm a read-only cost-report response/endpoint for measured baseline and optimized runs. The UI currently reports no measured comparison rather than invented savings.

### [done] Local CLI upload dispatch adapter (from B -> for A, B3)
B now stores live PDF bytes, inserts queued progress, writes the source to apps/web/.local-data/pdf, and invokes the existing `cairn-worker ingest <path> --corpus-id <id>` CLI through child_process.spawn with shell:false and windowsHide:true. CAIRN_WORKER_COMMAND may specify the native executable. Startup/exit failures become document/progress error states. A service queue remains a deployment integration choice; no live backend validation was possible in the fixture-only checkout. Null progress messages are normalized before IngestEvent validation.
