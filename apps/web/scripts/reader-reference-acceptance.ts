// Run with one or more existing document IDs; read-only except ordinary reader state.
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";

async function main() {
  const ids = process.argv.slice(2);
  assert(ids.length, "Pass document IDs to check");
  const base = process.env.QUOD_BASE_URL ?? process.env.CAIRN_BASE_URL ?? "http://127.0.0.1:3003";
  const data = await (await fetch(`${base}/api/library`)).json();
  const browser = await chromium.launch({ channel: "chrome" });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors: string[] = [], results = [];
  page.on("pageerror", error => errors.push(error.message));
  try {
    for (const id of ids) {
      const doc = data.docs.find((d: { id: string }) => d.id === id);
      assert.equal(doc?.status, "ready", `Document ${id} must be ready`);
      const anchors = data.anchors.filter((a: { doc_id: string }) => a.doc_id === id);
      let cards = 0, unmatched = 0, sourceJumpChecked = false;
      for (let number = 1; number <= doc.page_count; number++) {
        await page.goto(`${base}/read/${id}?page=${number}`);
        await page.locator(".pdf-page canvas").waitFor();
        await page.locator(".pdf-loading").waitFor({ state: "hidden" });
        if (anchors.some((a: { page: number }) => a.page === number)) await page.locator(".anchor").first().waitFor();
        const displayed = await page.locator(".anchor").evaluateAll(buttons => buttons.map(button => button.getAttribute("data-anchor")));
        const onPage = displayed.map(id => anchors.find((a: { id: string }) => a.id === id));
        for (const anchor of onPage) {
          await page.mouse.move(5, 5);
          await page.locator(".floating-card").waitFor({ state: "hidden" });
          await page.locator(`[data-anchor="${anchor.id}"]`).hover();
          await page.locator(".floating-card").waitFor().catch(error => { throw new Error(`${doc.title} page ${number}, ${anchor.surface} (${anchor.id}): ${error}`); });
          assert.equal(await page.locator(".reader-toast").count(), 0);
          if (await page.locator(".floating-card [data-card]").count()) {
            assert.equal(await page.locator(".floating-card [data-card]").getAttribute("data-card"), anchor.id);
            cards++;
            const targetId = anchor.target_node_id ?? data.entities.find((e: { id: string }) => e.id === anchor.target_entity_id)?.canonical_node_id;
            const target = data.nodes.find((n: { id: string }) => n.id === targetId);
            if (target && target.doc_id !== id && !sourceJumpChecked) {
              await page.locator(".floating-card .source-chip").click();
              await page.waitForURL(url => url.pathname === `/read/${target.doc_id}` && url.searchParams.get("page") === String(target.page));
              sourceJumpChecked = true;
              await page.goto(`${base}/read/${id}?page=${number}`);
              await page.locator(".pdf-page canvas").waitFor();
              await page.locator(".pdf-loading").waitFor({ state: "hidden" });
            }
          } else {
            await page.getByRole("article", { name: "Unmatched reference" }).waitFor();
            unmatched++;
          }
        }
      }
      const expected = data.nodes.filter((n: NodeEntry) => n.doc_id === id).sort((a: NodeEntry, b: NodeEntry) => a.page - b.page || a.bbox[1] - b.bbox[1] || a.bbox[0] - b.bbox[0] || a.id.localeCompare(b.id));
      assert.deepEqual(await page.locator(".outline-nodes button").evaluateAll(buttons => buttons.map(b => b.getAttribute("data-node"))), expected.map((n: NodeEntry) => n.id));
      for (const text of await page.locator(".outline-nodes .eyebrow").allTextContents()) assert(text.trim() && !text.trim().startsWith("·"));
      results.push({ id, title: doc.title, nodes: data.nodes.filter((n: { doc_id: string }) => n.doc_id === id).length, cards, unmatched, sourceJumpChecked });
    }
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ results, runtimeErrors: errors }));
  } finally { await browser.close(); }
}
type NodeEntry = { id: string; doc_id: string; page: number; bbox: number[] };
void main().catch(error => { console.error(error); process.exitCode = 1; });
