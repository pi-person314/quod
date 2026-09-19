import assert from "node:assert/strict";
import test from "node:test";
import { developmentCorpus, DEVELOPMENT_CORPUS_ID } from "../evals/development-corpus";
import { resolveCorpus, resolvedAnchorEntities, type ResolutionSnapshot } from "../resolution-service";
import { planResolution, type ResolutionPlan } from "../resolve";

async function harness() {
  const [chapter, exercises] = await developmentCorpus();
  const snapshot: ResolutionSnapshot = { nodes: [...chapter.nodes, ...exercises.nodes.map((node) => ({ ...node, entity_id: null }))],
    entities: chapter.entities, anchors: exercises.anchors };
  const calls: string[] = [];
  const plans: ResolutionPlan[] = [];
  return { chapter, exercises, snapshot, calls, plans, deps: {
    repository: { load: async () => snapshot, save: async (_id: string, _snapshot: ResolutionSnapshot, plan: ResolutionPlan) => { calls.push("save"); plans.push(plan); } },
    search: { indexNodes: async () => { calls.push("index"); return snapshot.nodes.length; },
      resolutionCandidates: async (node: typeof chapter.nodes[0]) => {
        calls.push("retrieve");
        const index = exercises.nodes.findIndex((item) => item.id === node.id);
        return [{ node: { ...chapter.nodes[index], statement_md: "STALE SEARCH TEXT" }, score: 1 }];
      } },
    model: async (request: { input: string }) => {
      calls.push("model");
      const pairs = JSON.parse(request.input) as { node_id: string; candidate_id: string; candidate: string }[];
      assert.ok(pairs.every((pair) => pair.candidate !== "STALE SEARCH TEXT"));
      return { decisions: pairs.map((pair) => ({ node_id: pair.node_id, candidate_id: pair.candidate_id, verdict: "same", confidence: 0.95 })) };
    },
  } };
}

test("resolution indexes, retrieves fresh pairs, batches once, and saves once", async () => {
  const h = await harness();
  const result = await resolveCorpus({ corpus_id: DEVELOPMENT_CORPUS_ID, node_ids: h.exercises.nodes.map((node) => node.id) }, h.deps);
  assert.equal(result.decisions.length, 3);
  assert.deepEqual(h.calls, ["index", "retrieve", "retrieve", "retrieve", "model", "save", "index"]);
  assert.equal(h.plans[0].entities.length, 20);
});
test("out-of-corpus input is rejected before indexing or model use", async () => {
  const h = await harness();
  await assert.rejects(resolveCorpus({ corpus_id: DEVELOPMENT_CORPUS_ID, node_ids: [DEVELOPMENT_CORPUS_ID] }, h.deps), /outside/);
  assert.deepEqual(h.calls, []);
});
test("malformed adjudication and failed persistence cannot return success", async () => {
  const h = await harness();
  const input = { corpus_id: DEVELOPMENT_CORPUS_ID, node_ids: [h.exercises.nodes[0].id] };
  await assert.rejects(resolveCorpus(input, { ...h.deps, model: async () => ({ decisions: [] }) }), /Missing/);
  assert.equal(h.plans.length, 0);
  await assert.rejects(resolveCorpus(input, { ...h.deps, repository: { ...h.deps.repository,
    save: async () => { throw new Error("stale snapshot"); } } }), /stale/);
});
test("named anchors resolve only unambiguous names with bounded labels", async () => {
  const h = await harness();
  const anchor = { ...h.exercises.anchors[0], target_node_id: null, target_entity_id: null, surface: "by Toy 1" };
  const snapshot = { ...h.snapshot, anchors: [anchor] };
  const plan = planResolution(DEVELOPMENT_CORPUS_ID, snapshot.nodes, snapshot.entities, []);
  assert.equal(resolvedAnchorEntities(snapshot, plan).get(anchor.id), h.chapter.entities[0].id);
  assert.equal(resolvedAnchorEntities({ ...snapshot, anchors: [{ ...anchor, surface: "by Toy 1.2" }] }, plan).size, 0);
  const ambiguous = { ...snapshot, nodes: snapshot.nodes.map((node, i) => i === 1 ? { ...node, label: "Toy 1" } : node) };
  assert.equal(resolvedAnchorEntities(ambiguous, plan).size, 0);
});
