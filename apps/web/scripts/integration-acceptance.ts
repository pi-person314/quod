import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { join, resolve } from "node:path";

async function main() {
  process.env.USE_FIXTURES = "1";
  process.env.FIXTURES_DIR = resolve("demo");
  const { dataset, saveLocal, LOCAL } = await import("../lib/data");
  const { GET: search } = await import("../app/api/search/route");
  const { POST: trace } = await import("../app/api/intel/trace/route");
  const { GET: costs } = await import("../app/api/intel/costs/route");
  const data = await dataset();
  const corpus = randomUUID(), docId = randomUUID(), nodeId = randomUUID();
  const statement = "The isolated uploaded theorem has a unique searchable statement.";
  const doc = { ...data.docs[0], id: docId, corpus_id: corpus, title: "Isolated test upload" };
  const node = { ...data.nodes[0], id: nodeId, doc_id: docId, entity_id: null, label: "Theorem 89.1", page: 1, statement_md: statement };
  try {
    await saveLocal("docs", docId, { doc, nodes: [node] });
    const response = await search(new Request(`http://127.0.0.1/api/search?q=searchable&corpus_id=${corpus}`));
    assert.equal(response.status, 200);
    const hits = (await response.json()).hits;
    assert.deepEqual(hits.map((hit: { node: { id: string } }) => hit.node.id), [nodeId]);
    const other = await search(new Request(`http://127.0.0.1/api/search?q=searchable&corpus_id=${randomUUID()}`));
    assert.deepEqual((await other.json()).hits, []);
    assert.equal((await search(new Request("http://127.0.0.1/api/search?corpus_id=invalid"))).status, 400);
    const traced = await trace(new Request("http://127.0.0.1/api/intel/trace", { method: "POST",
      headers: { "content-type": "application/json" }, body: JSON.stringify({ doc_id: docId, page: 1, selection: statement, read_node_ids: [] }) }));
    assert.equal(traced.status, 200);
    assert.equal((await traced.json()).chain[0].node.id, nodeId);
    assert.equal((await (await costs(new Request(`http://127.0.0.1/api/intel/costs?corpus_id=${corpus}`))).json()).measured, false);
  } finally { await rm(join(LOCAL, "docs", `${docId}.json`), { force: true }); }

  process.env.USE_FIXTURES = "0";
  const { db } = await import("@quod/contracts/db");
  try {
    await db().query("INSERT INTO corpora(id,name) VALUES($1,'Isolated reader integration test')", [corpus]);
    await db().query("INSERT INTO documents(id,corpus_id,title,filename,pdf_bytes,status) VALUES($1,$2,'test','test.pdf',$3,'ready')", [docId, corpus, Buffer.from("%PDF-test")]);
    const live = await dataset();
    const loaded = live.docs.find(item => item.id === docId)!;
    assert(loaded);
    assert(!Object.hasOwn(loaded, "pdf_bytes"));
    await db().query("INSERT INTO llm_calls(stage,model,cost_usd,corpus_id,meta) VALUES('eval','synthetic',12,$1,'{\"synthetic\":true}')", [corpus]);
    const ledger = await (await costs(new Request(`http://127.0.0.1/api/intel/costs?corpus_id=${corpus}`))).json();
    assert.equal(ledger.measured, false);
    assert.equal(ledger.total_usd, 0);
    console.log("PASS: fixture uploads participate in scoped search and selected-text tracing; invalid scope rejected; live reader excludes PDF bytes; Costs excludes synthetic usage.");
  } finally {
    await db().query("DELETE FROM llm_calls WHERE corpus_id=$1", [corpus]);
    await db().query("DELETE FROM corpora WHERE id=$1", [corpus]);
    await db().end();
  }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
