import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
const base = process.env.CAIRN_BASE_URL ?? "http://127.0.0.1:3003";
const browser = await chromium.launch({ channel: "chrome" });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`${base}/upload`);
  const library = await (await page.request.get(`${base}/api/library`)).json();
  const doc = library.docs.find(d => d.status === "ready");
  assert(doc, "A readable fixture is needed for the navigation check");
  let ready = false;
  let streams = 0;
  let posts = 0;
  page.on("request", request => { if (request.method() === "POST") posts++; });
  await page.route("**/api/corpus/*/events", route => {
    streams++;
    return route.fulfill({ status: 200, contentType: "text/event-stream", body:
      `data: ${JSON.stringify({ doc_id: doc.id, stage: "parse", nodes_done: 0, total: 0 })}\n\n` });
  });
  await page.route("**/api/library", route => route.fulfill({ json: {
    ...library, docs: [{ ...doc, status: ready ? "ready" : "ingesting" }],
  } }));
  await page.evaluate(({ doc }) => sessionStorage.setItem("cairn.pending-upload", JSON.stringify({
    corpus: doc.corpus_id,
    columns: [{ id: doc.id, name: "Recovered upload.pdf", stage: "queued", nodes: [] }],
  })), { doc });
  await page.reload();
  await page.getByRole("heading", { name: "Recovered upload.pdf" }).waitFor();
  await page.reload();
  await page.getByRole("heading", { name: "Recovered upload.pdf" }).waitFor();
  ready = true;
  await page.waitForURL(`**/read/${doc.id}`, { timeout: 30000 });
  assert(streams >= 2, "Reload should reconnect progress");
  assert.equal(posts, 0, "Recovery must not reupload documents");
  assert.equal(await page.evaluate(() => sessionStorage.getItem("cairn.pending-upload")), null);
  assert.deepEqual(errors, []);
  console.log("PASS: progress survives reload; disconnected SSE recovers durable completion; reader opens without reupload.");
} finally { await browser.close(); }
