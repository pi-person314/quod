# Cairn — design brief (Session B)

One page. Paste this whole file into any design tool and it has the context.
The canvas of artboards built from it is linked at the bottom.

## What it is, in one breath

A reader for proof-heavy courses. The student's whole corpus (textbook,
lecture notes, problem sets, slides) is one dependency graph. Hover any
reference — "by Theorem 3.4", "the dimension theorem" — and the cited result
appears in place, restated in the notation of the page you are on, narrowed
to the clause actually in use. Select a line you are stuck on and get the
minimal chain of prior results it rests on. Open the map and see the whole
course as one connected graph, with your reading progress on it.

Working name: Cairn — trail markers left so you can retrace a path.

## The bar

A judge's verdict forms in the first ten seconds of seeing the screen, and
the first pattern-match is "another AI PDF reader / ChatPDF clone". So:

- **No chat panel. Ever.** The intelligence shows up as typographic
  decoration on the page (underlines) and as cards that read like the book.
- The PDF is the surface. Chrome is quiet, dark, and recedes. Nothing
  competes with the page.
- Cards look like *marginalia by a very good TA*, not like a chatbot bubble.
- The demo opens on the cross-document jump, not the tooltip. The first
  screen a judge sees is a pset page with one underlined phrase.

## Direction

Dark-first, scholarly, restrained. Think a well-set mathematics book read at
night: near-black paper, warm off-white ink, one warm accent. The page itself
is a LaTeX PDF (Computer Modern) rendered to canvas; everything we draw
around it must feel like it belongs next to that typeface without imitating
it.

Tokens (these become `app/globals.css`):

| Token | Value | Use |
|---|---|---|
| `--bg` | `#0b0b0d` | app background |
| `--surface` | `#141417` | rails, panels, cards |
| `--surface-2` | `#1c1c21` | hover, pinned card, inputs |
| `--line` | `#2a2a31` | hairlines, card borders |
| `--ink` | `#ececf1` | primary text |
| `--ink-2` | `#a3a3ad` | secondary text, labels |
| `--ink-3` | `#8a8a96` | tertiary, read/greyed nodes (5.4:1 on surface; darker fails AA) |
| `--accent` | `#e2b25a` | anchors, active states (cairn stone, warm ochre) |
| `--accent-2` | `#8fb8ff` | entity / cross-document, links |
| `--danger` | `#ef5b4d` | unsupported doc, errors |
| `--doc-1..4` | `#e2b25a` `#6fc7bd` `#b79cf0` `#e58fc4` | per-document colour: textbook, notes, pset, slides. None of them is the cross-document blue |
| `--paper` / `--paper-ink` | `#17171b` / `#e6e2d8` | the PDF page in dark-paper mode (canvas filter); real white on toggle |

Type: UI in IBM Plex Sans (13–14px body, tight tracking on headings).
Node labels like `THM 3.22` in IBM Plex Mono, 11px, tracked uppercase,
`--ink-2` — they read as trail markers. Math and restated statements in
KaTeX in the app (its Computer Modern look is the point: the card reads
like the book); STIX Two Text stands in for it on the design canvas.

Radius 6px on cards and inputs, 4px on chips. Shadows only on floating
cards: `0 8px 30px rgba(0,0,0,.45)` plus a 1px `--line` border. Motion:
120ms open, 300ms mouse-out grace on cards; nothing bounces.

## Screens on the demo path (2:45)

### 1. Landing
One sentence, one button ("Open the demo corpus"), a quiet list of corpora
below. Wordmark small. No hero art; the corpus map screenshot can sit faintly
behind the sentence if it earns its place.

### 2. Ingest
Drag-and-drop target for PDFs. Once files land: one column per document,
each a **growing list of detected nodes** — `Theorem 3.4  Rank-Nullity`,
`Definition 3.1`, `Lemma 3.7` — appearing live as the parser finds them, with
a small stage word (`parsing · segmenting · linking · resolving · baking`)
at the top of each column. Not a progress bar. A document that fails quality
checks shows a calm `--danger` state: "Unsupported PDF (scanned or no text
layer)" with a remove action. Finishes by landing on the reader.

