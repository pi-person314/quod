import { z } from "zod";

const StageCost = z.object({ stage: z.string().min(1), calls: z.number().int().nonnegative(),
  input_tokens: z.number().int().nonnegative(), output_tokens: z.number().int().nonnegative(),
  cache_read_tokens: z.number().int().nonnegative(), cache_write_tokens: z.number().int().nonnegative(),
  cost_usd: z.number().finite().nonnegative() }).strict();
export const Measurement = z.object({
  run_id: z.string().min(1), corpus_hash: z.string().min(1), model_config: z.string().min(1),
  prompt_version: z.string().min(1), kind: z.enum(["live", "synthetic"]),
  scope: z.enum(["C-only", "full-pipeline"]), pass: z.enum(["cold", "repeat"]),
  evaluation_case_ids: z.array(z.string()).min(1),
  evaluation_results: z.record(z.boolean()),
  quality: z.object({ c1_correct: z.number().int().min(0).max(20), c1_total: z.literal(20),
    invalid_substitutions: z.number().int().nonnegative(), c3_correct: z.number().int().min(0).max(3),
    c3_total: z.literal(3), chapter_nodes: z.literal(20), false_merges: z.number().int().nonnegative() }).strict(),
  stages: z.array(StageCost).min(1),
}).strict();
export type Measurement = z.infer<typeof Measurement>;

/** Reject comparisons that could conceal changed data, quality loss, or missing stages. */
export function compareCosts(rawBaseline: Measurement, rawOptimized: Measurement) {
  const baseline = Measurement.parse(rawBaseline);
  const optimized = Measurement.parse(rawOptimized);
  if (baseline.kind !== "live" || optimized.kind !== "live") throw new Error("Synthetic measurements cannot substantiate sponsor savings");
  if (baseline.run_id === optimized.run_id) throw new Error("Separate measured runs are required");
  for (const field of ["corpus_hash", "model_config", "prompt_version", "scope", "pass"] as const) {
    if (baseline[field] !== optimized[field]) throw new Error(`Incomparable ${field}`);
  }
  const cases = (run: Measurement) => [...run.evaluation_case_ids].sort();
  if (JSON.stringify(cases(baseline)) !== JSON.stringify(cases(optimized)) ||
    new Set(baseline.evaluation_case_ids).size !== baseline.evaluation_case_ids.length) throw new Error("Evaluation cases differ or repeat");
  for (const run of [baseline, optimized]) {
    if (Object.keys(run.evaluation_results).length !== run.evaluation_case_ids.length ||
      run.evaluation_case_ids.some((id) => !Object.hasOwn(run.evaluation_results, id))) throw new Error("Missing per-case evaluation evidence");
    if (run.quality.c1_correct < 17 || run.quality.invalid_substitutions !== 0 || run.quality.c3_correct !== 3 || run.quality.false_merges !== 0) {
      throw new Error("Quality acceptance failed");
    }
    if (new Set(run.stages.map((stage) => stage.stage)).size !== run.stages.length) throw new Error("Duplicate stage totals");
  }
  if (baseline.evaluation_case_ids.some((id) => baseline.evaluation_results[id] !== optimized.evaluation_results[id])) {
    throw new Error("Per-case evaluation results changed");
  }
  if (JSON.stringify(baseline.quality) !== JSON.stringify(optimized.quality)) throw new Error("Quality results must remain unchanged");
  const before = new Map(baseline.stages.map((stage) => [stage.stage, stage]));
  const after = new Map(optimized.stages.map((stage) => [stage.stage, stage]));
  if (before.size !== after.size || [...before.keys()].some((stage) => !after.has(stage))) throw new Error("Stage coverage differs");
  if (baseline.scope === "full-pipeline" && ["segment", "edges", "embed", "resolve", "instantiate"].some((stage) => !before.has(stage))) {
    throw new Error("Full-pipeline evidence must include A and C stages (including zero-cost stages)");
  }
  const baselineUsd = baseline.stages.reduce((sum, stage) => sum + stage.cost_usd, 0);
  const optimizedUsd = optimized.stages.reduce((sum, stage) => sum + stage.cost_usd, 0);
  if (baselineUsd <= 0) throw new Error("Baseline cost must be positive");
  const reduction = (baselineUsd - optimizedUsd) / baselineUsd;
  return { scope: baseline.scope, pass: baseline.pass, baseline_usd: baselineUsd, optimized_usd: optimizedUsd,
    reduction_percent: reduction * 100,
    c5_target_met: baseline.scope === "full-pipeline" && baseline.pass === "cold" && reduction >= 0.6,
    stages: [...before.keys()].sort().map((stage) => ({ stage, baseline: before.get(stage)!, optimized: after.get(stage)! })),
  };
}
