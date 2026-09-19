# @cairn/intel — Session C

Everything that makes the graph smart, plus the cost instrumentation and the
voice layer. Route handlers under `apps/web/app/api/intel/*` import from here
and stay thin.

## What is here at hour 0

- `llm.ts` — `callModel()` (OpenAI Responses API) + `embed()` + `logCall()` +
  pricing. Every TS model call goes through this. Re-pull pricing at the
  venue and run the C0 synthetic test first.
- `scripts/cost-report.ts` — the C0 acceptance script (totals by stage).
- `prompts/` — empty. C1 puts the instantiation prompt and its 20-case eval here.

## Suggested layout as phases land

```
llm.ts                  C0  wrapper + ledger
prompts/instantiate.ts  C1  card generation, strict JSON out
prompts/adjudicate.ts   C3  same|different|specialisation over top-8 candidates (Sol)
evals/instantiate/      C1  20 cases from fixtures/golden, runner prints score
search.ts               C2  ES index mapping, hybrid BM25 + OpenAI embeddings, RRF
resolve.ts              C3  ES recall -> Sol adjudication -> union-find -> entities
bake.ts                 C1  loop anchors for a doc, call instantiate, write cards
trace.ts                C4  recursive CTE walk, depth<=4, breadth<=3, reader-state filter
forward.ts              C4  PageRank over reversed edges
voice/                  C6  Deepgram STT/TTS, viewport-scoped context
```

Contracts for every request/response are in `@cairn/contracts` under
`// ---- API shapes`. Fixture mode (`USE_FIXTURES=1`) must keep working in
your handlers too: read `apps/web/lib/fixtures.ts`.
