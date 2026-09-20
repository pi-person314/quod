// Exercises real retry dispatch with an empty PDF: parsing rejects it before any paid calls.
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { db } from "@quod/contracts/db";

async function main() {
  const base = process.env.QUOD_BASE_URL ?? process.env.CAIRN_BASE_URL ?? "http://127.0.0.1:3003";
  const corpus = randomUUID(), doc = randomUUID();
  const pdf = await PDFDocument.create(); pdf.addPage([595, 842]);
  const bytes = Buffer.from(await pdf.save());
  const browser = await chromium.launch({ channel: "chrome" });
  try {
    await db().query("INSERT INTO corpora(id,name) VALUES($1,'Disposable browser retry check')", [corpus]);
    await db().query(`INSERT INTO documents(id,corpus_id,title,filename,file_hash,pdf_bytes,status,page_count)
      VALUES($1,$2,'Retry check','empty.pdf',$3,$4,'error',1)`, [doc, corpus, createHash("sha256").update(bytes).digest("hex"), bytes]);
    await db().query("INSERT INTO ingest_progress(doc_id,stage,message) VALUES($1,'error','Controlled earlier failure')", [doc]);
    const page = await browser.newPage(), errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    const forbidden = await page.request.post(`${base}/api/doc/${doc}/retry`, { headers: { origin: "https://other.invalid" } });
    assert.equal(forbidden.status(), 403);
    await page.goto(`${base}/read/${doc}`);
    const response = page.waitForResponse(response => response.url().endsWith(`/api/doc/${doc}/retry`) && response.request().method() === "POST");
    await page.getByRole("button", { name: "Retry document", exact: true }).click();
    assert.equal((await response).status(), 202);
    await page.locator(".empty.error").filter({ hasText: "Unsupported PDF (scanned or no text layer)." }).waitFor({ timeout: 60000 });
    const { rows } = await db().query("SELECT status FROM documents WHERE id=$1", [doc]);
    assert.equal(rows[0].status, "unsupported");
    assert.equal((await db().query("SELECT count(*)::int AS count FROM llm_calls WHERE doc_id=$1", [doc])).rows[0].count, 0);
    assert.deepEqual(errors, []);
    const result = { storedPdfRetry: true, nativeWorkerDispatch: true, progressAutoRefresh: true, crossOriginRejected: true, sameDocumentId: true, paidCalls: 0, runtimeErrors: errors };
    await writeFile("../../.cairn-sessions/current-browser/retry-results.json", JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
  } finally {
    await browser.close();
    await db().query("DELETE FROM corpora WHERE id=$1", [corpus]);
    await db().end();
  }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
