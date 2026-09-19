/**
 * `pnpm test:contracts` — A0 acceptance test.
 *
 * Validates every fixtures/golden/*.json against GoldenFixture, then checks
 * referential integrity across all files together (pset4.json is allowed to
 * point at entities defined in analysis-ch3.json).
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { FIXTURE_CORPUS_ID, GoldenFixture } from "./types";

const goldenDir = resolve(import.meta.dirname, "../../fixtures/golden");
const files = readdirSync(goldenDir).filter((f) => f.endsWith(".json")).sort();

const problems: string[] = [];
const fixtures: { file: string; fx: GoldenFixture }[] = [];

for (const file of files) {
  const raw = JSON.parse(readFileSync(join(goldenDir, file), "utf8"));
  const parsed = GoldenFixture.safeParse(raw);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      problems.push(`${file}: ${issue.path.join(".") || "<root>"}: ${issue.message}`);
    }
    continue;
  }
  fixtures.push({ file, fx: parsed.data });
}

// Cross-file integrity.
const nodeIds = new Set<string>();
const entityIds = new Set<string>();
const anchorIds = new Set<string>();
const cardIds = new Set<string>();
const docIds = new Set<string>();
for (const { fx } of fixtures) {
  docIds.add(fx.document.id);
  fx.nodes.forEach((n) => nodeIds.add(n.id));
  fx.entities.forEach((e) => entityIds.add(e.id));
  fx.anchors.forEach((a) => anchorIds.add(a.id));
  fx.cards.forEach((c) => cardIds.add(c.id));
}

for (const { file, fx } of fixtures) {
  const p = (msg: string) => problems.push(`${file}: ${msg}`);
  if (fx.document.corpus_id !== FIXTURE_CORPUS_ID) p(`document.corpus_id must be ${FIXTURE_CORPUS_ID}`);
  if (fx.pdf && !existsSync(join(goldenDir, fx.pdf))) p(`pdf "${fx.pdf}" not found next to the fixture`);

  for (const n of fx.nodes) {
    if (n.doc_id !== fx.document.id) p(`node ${n.label ?? n.id} doc_id != document.id`);
    if (n.entity_id && !entityIds.has(n.entity_id)) p(`node ${n.label ?? n.id} entity_id ${n.entity_id} unknown`);
    if (n.page > fx.document.page_count && fx.document.page_count > 0) p(`node ${n.label ?? n.id} page ${n.page} > page_count`);
  }
  for (const e of fx.edges) {
    if (!nodeIds.has(e.src)) p(`edge src ${e.src} unknown`);
    if (!nodeIds.has(e.dst)) p(`edge dst ${e.dst} unknown`);
    if (e.src === e.dst) p(`edge ${e.src} is a self-loop`);
  }
  for (const a of fx.anchors) {
    if (a.doc_id !== fx.document.id) p(`anchor "${a.surface}" doc_id != document.id`);
    if (a.target_node_id && !nodeIds.has(a.target_node_id)) p(`anchor "${a.surface}" target_node_id unknown`);
    if (a.target_entity_id && !entityIds.has(a.target_entity_id)) p(`anchor "${a.surface}" target_entity_id unknown`);
    if (a.card_id && !cardIds.has(a.card_id)) p(`anchor "${a.surface}" card_id unknown`);
  }
  for (const c of fx.cards) {
    if (!anchorIds.has(c.anchor_id)) p(`card "${c.headline}" anchor_id unknown`);
    if (!docIds.has(c.source.doc_id)) p(`card "${c.headline}" source.doc_id unknown`);
  }
  for (const e of fx.entities) {
    if (e.canonical_node_id && !nodeIds.has(e.canonical_node_id)) p(`entity "${e.name}" canonical_node_id unknown`);
  }
}

// Acyclicity over depends_on / uses_notation / specialises (restates excluded), across all files.
{
  const adj = new Map<string, string[]>();
  for (const { fx } of fixtures)
    for (const e of fx.edges)
      if (e.kind !== "restates") adj.set(e.src, [...(adj.get(e.src) ?? []), e.dst]);
  const state = new Map<string, 1 | 2>();
  const visit = (u: string, path: string[]): boolean => {
    state.set(u, 1);
    for (const v of adj.get(u) ?? []) {
      if (state.get(v) === 1) { problems.push(`cycle: ${[...path, u, v].join(" -> ")}`); return true; }
      if (!state.has(v) && visit(v, [...path, u])) return true;
    }
    state.set(u, 2);
    return false;
  };
  for (const u of adj.keys()) if (!state.has(u) && visit(u, [])) break;
}

// Report.
for (const { file, fx } of fixtures) {
  console.log(
    `${file}: ${fx.nodes.length} nodes, ${fx.edges.length} edges, ${fx.anchors.length} anchors, ` +
      `${fx.cards.length} cards, ${fx.entities.length} entities`,
  );
}
if (files.length === 0) console.log("fixtures/golden is empty — A0 has not landed yet (that is fine at hour 0).");
if (problems.length) {
  console.error(`\n${problems.length} problem(s):`);
  for (const p of problems) console.error("  - " + p);
  process.exit(1);
}
console.log(`\nOK: ${files.length} fixture file(s) valid.`);
