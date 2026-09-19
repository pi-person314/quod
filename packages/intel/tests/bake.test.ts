import assert from "node:assert/strict";
import test from "node:test";
import type { Card } from "@cairn/contracts";
import { bakeDocument, extractInvokingContext, type BakeRepository } from "../bake";
import { instantiationCases } from "../evals/instantiation-cases";

const sample = instantiationCases[0];
function harness() {
  const saved = new Map<string, Card>();
  let writes = 0;
  const repository: BakeRepository = {
    anchors: async () => [sample.input.anchor], target: async () => sample.input.target,
    existing: async (id) => saved.get(id), context: async () => undefined,
    save: async (card) => { writes++; saved.set(card.anchor_id, card); return card; },
  };
  return { repository, saved, writes: () => writes };
}
test("bake persists an original card without context and is idempotent", async () => {
  const h = harness();
  assert.deepEqual(await bakeDocument(sample.input.anchor.doc_id, h.repository), { cards_done: 1 });
  const first = h.saved.get(sample.input.anchor.id)!;
  assert.equal(first.instantiated_md, sample.input.target.statement_md);
  await bakeDocument(sample.input.anchor.doc_id, h.repository);
  assert.equal(h.writes(), 1);
  assert.equal(h.saved.get(sample.input.anchor.id)!.id, first.id);
});

test("existing parsed nodes provide context only for a unique contained invocation", () => {
  const anchor = sample.input.anchor;
  const invoking = { ...sample.input.target, doc_id: anchor.doc_id, page: anchor.page,
    statement_md: `First paragraph.\n\n${sample.input.invokingParagraph} ${anchor.surface}.`, symbols: sample.input.localSymbols! };
  assert.equal(extractInvokingContext(anchor, [invoking])!.invokingParagraph, `${sample.input.invokingParagraph} ${anchor.surface}.`);
  assert.equal(extractInvokingContext(anchor, [{ ...invoking, statement_md: `${anchor.surface} and ${anchor.surface}` }]), undefined);
  assert.equal(extractInvokingContext(anchor, [{ ...invoking, page: anchor.page + 1 }]), undefined);
  assert.equal(extractInvokingContext(anchor, [{ ...invoking, bbox: [200, 200, 300, 300] }]), undefined);
  assert.equal(extractInvokingContext(anchor, [{ ...invoking, symbols: [{ sym: "y", role: "scalar" }, { sym: "y", role: "matrix" }] }]), undefined);
});
test("changed source invalidates the original card and preserves its identity", async () => {
  const h = harness();
  await bakeDocument(sample.input.anchor.doc_id, h.repository);
  const id = h.saved.get(sample.input.anchor.id)!.id;
  h.repository.target = async () => ({ ...sample.input.target, statement_md: "Updated theorem." });
  await bakeDocument(sample.input.anchor.doc_id, h.repository);
  assert.equal(h.writes(), 2);
  assert.equal(h.saved.get(sample.input.anchor.id)!.id, id);
  assert.equal(h.saved.get(sample.input.anchor.id)!.full_md, "Updated theorem.");
});
test("explicit context and offline model produce an instantiated persisted card", async () => {
  const h = harness();
  h.repository.context = async () => ({ invokingParagraph: sample.input.invokingParagraph!, localSymbols: sample.input.localSymbols! });
  await bakeDocument(sample.input.anchor.doc_id, h.repository, async () => sample.expected);
  assert.equal(h.saved.get(sample.input.anchor.id)!.instantiated_md, sample.expected.instantiated_md);
});
test("unresolved anchors skip, mismatched document and failed writes reject", async () => {
  const h = harness();
  h.repository.target = async () => undefined;
  assert.equal((await bakeDocument(sample.input.anchor.doc_id, h.repository)).cards_done, 0);
  await assert.rejects(bakeDocument(sample.input.target.doc_id, h.repository), /outside/);
  h.repository.target = async () => sample.input.target;
  h.repository.save = async () => { throw new Error("write failed"); };
  await assert.rejects(bakeDocument(sample.input.anchor.doc_id, h.repository), /write failed/);
});
