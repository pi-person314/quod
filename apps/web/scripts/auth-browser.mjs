import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "@playwright/test";
const base = process.env.CAIRN_BASE_URL ?? "http://127.0.0.1:3003";
const out = "../../.cairn-sessions/auth-browser";
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: "chrome" });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(base);
  await page.getByRole("button", { name: "Log in with Google", exact: true }).waitFor();
  assert.equal(await page.locator(".corpus-row").count(), 0);
  for (const endpoint of ["/api/corpus", "/api/library", "/api/doc/5486ed4a-e055-4dc1-8ee3-14ac6c2d24de/pdf"]) {
    assert.equal((await page.request.get(`${base}${endpoint}`)).status(), 401);
  }
  await page.screenshot({ path: `${out}/home-desktop.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${out}/home-mobile.png`, fullPage: true });
  await page.goto(`${base}/upload`);
  await page.getByRole("button", { name: /Log in with Google to add PDFs/ }).waitFor();
  await page.screenshot({ path: `${out}/upload-mobile.png`, fullPage: true });
  assert.equal(await page.locator(".ingest-columns>section").count(), 0);
  console.log("PASS: anonymous corpus/doc APIs rejected; private library empty; upload prompts login; desktop/mobile screenshots captured.");
} finally { await browser.close(); }
