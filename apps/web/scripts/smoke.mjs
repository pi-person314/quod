import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
await mkdir("../../.cairn-sessions/screenshots", { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on("pageerror", (e) => console.log("PAGE ERROR", e.message));
page.on("console", (m) => {
  if (m.type() === "error") console.log("CONSOLE", m.text());
});
await page.goto("http://localhost:3001");
await page.screenshot({
  path: "../../.cairn-sessions/screenshots/landing.png",
  fullPage: true,
});
await page.getByText("Open the demo corpus").click();
await page
  .locator('.pdf-page[data-loading="false"]')
  .waitFor({ timeout: 60000 });
await page.screenshot({ path: "../../.cairn-sessions/screenshots/reader.png" });
await page
  .getByRole("button", {
    name: "Reference: the dimension theorem",
    exact: true,
  })
  .hover();
await page.locator(".floating-card").waitFor();
await page.screenshot({ path: "../../.cairn-sessions/screenshots/hover.png" });
console.log(
  "Reader title:",
  await page.title(),
  "anchors:",
  await page.locator(".anchor").count(),
  "text spans:",
  await page.locator(".textLayer span").count(),
);
await browser.close();
