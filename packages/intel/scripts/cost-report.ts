/**
 * C0 acceptance: print total cost grouped by stage.
 * `pnpm --filter @cairn/intel cost-report`
 */
import { db } from "@cairn/contracts/db";

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
  GROUP BY stage
  ORDER BY sum(cost_usd) DESC
`);

console.table(rows.map((r) => ({ ...r, cost: `$${Number(r.cost).toFixed(4)}` })));
const total = rows.reduce((s, r) => s + Number(r.cost), 0);
console.log(`total: $${total.toFixed(4)}`);
await db().end();
