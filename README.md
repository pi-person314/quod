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

On macOS/Linux, create the worker environment with:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -e "apps/worker[dev]"
```

Copy `.env.example` to a private root `.env` and set `OPENAI_API_KEY`.
`DEEPGRAM_API_KEY` is optional and only needed for voice. To authorize paid calls,
explicitly enable the existing shared spending guard once:

```sh
docker compose exec -T postgres psql -U cairn -d cairn -c "UPDATE api_budget SET enabled=true WHERE id='cairn-total';"
```

Start fresh from the current source (stop the previous server with Ctrl+C first):

```sh
docker compose up -d --wait
pnpm dev:live
```

Open **http://127.0.0.1:3003** and upload a selectable-text PDF. `dev:live`
loads the root `.env`, overrides fixture mode, enables live provider calls, locates
the local worker environment, and sets the worker callback URL to the actual port.
It checks database access, the spending switch, and Elasticsearch before starting.
Use `pnpm dev:live --check` to run those checks without starting a server or calling providers.
It does not load an older verification build. Set `PORT` to use another port.
The launcher never enables or resets the shared budget. The guard defaults to a
$500 ceiling; enabling it preserves the existing balance. Restore the existing
database when moving machines to retain spending history.

`pnpm dev` runs the web server alone; its default is the fixture demonstration.
Use `pnpm dev:live` for real uploads and model calls. Synthetic fixture results
have no API costs. `pnpm test:startup` checks the live launch configuration without
loading private credentials or making paid calls.

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

## Google login and private corpora

Root `.env` supplies the six `NEXT_PUBLIC_FIREBASE_*` values from the Firebase web app settings. Both `pnpm dev` and `pnpm build` now load that file; restart after changing public variables. Use `pnpm dev:live` for real PDF ingestion.

Enable Google under Firebase Authentication → Sign-in method. Add the browser host (`localhost`, and `127.0.0.1` if used) to Authentication → Settings → Authorized domains. Create the default Firestore database and deploy the repository's `firestore.rules` to the same project after reviewing any existing rules:

```sh
firebase deploy --only firestore:rules --project YOUR_FIREBASE_PROJECT_ID
```

The header supports Google login and logout. Adding a corpus prompts login first. The server verifies Firebase ID tokens, sets an HTTP-only session cookie, and writes `corpora/{corpusId}` in Firestore with an immutable `owner_uid`. Login reloads only that owner's corpora. PDFs, parsed nodes, and the processing graph remain in PostgreSQL; their APIs also check Firestore ownership. No Firebase Admin service-account credential is needed. The public Firebase configuration is not an authorization mechanism: the deployed Firestore rules enforce ownership.

Existing pre-login corpora are not assigned to arbitrary accounts. To perform the requested one-time reset, stop the web server and ingestion workers, then run:

```sh
pnpm reset:corpora --confirm
```

This removes the existing PostgreSQL corpora, cascaded document data, matching Elasticsearch records, and local uploads. It preserves spending/accounting records. It is intended before creating account-owned Firestore corpora; it does not delete remote Firestore metadata.

PDF processing keeps its existing local worker callbacks; no worker secret is required. Firebase login controls corpus creation and history. Resolution errors identify the failing stage without exposing provider credentials.

Verification:

```sh
pnpm test:auth
pnpm --filter @cairn/web exec node scripts/auth-browser.mjs
```

The browser check covers anonymous access and header/upload presentation. Completing a real Google sign-in and deploying rules require access to your Firebase project.
