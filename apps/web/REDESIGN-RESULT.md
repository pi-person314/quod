# Quod redesign and upstream integration — 2026-09-20

Merged `origin/main` at `bece795` (Firebase Google OAuth and Firestore), restored
the Quod redesign, and resolved every Git conflict. The recovery stash remains
available. No commit, push, merge to a remote branch, or deployment was performed.

The supplied `Quod - UI mockups.html` is the design reference for the landing,
library, reader, margin cards, map, upload, search/trace/weak spots/cost/keyboard
panels, voice and application states. The homepage uses three actual rendered
Manim loops, with pause and reduced-motion support. Active branding and package
names use Quod; storage and legacy aliases are preserved as documented in
`QUOD-MIGRATION.md`.

Google authentication now covers redesigned navigation, corpus creation, upload,
library, reader and map. Runtime public Firebase configuration supports builds
made without opening environment files. Standalone UTF-8 `.tex` files compile in
Docker/Tectonic and use the existing PDF ingestion path. Mixed upload batches
are compiled and validated before document persistence.

## Verification

- Production build and TypeScript validation passed after the final code changes.
- Firebase/session/ownership tests: 5 passed; TeX validation tests: 3 passed;
  cross-platform live launcher tests: 5 passed.
- Contract fixtures, four demo PDFs (49 nodes, 50 anchors/cards), coordinate
  round trips, and the authored four-hop trace validation passed.
- Browser checks passed for homepage, all three animations, pause, library,
  PDF reader, outline collapse, hover/pin/unpin and source controls, search,
  map, upload and 404. No runtime page errors remained.
- Signed-out pages, anonymous API 401, non-owner 404, reduced motion, and
  mobile horizontal overflow checks passed.
- Real authenticated `.tex` API upload passed using synthetic Firebase/Firestore
  identities in an isolated test process: valid PDF bytes, correct one-page
  metadata, original filename, and malformed-source 400 response.

The TeX retest initially timed out while concurrent builds exhausted available
memory and Docker stalled. Docker inspection now allows 20 seconds. The final
complete upload passed after build load cleared; compilation remains bounded
at 45 seconds. These checks did not call paid intelligence or speech providers.

## Running instance and remaining configuration

The verified build was activated on `http://127.0.0.1:3003` after confirming zero
active ingestion jobs. The homepage returns 200 with Quod markup and the private
library API returns 401 anonymously. `/api/auth/config` returns 503: the running
user-owned process does not have all required public Firebase settings.

The user must provide Firebase web configuration, enable Google login, authorize
their browser host, and configure Firestore/rules as described in the root README.
If those settings are already in their private `.env`, restarting the launcher
loads them. Real Google-account login remains a user acceptance step. No private
environment file was opened. Restarting also loads the updated launcher, whose
future build reloads check database activity rather than a now-private HTTP API.

Browser screenshots and isolated test scripts are retained under `.session-tools/`
(`quod-live-*.png`, `quod-pinned.png`, `quod-signed-out.png`,
`quod-mobile-home.png`, `quod-browser.cjs`, `quod-extra.cjs`). Test transport mocks
were loaded only by the isolated preview and are not in production source.
