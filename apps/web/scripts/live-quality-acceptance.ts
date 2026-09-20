// Calls the user's private server, never reads provider keys or environment files.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { db } from "@cairn/contracts/db";
import { instantiationCases } from "../../../packages/intel/evals/instantiation-cases";

async function main() {
  if (process.argv.includes("--rescore")) {
    const path = "../../.cairn-sessions/current-quality/instantiation-live.json";
    const report = JSON.parse(await readFile(path, "utf8"));
    for (const result of report.results) {
      const expected = instantiationCases.find(c => c.name === result.name)!.expected;
      result.substitutionsCorrect = isDeepStrictEqual(result.actual.substitutions, expected.substitutions);
    }
    report.correctRewrites = report.results.filter((r: { rewriteCorrect: boolean; substitutionsCorrect: boolean }) => r.rewriteCorrect && r.substitutionsCorrect).length;
    await writeFile(path, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ correctClauses: report.correctClauses, correctRewrites: report.correctRewrites, total: report.total, rescoredStoredResponses: true })); return;
  }
  if (!process.argv.includes("--live")) throw new Error("Pass --live for provider-backed quality evaluation");
  const base = process.env.CAIRN_BASE_URL ?? "http://127.0.0.1:3003";
  const corpus = randomUUID(), source = randomUUID(), invoking = randomUUID();
  const cases: { name: string; anchor: string; expected: typeof instantiationCases[number]["expected"] }[] = [];
  try {
    await db().query("INSERT INTO corpora(id,name) VALUES($1,'Live quality evaluation: authored mathematics')", [corpus]);
    for (const [id, title] of [[source, "Evaluation statements"], [invoking, "Evaluation applications"]])
      await db().query("INSERT INTO documents(id,corpus_id,title,filename,status,page_count) VALUES($1,$2,$3,'evaluation.pdf','ready',20)", [id, corpus, title]);
    for (const [index, c] of instantiationCases.entries()) {
      const target = randomUUID(), local = randomUUID(), anchor = randomUUID();
      await db().query(`INSERT INTO nodes(id,doc_id,kind,label,title,statement_md,clauses,symbols,page,bbox,confidence)
        VALUES($1,$2,'theorem',$3,$4,$5,$6,$7,$8,$9,1)`, [target, source, `Theorem ${index + 1}`, c.name,
        c.input.target.statement_md, JSON.stringify(c.input.target.clauses), JSON.stringify(c.input.target.symbols), index + 1, [0, 0, 500, 100]]);
      const surface = `Theorem ${index + 1}`;
      await db().query(`INSERT INTO nodes(id,doc_id,kind,statement_md,clauses,symbols,page,bbox,confidence)
        VALUES($1,$2,'proof',$3,'[]',$4,$5,$6,1)`, [local, invoking, `By ${surface}. ${c.input.invokingParagraph}`,
        JSON.stringify(c.input.localSymbols), index + 1, [0, 0, 500, 100]]);
      await db().query("INSERT INTO anchors(id,doc_id,page,bbox,surface,target_node_id) VALUES($1,$2,$3,$4,$5,$6)",
        [anchor, invoking, index + 1, [5, 5, 100, 20], surface, target]);
      cases.push({ name: c.name, anchor, expected: c.expected });
    }
    const cost = async () => Number((await db().query("SELECT coalesce(sum(cost_usd),0) AS cost FROM llm_calls WHERE doc_id=$1", [invoking])).rows[0].cost);
    const before = await cost();
    const bake = async () => {
      const response = await fetch(base + "/api/intel/bake", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ doc_id: invoking }) });
      assert.equal(response.status, 200); assert.equal((await response.json()).cards_done, 20);
    };
    console.log(`Evaluating 20 live clause-selection and notation cases in corpus ${corpus}`);
    await bake();
    const firstCost = await cost() - before;
    const cards = (await db().query("SELECT * FROM cards WHERE anchor_id=ANY($1::uuid[])", [cases.map(c => c.anchor)])).rows;
    const results = cases.map(c => {
      const card = cards.find(card => card.anchor_id === c.anchor)!;
      return { name: c.name, clauseCorrect: JSON.stringify(card.clause_ids) === JSON.stringify(c.expected.clause_ids),
        rewriteCorrect: card.instantiated_md === c.expected.instantiated_md,
        substitutionsCorrect: isDeepStrictEqual(card.substitutions, c.expected.substitutions),
        actual: { clause_ids: card.clause_ids, substitutions: card.substitutions, instantiated_md: card.instantiated_md, gloss: card.gloss } };
    });
    await bake();
    const repeatCost = await cost() - before - firstCost;
    const repeated = (await db().query("SELECT * FROM cards WHERE anchor_id=ANY($1::uuid[])", [cases.map(c => c.anchor)])).rows;
    assert.deepEqual(repeated.sort((a,b) => a.id.localeCompare(b.id)), cards.sort((a,b) => a.id.localeCompare(b.id)));
    const report = { providerMode: "live", benchmark: "20 hand-authored development cases; not source-PDF acceptance", corpus,
      correctClauses: results.filter(r => r.clauseCorrect).length, correctRewrites: results.filter(r => r.rewriteCorrect && r.substitutionsCorrect).length,
      total: 20, cost: { scope: "C1 baking only, same-process warm repeat", firstUsd: firstCost, repeatUsd: Math.max(0, repeatCost) }, results };
    await mkdir("../../.cairn-sessions/current-quality", { recursive: true });
    await writeFile("../../.cairn-sessions/current-quality/instantiation-live.json", JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  } finally {
    // Preserve paid ledger rows, but remove only this evaluation's application data.
    await db().query("DELETE FROM corpora WHERE id=$1", [corpus]);
    await db().end();
  }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
