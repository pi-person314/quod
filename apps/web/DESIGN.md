# Quod — implemented design direction

The authoritative reference is [Quod - UI mockups.html](../../Quod%20-%20UI%20mockups.html), exported by the user from https://claude.ai/artifact/HHbfmfvrY6z8E4j2iXDGtQ. The export was inspected as source and rendered artboards. It replaces the original Session B design.

## Surfaces

- **1a Landing:** full-height black canvas with three selectable mathematical loops (sphere, surface, lattice), a floating pill navigation bar, the headline “Know what rests on what.”, Google account control and upload/library actions. The three video loops are rendered with Manim; sources and reproduction instructions are in [animations](animations/README.md). Motion can be paused and honors reduced-motion preferences.
- **1b Library:** authenticated corpora at /library, numbered rows with real document/result/edge counts, per-document coverage strips, drag-and-drop upload and a measured per-corpus cost ledger. No mock identities, cost amounts or graph counts are presented as real data.
- **1c Reader:** 56px toolbar, document outline, real PDF canvas, persistent margin rail, compact pinned cards and page-read counts. Reference overlays, source jumps, substitution chips, reading state and voice use the existing data contracts.
- **1d Map:** near-black graph surface, document-colored nodes, PageRank sizing, read-state opacity, search, two-hop hover neighborhoods, zoom and source navigation. Available from the reader and /map/:corpus_id with the same ownership checks.
- **1e Panels:** prerequisite trace, search, weak spots/export, costs, keyboard shortcuts, selection affordance and unresolved-reference card.
- **1f Upload:** large split introduction, copper drop target, real ready/total counts, streamed per-document stage/status cards, recovery and unsupported/error handling. PDF and standalone TeX are accepted; TeX is converted to PDF before ingestion.
- **1g Quiet states:** voice listening/response/unavailable, document preparation/failure, toast, signed-out private library, missing page and corpus load failure.

## Tokens and type

Background #0D1B2A; deep surface #091320; raised surface #12253A; lines #1E3146 and #2F4760. Primary ink #F4F1DE; secondary #A9B8C9; tertiary #7F93A8. Copper #C97B4A/#DB935F; cross-document blue #6C97C4; warning #E0B45A; read/ready #7FA88A; error #D9614C.

Bricolage Grotesque for display, Instrument Sans for controls, JetBrains Mono for labels and Newsreader for typeset supporting text. The export's bundled font files are served locally under public/fonts. Mathematical notation continues to use KaTeX; PDFs retain their embedded typefaces.

Cards use 12–16px radii, upload zones 20px and buttons rounded pills. The reference intentionally uses restrained translucent navigation, glows and gradients; the previous brief's prohibitions on these no longer apply.

## Functional integration

The upstream Firebase Google OAuth/Firestore ownership implementation is retained. Runtime public Firebase configuration is served through a strict whitelist; no private credentials are read by verification builds. The new visual routes never render the global unfiltered document dataset. Existing API spending guards, queued jobs, retry behavior, saved reader state, keyboard controls and PDF coordinates must remain functional.
