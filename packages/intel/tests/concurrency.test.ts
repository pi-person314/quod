import assert from "node:assert/strict";
import { test } from "node:test";
import { mapConcurrent } from "../concurrency.js";

test("parallel work is bounded and preserves order despite reverse completion", async () => {
  let active = 0, peak = 0;
  const result = await mapConcurrent([4, 3, 2, 1, 0], 3, async value => {
    peak = Math.max(peak, ++active);
    await new Promise(resolve => setTimeout(resolve, value * 5));
    active--;
    return value * 2;
  });
  assert.equal(peak, 3);
  assert.deepEqual(result, [8, 6, 4, 2, 0]);
});

test("a failure stops new work and drains already running work before rejecting", async () => {
  const started: number[] = [];
  let drained = false;
  await assert.rejects(mapConcurrent([0, 1, 2, 3], 2, async value => {
    started.push(value);
    if (value === 0) throw new Error("provider failure");
    await new Promise(resolve => setTimeout(resolve, 10));
    drained = true;
  }), /provider failure/);
  assert.deepEqual(started, [0, 1]);
  assert.equal(drained, true);
});
