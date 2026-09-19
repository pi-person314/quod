# fixtures/ — shared, append-only

The thing that actually unblocks parallelism. Sessions B and C build against
`golden/` from minute one and never wait on the parser.

## golden/

One JSON file per source document, envelope `GoldenFixture` (see
`packages/contracts/types.ts` and CONTRACTS.md). All share corpus id
`00000000-0000-4000-8000-000000000001`.

Session A's Phase A0 commits, hand-authored from a real chapter of a real
LaTeX-produced textbook:

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

## Later

- `demo.dump` — A5 snapshot of the fully ingested four-document demo corpus.
  `make demo-db` restores it in under 30 seconds with no network.
- `trace/` — B4 hand-written `TraceResponse` examples for the stack-trace panel.
- `evals/` — C1 (20 instantiation cases) and C3 (resolution) expected outputs.
