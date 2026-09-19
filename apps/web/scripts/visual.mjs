import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on("pageerror", (e) => console.log("ERROR", e.message));
await page.goto(
  "http://localhost:3001/read/b0000000-0000-4000-8000-000000000003",
);
await page.locator('.pdf-page[data-loading="false"]').waitFor();
for (let i = 0; i < 3; i++) {
  await page.locator(".anchor").nth(i).hover();
  await page.locator(".floating-card").waitFor();
  await page
    .locator(".floating-card")
    .getByRole("button", { name: "Pin +", exact: true })
    .click();
  await page.locator('.pdf-page[data-loading="false"]').waitFor();
}
console.log(
  "Pinned",
  await page.locator(".pinned").evaluateAll((els) =>
    els.map((e) => ({
      top: e.getBoundingClientRect().top,
      bottom: e.getBoundingClientRect().bottom,
      height: e.getBoundingClientRect().height,
    })),
  ),
);
await page.screenshot({ path: "../../.cairn-sessions/screenshots/pinned.png" });
await page.getByRole("button", { name: "Corpus map", exact: true }).click();
await page.waitForTimeout(4000);
await page.screenshot({ path: "../../.cairn-sessions/screenshots/map.png" });
console.log("Map nodes", await page.locator("circle").count());
await browser.close();
