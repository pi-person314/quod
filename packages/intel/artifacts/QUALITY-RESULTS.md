# Quality improvement pass

These are measured local results. Authored development cases are not held-out
textbook evaluation. No sponsor submission or production deployment is implied.

| Check | Result | Scope |
|---|---|---|
| Original dependency benchmark | F1 0.390 → **0.627**; precision 0.762, recall 0.533 | Unchanged 30-edge gold; original >0.75 gate still fails |
| Source-backed dependency evaluation | 21/24, zero extras, F1 **0.933** | Same small authored chapter, manually reviewed during development |
| Live card generation | **20/20** clause selections and notation rewrites | Real bake route/model outputs on authored cases; fallback does not count |
| Live equivalence | **3/3** restatements, confidence 1.0; **zero false merges** across 21 source statements | Four authored documents; domain/operator-preserving equivalence |
| Live semantic search | **2/2 top-1**: “rank nullity” and kernel/image paraphrase | Four authored documents; source statement omits the theorem name; cold expansion 5.65s, direct paraphrase 1.07s |
| Cross-document trace | Accepted restatement reaches its source statement | Actual HTTP trace after live resolution |
| Parsed proof trace | **41–298ms**, five HTTP requests | Expected theorem/kernel/image prerequisites present; elementary sample proof |
| Reference rectangles | **41/41**, 0px error against PDF text geometry | Two sample PDFs, exact-text rectangle check |
| Numbered problem segmentation | **6/6** | Sample problem set |
| Live card cost reuse | **$0.072484 → $0** | Same-process warm C1 repeat, identical cards |
| Live PDF duplicate upload | **$0.427567 initial ingest; zero new paid calls** | Warm full-pipeline idempotency, identical graph/cards |

Changes address false dependencies from trailing remarks, missing definitions and
operator uses, hardcoded named-theorem recognition, document-scope collisions,
restatement relation types, cross-page geometry and skipped problem environments.
Resolution now emits accepted restatement graph edges as well as entity IDs.

The original golden annotations remain intact. Some expect relationships absent
from the PDF (including a spectral-theorem consequence specialising rank–nullity).
The separate source-evidence manifest records its reasoning, source hash and
literal excerpts. Three semantic dependencies remain missing there.

Raw local reports are in `.cairn-sessions/current-quality/`: `dependencies-source.json`,
`instantiation-live.json`, `resolution-live.json` and `reader-live.json`.
The runners are in `apps/worker/scripts/eval_dependencies.py` and
`apps/web/scripts/live-*-acceptance.ts` / `live-reader-quality.ts`.
They access the user's existing HTTP server; no provider key or `.env` access is
needed by the evaluator. Paid usage remains in the shared ledger after evaluation
documents are removed.

Still unproven: broad real-book correctness, original dependency acceptance,
composite-symbol rewrites, and ≥60% **cold** full-pipeline savings with unchanged
quality. Warm reuse measurements must not be presented as that cold-cost gate.
