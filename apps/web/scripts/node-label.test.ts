import test from "node:test";
import assert from "node:assert/strict";
import { nodeLabel, nodeDescription } from "../lib/node-label";
const node = { title: null, label: null, kind: "definition" as const, page: 3, statement_md: "A basis is a linearly independent spanning set." };
test("unnamed results show type and source excerpt, including literal missing-value strings", () => {
  for (const missing of [null, "null", "undefined", " "]) {
    const result = { ...node, title: missing, label: missing };
    assert.equal(nodeLabel(result), "Definition: A basis is a linearly independent spanning set.");
    assert.match(nodeDescription(result), /p\. 3$/);
  }
  assert.equal(nodeLabel({ ...node, statement_md: "" }), "Definition · p. 3");
});
test("real titles and numbered labels are preserved without duplicate hover text", () => {
  assert.equal(nodeLabel({ ...node, title: "Basis", label: "Definition 2.1" }), "Basis");
  assert.equal(nodeDescription({ ...node, label: "Definition 2.1" }), "Definition 2.1 · p. 3");
  assert.equal(nodeDescription({ ...node, title: "Basis", label: "Definition 2.1" }), "Definition 2.1 · Basis · p. 3");
});
