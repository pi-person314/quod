# Cairn

A textbook is a dependency graph flattened into a line. Cairn unflattens it.

Drop a course corpus in (textbook, lecture notes, problem sets, slides). Cairn
reconstructs the dependency graph across all of them and makes reading
adaptive: hover any reference to read the cited result in place, restated in
the notation of the page you are on; select a line to see the minimal chain of
prior results it rests on; and a pset's "the dimension theorem", the notes'
"Rank-Nullity" and the book's "Theorem 3.22" resolve to one node.

HackMIT 2026. Built by three parallel Claude Code sessions — see `CLAUDE.md`,
`CONTRACTS.md` and `sessions/`.

## Run

```bash
cp .env.example .env
pnpm install
pnpm infra:up            # Postgres + Elasticsearch
pnpm dev                 # reader on http://localhost:3000, fixture-backed by default
```

Worker (ingest):

```bash
cd apps/worker && pip install -e ".[dev]"
cairn-worker ingest path/to/pdfs
```

## Layout

| Path | What |
|---|---|
| `apps/web` | Next.js reader: PDF.js overlay, hover cards, trace panel, corpus map |
| `apps/worker` | Python ingest: parse, segment, anchors, edges |
| `packages/contracts` | zod types, `schema.sql`, fixture validator |
| `packages/intel` | LLM wrapper + cost ledger, instantiation, resolution, search, trace |
| `fixtures` | golden corpus and demo snapshot |

Architecture, evals and the cost table land here as the build progresses.

MIT licensed.
