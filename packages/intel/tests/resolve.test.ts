import assert from "node:assert/strict";
import test from "node:test";
import { adjudicatePairs, planResolution } from "../resolve";
import { developmentCorpus, DEVELOPMENT_CORPUS_ID } from "../evals/development-corpus";

test("three same decisions merge restatements without merging twenty source results", async () => {
  const [chapter, exercises] = await developmentCorpus();
  const nodes = [...chapter.nodes, ...exercises.nodes.map((node) => ({ ...node, entity_id: null }))];
  const decisions = exercises.nodes.map((node, i) => ({ node_id: node.id, candidate_id: chapter.nodes[i].id,
    verdict: "same" as const, confidence: 0.95 }));
  const result = planResolution(DEVELOPMENT_CORPUS_ID, nodes, chapter.entities, decisions);
  assert.equal(result.entities.length, 20);
  for (const decision of decisions) {
    const assignments = new Map(result.assignments.map((item) => [item.node_id, item.entity_id]));
    assert.equal(assignments.get(decision.node_id), assignments.get(decision.candidate_id));
  }
  const assigned = new Map(result.assignments.map((item) => [item.node_id, item.entity_id]));
  const repeated = planResolution(DEVELOPMENT_CORPUS_ID, nodes.map((node) => ({ ...node, entity_id: assigned.get(node.id)! })), result.entities, decisions);
  assert.deepEqual(repeated, result);
});
test("specialisation and low confidence never union results", async () => {
  const [chapter] = await developmentCorpus();
  const nodes = chapter.nodes.slice(0, 3).map((node) => ({ ...node, entity_id: null }));
  const result = planResolution(DEVELOPMENT_CORPUS_ID, nodes, [], [
    { node_id: nodes[0].id, candidate_id: nodes[1].id, verdict: "specialisation", confidence: 0.9 },
    { node_id: nodes[1].id, candidate_id: nodes[2].id, verdict: "same", confidence: 0.79 },
  ]);
  assert.equal(result.entities.length, 3);
  assert.equal(result.edges.length, 1);
  assert.equal(result.edges[0].kind, "specialises");
  assert.equal(result.decisions.length, 2, "low-confidence evidence remains visible without merging");
  assert.equal(result.decisions[1].confidence, 0.79);
});
test("conflicting transitive evidence stays separate with zero accepted equivalence confidence", async () => {
  const [chapter] = await developmentCorpus();
  const nodes = chapter.nodes.slice(0, 3).map((node) => ({ ...node, entity_id: null }));
  const result = planResolution(DEVELOPMENT_CORPUS_ID, nodes, [], [
    { node_id: nodes[0].id, candidate_id: nodes[1].id, verdict: "same", confidence: 0.95 },
    { node_id: nodes[1].id, candidate_id: nodes[2].id, verdict: "same", confidence: 0.95 },
    { node_id: nodes[0].id, candidate_id: nodes[2].id, verdict: "different", confidence: 0.95 },
  ]);
  assert.equal(result.entities.length, 3);
  assert(result.decisions.filter(decision => decision.verdict === "same").every(decision => decision.confidence === 0));
  assert.equal(new Set(result.assignments.map(assignment => assignment.entity_id)).size, 3);
});

test("new contradictory evidence cannot silently split an existing entity", async () => {
  const [chapter] = await developmentCorpus();
  const entity = chapter.entities[0];
  const nodes = chapter.nodes.slice(0, 2).map(node => ({ ...node, entity_id: entity.id }));
  assert.throws(() => planResolution(DEVELOPMENT_CORPUS_ID, nodes, [entity], [
    { node_id: nodes[0].id, candidate_id: nodes[1].id, verdict: "different", confidence: 0.95 },
  ]), /existing entity/);
});
test("adjudication rejects fabricated, duplicate, and missing pairs", async () => {
  const [chapter] = await developmentCorpus();
  const [node, candidate] = chapter.nodes;
  const valid = { node_id: node.id, candidate_id: candidate.id, verdict: "same", confidence: 0.95 };
  assert.equal((await adjudicatePairs([{ node, candidate }], async () => ({ decisions: [valid] }))).length, 1);
  for (const decisions of [[], [valid, valid], [{ ...valid, candidate_id: chapter.nodes[2].id }], [{ ...valid, confidence: 2 }]]) {
    await assert.rejects(adjudicatePairs([{ node, candidate }], async () => ({ decisions })));
  }
});

test("large resolution sets use bounded batches and reject missing decisions before persistence", async () => {
  const [chapter] = await developmentCorpus();
  const pairs = Array.from({ length: 49 }, (_, i) => ({
    node: { ...chapter.nodes[0], id: `c0000000-0000-4000-8000-${String(i).padStart(12, "0")}` }, candidate: chapter.nodes[1],
  }));
  const counts: number[] = [];
  const decisions = await adjudicatePairs(pairs, async request => {
    const batch = JSON.parse(request.input); counts.push(batch.length);
    return { decisions: batch.map((pair: { node_id: string; candidate_id: string }) => ({ node_id: pair.node_id,
      candidate_id: pair.candidate_id, verdict: "different", confidence: 0.9 })) };
  });
  assert.deepEqual(counts, [24, 24, 1]); assert.equal(decisions.length, 49);
});
