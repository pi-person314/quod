import assert from "node:assert/strict";
import test from "node:test";
import { answerFromViewport, mintVoiceToken, synthesizeSpeech } from "../voice/server";
import { VoiceTurn, type SpokenAnswer } from "../voice/turn";
import { developmentCorpus } from "../evals/development-corpus";

test("voice context and citations cannot escape the selected page", async () => {
  const [chapter] = await developmentCorpus();
  const node = chapter.nodes[0];
  const input = { doc_id: node.doc_id, page: node.page, visible_node_ids: [node.id], question: "What does this say?" };
  const answer = await answerFromViewport(input, chapter.nodes, async (request) => {
    assert.equal(JSON.parse(request.input).visible_statements.length, 1);
    return { answer: "Check the stated hypotheses.", citations: [node.id] };
  });
  assert.deepEqual(answer.citations, [node.id]);
  await assert.rejects(answerFromViewport({ ...input, page: node.page + 1 }, chapter.nodes, async () => assert.fail()), /Viewport/);
  await assert.rejects(answerFromViewport(input, chapter.nodes, async () => ({ answer: "Unsupported", citations: [chapter.nodes[1].id] })), /unavailable/);
});
test("speech credentials remain server-side and token TTL is explicit", async () => {
  const token = await mintVoiceToken({ authorize: async () => {}, apiKey: "test-key", fetch: async (url, init) => {
    assert.equal(String(url), "https://api.deepgram.com/v1/auth/grant");
    assert.deepEqual(JSON.parse(String(init?.body)), { ttl_seconds: 30 });
    return Response.json({ access_token: "temporary-token", expires_in: 30, api_key: "must-not-leak" });
  } });
  assert.deepEqual(token, { access_token: "temporary-token", expires_in: 30 });
  await assert.rejects(mintVoiceToken({ fetch: async () => assert.fail() }), /disabled/);
});
test("TTS forwards audio only and honors cancellation before provider calls", async () => {
  const deps = { authorize: async () => {}, apiKey: "test-key", fetch: async () => new Response(new Uint8Array([1, 2]), { headers: { "content-type": "audio/mpeg" } }) };
  const audio = await synthesizeSpeech("A short answer.", undefined, deps);
  assert.equal(audio.headers.get("cache-control"), "no-store");
  assert.equal((await audio.arrayBuffer()).byteLength, 2);
  await assert.rejects(synthesizeSpeech("answer", AbortSignal.abort(), { ...deps, fetch: async () => assert.fail() }));
  await assert.rejects(synthesizeSpeech("answer", undefined, { ...deps, fetch: async () => Response.json({ error: "no audio" }) }), /failed/);
});
test("barge-in prevents an old answer from playing even if its fetch ignores abort", async () => {
  const resolvers: ((value: SpokenAnswer) => void)[] = [];
  const spoken: string[] = [];
  let stops = 0;
  const turn = new VoiceTurn({ answer: async () => new Promise((resolve) => resolvers.push(resolve)),
    speak: async (text) => { spoken.push(text); }, stopPlayback: () => { stops++; } });
  const first = turn.ask("first");
  const second = turn.ask("second");
  resolvers[0]({ answer: "stale", citations: [] });
  resolvers[1]({ answer: "current", citations: [] });
  assert.equal(await first, undefined);
  assert.equal((await second)?.answer, "current");
  assert.deepEqual(spoken, ["current"]);
  assert.equal(stops, 2);
});
