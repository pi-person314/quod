import { chromium } from "@playwright/test";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto(
  "http://localhost:3001/read/b0000000-0000-4000-8000-000000000003",
);
await page.locator('.pdf-page[data-loading="false"]').waitFor();
console.log(
  await page.evaluate(() => {
    const a = document.querySelector(".anchor"),
      r = a.getBoundingClientRect();
    const spans = [...document.querySelectorAll(".textLayer span")];
    const s = spans.find((s) =>
      s.textContent.includes("the dimension theorem"),
    );
    const t = s.firstChild;
    const range = document.createRange();
    const start = t.textContent.indexOf("the dimension theorem");
    range.setStart(t, start);
    range.setEnd(t, start + "the dimension theorem".length);
    const tr = range.getBoundingClientRect();
    return {
      anchor: [r.x, r.y, r.width, r.height],
      text: [tr.x, tr.y, tr.width, tr.height],
      style: s.getAttribute("style"),
    };
  }),
);
await browser.close();
