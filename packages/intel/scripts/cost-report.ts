/**
 * C0 acceptance: print total cost grouped by stage.
 * `pnpm --filter @cairn/intel cost-report`
 */
import { db } from "@cairn/contracts/db";

const args = process.argv.slice(2);
const runIndex = args.indexOf("--run");
const runId = runIndex >= 0 ? args[runIndex + 1] : undefined;
if (runIndex >= 0 && (!runId || runId.startsWith("--"))) throw new Error("--run requires a run ID");
const includeSynthetic = args.includes("--include-synthetic");

const { rows } = await db().query<{
  stage: string; calls: string; input: string; output: string; cache_read: string; cache_write: string; cost: string;
}>(`
  SELECT stage,
         count(*)                 AS calls,
         sum(input_tokens)        AS input,
         sum(output_tokens)       AS output,
         sum(cache_read_tokens)   AS cache_read,
         sum(cache_write_tokens)  AS cache_write,
         sum(cost_usd)            AS cost
  FROM llm_calls
  WHERE ($1::text IS NULL OR meta->>'run_id' = $1)
    AND ($2::boolean OR COALESCE(meta->>'synthetic', 'false') <> 'true')
  GROUP BY stage
  ORDER BY sum(cost_usd) DESC
`, [runId ?? null, includeSynthetic]);

console.table(rows.map((r) => ({ ...r, cost: `$${Number(r.cost).toFixed(4)}` })));
const total = rows.reduce((s, r) => s + Number(r.cost), 0);
console.log(`total: $${total.toFixed(4)}`);
console.log(`scope: ${runId ?? "all runs"}; synthetic entries ${includeSynthetic ? "included" : "excluded"}; ledger estimates, not a billing receipt`);
await db().end();
