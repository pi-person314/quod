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
try {
  assert.equal(await client.indexNodes(DEVELOPMENT_CORPUS_ID, nodes), 2);
  assert.equal(embedded, 2);
  await client.indexNodes(DEVELOPMENT_CORPUS_ID, nodes);
  assert.equal(embedded, 2, "second index pass must reuse stored vectors");
  const candidates = await client.resolutionCandidates(nodes[0], DEVELOPMENT_CORPUS_ID);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].node.id, nodes[1].id);
  assert.deepEqual(await client.search("absolute", { corpusId: randomUUID() }), []);
  console.log("Elasticsearch verified: mapping, bulk writes, persistent vector reuse, hybrid queries, candidate scoping.");
} finally {
  const cleanup = await fetch(`${url}/${index}`, { method: "DELETE", signal: AbortSignal.timeout(10_000) });
  if (!cleanup.ok && cleanup.status !== 404) throw new Error(`Test-index cleanup failed (${cleanup.status})`);
}
