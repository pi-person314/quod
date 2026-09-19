import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { GoldenFixture } from "@cairn/contracts";
import { db } from "@cairn/contracts/db";
import { developmentCorpus } from "../evals/development-corpus";
import { bakeDocument } from "../bake";
import { estimateCostUsd, logCall, toLedgerUsage } from "../llm";
import { postgresResolutionRepository, resolveCorpus } from "../resolution-service";
import { traceFromPostgres } from "../graph-store";
import { planResolution } from "../resolve";
import { spawnSync } from "node:child_process";

// Uses inherited DATABASE_URL only. Never loads an environment file or calls a model.
const ids = new Map<string, string>();
function isolate(value: unknown): unknown {
  if (typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(value)) {
    if (!ids.has(value)) ids.set(value, randomUUID());
    return ids.get(value);
  }
  if (Array.isArray(value)) return value.map(isolate);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, isolate(item)]));
  return value;
}
const fixtures = (await developmentCorpus()).map((fixture) => GoldenFixture.parse(isolate(fixture)));
const corpusId = fixtures[0].document.corpus_id;
const runId = `c0-synthetic-${randomUUID()}`;
const pool = db();
let created = false;
try {
  await pool.query("INSERT INTO corpora (id, name) VALUES ($1, $2)", [corpusId, "C isolated verification"]);
  created = true;
  for (const fixture of fixtures) {
    const doc = fixture.document;
    await pool.query("INSERT INTO documents (id,corpus_id,title,filename,page_count,status) VALUES ($1,$2,$3,$4,$5,'ready')",
      [doc.id, corpusId, doc.title, doc.filename, doc.page_count]);
    for (const node of fixture.nodes) await pool.query(`INSERT INTO nodes
      (id,doc_id,kind,label,title,statement_md,clauses,symbols,page,bbox,confidence)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [node.id, node.doc_id, node.kind, node.label, node.title,
      node.statement_md, JSON.stringify(node.clauses), JSON.stringify(node.symbols), node.page, node.bbox, node.confidence]);
  }
  for (const fixture of fixtures) for (const entity of fixture.entities) {
    await pool.query("INSERT INTO entities (id,corpus_id,canonical_node_id,name) VALUES ($1,$2,$3,$4)",
      [entity.id, corpusId, entity.canonical_node_id, entity.name]);
  }
  for (const fixture of fixtures) {
    for (const node of fixture.nodes) await pool.query("UPDATE nodes SET entity_id=$1 WHERE id=$2", [node.entity_id, node.id]);
    for (const edge of fixture.edges) await pool.query("INSERT INTO edges (src,dst,kind,extractor,confidence) VALUES ($1,$2,$3,$4,$5)",
      [edge.src, edge.dst, edge.kind, edge.extractor, edge.confidence]);
    for (const anchor of fixture.anchors) await pool.query(`INSERT INTO anchors
      (id,doc_id,page,bbox,surface,target_node_id,target_entity_id) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [anchor.id, anchor.doc_id, anchor.page, anchor.bbox, anchor.surface, anchor.target_node_id, anchor.target_entity_id]);
  }
  const invokingDoc = fixtures[1].document.id;
  const traceStarted = performance.now();
  const traced = await traceFromPostgres(corpusId, { doc_id: invokingDoc, page: 2, selection: "We conclude by Toy 2.", read_node_ids: [fixtures[0].nodes[0].id] });
  assert.equal(traced.chain[0].node.id, fixtures[0].nodes[1].id);
  assert.equal(traced.chain[1].node.id, fixtures[0].nodes[0].id);
  assert.equal(traced.chain[1].read, true);
  console.log(`Synthetic cross-document SQL trace: ${(performance.now() - traceStarted).toFixed(1)}ms (not a real-proof latency evaluation).`);
  const exercises = fixtures[1].nodes;
  for (const node of exercises) await pool.query("UPDATE nodes SET entity_id=NULL WHERE id=$1", [node.id]);
  const repository = postgresResolutionRepository();
  const resolution = await resolveCorpus({ corpus_id: corpusId, node_ids: exercises.map((node) => node.id) }, {
    repository, search: { indexNodes: async (_corpusId, nodes) => nodes.length,
      resolutionCandidates: async (node) => [{ node: fixtures[0].nodes[exercises.findIndex((item) => item.id === node.id)], score: 1 }] },
    model: async ({ input }) => ({ decisions: (JSON.parse(input) as { node_id: string; candidate_id: string }[])
      .map(({ node_id, candidate_id }) => ({ node_id, candidate_id, verdict: "same", confidence: 0.95 })) }),
  });
  assert.equal(resolution.decisions.length, 3);
  for (const [i, node] of exercises.entries()) {
    const row = await pool.query("SELECT entity_id FROM nodes WHERE id=$1", [node.id]);
    assert.equal(row.rows[0].entity_id, fixtures[0].nodes[i].entity_id);
  }
  const stale = await repository.load(corpusId);
  const stalePlan = planResolution(corpusId, stale.nodes, stale.entities, []);
  await pool.query("UPDATE nodes SET title='Changed during resolution' WHERE id=$1", [exercises[0].id]);
  await assert.rejects(repository.save(corpusId, stale, stalePlan), /changed during resolution/);
  await pool.query("UPDATE nodes SET title=$1 WHERE id=$2", [exercises[0].title, exercises[0].id]);
  assert.equal((await bakeDocument(invokingDoc)).cards_done, 20);
  const first = await pool.query("SELECT c.id FROM cards c JOIN anchors a ON a.id=c.anchor_id WHERE a.doc_id=$1 ORDER BY c.id", [invokingDoc]);
  assert.equal((await bakeDocument(invokingDoc)).cards_done, 20);
  const second = await pool.query("SELECT c.id FROM cards c JOIN anchors a ON a.id=c.anchor_id WHERE a.doc_id=$1 ORDER BY c.id", [invokingDoc]);
  assert.deepEqual(second.rows, first.rows);
  const broken = await pool.query("SELECT id FROM anchors WHERE doc_id=$1 AND card_id IS NULL", [invokingDoc]);
  assert.equal(broken.rowCount, 0);
  const usage = toLedgerUsage({ input_tokens: 100, output_tokens: 20, total_tokens: 120,
    input_tokens_details: { cached_tokens: 40 }, output_tokens_details: { reasoning_tokens: 0 } });
  for (let i = 0; i < 50; i++) await logCall({ stage: i < 25 ? "instantiate" : "resolve", model: "gpt-5.6-sol",
    usage, latencyMs: 10, costUsd: estimateCostUsd("gpt-5.6-sol", usage), corpusId, meta: { run_id: runId, synthetic: true } });
  const ledger = await pool.query("SELECT stage, count(*)::int AS calls, sum(cost_usd)::text AS cost FROM llm_calls WHERE meta->>'run_id'=$1 GROUP BY stage ORDER BY stage", [runId]);
  assert.equal(ledger.rows.length, 2);
  for (const row of ledger.rows) { assert.equal(row.calls, 25); assert.equal(Number(row.cost), 0.0164); }
  const report = spawnSync(process.execPath, ["--import", "tsx", "scripts/cost-report.ts", "--run", runId, "--include-synthetic"], { encoding: "utf8", timeout: 15_000 });
  assert.equal(report.status, 0, report.stderr);
  assert.match(report.stdout, /total: \$0\.0328/);
  const filtered = spawnSync(process.execPath, ["--import", "tsx", "scripts/cost-report.ts", "--run", runId], { encoding: "utf8", timeout: 15_000 });
  assert.equal(filtered.status, 0, filtered.stderr);
  assert.match(filtered.stdout, /total: \$0\.0000/);
  console.log("Postgres verified: 3 restatements persisted; 20 linked cards; repeat bake stable; 50 synthetic ledger calls, $0.0328 estimated.");
} finally {
  if (created) {
    await pool.query("DELETE FROM llm_calls WHERE meta->>'run_id'=$1", [runId]);
    await pool.query("DELETE FROM corpora WHERE id=$1", [corpusId]);
  }
  await pool.end();
}