### 3. Reader (the main screen)
Three regions. Centre: the PDF page on canvas, page-width fit, thin page
chrome (doc title · page 112 of 340 · zoom). Left: a slim, collapsible
outline of this document's nodes. Right: a rail that is empty until
something is pinned.

On the page, **reference anchors** get an underline: `--accent`, 1px, solid
when confidence ≥ 0.7, dashed below. Anchors that resolve across documents
get a `--accent-2` underline, so the cross-document jump reads as different
before you even hover it.

**Hover card** (opens 120ms after hover, positioned to stay in the viewport,
max ~420px wide):
- Header: `Rank-Nullity · clause (ii)` with the source chip
  `Textbook · p. 112` in that document's colour.
- **Substitution strip**: chips `A → T`, `V → ℝⁿ` in `--surface-2`. This is
  the thing we point at during the demo; give it room.
- Gloss (only for nodes not yet read): one plain-language line, `--ink-2`,
  italic.
- The **instantiated statement** in KaTeX, `--ink`, comfortable leading.
- `Show full statement` toggle, collapsed by default; expands to the original
  notation with the unused clauses.
- **Occurrences**: when the node exists in several documents, a row of chips
  `Textbook 3.22 · Notes "Rank-Nullity" · Pset 4 "dimension theorem"` in
  their document colours.
- On a definition or theorem: **Pays off in** — three downstream nodes.
- Footer: `Jump to source` · `Pin`.

**Pinned cards** dock to the right rail, stacked, each collapsible to its
header line; three pinned must all stay readable.

### 4. Trace panel — "why am I stuck"
Selecting text shows a small floating affordance next to the selection:
`Why am I stuck?`. Clicking slides a panel in from the right (it shares the
rail with pinned cards). Content is a **stack trace**: the selected sentence
at the top; below it the chain of prerequisites, innermost at the bottom.
Hops you have already read are collapsed to one grey line
(`Lemma 3.7 · read`, `--ink-3`); unread hops are expanded with their
statement and a one-line "why this is needed" in `--ink-2`. Depth ≤ 4,
breadth ≤ 3, so it never becomes a tree.

### 5. Corpus map
Full-bleed force layout. Nodes coloured by document (four colours, legend
top-left), sized by PageRank, opacity by read state (unread nodes dim).
Hover highlights the depth-2 ego network and fades the rest; click jumps to
the node's canonical occurrence. Search box top-right. This is the submission
screenshot: it must be legible on a dark background at 1280×800 with ~200
nodes and no manual tweaking.

## Secondary (design lightly, build if time)
- **Weak spots** panel: nodes hovered ≥ 3 times, with an `Export to Anki` action.
- **Search** (`/api/search`): a command-palette style box, results as node rows
  with document chip and page.
- **Voice** push-to-talk: a single mic affordance in the page chrome; shows a
  waveform while listening and speaks back. P2 — do not let it take space.

## States to draw for every component
Empty · loading (skeleton, no spinners) · error · unsupported document ·
low-confidence (dashed) · read vs unread · pinned vs floating.

## Do not
Chat bubbles, gradients, glassmorphism, emoji, progress bars, more than one
accent, light theme (not in scope), mobile (not in scope).

## Canvas
Artboards for screens 1–5 plus a components board (card by reader state,
anchor styles), private, share from the page's menu:
https://claude.ai/artifact/R55Hux9yxES6Y441QGWnaS

Boards link to each other (Play mode walks the demo path), and the Reader
board has a `paper` tweak to compare dark paper with real white. The map is
a real force layout over a 97-node synthetic corpus shaped like the demo
one, not a drawing.
