// Independent live retrieval/resolution check through the user's configured server.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { db } from "@cairn/contracts/db";
import { instantiationCases } from "../../../packages/intel/evals/instantiation-cases";

async function main() {
  if (!process.argv.includes("--live")) throw new Error("Pass --live for provider calls");
  const base = process.env.CAIRN_BASE_URL ?? "http://127.0.0.1:3003";
  const corpus = randomUUID(), docs = Array.from({ length: 4 }, () => randomUUID());
  const sources: string[] = [], restatements: string[] = [];
  const rank = randomUUID();
  try {
    await db().query("INSERT INTO corpora(id,name) VALUES($1,'Live retrieval and equivalence evaluation')", [corpus]);
    for (const [i, doc] of docs.entries()) await db().query("INSERT INTO documents(id,corpus_id,title,filename,status,page_count) VALUES($1,$2,$3,'evaluation.pdf','ready',1)", [doc, corpus, `Authored evaluation ${i + 1}`]);
    const insert = async (id: string, doc: string, text: string, title: string) => db().query(`INSERT INTO nodes
      (id,doc_id,kind,label,title,statement_md,clauses,symbols,page,bbox,confidence) VALUES($1,$2,'theorem',NULL,$3,$4,'[]','[]',1,$5,1)`, [id, doc, title, text, [10, 10, 500, 100]]);
    for (const [i, c] of instantiationCases.entries()) {
      const id = randomUUID(); sources.push(id);
      await insert(id, docs[i % 4], c.input.target.statement_md, c.name);
      if (i < 3) {
        const restated = randomUUID(); restatements.push(restated);
        await insert(restated, docs[(i + 1) % 4], c.expected.instantiated_md, `Exercise result ${i + 1}`);
      }
    }
    await insert(rank, docs[3], "Let T: V -> W be a linear map with V finite-dimensional. Then dim(ker T) + dim(im T) = dim V.", "Dimensions of a linear transformation");
    console.log(`Resolving 24 statements across four documents in corpus ${corpus}`);
    const response = await fetch(base + "/api/intel/resolve", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ corpus_id: corpus, node_ids: [...sources, ...restatements, rank] }) });
    const resolved = await response.json(); assert.equal(response.status, 200, JSON.stringify(resolved));
    const nodes = (await db().query("SELECT id,entity_id,confidence FROM nodes WHERE doc_id=ANY($1::uuid[])", [docs])).rows;
    const byId = new Map(nodes.map(n => [n.id, n]));
    const matches = restatements.map((id, i) => ({ id, source: sources[i], merged: byId.get(id).entity_id === byId.get(sources[i]).entity_id,
      confidence: Math.max(...resolved.decisions.filter((d: { node_id: string; entity_id: string; verdict: string }) => d.verdict === "same" &&
        [id, sources[i]].includes(d.node_id) && d.entity_id === byId.get(sources[i]).entity_id).map((d: { confidence: number }) => d.confidence), 0) }));
    const falseMerges: string[][] = [];
    const originals = [...sources, rank];
    for (let i=0;i<originals.length;i++) for (let j=i+1;j<originals.length;j++) if (byId.get(originals[i]).entity_id === byId.get(originals[j]).entity_id) falseMerges.push([originals[i], originals[j]]);
    const searches = [];
    for (const query of ["rank nullity", "dimension of the kernel plus dimension of the image"]) {
      const r = await fetch(`${base}/api/search?corpus_id=${corpus}&q=${encodeURIComponent(query)}`);
      assert.equal(r.status, 200); const result = await r.json();
      searches.push({ query, top1Correct: result.hits[0]?.node.id === rank, top1: result.hits[0]?.node.title,
        hits: result.hits.slice(0, 8).map((hit: { node: { id: string; title: string }; score: number }) => ({ id: hit.node.id, title: hit.node.title, score: hit.score })) });
    }
    const report = { providerMode: "live", benchmark: "Authored statements across four documents, not source-PDF ingestion", corpus,
      documents: 4, docIds: docs, sourceIds: sources, rankId: rank, sourceStatements: 21, restatements: matches, falseMerges, searches, decisions: resolved.decisions };
    await mkdir("../../.cairn-sessions/current-quality", { recursive: true });
    await writeFile("../../.cairn-sessions/current-quality/resolution-live.json", JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ ...report, decisions: resolved.decisions.length }));
  } finally {
    // Delete only this run's index rows and application data. Keep all paid ledger rows.
    if (!process.argv.includes("--keep")) {
      await fetch(`http://127.0.0.1:9200/cairn-nodes-v1/_delete_by_query?refresh=true`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: { term: { corpus_id: corpus } } }) });
      await db().query("DELETE FROM corpora WHERE id=$1", [corpus]);
    }
    await db().end();
  }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
