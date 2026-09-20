# Quod — brief for every Claude Code session

Quod ingests a student's course corpus (textbook, lecture notes, psets,
slides) into one dependency graph and makes reading adaptive: hover a
reference and see the cited theorem restated in the invoking page's notation;
select a line and get the prerequisite chain; a pset's "the dimension theorem"
and the book's "Theorem 3.22" resolve to one node. HackMIT 2026, 24 hours.

Full spec: `Cairn — HackMIT 2026 Spec (1).pdf` — the OpenAI-stack revision;
`pdftotext -layout` works but the tables come out mangled. You should rarely need it — the seams are in
`CONTRACTS.md` and your phases are in `sessions/<A|B|C>.md`.

## Which session am I?

Three sessions on three machines work in parallel. Run
`git branch --show-current`:

| Branch | Session | Owns |
|---|---|---|
| `sess/a-ingest` | **A** | `apps/worker/`, `packages/contracts/`, `fixtures/` |
| `sess/b-reader` | **B** | `apps/web/` (route shells included) |
| `sess/c-intel`  | **C** | `packages/intel/`, `apps/web/app/api/intel/*`, Elasticsearch, cost ledger, voice |

If you are on `main`, ask the user which session this is, then
`git checkout -b sess/<name>` and read `sessions/<X>.md` before anything else.

## Rules

1. **Ownership is strict.** Never commit into another session's directory.
   Need something there? Write an issue in `INTEGRATION.md`, stub around it,
   keep moving.
2. **`CONTRACTS.md` is frozen.** Changing it is a synchronous decision by all
   three. Additive optional fields on API shapes are fine if logged in
   `INTEGRATION.md`.
3. **`USE_FIXTURES=1` must keep working to the end.** It is the demo fallback.
4. **Every model call is logged** to `llm_calls` — via `packages/intel/llm.ts`
   in TypeScript, `quod_worker/llm.py` in Python. No bare SDK calls.
5. **Merge to `main` only at checkpoints** (hour 6, 12, 17). Between them,
   pull `main` into your branch freely; never block on another session.
6. **Each phase ends with its acceptance test.** Do not advance until it
   passes. Overrun by 50% -> ship the phase's fallback and move on.
7. **Cut order:** F9, F8, F7, F6, F5. Never F1/F2/F3 (ingest, hover card,
   cross-document resolution — they are the project). F9 is forbidden before
   hour 17. F10 (shared annotations, needs auth) is decided before hour 4 or never.
8. Models are OpenAI, and that is itself a sponsor track: GPT-5.6 Luna
   (`MODEL_FAST`) for bulk classification, GPT-5.6 Sol (`MODEL_QUALITY`) for
   instantiation and resolution, `text-embedding-3-small` for the ES dense
   index. Keep the chapter context byte-stable and pass a `prompt_cache_key`
   per chapter so cached input (90% off) actually hits. No Batch API.

## Commands

```bash
pnpm install                 # workspace deps
pnpm infra:up                # Postgres + Elasticsearch (docker compose); schema auto-applied
pnpm db:schema               # re-apply packages/contracts/schema.sql (idempotent)
pnpm test:contracts          # validate fixtures/golden/* against the zod schemas
pnpm typecheck               # all TS packages
pnpm dev                     # Next.js on :3000 (USE_FIXTURES=1 from .env needs no backend)
cd apps/worker && pip install -e ".[dev]" && quod-worker --help
```

## Layout

```
CONTRACTS.md            frozen types, API surface, coordinate convention, seams
INTEGRATION.md          cross-session issues, checkpoint log
sessions/{A,B,C}.md     per-session phases, budgets, acceptance tests
packages/contracts/     types.ts (zod), schema.sql, db.ts, test.ts
packages/intel/         llm.ts wrapper + ledger, prompts/, scripts/cost-report.ts
apps/web/               Next.js 15 / React 19 / Tailwind 4; app/api/** route shells
apps/worker/            Python: quod_worker/{cli,pipeline,models,db,llm}.py, stages/
fixtures/golden/        A0 golden corpus (empty until A0 lands)
```
