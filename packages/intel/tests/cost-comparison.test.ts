import assert from "node:assert/strict";
import test from "node:test";
import { compareCosts, type Measurement } from "../cost-comparison";

const baseline: Measurement = { run_id: "before", corpus_hash: "book-hash", model_config: "fixed-models", prompt_version: "fixed-prompts",
  kind: "live", scope: "full-pipeline", pass: "cold", evaluation_case_ids: ["c1-set", "c3-set"],
  evaluation_results: { "c1-set": true, "c3-set": true },
  quality: { c1_correct: 18, c1_total: 20, invalid_substitutions: 0, c3_correct: 3, c3_total: 3, chapter_nodes: 20, false_merges: 0 },
  stages: ["segment", "edges", "embed", "resolve", "instantiate"].map((stage) => ({ stage, calls: 1, input_tokens: 10,
    output_tokens: 2, cache_read_tokens: 0, cache_write_tokens: 0, cost_usd: 1 })) };
const optimized: Measurement = { ...baseline, run_id: "after", stages: baseline.stages.map((stage) => ({ ...stage, cost_usd: 0.3 })) };
test("comparable measurements report stage totals and savings", () => {
  const result = compareCosts(baseline, optimized);
  assert.equal(result.reduction_percent, 70);
  assert.equal(result.c5_target_met, true);
});
test("synthetic, changed-data, changed-quality, and missing-stage evidence reject", () => {
  for (const changed of [
    { ...optimized, kind: "synthetic" as const }, { ...optimized, corpus_hash: "different" },
    { ...optimized, quality: { ...optimized.quality, c1_correct: 17 } },
    { ...optimized, stages: optimized.stages.slice(1) }, { ...optimized, pass: "repeat" as const },
    { ...optimized, evaluation_results: { "c1-set": false, "c3-set": true } },
  ]) assert.throws(() => compareCosts(baseline, changed));
});
test("C-only and repeat-run savings never claim the full cold-pipeline target", () => {
  for (const override of [{ scope: "C-only" as const }, { pass: "repeat" as const }]) {
    assert.equal(compareCosts({ ...baseline, ...override }, { ...optimized, ...override }).c5_target_met, false);
  }
});
