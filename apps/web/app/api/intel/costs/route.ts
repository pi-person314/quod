import { Uuid } from "@cairn/contracts";
import { db } from "@cairn/contracts/db";
import { fixturesEnabled } from "@/lib/fixtures";

export async function GET(req: Request) {
  const corpusId = new URL(req.url).searchParams.get("corpus_id");
  if (!Uuid.safeParse(corpusId).success) return Response.json({ error: "Invalid corpus_id" }, { status: 400 });
  if (fixturesEnabled() && (process.env.CAIRN_LIVE_API !== "1" || !process.env.DATABASE_URL))
    return Response.json({ stages: [], total_usd: 0, measured: false });
  const result = await db().query(`SELECT stage, count(*)::int AS calls,
    sum(input_tokens)::bigint::text AS input_tokens, sum(output_tokens)::bigint::text AS output_tokens,
    sum(cache_read_tokens)::bigint::text AS cache_read_tokens, sum(cost_usd)::float8 AS cost_usd
    FROM llm_calls WHERE coalesce(meta->>'synthetic','false') <> 'true'
      AND (corpus_id=$1 OR doc_id IN (SELECT id FROM documents WHERE corpus_id=$1) OR meta->>'source_corpus_id'=$1::text)
    GROUP BY stage ORDER BY stage`, [corpusId]);
  return Response.json({ stages: result.rows,
    total_usd: result.rows.reduce((sum, row) => sum + row.cost_usd, 0), measured: result.rowCount! > 0 });
}
