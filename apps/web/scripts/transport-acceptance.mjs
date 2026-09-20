// Database-backed transport check. --live labels real provider calls explicitly.
import { chromium } from "@playwright/test";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
const base = process.env.CAIRN_BASE_URL ?? "http://127.0.0.1:3005";
const live = process.argv.includes("--live");
const existingCorpus = process.env.CAIRN_TEST_CORPUS;
const response = existingCorpus ? undefined : await fetch(base + "/api/corpus", { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ name: `Transport acceptance ${crypto.randomUUID()}` }) });
if (response) assert.equal(response.status, 200);
const corpus_id = existingCorpus ?? (await response.json()).corpus_id;
const pdf = await readFile("../../fixtures/golden/analysis-ch3.pdf");
async function upload() {
  const form = new FormData(); form.append("files", new Blob([pdf], { type: "application/pdf" }), "analysis-ch3.pdf");
  const response = await fetch(`${base}/api/corpus/${corpus_id}/docs`, { method: "POST", body: form });
  assert.equal(response.status, 200); return (await response.json()).doc_ids[0];
}
const docId = await upload();
console.log(JSON.stringify({ corpus_id, docId }));
const abort = new AbortController();
const events = await fetch(`${base}/api/corpus/${corpus_id}/events`, { signal: abort.signal });
assert.equal(events.status, 200); assert.match(events.headers.get("content-type"), /text\/event-stream/);
const reader = events.body.getReader();
const stream = []; const decoder = new TextDecoder();
const received = (async () => { try { while (true) { const next = await reader.read(); if (next.done) break; stream.push(decoder.decode(next.value)); } } catch (error) { if (!abort.signal.aborted) throw error; } })();
let data, doc;
for (let attempt = 0; attempt < (live ? 300 : 120); attempt++) {
  data = await (await fetch(base + "/api/library")).json(); doc = data.docs.find(doc => doc.id === docId);
  if (doc?.status === "ready") break;
  assert.notEqual(doc?.status, "error", "worker failed");
  if (attempt % 15 === 0) console.log(`Ingest status: ${doc?.status}`);
  await new Promise(resolve => setTimeout(resolve, live ? 2000 : 500));
}
assert.equal(doc.status, "ready");
await new Promise(resolve => setTimeout(resolve, 1200)); abort.abort(); await received;
const nodes = data.nodes.filter(node => node.doc_id === docId);
assert.equal(nodes.length, 20); assert(!Object.hasOwn(doc, "pdf_bytes"));
assert.equal(await upload(), docId);
assert(Buffer.from(await (await fetch(`${base}/api/doc/${docId}/pdf`)).arrayBuffer()).equals(pdf));
assert(stream.join("").includes('"stage":"done"'));
const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage(); const errors = [];
page.on("pageerror", error => errors.push(error.message));
try {
  await page.goto(`${base}/read/${docId}?page=1`);
  await page.locator('.pdf-page[data-loading="false"]').waitFor({ timeout: 60000 });
  const search = await (await page.request.get(`${base}/api/search?corpus_id=${corpus_id}&q=${encodeURIComponent(nodes[0].label)}`)).json();
  assert(search.hits.some(hit => hit.node.doc_id === docId));
  assert.deepEqual(errors, []);
  await mkdir("../../.cairn-sessions/current-browser", { recursive: true });
  const result = { corpus_id, docId, nodes: nodes.length, uploadWorkerHttp: true, sseReady: true, duplicateId: true,
    pdfBytes: true, browserPdf: true, scopedSearch: true, runtimeErrors: errors, providerMode: live ? "live" : "disabled" };
  await writeFile("../../.cairn-sessions/current-browser/transport-results.json", JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally { await browser.close(); }
