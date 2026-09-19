import assert from "node:assert/strict";
import { test } from "node:test";
import type OpenAI from "openai";
import { callModel, embed, createModelRunner, estimateCostUsd, logCall, toLedgerUsage, type LedgerRow, type ModelDependencies } from "../llm";

const usage = { input_tokens: 100, output_tokens: 20, total_tokens: 120,
  input_tokens_details: { cached_tokens: 40 }, output_tokens_details: { reasoning_tokens: 0 } };
const response = { id: "offline-response", status: "completed", output_text: '{"ok":true}', usage } as OpenAI.Responses.Response;
function harness(overrides: Partial<ModelDependencies> = {}) {
  const rows: LedgerRow[] = [];
  const runner = createModelRunner({ authorize: async () => {}, respond: async () => response,
    embeddings: async () => ({ object: "list", model: "text-embedding-3-small", usage: { prompt_tokens: 10, total_tokens: 10 },
      data: [{ object: "embedding", index: 1, embedding: [0, 1] }, { object: "embedding", index: 0, embedding: [1, 0] }] }),
    log: async (row) => { rows.push(row); }, ...overrides });
  return { rows, ...runner };
}

test("cached reads and writes split into disjoint ledger columns", () => {
  assert.deepEqual(toLedgerUsage(usage), { input_tokens: 60, output_tokens: 20, cache_read_tokens: 40, cache_write_tokens: 0 });
  const withWrites = { ...usage, input_tokens_details: { cached_tokens: 40, cache_write_tokens: 10 } };
  assert.equal(toLedgerUsage(withWrites).input_tokens, 50);
  assert.equal(toLedgerUsage(withWrites).cache_write_tokens, 10);
  assert.throws(() => toLedgerUsage({ ...usage, input_tokens: 30 }), /exceed/);
  assert.throws(() => toLedgerUsage({ ...usage, output_tokens: NaN }), /Invalid/);
});
test("unpriced and unsupported long-context calls never look free", () => {
  const u = toLedgerUsage(usage);
  assert.ok(Math.abs(estimateCostUsd("gpt-5.6-sol", u) - 0.000656) < 1e-12);
  assert.throws(() => estimateCostUsd("unknown", u), /pricing/);
  assert.throws(() => estimateCostUsd("gpt-5.6-sol", { ...u, input_tokens: 272_001 }), /Long-context/);
});
test("50 synthetic writes preserve exact ledger fields and stage attribution", async () => {
  const values: unknown[][] = [];
  const u = toLedgerUsage(usage);
  for (let i = 0; i < 50; i++) {
    await logCall({ stage: i < 25 ? "instantiate" : "resolve", model: "gpt-5.6-sol", usage: u,
      costUsd: estimateCostUsd("gpt-5.6-sol", u), latencyMs: 10, meta: { run_id: "synthetic-50", synthetic: true } },
    async (sql, params) => { assert.match(sql, /INSERT INTO llm_calls/); values.push(params); });
  }
  assert.equal(values.length, 50);
  assert.equal(values.filter((v) => v[0] === "resolve").length, 25);
  assert.equal(values.reduce((n, v) => n + Number(v[2]), 0), 3000);
  assert.equal(values.reduce((n, v) => n + Number(v[4]), 0), 2000);
  assert.ok(Math.abs(values.reduce((n, v) => n + Number(v[7]), 0) - 0.0328) < 1e-12);
  assert.equal(JSON.parse(String(values[0][10])).run_id, "synthetic-50");
});
test("default paths cannot make paid calls, even with API credentials present", async () => {
  await assert.rejects(callModel({ stage: "eval", input: "test", model: "gpt-5.6-sol" }), /disabled/);
  await assert.rejects(embed(["test"]), /disabled/);
  assert.deepEqual(await embed([]), []);
});
test("authorization failure prevents provider and ledger invocation", async () => {
  const h = harness({ authorize: async () => { throw new Error("budget denied"); },
    respond: async () => { assert.fail("must not reach provider"); } });
  await assert.rejects(h.callModel({ stage: "eval", input: "test" }), /denied/);
  assert.equal(h.rows.length, 0);
});
test("success preserves run metadata and logs status", async () => {
  const h = harness();
  const r = await h.callModel({ stage: "eval", input: "test", meta: { run_id: "unit" } });
  assert.equal(r.text, '{"ok":true}');
  assert.equal(h.rows[0].meta?.run_id, "unit");
  assert.equal(h.rows[0].meta?.response_status, "completed");
});
test("incomplete and malformed JSON responses are billed but rejected", async () => {
  for (const bad of [{ ...response, status: "incomplete" }, { ...response, output_text: "bad JSON" }]) {
    const h = harness({ respond: async () => bad as OpenAI.Responses.Response });
    await assert.rejects(h.callModel({ stage: "eval", input: "test", jsonSchema: { name: "test", schema: {} } }));
    assert.equal(h.rows.length, 1);
  }
});
test("missing usage and ledger failure cannot silently return success", async () => {
  const missing = harness({ respond: async () => ({ ...response, usage: undefined }) });
  await assert.rejects(missing.callModel({ stage: "eval", input: "test" }), /reconciliation/);
  const broken = harness({ log: async () => { throw new Error("ledger unavailable"); } });
  await assert.rejects(broken.callModel({ stage: "eval", input: "test" }), /ledger/);
});
test("embedding responses restore input order and carry run metadata", async () => {
  const h = harness();
  assert.deepEqual(await h.embed(["a", "b"], { meta: { run_id: "embedding-test" } }), [[1, 0], [0, 1]]);
  assert.equal(h.rows[0].meta?.run_id, "embedding-test");
});

test("content reuse coalesces concurrent calls and never charges cached tokens twice", async () => {
  let providerCalls = 0;
  const h = harness({ respond: async () => { providerCalls++; return response; } });
  const options = { stage: "eval" as const, input: "same input", cache: "content" as const, meta: { prompt_version: "v1" } };
  const [first, second] = await Promise.all([h.callModel(options), h.callModel(options)]);
  assert.equal(providerCalls, 1);
  assert.equal(h.rows.length, 1);
  assert.equal(first.cacheHit, false);
  assert.equal(second.cacheHit, true);
  assert.equal(second.costUsd, 0);
  assert.equal(second.usage.input_tokens, 0);
  const third = await h.callModel(options);
  assert.equal(third.cacheHit, true);
  await h.callModel({ ...options, meta: { prompt_version: "v2" } });
  await h.callModel({ ...options, input: "changed input" });
  await h.callModel({ ...options, cache: "off" });
  assert.equal(providerCalls, 4);
});
test("failed generation is never retained in the content cache", async () => {
  let calls = 0;
  const h = harness({ respond: async () => { calls++; throw new Error("provider failed"); } });
  const options = { stage: "eval" as const, input: "same input", cache: "content" as const };
  await assert.rejects(h.callModel(options), /failed/);
  await assert.rejects(h.callModel(options), /failed/);
  assert.equal(calls, 2);
});
