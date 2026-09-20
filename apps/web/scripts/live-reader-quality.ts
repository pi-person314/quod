import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { db } from "@cairn/contracts/db";

async function main() {
  const base = process.env.CAIRN_BASE_URL ?? "http://127.0.0.1:3003";
  const { corpus_id: corpus, docId } = JSON.parse(await readFile("../../.cairn-sessions/current-browser/transport-results.json", "utf8"));
  try {
    const nodes = (await db().query("SELECT * FROM nodes WHERE doc_id=$1 ORDER BY id", [docId])).rows;
    const proof = nodes.find(n => n.kind === "proof"); assert(proof);
    const times: number[] = []; let chain;
    for (let i=0;i<5;i++) {
      const start = performance.now();
      const response = await fetch(base + "/api/intel/trace", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ doc_id: docId, page: proof.page, selection: proof.statement_md, read_node_ids: [] }) });
      assert.equal(response.status, 200); chain = (await response.json()).chain; times.push(performance.now() - start);
      assert(chain.some((hop: { node: { label: string } }) => hop.node.label === "Theorem 3.4"));
      assert(chain.some((hop: { node: { label: string } }) => hop.node.label === "Definition 3.2"));
      assert(chain.some((hop: { node: { label: string } }) => hop.node.label === "Definition 3.3"));
    }
    const snapshot = async () => ({
      nodes: (await db().query("SELECT * FROM nodes WHERE doc_id=$1 ORDER BY id", [docId])).rows,
      edges: (await db().query("SELECT e.* FROM edges e JOIN nodes n ON n.id=e.src WHERE n.doc_id=$1 ORDER BY e.src,e.dst,e.kind", [docId])).rows,
      cards: (await db().query("SELECT c.* FROM cards c JOIN anchors a ON a.id=c.anchor_id WHERE a.doc_id=$1 ORDER BY c.id", [docId])).rows,
    });
    const counts = async () => Number((await db().query("SELECT count(*) FROM llm_calls WHERE corpus_id=$1 OR doc_id=$2", [corpus, docId])).rows[0].count);
    const previous = await snapshot(), before = await counts();
    const bytes = await readFile("../../fixtures/golden/analysis-ch3.pdf");
    const form = new FormData(); form.append("files", new Blob([bytes], { type: "application/pdf" }), "analysis-ch3.pdf");
    const response = await fetch(`${base}/api/corpus/${corpus}/docs`, { method: "POST", body: form });
    assert.equal(response.status, 200); assert.equal((await response.json()).doc_ids[0], docId);
    assert.deepEqual(await snapshot(), previous); assert.equal(await counts(), before);
    const costs = (await db().query(`SELECT stage,sum(cost_usd) AS usd FROM llm_calls WHERE (corpus_id=$1 OR doc_id=$2)
      AND created_at <= (SELECT updated_at FROM ingest_progress WHERE doc_id=$2) GROUP BY stage ORDER BY stage`, [corpus, docId])).rows;
    const report = { corpus, docId, trace: { scope: "Actual parsed sample proof, not a hard real-textbook proof", milliseconds: times,
      maxMs: Math.max(...times), requiredReferencesPresent: true, chain },
      repeatedUpload: { sameDocumentId: true, graphAndCardsIdentical: true, newPaidCalls: 0,
        firstIngestCostByStage: costs, scope: "warm idempotent full-pipeline reuse; not the cold optimized-vs-baseline 60% gate" } };
    await writeFile("../../.cairn-sessions/current-quality/reader-live.json", JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ maxTraceMs: report.trace.maxMs, traceReferencesVerified: true, repeatedUpload: report.repeatedUpload }));
  } finally { await db().end(); }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
