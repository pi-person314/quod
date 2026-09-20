// Fresh browser upload using an existing PDF; credentials stay in the user's server.
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";
import { db } from "@quod/contracts/db";

async function main() {
  const source = process.argv[2];
  assert(source, "Pass a source document ID");
  const base = process.env.QUOD_BASE_URL ?? process.env.CAIRN_BASE_URL ?? "http://127.0.0.1:3003";
  const pdf = await fetch(`${base}/api/doc/${source}/pdf`);
  assert.equal(pdf.status, 200);
  const browser = await chromium.launch({ channel: "chrome" });
  let corpus: string | undefined, doc: string | undefined, terminal = false;
  try {
    const page = await browser.newPage(), errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${base}/upload`);
    const created = page.waitForResponse(r => r.url().endsWith("/api/corpus") && r.request().method() === "POST");
    const uploaded = page.waitForResponse(r => /\/api\/corpus\/[^/]+\/docs$/.test(r.url()) && r.request().method() === "POST");
    const started = Date.now();
    await page.locator('input[type="file"]').setInputFiles({ name: "Stage timing verification.pdf", mimeType: "application/pdf", buffer: Buffer.from(await pdf.arrayBuffer()) });
    corpus = (await (await created).json()).corpus_id;
    doc = (await (await uploaded).json()).doc_ids[0];
    const transitions: { stage: string; atMs: number; message: string | null }[] = [];
    const visible = new Set<string>();
    let previous = "";
    while (Date.now() - started < 600000) {
      const { rows } = await db().query("SELECT d.status,p.stage,p.message FROM documents d JOIN ingest_progress p ON p.doc_id=d.id WHERE d.id=$1", [doc]);
      const current = rows[0];
      if (current.stage !== previous) {
        transitions.push({ stage: current.stage, atMs: Date.now() - started, message: current.message });
        console.log(JSON.stringify(transitions.at(-1)));
        previous = current.stage;
      }
      for (const text of await page.locator(".ingest-columns .muted").allTextContents()) if (text.includes(" / ")) visible.add(text.trim());
      if (["ready", "error", "unsupported"].includes(current.status)) {
        terminal = true;
        assert.equal(current.status, "ready", current.message);
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    assert(terminal, "Upload timed out; retained for diagnosis");
    await page.waitForURL(`**/read/${doc}`, { timeout: 10000 });
    await page.locator('.pdf-page[data-loading="false"]').waitFor();
    assert.deepEqual(errors, []);
    assert([...visible].some(text => text.includes("Analyzing result details")));
    assert([...visible].some(text => text.includes("Comparing related results")));
    assert([...visible].some(text => text.includes("Preparing cards")));
    const calls = (await db().query(`SELECT stage,count(*)::int AS calls,sum(latency_ms)::int AS provider_ms,
      sum(cost_usd)::float AS cost FROM llm_calls WHERE corpus_id=$1 OR doc_id=$2 GROUP BY stage`, [corpus, doc])).rows;
    const report = { elapsedMs: Date.now() - started, transitions, visibleProgress: [...visible], calls, runtimeErrors: errors };
    await writeFile("../../.session-tools/ingest-progress-results.json", JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  } finally {
    await browser.close();
    if (corpus && terminal) await db().query("DELETE FROM corpora WHERE id=$1", [corpus]);
    await db().end();
  }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
