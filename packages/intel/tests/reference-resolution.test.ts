import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { Anchor, Node } from "@quod/contracts";
import { matchReferences } from "../reference-resolution";

const doc = randomUUID();
const context: Node = { id: randomUUID(), doc_id: doc, kind: "example", label: "Problem 8", title: null,
  statement_md: "Use lecture Proposition 73, which says injectivity is equivalent to trivial kernel.",
  clauses: [], symbols: [], page: 1, bbox: [0, 0, 400, 100], entity_id: null, confidence: 1 };
const target: Node = { ...context, id: randomUUID(), doc_id: randomUUID(), kind: "proposition", label: "Proposition 4.12",
  statement_md: "A linear map is injective if and only if its kernel is trivial." };
const anchor: Anchor = { id: randomUUID(), doc_id: doc, page: 1, bbox: [10, 20, 150, 35], surface: "Proposition 73",
  target_node_id: null, target_entity_id: null, card_id: null };
const search = async () => [];
const output = (changes = {}) => ({ links: [{ anchor_id: anchor.id, target_node_id: target.id,
  confidence: 0.95, evidence: target.statement_md, ...changes }] });

test("contextual citation matching can retain different source numbering without equating exercises", async () => {
  const links = await matchReferences([anchor], [context, target], search, async request => {
    const [input] = JSON.parse(request.input);
    assert.equal(input.context, context.statement_md);
    assert.equal(input.candidates[0].label, "Proposition 4.12");
    assert.equal(input.candidates.length, 1);
    return output();
  });
  assert.deepEqual(links, [{ anchor_id: anchor.id, node_id: target.id }]);
});
test("unsupported excerpts, low confidence and missing targets remain unresolved", async () => {
  for (const changes of [{ evidence: "A fabricated source claim." }, { confidence: 0.89 }, { target_node_id: null, evidence: "" }])
    assert.deepEqual(await matchReferences([anchor], [context, target], search, async () => output(changes)), []);
});
test("foreign targets, wrong anchors and missing decisions are rejected", async () => {
  for (const changes of [{ target_node_id: randomUUID() }, { anchor_id: randomUUID() }])
    await assert.rejects(matchReferences([anchor], [context, target], search, async () => output(changes)));
  await assert.rejects(matchReferences([anchor], [context, target], search, async () => ({ links: [] })));
});
test("no invoking context means no paid matching call", async () => {
  assert.deepEqual(await matchReferences([anchor], [target], search, async () => { assert.fail("model called without context"); }), []);
});
