import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
const base = process.env.QUOD_BASE_URL ?? process.env.CAIRN_BASE_URL ?? "http://127.0.0.1:3003";
const out = "../../.cairn-sessions/current-browser";
await mkdir(`${out}/screenshots`, { recursive: true });
const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto(
  `${base}/read/b0000000-0000-4000-8000-000000000001?page=4`,
);
await page.locator('.pdf-page[data-loading="false"]').waitFor();
const line = page
  .locator(".textLayer span")
  .filter({ hasText: "corresponding combination" });
await line.scrollIntoViewIfNeeded();
const r = await line.boundingBox();
await page.mouse.move(r.x + 2, r.y + r.height / 2);
await page.mouse.down();
await page.mouse.move(r.x + r.width - 2, r.y + r.height / 2, { steps: 18 });
await page.mouse.up();
const selected = await page.evaluate(() => window.getSelection().toString());
assert(selected.includes("corresponding combination"));
await page
  .getByRole("button", { name: "Why am I stuck?", exact: false })
  .click();
await page.locator(".trace-hop").nth(3).waitFor();
await page.screenshot({
  path: `${out}/screenshots/physical-selection-trace.png`,
});
await page.keyboard.press("Escape");
await page.goto(
  `${base}/read/b0000000-0000-4000-8000-000000000003?page=1`,
);
await page.locator('.pdf-page[data-loading="false"]').waitFor();
const cross = await page
  .locator(".anchor.cross")
  .first()
  .evaluate((el) => getComputedStyle(el).borderBottomColor);
assert.equal(cross, "rgb(143, 184, 255)");
await page.getByRole("spinbutton", { name: "Page number" }).fill("3");
await page.locator(".anchor.uncertain").waitFor();
const dash = await page
  .locator(".anchor.uncertain")
  .evaluate((el) => getComputedStyle(el).borderBottomStyle);
assert.equal(dash, "dashed");
await page.getByRole("button", { name: "Search", exact: false }).click();
await page
  .getByRole("textbox", { name: "Search corpus" })
  .fill("no-such-theorem-xyz");
await page.getByText("No results. Try a theorem name or a symbol.").waitFor();
await page.screenshot({
  path: `${out}/screenshots/search-empty.png`,
});
await page.keyboard.press("Escape");
await page.route("**/api/doc/*/pdf", (route) =>
  route.fulfill({ status: 404, body: "PDF unavailable" }),
);
await page.reload();
await page
  .getByText("This PDF could not be opened.", { exact: false })
  .waitFor();
await page.screenshot({
  path: `${out}/screenshots/pdf-error.png`,
});
await page.unroute("**/api/doc/*/pdf");
await page.getByRole("button", { name: "Try again", exact: true }).click();
await page.locator('.pdf-page[data-loading="false"]').waitFor();
const result = {
  physicalDragSelection: selected,
  crossDocumentColor: cross,
  lowConfidenceStyle: dash,
  searchEmpty: true,
  pdfErrorAndRetry: true,
};
console.log(JSON.stringify(result, null, 2));
await writeFile(
  `${out}/physical-results.json`,
  JSON.stringify(result, null, 2),
);
await browser.close();
