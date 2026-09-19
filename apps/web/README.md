# Cairn web

Run from the repository root with native Windows Node/pnpm:

```powershell
pnpm install
$env:USE_FIXTURES = '1'
pnpm dev
```

Golden fixtures are now available and load by default. To rehearse the four-document web-local demo described below, set `$env:FIXTURES_DIR = (Resolve-Path apps/web/demo).Path` before starting the server.

Open http://localhost:3000. The demo button opens the problem set; hover **the dimension theorem**, then **Jump to source**. The textbook outline includes **Why Rank-Nullity holds** on page 4 for the selection/trace demonstration. `/`, `M`, `P`, `[`, arrow keys, and `?` provide reader shortcuts.

The committed `demo/` contains original teaching PDFs, with embedded Computer Modern-family fonts, and contract-valid local data. Golden fixtures take precedence automatically when A0 supplies them. `DESIGN.md` is the provided visual specification; the private artifact was inaccessible during implementation.

Fixture uploads preserve the actual PDF and inspect its text layer in PDF.js. Numbered results are streamed over SSE. This fallback is deterministic extraction, not the A/C semantic ingestion pipeline. Local uploads persist in ignored `apps/web/.local-data/`; reader state persists in browser localStorage. Scanned or encrypted files have an unsupported state; PDFs without numbered results can still be read.

For live mode set `USE_FIXTURES=0` and `DATABASE_URL` in the web environment. The upload route stores bytes in Postgres and dispatches the existing native `cairn-worker ingest` CLI. `CAIRN_WORKER_COMMAND` can provide its executable path. The Python worker, database, and C endpoints must be installed/configured separately. A deployed service queue remains an integration concern. No measured savings are displayed until a real cost comparison is supplied.

## Acceptance commands

```powershell
pnpm typecheck
pnpm test:contracts
pnpm --filter @cairn/web exec tsx scripts/validate-demo.ts
pnpm --filter @cairn/web exec tsx scripts/logic-acceptance.ts
pnpm build
$env:USE_FIXTURES = '1'
$env:CAIRN_ACCEPTANCE = '1'
$env:FIXTURES_DIR = (Resolve-Path apps/web/demo).Path
pnpm --filter @cairn/web start -p 3001
```

In another terminal:

```powershell
pnpm --filter @cairn/web exec playwright install chromium
pnpm --filter @cairn/web exec node scripts/acceptance.mjs
pnpm --filter @cairn/web exec node scripts/interaction-acceptance.mjs
pnpm --filter @cairn/web exec node scripts/ingest-acceptance.mjs
```

Tests save evidence under `.cairn-sessions/` and create local upload corpora. The acceptance-only `/acceptance/map` route builds 200 nodes / 582 edges; it returns 404 in production unless `CAIRN_ACCEPTANCE=1`. Its benchmark measures interaction frame rate after deterministic D3 force layout settles, not server inference or worker throughput. Development output uses `.next-dev`; production uses `.next`.

Regenerate demo PDFs with `pnpm --filter @cairn/web exec node scripts/demo.mjs`, then `python apps/web/scripts/align-demo.py` (requires PyMuPDF) to reconcile bboxes directly with the generated PDF text. Regeneration is unnecessary for normal startup.
