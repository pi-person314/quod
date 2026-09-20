import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
const out = "../../.cairn-sessions/current-browser/screenshots";
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const base = process.env.CAIRN_BASE_URL ?? "http://127.0.0.1:3003";
const data = await (await page.request.get(base + "/api/library")).json();
const demo = data.docs.filter((d) => d.id.startsWith("b000"));
let checked = 0,
  maxError = 0;
const times = [];
const ready = async () => {
  await page
    .locator('.pdf-page[data-loading="false"]')
    .waitFor({ timeout: 60000 });
  await page.waitForTimeout(120);
};
const mapOnly = process.argv.includes("--map-only");
if (!mapOnly) {
for (const doc of demo) {
  console.log("Checking",doc.title);
  await page.goto(`${base}/read/${doc.id}?page=1`);
  await ready();
  for (let p = 1; p <= doc.page_count; p++) {
    console.log(" page",p);
    await page.getByRole("spinbutton", { name: "Page number" }).fill(String(p));
    await ready();
    for (const zoom of ["0.5", "1", "2"]) {
      await page.getByRole("combobox", { name: "Zoom" }).selectOption(zoom);
      await ready();
      for (const viewportWidth of [1280, 1100]) {
      await page.setViewportSize({width:viewportWidth,height:800});
      await ready();
      const anchors = data.anchors.filter(
        (a) => a.doc_id === doc.id && a.page === p,
      );
      const result = await page.locator(".pdf-page").evaluate((el, anchors) => {
        const r = el.getBoundingClientRect(),
          w = Number(el.dataset.pageWidth),
          h = Number(el.dataset.pageHeight);
        return anchors.map((a, i) => {
          const b = el.querySelectorAll(".anchor")[i].getBoundingClientRect();
          return Math.max(
            Math.abs(b.x - r.x - (a.bbox[0] * r.width) / w),
            Math.abs(b.y - r.y - (a.bbox[1] * r.height) / h),
            Math.abs(b.width - ((a.bbox[2] - a.bbox[0]) * r.width) / w),
            Math.abs(b.height - ((a.bbox[3] - a.bbox[1]) * r.height) / h),
          );
        });
      }, anchors);
      maxError = Math.max(maxError, ...result);
      assert(result.every((e) => e < 2));
      checked += result.length;
      if (doc.id === demo[2].id && viewportWidth===1280)
        await page.screenshot({ path: `${out}/alignment-p${p}-${zoom}.png` });
      }
      await page.setViewportSize({width:1280,height:800});
      await ready();
    }
    await page.getByRole("combobox", { name: "Zoom" }).selectOption("0.5");
    await ready();
    for (const anchor of data.anchors.filter(
      (a) => a.doc_id === doc.id && a.page === p,
    )) {
      const locator = page.getByRole("button", {
        name: `Reference: ${anchor.surface}`,
        exact: true,
      });
      await locator.scrollIntoViewIfNeeded();
      await locator.evaluate((el) => {
        window.__hoverStart = performance.now();
        el.addEventListener(
          "mouseenter",
          () => {
            window.__hoverStart = performance.now();
            const observer=new MutationObserver(()=>{if(document.querySelector('.floating-card')){window.__cardLatency=performance.now()-window.__hoverStart;observer.disconnect();}});
            observer.observe(document.body,{childList:true,subtree:true});
          },
          { once: true },
        );
      });
      await locator.hover();
      await page.locator(".floating-card").waitFor();
      const elapsed = await page.evaluate(
        () => window.__cardLatency,
      );
      times.push(elapsed);
      assert.equal(
        await page.locator(".floating-card article").getAttribute("data-card"),
        anchor.id,
      );
      await page.keyboard.press("Escape");
      await page.mouse.move(10, 10);
    }
  }
  await page.setViewportSize({ width: 1100, height: 800 });
  await ready();
  const width = await page
    .locator(".pdf-page")
    .evaluate((el) => el.offsetWidth);
  assert(width > 200);
  await page.setViewportSize({ width: 1280, height: 800 });
}
console.log(
  "Coordinate/hover sweep",
  JSON.stringify({
    checked,
    maxError,
    samples: times.length,
    maxHoverMs: Math.max(...times),
  }),
);
await page.goto(`${base}/read/${demo[2].id}?page=1`);
await ready();
await page
  .getByRole("button", {
    name: "Reference: the dimension theorem",
    exact: true,
  })
  .hover();
await page.locator(".floating-card").waitFor();
await page.locator(".floating-card").hover();
await page.waitForTimeout(400);
assert(await page.locator(".floating-card").isVisible());
await page
  .locator(".floating-card")
  .getByText("Show full statement", { exact: false })
  .click();
const rect = await page.locator(".floating-card").boundingBox();
assert(rect.y + rect.height <= 801);
await page.screenshot({ path: `${out}/full-statement.png` });
await page
  .locator(".floating-card")
  .getByRole("button", { name: "Jump to source", exact: false })
  .click();
await ready();
assert(page.url().includes(demo[0].id));
assert((await page.locator(".pdf-scroll").evaluate((el) => el.scrollTop)) > 0);
await page.keyboard.press("/");
await page.getByRole("textbox", { name: "Search corpus" }).fill("rank nullity");
await page.waitForTimeout(600);
assert((await page.locator(".search-result").count()) > 0);
await page.keyboard.press("Escape");
await page.goto(`${base}/read/${demo[0].id}?page=3`);
await ready();
await page
  .locator(".textLayer span")
  .filter({ hasText: "composition" })
  .first()
  .evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
await page
  .getByRole("button", { name: "Why am I stuck?", exact: false })
  .click();
await page.locator(".trace-hop").first().waitFor();
assert((await page.locator(".trace-hop").count()) >= 3);
await page.screenshot({ path: `${out}/trace.png` });
await page.keyboard.press("Escape");
await page.goto(base + "/acceptance/map");
} else await page.goto(base + "/acceptance/map");
await page.locator("circle").nth(199).waitFor({ timeout: 60000 });
const bounds = await page.locator("circle").evaluateAll((els) =>
  els.map((e) => {
    const r = e.getBoundingClientRect();
    return (
      r.x >= 0 &&
      r.y >= 180 &&
      r.right <= innerWidth &&
      r.bottom <= innerHeight - 40
    );
  }),
);
assert(bounds.every(Boolean));
const performanceResult = await page.evaluate(async () => {
  const svg = document.querySelector("svg");
  const durations = [];
  let previous = performance.now(),
    start = previous;
  return await new Promise((resolve) => {
    function frame(now) {
      durations.push(now - previous);
      previous = now;
      svg.dispatchEvent(
        new WheelEvent("wheel", {
          deltaY: Math.sin(now / 180) * 5,
          clientX: 650,
          clientY: 420,
          bubbles: true,
          cancelable: true,
        }),
      );
      if (now - start < 3000) requestAnimationFrame(frame);
      else
        resolve({
          frames: durations.length,
          fps: (durations.length / (now - start)) * 1000,
          p95: durations.sort((a, b) => a - b)[
            Math.floor(durations.length * 0.95)
          ],
        });
    }
    requestAnimationFrame(frame);
  });
});
await page.screenshot({ path: `${out}/map-200.png` });
const report = {
  coordinateChecks: checked,
  maxCoordinateErrorPx: maxError,
  hoverSamples: times.length,
  hoverTotalMs: {
    min: Math.min(...times),
    max: Math.max(...times),
    average: times.reduce((a, b) => a + b, 0) / times.length,
  },
  map200: performanceResult,
  pageErrors: errors,
};
console.log(JSON.stringify(report, null, 2));
await writeFile(
  `../../.cairn-sessions/current-browser/${mapOnly ? "map-results" : "browser-results"}.json`,
  JSON.stringify(report, null, 2),
);
assert(performanceResult.fps >= 30, `200-node map measured ${performanceResult.fps.toFixed(1)}fps, requires 30fps`);
assert.equal(errors.length, 0);
await browser.close();
