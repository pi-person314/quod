# fixtures/ — shared, append-only

The thing that actually unblocks parallelism. Sessions B and C build against
`golden/` from minute one and never wait on the parser.

## golden/

One JSON file per source document, envelope `GoldenFixture` (see
`packages/contracts/types.ts` and CONTRACTS.md). All share corpus id
`00000000-0000-4000-8000-000000000001`.

Session A's Phase A0 commits, hand-authored from a real chapter of a real
LaTeX-produced textbook (or generated via `apps/worker/scripts/build_a0_golden.py`
until your PDFs are in place — see INTEGRATION.md):

| File | Contents |
|---|---|
| `analysis-ch3.json` | 20 nodes, 30 edges, 15 anchors, 15 cards |
| `analysis-ch3.pdf`  | the source pages, so B1 can render and align bboxes |
| `pset4.json`        | 6 nodes; three deliberately restate chapter theorems under different names and share their `entity_id` |
| `pset4.pdf`         | the source pset |

Rules:
- Bboxes must be real (measured off the PDF in PyMuPDF space) — B1 verifies
  alignment visually against them.
- IDs are hand-written UUIDs and never change once committed.
- Append-only after A0. Add new files; do not edit existing ones except to fix
  a value that is provably wrong, and say so in INTEGRATION.md.
- `pnpm test:contracts` must pass before every push.

## demo.dump

A5 snapshot of the ingested demo corpus, written by `cairn-worker dump-demo`.
Plain SQL rather than `pg_dump` output, so restoring never depends on a client
whose version matches the server. It opens by deleting the corpora it is about
to insert, so applying it twice is safe.

```bash
make demo-db        # schema + dump into $DATABASE_URL (offline, < 30s)
make demo-fixtures  # or load fixtures/golden/* directly, no dump needed
make demo-dump      # regenerate the snapshot from the current database
```

Currently two documents (the A0 golden pair); the demo corpus grows to four
once the lecture notes and slides land.

## Later
- `trace/` — B4 hand-written `TraceResponse` examples for the stack-trace panel.
- `evals/` — C1 (20 instantiation cases) and C3 (resolution) expected outputs.
