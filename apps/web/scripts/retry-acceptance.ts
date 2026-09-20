import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { db } from "@cairn/contracts/db";
import { LOCAL } from "../lib/data";
import { retryDocument } from "../lib/retry-document";

async function main() {
  const corpus = randomUUID(), doc = randomUUID(), bytes = Buffer.from("%PDF-retry-check");
  const dispatched: string[][] = [];
  const dispatch = (...args: string[]) => { dispatched.push(args); };
  try {
    await db().query("INSERT INTO corpora(id,name) VALUES($1,'Disposable retry check')", [corpus]);
    await db().query("INSERT INTO documents(id,corpus_id,title,filename,status,pdf_bytes) VALUES($1,$2,'Retry','retry.pdf','error',$3)", [doc, corpus, bytes]);
    await db().query("INSERT INTO ingest_progress(doc_id,stage,message) VALUES($1,'error','Earlier failure')", [doc]);
    const results = await Promise.all([retryDocument(doc, dispatch), retryDocument(doc, dispatch)]);
    assert.deepEqual(results.sort(), ["queued", "unavailable"]);
    assert.equal(dispatched.length, 1);
    assert.equal(dispatched[0][1], corpus); assert.equal(dispatched[0][2], doc);
    assert((await readFile(dispatched[0][0])).equals(bytes));
    const { rows } = await db().query("SELECT status,stage,message FROM documents JOIN ingest_progress ON doc_id=documents.id WHERE documents.id=$1", [doc]);
    assert.deepEqual(rows[0], { status: "queued", stage: "queued", message: null });
    assert.equal(await retryDocument(randomUUID(), dispatch), "missing");
    await db().query("UPDATE documents SET status='ready' WHERE id=$1", [doc]);
    assert.equal(await retryDocument(doc, dispatch), "unavailable");
    assert.equal(dispatched.length, 1);
    assert.equal(await retryDocument(doc, dispatch, true), "queued");
    assert.equal(await retryDocument(doc, dispatch, true), "unavailable");
    assert.equal(dispatched.length, 2);
    console.log("PASS: retries dispatch once, preserve bytes and IDs, clear progress, reject ready/missing documents by default, and support explicit ready-document reprocessing. No provider calls.");
  } finally {
    await db().query("DELETE FROM corpora WHERE id=$1", [corpus]);
    await rm(join(LOCAL, "pdf", `${doc}.pdf`), { force: true });
    await db().end();
  }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
