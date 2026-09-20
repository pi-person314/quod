import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import type { Card } from "@quod/contracts";
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

test("bake runs four model calls at a time and reports persisted cards in order", async () => {
  const h = harness();
  const anchors = Array.from({ length: 10 }, () => ({ ...sample.input.anchor, id: randomUUID() }));
  h.repository.anchors = async () => anchors;
  h.repository.target = async anchor => anchor.id === anchors[9].id ? undefined : sample.input.target;
  h.repository.context = async () => ({ invokingParagraph: sample.input.invokingParagraph!, localSymbols: sample.input.localSymbols! });
  let active = 0, peak = 0;
  const notifications: number[] = [];
  h.repository.progress = async (_docId, done, total) => {
    assert.equal(total, 9);
    assert(h.saved.size >= done, "progress must follow successful persistence");
    await new Promise(resolve => setTimeout(resolve, done % 2 ? 5 : 1));
    notifications.push(done);
  };
  const result = await bakeDocument(sample.input.anchor.doc_id, h.repository, async () => {
    peak = Math.max(peak, ++active);
    await new Promise(resolve => setTimeout(resolve, 10));
    active--;
    return sample.expected;
  });
  assert.equal(peak, 4);
  assert.deepEqual(result, { cards_done: 9 });
  assert.deepEqual(notifications, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.equal(h.saved.size, 9);
  assert([...h.saved.values()].every(card => card.instantiated_md === sample.expected.instantiated_md));
});

test("failed persistence stops scheduling and drains in-flight cards before rejecting", async () => {
  const h = harness();
  const anchors = Array.from({ length: 10 }, () => ({ ...sample.input.anchor, id: randomUUID() }));
  h.repository.anchors = async () => anchors;
  let saves = 0, drained = 0;
  h.repository.save = async card => {
    saves++;
    if (card.anchor_id === anchors[0].id) throw new Error("write failed");
    await new Promise(resolve => setTimeout(resolve, 15));
    drained++;
    return card;
  };
  await assert.rejects(bakeDocument(sample.input.anchor.doc_id, h.repository), /write failed/);
  assert.equal(saves, 4);
  assert.equal(drained, 3);
});
