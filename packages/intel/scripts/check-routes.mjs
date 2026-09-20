import assert from "node:assert/strict";
import { BakeResponse, ResolveResponse } from "@cairn/contracts";
import { POST as bake } from "../../../apps/web/app/api/intel/bake/route";
import { POST as resolve } from "../../../apps/web/app/api/intel/resolve/route";
import { POST as trace } from "../../../apps/web/app/api/intel/trace/route";
import { GET as forward } from "../../../apps/web/app/api/intel/forward/[entity_id]/route";
import { GET as search } from "../../../apps/web/app/api/search/route";
import { POST as voiceAnswer } from "../../../apps/web/app/api/intel/voice/answer/route";
import { POST as voiceToken } from "../../../apps/web/app/api/intel/voice/token/route";
import { POST as voiceSpeak } from "../../../apps/web/app/api/intel/voice/speak/route";
import { developmentCorpus, DEVELOPMENT_CORPUS_ID } from "../evals/development-corpus";

if (process.env.USE_FIXTURES !== "1" || !process.env.FIXTURES_DIR) throw new Error("Explicit fixture test environment required");
const [chapter, exercises] = await developmentCorpus();
const request = (body) => new Request("http://localhost/api/intel/test", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
delete process.env.CAIRN_WORKER_SECRET; // Neither processing endpoint needs an extra secret.
assert.equal((await resolve(new Request("http://localhost/api/intel/resolve", { method: "POST", headers: { origin: "https://elsewhere.test" }, body: "{}" }))).status, 403);
assert.equal(BakeResponse.parse(await (await bake(request({ doc_id: exercises.document.id }))).json()).cards_done, 20);
assert.equal((await bake(request({ doc_id: "invalid" }))).status, 400);
assert.equal((await bake(request({ doc_id: DEVELOPMENT_CORPUS_ID }))).status, 404);
const decisions = ResolveResponse.parse(await (await resolve(request({ corpus_id: DEVELOPMENT_CORPUS_ID, node_ids: exercises.nodes.map((node) => node.id) }))).json());
assert.equal(decisions.decisions.length, 3);
assert.equal((await resolve(request({ corpus_id: chapter.document.id, node_ids: [chapter.nodes[0].id] }))).status, 404);
// User-facing routes require Firebase authentication even in fixture mode.
// Their authenticated data behavior is covered by service-level tests.
for (const response of await Promise.all([
  trace(request({ doc_id: chapter.document.id, selection: "by Toy 2" })),
  forward(new Request("http://localhost"), { params: Promise.resolve({ entity_id: chapter.entities[0].id }) }),
  search(new Request("http://localhost/api/search?q=absolute")),
  voiceAnswer(request({ doc_id: chapter.document.id, page: 1, question: "What is that theorem?" })),
  voiceToken(request({})),
  voiceSpeak(request({ text: "test" })),
])) assert.equal(response.status, 401);
console.log("fixture routes passed");
