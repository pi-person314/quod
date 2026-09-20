import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { db } from "@cairn/contracts/db";

async function main() {
  if (!process.argv.includes("--live")) throw new Error("Pass --live for live search verification");
  const base = process.env.CAIRN_BASE_URL ?? "http://127.0.0.1:3003";
  const path = "../../.cairn-sessions/current-quality/resolution-live.json";
  const report = JSON.parse(await readFile(path, "utf8"));
  try {
    report.previousSearches = report.searches; report.searches = [];
    for (const query of ["rank nullity", "dimension of the kernel plus dimension of the image"]) {
      const started = performance.now();
      const response = await fetch(`${base}/api/search?corpus_id=${report.corpus}&q=${encodeURIComponent(query)}`);
      assert.equal(response.status, 200); const result = await response.json();
      report.searches.push({ query, top1Correct: result.hits[0]?.node.id === report.rankId, top1: result.hits[0]?.node.title,
        latencyMs: performance.now()-started, hits: result.hits.slice(0, 4).map((hit: any) => ({ id: hit.node.id, title: hit.node.title })) });
    }
    const restatement = (await db().query("SELECT * FROM nodes WHERE id=$1", [report.restatements[0].id])).rows[0];
    const traceResponse = await fetch(base + "/api/intel/trace", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ doc_id: restatement.doc_id, page: 1, selection: restatement.statement_md, read_node_ids: [] }) });
    assert.equal(traceResponse.status, 200); const { chain } = await traceResponse.json();
    report.crossDocumentTrace = chain.some((hop: any) => hop.node.id === report.restatements[0].source);
    await writeFile(path, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ searches: report.searches, restatements: report.restatements, falseMerges: report.falseMerges, crossDocumentTrace: report.crossDocumentTrace }));
    assert(report.searches.every((s: any) => s.top1Correct));
    assert(report.restatements.every((r: any) => r.merged && r.confidence >= .8));
    assert.equal(report.falseMerges.length, 0); assert(report.crossDocumentTrace);
    const removed = await fetch("http://127.0.0.1:9200/cairn-nodes-v1/_delete_by_query?refresh=true", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: { term: { corpus_id: report.corpus } } }) });
    assert(removed.ok);
    await db().query("DELETE FROM corpora WHERE id=$1", [report.corpus]);
  } finally { await db().end(); }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
