import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { developmentCorpus, DEVELOPMENT_CORPUS_ID } from "../evals/development-corpus";
import { createSearchClient } from "../search";

// Real ES protocol test with deterministic vectors. No API key, model, or .env reads.
const url = (process.env.ELASTICSEARCH_URL ?? "http://localhost:9200").replace(/\/$/, "");
const index = `cairn-c-verification-${randomUUID()}`;
let embedded = 0;
const client = createSearchClient({ url, index, dimensions: 2, embeddingModel: "offline-verification-v1",
  embed: async (texts) => { embedded += texts.length; return texts.map(() => [1, 0]); } });
const [chapter] = await developmentCorpus();
const nodes = chapter.nodes.slice(0, 2);
// Real PDF boxes mix integer and fractional coordinates in the same array.
nodes[0] = { ...nodes[0], bbox: [40, 81.125, 520, 127.875], confidence: 1 };
nodes[1] = { ...nodes[1], confidence: 0.85 };
try {
  assert.equal(await client.indexNodes(DEVELOPMENT_CORPUS_ID, nodes), 2);
  assert.equal(embedded, 2);
  await client.indexNodes(DEVELOPMENT_CORPUS_ID, nodes);
  assert.equal(embedded, 2, "second index pass must reuse stored vectors");
  const candidates = await client.resolutionCandidates(nodes[0], DEVELOPMENT_CORPUS_ID);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].node.id, nodes[1].id);
  const stored = await client.search(nodes[0].label ?? "absolute", { corpusId: DEVELOPMENT_CORPUS_ID });
  assert.deepEqual(stored.find(hit => hit.node.id === nodes[0].id)?.node.bbox, nodes[0].bbox);
  assert.deepEqual(await client.search("absolute", { corpusId: randomUUID() }), []);
  const otherCorpus = randomUUID();
  const other = { ...nodes[1], id: randomUUID() };
  await client.indexNodes(otherCorpus, [other]);
  await client.removeStaleNodes(DEVELOPMENT_CORPUS_ID, [nodes[0].id]);
  const remaining = await client.search("absolute", { corpusId: DEVELOPMENT_CORPUS_ID });
  assert.deepEqual(remaining.map(hit => hit.node.id), [nodes[0].id]);
  assert.deepEqual((await client.search("absolute", { corpusId: otherCorpus })).map(hit => hit.node.id), [other.id]);
  console.log("Elasticsearch verified: mixed numeric coordinates, bulk writes, vector reuse, hybrid retrieval, and corpus-scoped stale-node cleanup.");
} finally {
  const cleanup = await fetch(`${url}/${index}`, { method: "DELETE", signal: AbortSignal.timeout(10_000) });
  if (!cleanup.ok && cleanup.status !== 404) throw new Error(`Test-index cleanup failed (${cleanup.status})`);
}
