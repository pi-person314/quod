# Session B — Reader frontend and interaction

**Owns:** `apps/web/` including API route shells (C owns the handlers under
`app/api/intel/*`).
**Branch:** `sess/b-reader`.
**Deliverable:** a reader that renders any ingested PDF with live hover cards,
the trace panel and the corpus map. Runs on fixtures from minute one and never
waits on Session A past A0.

This session carries the demo. Visual quality is not decoration here; a
judge's verdict is formed in the first ten seconds of seeing the screen.

## Start here

```bash
git checkout -b sess/b-reader
cp .env.example .env            # USE_FIXTURES=1 is already set
pnpm install
pnpm dev                        # http://localhost:3000
```

Route shells are in `app/api/**/route.ts`, each returning 501 with its owner
and phase. `lib/fixtures.ts` loads `fixtures/golden/*` into one corpus.
`lib/http.ts` has `jsonOf(schema, data)` so every response is validated
against `@quod/contracts` before it leaves.

Until A0 lands, `fixtures/golden/` is empty. Build the shell and the PDF.js
transform against any LaTeX PDF and a hand-written anchor or two; swap in the
real fixture when it arrives.

## Phase B0 — Shell and fixture server (60 min)

Tailwind, dark-first theme (`app/globals.css`). Every API route implemented
as a thin handler that returns fixture data when `USE_FIXTURES=1`. Corpus
list page, document upload page, reader route `/read/:doc_id`. Serve the
fixture PDF bytes from a route so the reader can load it.

Accept: `USE_FIXTURES=1 pnpm dev` serves a reader page with fixture data and
no backend running.

## Phase B1 — PDF rendering and coordinate transform (2h)

PDF.js canvas render with a custom absolutely-positioned overlay layer. The
critical piece is a bidirectional transform between PDF user-space coordinates
and viewport pixels that survives zoom and window resize. The convention is
fixed in CONTRACTS.md (PyMuPDF space: points, origin top-left, y down, pages
1-indexed; `px = x * renderedWidth / pageWidthPt`). Render fixture anchor
bboxes as coloured rectangles first and verify alignment visually before
building anything on top.

Accept: anchor rectangles sit on their text at 50%, 100% and 200% zoom, and
after a window resize, on every page of the demo document.
Risk: likeliest phase to overrun. If not working at the 3h mark, fall back to
rendering the PDF text layer as selectable HTML and anchoring by character
offset rather than bbox.

## Phase B2 — Hover card (2h)

Decorate resolved anchors with a subtle underline, dashed where confidence is
below 0.7. Hover opens a card after 120ms, positioned to stay in viewport,
dismissed on mouse-out with a 300ms grace. Card renders `instantiated_md`
with KaTeX, the substitution strip (`A -> T`), the collapsed-clause toggle
(`full_md`), page citation, jump-to-source and pin. Pinned cards dock to a
right rail and stack.

Accept: hovering any of the 15 fixture anchors opens a correct card in under
100ms with no layout shift; pinning three cards leaves all three readable.

## Phase B3 — Ingest experience (75 min)

Drag-and-drop upload, SSE subscription to `/api/corpus/:id/events`, live
progress showing nodes appearing per document. This screen is on camera for
20 seconds: a growing list of detected theorems with their labels, not a
progress bar. The SSE route polls `ingest_progress` (see `schema.sql`).

Accept: uploading four PDFs streams per-document progress and lands on the
reader when complete, with a graceful state for a document that fails
quality checks (`status = 'unsupported'`).

## Phase B4 — Trace panel and forward links (90 min)

Text selection triggers a floating "why am I stuck" affordance. Clicking calls
`POST /api/intel/trace` and renders `chain` as a vertical stack trace,
`chain[0]` at the top, innermost at the bottom; read hops collapsed and
greyed, unread expanded. Forward links render as a "pays off in" section
inside any card opened on a definition (`GET /api/intel/forward/:entity_id`).

Accept: works against a hand-written `TraceResponse` fixture
(`fixtures/trace/`) before C's endpoint exists; swap to live with no
component changes.

## Phase B5 — Corpus map (90 min)

D3 force layout over the entity graph. Colour by source document, size by
PageRank, opacity by read state. Click to jump. Hover highlights the ego
network at depth 2. Pan and zoom. This is the screenshot in the submission.

Accept: 200 nodes at 30fps or better; the four-document demo corpus is legible
without manual layout tweaking.

## Phase B6 — Polish (remainder)

Weak-spots panel (nodes hovered 3+ times, Anki CSV export), keyboard
shortcuts, empty and error states, landing screen with one sentence and a
demo-corpus button. Then freeze and rehearse the demo path repeatedly, fixing
only what breaks on that path.

## Demo path you are rehearsing (2:45)

pset hover -> cross-document jump -> hard proof, two hovers -> select line,
trace -> corpus map -> drag in a short PDF, watch nodes stream -> cost table
-> close. The first ten seconds decide whether a judge files this under
"ChatPDF clone": open on the cross-document jump, not the tooltip.
