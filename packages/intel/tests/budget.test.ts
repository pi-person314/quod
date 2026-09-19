import assert from "node:assert/strict";
import { test } from "node:test";
import { reserveSpend, settleSpend, requireLiveBudget } from "../budget";

test("in-flight reservations count against the total cap", () => {
  const first = reserveSpend({ spentMicros: 499_000_000, reservations: {} }, "one", 0.75);
  assert.throws(() => reserveSpend(first, "two", 0.26), /limit/);
  assert.equal(reserveSpend(first, "two", 0.25).reservations.two, 250_000);
});
test("settling releases only the unused reservation and charges actual cost", () => {
  const state = reserveSpend({ spentMicros: 0, reservations: {} }, "one", 2);
  assert.deepEqual(settleSpend(state, "one", 0.4), { spentMicros: 400_000, reservations: {} });
  assert.equal(state.reservations.one, 2_000_000);
  assert.throws(() => settleSpend(state, "one", 3), /reconciliation/);
});
test("invalid amounts and duplicate requests cannot corrupt the budget", () => {
  const state = { spentMicros: 0, reservations: {} };
  for (const amount of [NaN, Infinity, -1, 0, 501]) assert.throws(() => reserveSpend(state, "x", amount));
  assert.throws(() => reserveSpend(reserveSpend(state, "x", 1), "x", 1), /Duplicate/);
  assert.throws(() => settleSpend(state, "unknown", 1), /Unknown/);
  assert.throws(() => reserveSpend({ spentMicros: NaN, reservations: {} }, "x", 1));
});
test("live access fails closed while durable enforcement is pending", async () => {
  await assert.rejects(requireLiveBudget(), /disabled/);
});
