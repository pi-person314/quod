import assert from "node:assert/strict";
import { instantiationCases } from "./instantiation-cases";
import { instantiateCard } from "../prompts/instantiate";

let accepted = 0;
for (const fixture of instantiationCases) {
  const result = await instantiateCard(fixture.input, async () => fixture.expected);
  assert.deepEqual(result.card.clause_ids, fixture.expected.clause_ids, fixture.name);
  assert.equal(result.mode, "instantiated", fixture.name);
  accepted++;
}
console.log(JSON.stringify({ mode: "synthetic-answer-replay", accepted, cases: instantiationCases.length,
  api_calls: 0, live_model_quality_measured: false }, null, 2));
