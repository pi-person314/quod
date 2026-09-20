import assert from "node:assert/strict";
import test from "node:test";
import type { Edge, Node } from "@cairn/contracts";
import { forwardGraph } from "../forward";
import { matchTraceRoots, matchSelectionRoots, traceGraph, traceSelection } from "../trace";

test("physical selections match a unique containing passage, never a vague or ambiguous fragment", () => {
  const passage = "Suppose that the vectors form a basis of the vector space.";
  const a = node("a", { statement_md: passage });
  const request = { doc_id: "doc", page: 1, selection: "the vectors form a basis of the vector space", read_node_ids: [] };
  assert.deepEqual(matchSelectionRoots([a], request), ["a"]);
  assert.deepEqual(matchSelectionRoots([a, node("b", { statement_md: passage })], request), []);
  assert.deepEqual(matchSelectionRoots([a], { ...request, page: 2 }), []);
  assert.deepEqual(matchSelectionRoots([a], { ...request, selection: "the vectors" }), []);
});

const node = (id: string, overrides: Partial<Node> = {}): Node => ({
  id, doc_id: "doc", kind: "theorem", label: `Theorem ${id}`, title: null,
  statement_md: "A statement", clauses: [], symbols: [], page: 1,
  bbox: [0, 0, 1, 1], entity_id: null, confidence: 1, ...overrides,
});
const edge = (src: string, dst: string, confidence = 1): Edge => ({ src, dst, confidence, kind: "depends_on", extractor: "deterministic" });

test("trace follows dependencies, keeps read flags, deduplicates cycles and duplicate edges", () => {
  const nodes = [node("a"), node("b"), node("c")];
  const edges = [edge("a", "b"), edge("a", "b"), edge("b", "c"), edge("c", "a")];
  const { chain } = traceGraph(nodes, edges, ["a", "a", "missing"], ["b"]);
  assert.deepEqual(chain.map((hop) => [hop.node.id, hop.depth, hop.read]), [["a", 0, false], ["b", 1, true], ["c", 2, false]]);
  assert.match(chain[1]!.reason, /Theorem a depends on/);
  assert.deepEqual(traceGraph(nodes, [...edges].reverse(), ["a"], ["b"]), { chain });
});

test("trace enforces breadth three and depth four with deterministic breadth-first order", () => {
  const nodes = ["a", "b", "c", "d", "e", "f", "g", "h", "i"].map((id) => node(id));
  const edges = [edge("a", "e", 0.5), edge("a", "d"), edge("a", "c"), edge("a", "b"), edge("b", "f"), edge("f", "g"), edge("g", "h"), edge("h", "i")];
  const chain = traceGraph(nodes, edges, ["a"]).chain;
  assert.deepEqual(chain.map((hop) => hop.node.id), ["a", "b", "c", "d", "f", "g", "h"]);
  assert.equal(chain.at(-1)!.depth, 4);
});

test("explicit reference matching is document scoped, number bounded, and conservative about ambiguity", () => {
  const nodes = [node("a", { label: "Theorem 3.4" }), node("b", { label: "Theorem 3.4", page: 2 }), node("foreign", { doc_id: "other", title: "Foreign result" }), node("short", { label: "Theorem 3" })];
  const request = { doc_id: "doc", selection: "By Theorem 3.4.", read_node_ids: [] };
  assert.deepEqual(matchTraceRoots(nodes, request), []);
  assert.deepEqual(matchTraceRoots(nodes, { ...request, page: 2 }), ["b"]);
  assert.deepEqual(matchTraceRoots(nodes, { ...request, selection: "Theorem 3.45 and Foreign result" }), []);
  assert.deepEqual(traceSelection(nodes, [], { ...request, selection: "a vague reference" }), { chain: [] });
});

test("duplicate occurrences of one entity yield a single reference root", () => {
  const nodes = [node("a", { title: "Rank-Nullity", entity_id: "rank" }), node("b", { title: "Rank-Nullity", entity_id: "rank", page: 2 })];
  assert.deepEqual(matchTraceRoots(nodes, { doc_id: "doc", selection: "Apply Rank–Nullity.", read_node_ids: [] }), ["a"]);
});

test("forward excludes prerequisites and disconnected nodes and aggregates all entity occurrences", () => {
  const nodes = [node("a", { entity_id: "entity" }), node("a2", { entity_id: "entity" }), node("b"), node("c"), node("d"), node("unrelated"), node("prerequisite")];
  const edges = [edge("a", "prerequisite"), edge("b", "a"), edge("c", "b"), edge("d", "a2"), edge("unrelated", "prerequisite")];
  const result = forwardGraph(nodes, edges, "entity");
  assert.deepEqual(new Set(result.downstream.map((hit) => hit.node.id)), new Set(["b", "c", "d"]));
  assert.equal(result.downstream[0]!.node.id, "c");
  assert.ok(result.downstream.every((hit) => Number.isFinite(hit.score) && hit.score > 0));
  assert.deepEqual(forwardGraph([...nodes].reverse(), [...edges].reverse(), "entity"), result);
  assert.deepEqual(forwardGraph(nodes, edges, "missing").downstream, []);
});

test("forward handles cycles, dangling nodes, and duplicate edges without changing scores", () => {
  const nodes = [node("a", { entity_id: "entity" }), node("b"), node("c")];
  const edges = [edge("b", "a"), edge("c", "b"), edge("b", "c")];
  const result = forwardGraph(nodes, edges, "entity");
  assert.equal(result.downstream.length, 2);
  assert.ok(result.downstream.every((hit) => Number.isFinite(hit.score)));
  assert.deepEqual(forwardGraph(nodes, [...edges, edges[0]!], "entity"), result);
  assert.deepEqual(forwardGraph([node("a", { entity_id: "entity" })], [], "entity").downstream, []);
});
