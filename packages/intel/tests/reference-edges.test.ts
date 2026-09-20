import assert from "node:assert/strict";
import test from "node:test";
import type { Anchor, Node } from "@quod/contracts";
import { referenceDependencyEdges } from "../reference-edges";

const node = (id: string, doc: string, bbox: Node["bbox"] = [0, 0, 100, 100]): Node => ({
  id, doc_id: doc, bbox, page: 1, kind: "example", label: "Problem 1", title: null,
  statement_md: "Use Theorem 3.4.", clauses: [], symbols: [], entity_id: null, confidence: 1,
});
const anchor = (target: string | null): Anchor => ({ id: "citation", doc_id: "pset", page: 1,
  bbox: [10, 10, 40, 20], surface: "Theorem 3.4", target_node_id: target, target_entity_id: null, card_id: null });

test("a citation resolved after extraction connects its problem to another document", () => {
  const nodes = [node("problem", "pset"), node("theorem", "book")];
  assert.deepEqual(referenceDependencyEdges(nodes, [anchor(null)]), []);
  const edges = referenceDependencyEdges(nodes, [anchor("theorem")]);
  assert.equal(edges.length, 1);
  assert.equal(edges[0].src, "problem");
  assert.equal(edges[0].dst, "theorem");
  assert.equal(edges[0].kind, "depends_on");
  assert.deepEqual(referenceDependencyEdges(nodes.reverse(), [anchor("theorem"), anchor("theorem")]), edges);
});

test("entity-only citations work; unresolved, out-of-set, self and unowned citations do not", () => {
  const nodes = [node("problem", "pset"), { ...node("theorem", "book"), entity_id: "entity" }];
  assert.equal(referenceDependencyEdges(nodes, [{ ...anchor(null), target_entity_id: "entity" }]).length, 1);
  for (const reference of [anchor(null), anchor("missing"), anchor("problem"), { ...anchor("theorem"), page: 2 },
    { ...anchor("theorem"), doc_id: "other" }, { ...anchor("theorem"), bbox: [200, 200, 220, 220] as Anchor["bbox"] }]) {
    assert.deepEqual(referenceDependencyEdges(nodes, [reference]), []);
  }
});

test("assign citations to the smallest containing passage, skipping ambiguous owners", () => {
  const nodes = [node("outer", "pset"), node("problem", "pset", [5, 5, 50, 30]), node("theorem", "book")];
  assert.equal(referenceDependencyEdges(nodes, [anchor("theorem")])[0].src, "problem");
  assert.deepEqual(referenceDependencyEdges([...nodes, node("duplicate", "pset", [5, 5, 50, 30])], [anchor("theorem")]), []);
});

test("theorem citations prefer their statement over a historical proof canonical", () => {
  const nodes = [node("problem", "pset"), { ...node("proof", "book"), kind: "proof" as const, entity_id: "result" },
    { ...node("theorem", "book"), kind: "theorem" as const, entity_id: "result" }];
  assert.equal(referenceDependencyEdges(nodes, [anchor("proof")])[0].dst, "theorem");
  assert.equal(referenceDependencyEdges(nodes, [{ ...anchor("proof"), surface: "Proof of Theorem 3.4" }])[0].dst, "proof");
  assert.equal(referenceDependencyEdges([...nodes, { ...nodes[2], id: "ambiguous" }], [anchor("proof")])[0].dst, "proof");
});
