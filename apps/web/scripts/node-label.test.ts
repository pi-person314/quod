import test from "node:test";
import assert from "node:assert/strict";
import { nodeLabel, nodeDescription } from "../lib/node-label";
import type { Node } from "@quod/contracts";
const node = { title: null, label: null, kind: "definition" as const, page: 3, statement_md: "A basis is a linearly independent spanning set." };
test("unnamed results show type and source excerpt, including literal missing-value strings", () => {
  for (const missing of [null, "null", "undefined", " "]) {
    const result = { ...node, title: missing, label: missing };
    assert.equal(nodeLabel(result), "Definition: A basis is a linearly independent spanning set.");
    assert.match(nodeDescription(result), /p\. 3$/);
  }
  assert.equal(nodeLabel({ ...node, statement_md: "" }), "Definition · p. 3");
});
test("proofs use their own result number, never a theorem mentioned as a dependency", () => {
  const proof = { ...node, kind: "proof" as const, statement_md: "Proof. The two subspaces intersect trivially by Theorem 3.4." };
  assert.equal(nodeLabel(proof), "Proof: two subspaces intersect trivially…");
  assert.ok(nodeLabel(proof).split(/\s+/).length <= 5);
  assert.equal(nodeLabel({ ...proof, statement_md: "Proof of Theorem 1.2. Apply Theorem 3.4." }), "Proof 1.2");
  assert.equal(nodeLabel({ ...proof, label: "Proof 2.3" }), "Proof 2.3");
  const result = { ...node, id: "theorem", doc_id: "book", bbox: [0, 10, 100, 30], kind: "theorem", label: "Theorem 1.2" } as Node;
  const following = { ...proof, id: "proof", doc_id: "book", bbox: [0, 50, 100, 80] } as Node;
  assert.equal(nodeLabel(following, [following, result]), "Proof 1.2");
  assert.equal(nodeDescription(following, [following, result]), "Proof 1.2 · p. 3");
  assert.notEqual(nodeLabel(following, [following, { ...result, doc_id: "other" }]), "Proof 1.2");
  const intervening = { ...result, id: "example", kind: "example" as const, bbox: [0, 35, 100, 40] as Node["bbox"] };
  assert.notEqual(nodeLabel(following, [result, intervening, following]), "Proof 1.2");
});
test("real titles and numbered labels are preserved without duplicate hover text", () => {
  assert.equal(nodeLabel({ ...node, title: "Basis", label: "Definition 2.1" }), "Basis");
  assert.equal(nodeDescription({ ...node, label: "Definition 2.1" }), "Definition 2.1 · p. 3");
  assert.equal(nodeDescription({ ...node, title: "Basis", label: "Definition 2.1" }), "Definition 2.1 · Basis · p. 3");
});
