// Exercises a fresh copy of a parsed document through the user's live server.
// Reads no environment files; provider access stays in the existing server process.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";
import { db } from "@quod/contracts/db";

async function main() {
  const source = process.argv[2];
  assert(source, "Pass the ID of an existing parsed document");
  const base = process.env.QUOD_BASE_URL ?? process.env.CAIRN_BASE_URL ?? "http://127.0.0.1:3003";
  const corpus = randomUUID(), doc = randomUUID();
  const browser = await chromium.launch({ channel: "chrome" });
  let request: Promise<Response> | undefined;
  try {
    const nodes = (await db().query("SELECT * FROM nodes WHERE doc_id=$1", [source])).rows;
    assert(nodes.length);
    const ids = new Map(nodes.map(n => [n.id, randomUUID()]));
    await db().query("INSERT INTO corpora(id,name) VALUES($1,'Disposable parallel bake verification')", [corpus]);
    await db().query(`INSERT INTO documents(id,corpus_id,title,filename,status,page_count,pdf_bytes)
      SELECT $1,$2,'Parallel bake verification',filename,'ingesting',page_count,pdf_bytes FROM documents WHERE id=$3`, [doc, corpus, source]);
    for (const n of nodes) await db().query(`INSERT INTO nodes(id,doc_id,kind,label,title,statement_md,clauses,symbols,page,bbox,confidence)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [ids.get(n.id), doc, n.kind, n.label, n.title, n.statement_md, JSON.stringify(n.clauses), JSON.stringify(n.symbols), n.page, n.bbox, n.confidence]);
    const anchors = (await db().query(`SELECT a.*,COALESCE(a.target_node_id,e.canonical_node_id) AS resolved_target
      FROM anchors a LEFT JOIN entities e ON e.id=a.target_entity_id WHERE a.doc_id=$1`, [source])).rows;
    let expected = 0;
    for (const a of anchors) {
      const target = ids.get(a.resolved_target) ?? null;
      if (target) expected++;
      await db().query("INSERT INTO anchors(id,doc_id,page,bbox,surface,target_node_id) VALUES($1,$2,$3,$4,$5,$6)",
        [randomUUID(), doc, a.page, a.bbox, a.surface, target]);
    }
    await db().query("INSERT INTO ingest_progress(doc_id,stage) VALUES($1,'bake')", [doc]);
    const page = await browser.newPage(), errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${base}/read/${doc}`);
    const start = Date.now();
    request = fetch(`${base}/api/intel/bake`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ doc_id: doc }) });
    // Reader receives the same progress messages as the upload screen via real SSE.
    await page.getByText(/Preparing cards: \d+ \/ \d+/).waitFor({ timeout: 60000 });
    const firstVisibleProgress = await page.getByText(/Preparing cards: \d+ \/ \d+/).innerText();
    const response = await request;
    assert.equal(response.status, 200);
    const result = await response.json();
    const elapsedMs = Date.now() - start;
    assert.equal(result.cards_done, expected);
    const saved = (await db().query("SELECT count(*)::int AS n FROM cards c JOIN anchors a ON a.id=c.anchor_id WHERE a.doc_id=$1", [doc])).rows[0].n;
    assert.equal(saved, expected);
    await page.getByText(`Preparing cards: ${expected} / ${expected}`, { exact: false }).waitFor();
    const calls = (await db().query("SELECT latency_ms,cost_usd FROM llm_calls WHERE doc_id=$1 AND stage='instantiate'", [doc])).rows;
    const providerMs = calls.reduce((sum, row) => sum + row.latency_ms, 0);
    assert.deepEqual(errors, []);
    const report = { cards: expected, elapsedMs, providerCalls: calls.length, summedProviderMs: providerMs,
      providerTimeToWallTimeRatio: Number((providerMs / elapsedMs).toFixed(2)),
      costUsd: calls.reduce((sum, row) => sum + Number(row.cost_usd), 0), firstVisibleProgress, finalProgress: `${expected} / ${expected}`, runtimeErrors: errors };
    await writeFile("../../.session-tools/bake-parallel-results.json", JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  } finally {
    // Do not delete rows while server-side generation is still using them.
    if (request) await request.catch(() => {});
    await browser.close();
    await db().query("DELETE FROM corpora WHERE id=$1", [corpus]);
    await db().end();
  }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
