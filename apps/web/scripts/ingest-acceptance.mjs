import { chromium } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto("http://localhost:3001/upload");
const files = await Promise.all(
  [0, 1, 2, 3].map(async (i) => ({
    name: `course-${i}.pdf`,
    bytes: [...(await readFile(`demo/demo-${i}.pdf`))],
  })),
);
await page.locator(".dropzone").evaluate((el, files) => {
  const transfer = new DataTransfer();
  for (const f of files)
    transfer.items.add(
      new File([new Uint8Array(f.bytes)], f.name, { type: "application/pdf" }),
    );
  el.dispatchEvent(
    new DragEvent("drop", {
      dataTransfer: transfer,
      bubbles: true,
      cancelable: true,
    }),
  );
}, files);
await page.locator(".detected-nodes>div").first().waitFor({ timeout: 60000 });
const firstCount = await page.locator(".detected-nodes>div").count();
await page.waitForTimeout(1000);
const growingCount = await page.locator(".detected-nodes>div").count();
assert(growingCount > firstCount);
assert.equal(await page.locator(".ingest-columns>section").count(), 4);
await page.screenshot({ path: "../../.cairn-sessions/screenshots/ingest.png" });
await page.waitForURL("**/read/**", { timeout: 60000 });
await page.locator('.pdf-page[data-loading="false"]').waitFor();
const docId = new URL(page.url()).pathname.split("/").pop();
const bytes = await (
  await page.request.get(`http://localhost:3001/api/doc/${docId}/pdf`)
).body();
assert(files.some((f) => Buffer.from(f.bytes).equals(bytes)));
const uploadAnchorCount = await page.locator(".anchor").count();
await page.goto("http://localhost:3001/upload");
const pdf = await PDFDocument.create();
pdf.addPage([595, 842]);
await writeFile("../../.cairn-sessions/scanned.pdf", await pdf.save());
await page
  .locator("input[type=file]")
  .setInputFiles("../../.cairn-sessions/scanned.pdf");
await page.locator(".unsupported").waitFor({ timeout: 60000 });
assert(
  (await page.locator(".unsupported").textContent()).includes("no text layer"),
);
await page.screenshot({
  path: "../../.cairn-sessions/screenshots/unsupported.png",
});
await page.getByRole("button", { name: "Remove from view" }).click();
assert.equal(await page.locator(".ingest-columns>section").count(), 0);
await page.locator("input[type=file]").setInputFiles({
  name: "notes.txt",
  mimeType: "text/plain",
  buffer: Buffer.from("hello"),
});
assert((await page.locator("p[role=alert]").textContent()).includes("PDF"));
console.log(
  JSON.stringify(
    {
      fourDocumentDrop: true,
      streamFirstCount: firstCount,
      streamLaterCount: growingCount,
      actualUploadedBytesPreserved: true,
      unsupported: true,
      invalidType: true,
      uploadedReferences: uploadAnchorCount,
      pageErrors: errors,
    },
    null,
    2,
  ),
);
assert.equal(errors.length, 0);
await browser.close();
