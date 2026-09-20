# Quod web

Run from the repository root with native Windows Node/pnpm:

```powershell
pnpm install
$env:USE_FIXTURES = '1'
pnpm dev
```

Golden fixtures are now available and load by default. To rehearse the four-document web-local demo described below, set `$env:FIXTURES_DIR = (Resolve-Path apps/web/demo).Path` before starting the server.

Open http://localhost:3000 and sign in with Google. Authentication and Firestore ownership apply in fixture mode too; fixture mode is not an authentication bypass. See the root README for Firebase setup. The reader supports hover cards, source jumps, pinned cards, search, dependency maps, trace, weak spots, voice, and keyboard shortcuts.

The current design comes from the supplied `Quod - UI mockups.html` export. `DESIGN.md` maps its seven artboards to the implemented views. Homepage animations are pre-rendered with Manim; the application does not need Python or Manim to play them.
Fixture uploads preserve the actual PDF and inspect its text layer in PDF.js. Numbered results are streamed over SSE. This fallback is deterministic extraction, not the A/C semantic ingestion pipeline. Local uploads persist in ignored `apps/web/.local-data/`; reader state persists in browser localStorage. Scanned or encrypted files have an unsupported state; PDFs without numbered results can still be read.

For live mode set `USE_FIXTURES=0` and `DATABASE_URL` in the web environment. The upload route stores bytes in Postgres and dispatches the existing native `quod-worker ingest` CLI. `QUOD_WORKER_COMMAND` can provide its executable path. The Python worker, database, and C endpoints must be installed/configured separately. A deployed service queue remains an integration concern. No measured savings are displayed until a real cost comparison is supplied.

## Acceptance commands

```powershell
pnpm typecheck
pnpm test:contracts
pnpm --filter @quod/web exec tsx scripts/validate-demo.ts
pnpm --filter @quod/web exec tsx scripts/logic-acceptance.ts
pnpm build
$env:USE_FIXTURES = '1'
$env:QUOD_ACCEPTANCE = '1'
$env:FIXTURES_DIR = (Resolve-Path apps/web/demo).Path
pnpm --filter @quod/web start -p 3001
```

In another terminal:

```powershell
pnpm --filter @quod/web exec playwright install chromium
pnpm --filter @quod/web exec node scripts/acceptance.mjs
pnpm --filter @quod/web exec node scripts/interaction-acceptance.mjs
pnpm --filter @quod/web exec node scripts/ingest-acceptance.mjs
```

Tests save evidence under `.cairn-sessions/` and create local upload corpora. The acceptance-only `/acceptance/map` route builds 200 nodes / 582 edges; it returns 404 in production unless `QUOD_ACCEPTANCE=1`. Its benchmark measures interaction frame rate after deterministic D3 force layout settles, not server inference or worker throughput. Development output uses `.next-dev`; production uses `.next`.

Regenerate demo PDFs with `pnpm --filter @quod/web exec node scripts/demo.mjs`, then `python apps/web/scripts/align-demo.py` (requires PyMuPDF) to reconcile bboxes directly with the generated PDF text. Regeneration is unnecessary for normal startup.
