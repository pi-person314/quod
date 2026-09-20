// Real HTTP and browser checks with disposable data; no provider calls or credentials.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chromium } from "@playwright/test";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { db } from "@cairn/contracts/db";

async function main() {
  const base = process.env.CAIRN_BASE_URL ?? "http://127.0.0.1:3003";
  const corpus = randomUUID(), doc = randomUUID(), node = randomUUID();
  const known = randomUUID(), unknown = randomUUID();
  const pdf = await PDFDocument.create(), sheet = pdf.addPage([612, 792]);
  const font = await pdf.embedFont(StandardFonts.TimesRoman);
  sheet.drawText("Theorem 1. An original result.", { x: 40, y: 740, size: 12, font });
  sheet.drawText("By Theorem 1", { x: 40, y: 700, size: 12, font });
  sheet.drawText("By Theorem 99", { x: 40, y: 660, size: 12, font });
  const browser = await chromium.launch({ channel: "chrome" });
  try {
    await db().query("INSERT INTO corpora(id,name) VALUES($1,'Disposable reference fallback check')", [corpus]);
    await db().query("INSERT INTO documents(id,corpus_id,title,filename,status,page_count,pdf_bytes) VALUES($1,$2,'Reference check','references.pdf','ready',1,$3)", [doc, corpus, Buffer.from(await pdf.save())]);
    await db().query("INSERT INTO nodes(id,doc_id,kind,label,statement_md,page,bbox,confidence) VALUES($1,$2,'theorem','Theorem 1','An original result.',1,ARRAY[40,40,300,56],1)", [node, doc]);
    await db().query("INSERT INTO anchors(id,doc_id,page,bbox,surface,target_node_id) VALUES($1,$2,1,ARRAY[40,80,130,95],'By Theorem 1',$3),($4,$2,1,ARRAY[40,120,130,135],'By Theorem 99',NULL)", [known, doc, node, unknown]);
    const response = await fetch(`${base}/api/card/${known}`);
    assert.equal(response.status, 200);
    const card = await response.json();
    assert.equal(card.full_md, "An original result.");
    assert.match(card.gloss, /Original statement/);
    assert.equal((await fetch(`${base}/api/card/${unknown}`)).status, 404);
    const page = await browser.newPage(), errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${base}/read/${doc}`);
    await page.getByRole("button", { name: "Reference: By Theorem 1", exact: true }).hover();
    await page.locator(`.floating-card [data-card="${known}"]`).waitFor();
    assert.match(await page.locator(".floating-card").innerText(), /Original statement/);
    await page.mouse.move(5, 5);
    await page.locator(".floating-card").waitFor({ state: "hidden" });
    await page.getByRole("button", { name: "Reference: By Theorem 99", exact: true }).hover();
    await page.getByRole("article", { name: "Unmatched reference" }).waitFor();
    assert.equal(await page.locator(".reader-toast").count(), 0);
    assert.deepEqual(errors, []);
    assert.equal((await db().query("SELECT count(*)::int AS n FROM cards WHERE anchor_id IN ($1,$2)", [known, unknown])).rows[0].n, 0);
    console.log("PASS: missing baked card returns original source, unknown reference shows a normal popover, no error toasts/runtime errors, no stored-card mutation or model calls.");
  } finally {
    await browser.close();
    await db().query("DELETE FROM corpora WHERE id=$1", [corpus]);
    await db().end();
  }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
