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

See [PROJECT_STATUS.md](PROJECT_STATUS.md) for the current phase-by-phase audit,
integration fixes and reproducible checks. The fixture frontend is complete;
live model quality, edge quality, measured savings and voice are not fully accepted.

## Run

Fresh Windows setup: install Node.js 22, Python 3.11+, Git and Docker Desktop.
Run these commands from the project root, with Docker Desktop running:

```powershell
npm install -g pnpm@10.15.1
pnpm install --frozen-lockfile
py -3 -m venv .session-tools/worker-venv
.\.session-tools\worker-venv\Scripts\python.exe -m pip install -e "apps/worker[dev]"
docker compose up -d --wait
```

Create a private root `.env` containing `OPENAI_API_KEY` and `DEEPGRAM_API_KEY`.
The user-run launcher below supplies the local database/search/worker settings.
Enable the existing spending guard, then build and launch:

```powershell
docker compose exec -T postgres psql -U cairn -d cairn -c "UPDATE api_budget SET enabled=true WHERE id='cairn-total';"
node apps/web/scripts/isolated-verification.mjs build
node --env-file=.env apps/web/scripts/start-local.mjs
```

Open **http://127.0.0.1:3003** and upload a selectable-text PDF. Keep the terminal
running. The launcher reloads successful builds and keeps private configuration
in its process. The guard defaults to a $500 ceiling; enabling it does not reset
the existing balance. A fresh database has no other machine's spending history;
restore the existing database to retain that accounting.

Subsequent starts only need `docker compose up -d --wait` and the launcher command.
Run the build command again after frontend changes. `pnpm dev` instead starts the
fixture demonstration; it does not configure the complete live stack.

## Layout

| Path | What |
|---|---|
| `apps/web` | Next.js reader: PDF.js overlay, hover cards, trace panel, corpus map |
| `apps/worker` | Python ingest: parse, segment, anchors, edges |
| `packages/contracts` | zod types, `schema.sql`, fixture validator |
| `packages/intel` | LLM wrapper + cost ledger, instantiation, resolution, search, trace |
| `fixtures` | golden corpus and demo snapshot |

Architecture, evals and the cost table land here as the build progresses.

The worker reads process variables only. Agent verification must not load `.env`:
`node apps/web/scripts/isolated-verification.mjs build` makes a separate source
copy excluding environment files. The shared API budget stays disabled by default.

Voice controls and the bounded speech relay are implemented. See
[voice setup](packages/intel/voice/README.md) for the private user-run launcher
and the remaining live-provider acceptance checks.

MIT licensed.
