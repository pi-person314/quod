import assert from "node:assert/strict";
import test from "node:test";
import { createSearchClient, lexicalSearch, reciprocalRankFusion, nodeSearchText } from "../search";
import { developmentCorpus, DEVELOPMENT_CORPUS_ID } from "../evals/development-corpus";

test("RRF uses rank not incomparable scores, and deduplicates per ranking", async () => {
  const [chapter] = await developmentCorpus();
  const [a, b] = chapter.nodes;
  const fused = reciprocalRankFusion([[{ node: a, score: 100 }, { node: b, score: 1 }, { node: a, score: 100 }], [{ node: b, score: 0.1 }]]);
  assert.equal(fused.length, 2);
  assert.equal(fused[0].node.id, b.id);
  assert.equal(fused[1].score, 1 / 61);
  assert.equal(lexicalSearch(chapter.nodes, "absolute")[0].node.id, a.id);
  assert.deepEqual(lexicalSearch(chapter.nodes, ""), []);
});
test("missing index makes no paid query embedding", async () => {
  const client = createSearchClient({ dimensions: 2, fetch: async () => Response.json({ error: { type: "index_not_found_exception" } }, { status: 404 }),
    embed: async () => { assert.fail("must not embed for absent index"); } });
  assert.deepEqual(await client.search("rank nullity"), []);
});

test("search expands mathematical operators without inventing a theorem name", async () => {
  const [chapter] = await developmentCorpus();
  const statement = String.raw`For T, dim(ker T) + \\dim \\operatorname{im} T = dim V. The image is not a determinant.`;
  const text = nodeSearchText({ ...chapter.nodes[0], title: null, label: null, statement_md: statement, symbols: [] });
  assert(text.startsWith(statement));
  assert(text.includes("dimension(kernel T)"));
  assert(text.includes("image T"));
  assert(!text.includes("rank"));
  assert(text.includes("determinant."));
});
test("hybrid requests apply corpus filters and exclude self in both rankings", async () => {
  const [chapter] = await developmentCorpus();
  const [source, candidate] = chapter.nodes;
  const requests: Record<string, any>[] = [];
  const client = createSearchClient({ dimensions: 2, embed: async () => [[1, 0]], fetch: async (_url, init) => {
    requests.push(JSON.parse(String(init?.body)));
    return Response.json({ timed_out: false, _shards: { failed: 0 }, hits: { hits: [{ _source: { ...candidate, corpus_id: DEVELOPMENT_CORPUS_ID }, _score: 2 }] } });
  } });
  assert.equal((await client.resolutionCandidates(source, DEVELOPMENT_CORPUS_ID))[0].node.id, candidate.id);
  assert.deepEqual(requests[0].query.bool.filter, [{ term: { corpus_id: DEVELOPMENT_CORPUS_ID } }]);
  assert.deepEqual(requests[1].knn.filter.bool.must_not, [{ term: { id: source.id } }]);
});

test("short unmatched queries use a bounded paraphrase while candidate queries do not", async () => {
  const [chapter] = await developmentCorpus();
  const requests: any[] = [], embedded: string[][] = [];
  let expansions = 0;
  const client = createSearchClient({ dimensions: 2, expandQuery: async () => { expansions++; return "finite subcover for every open cover"; },
    embed: async texts => { embedded.push(texts); return [[1, 0]]; }, fetch: async (_url, init) => {
      const request = JSON.parse(String(init?.body)); requests.push(request);
      return Response.json({ timed_out: false, _shards: { failed: 0 }, hits: { hits: [] } });
    } });
  await client.search("compactness", { corpusId: DEVELOPMENT_CORPUS_ID });
  assert.equal(expansions, 1);
  assert.deepEqual(embedded[0], ["finite subcover for every open cover"]);
  assert.deepEqual(requests[1].query.bool.filter, [{ term: { corpus_id: DEVELOPMENT_CORPUS_ID } }]);
  await client.search("compactness", { corpusId: DEVELOPMENT_CORPUS_ID, excludeNodeId: chapter.nodes[0].id });
  assert.equal(expansions, 1);
});
test("partial search failures and cross-corpus results reject", async () => {
  const [chapter] = await developmentCorpus();
  for (const body of [
    { timed_out: true, _shards: { failed: 0 }, hits: { hits: [] } },
    { timed_out: false, _shards: { failed: 1 }, hits: { hits: [] } },
    { timed_out: false, _shards: { failed: 0 }, hits: { hits: [{ _source: { ...chapter.nodes[0], corpus_id: chapter.nodes[0].doc_id }, _score: 1 }] } },
  ]) {
    const client = createSearchClient({ fetch: async () => Response.json(body), embed: async () => { assert.fail("must reject before embedding"); } });
    await assert.rejects(client.search("test", { corpusId: DEVELOPMENT_CORPUS_ID }));
  }
});
test("bulk indexing uses stable IDs, newline termination, and detects partial errors", async () => {
  const [chapter] = await developmentCorpus();
  const node = chapter.nodes[0];
  const bulk: string[] = [];
  let fail = false;
  const client = createSearchClient({ dimensions: 2, reuseEmbeddings: false, embed: async () => [[1, 0]], fetch: async (url, init) => {
    if (!String(url).includes("_bulk")) return Response.json({ acknowledged: true });
    bulk.push(String(init?.body));
    return Response.json({ errors: fail, items: [{ index: { _id: `${DEVELOPMENT_CORPUS_ID}:${node.id}`, status: fail ? 400 : 201 } }] });
  } });
  await client.indexNodes(DEVELOPMENT_CORPUS_ID, [node]);
  await client.indexNodes(DEVELOPMENT_CORPUS_ID, [node, node]);
  assert.equal(bulk[0], bulk[1]);
  assert.ok(bulk[0].endsWith("\n"));
  fail = true;
  await assert.rejects(client.indexNodes(DEVELOPMENT_CORPUS_ID, [node]), /partially failed/);
});
test("bad vectors cannot reach bulk indexing", async () => {
  const [chapter] = await developmentCorpus();
  for (const vector of [[1], [NaN, 0], [0, 0]]) {
    let requests = 0;
    const client = createSearchClient({ dimensions: 2, reuseEmbeddings: false, embed: async () => [vector], fetch: async () => {
      requests++; return Response.json({ acknowledged: true });
    } });
    await assert.rejects(client.indexNodes(DEVELOPMENT_CORPUS_ID, [chapter.nodes[0]]), /dimensions/);
    assert.equal(requests, 1);
  }
});

test("unchanged content reuses persisted vectors; changed text and model invalidate them", async () => {
  const [chapter] = await developmentCorpus();
  const node = chapter.nodes[0];
  let stored: Record<string, unknown> | undefined;
  let embeddingCalls = 0;
  const transport: typeof fetch = async (url, init) => {
    const path = String(url);
    if (path.includes("/_mget?")) {
      assert.equal(new URL(path).searchParams.get("_source"), "embedding_key,embedding");
      assert.deepEqual(Object.keys(JSON.parse(String(init?.body))), ["ids"]);
      return Response.json({ docs: [{ _id: `${DEVELOPMENT_CORPUS_ID}:${node.id}`, found: !!stored, ...(stored ? { _source: stored } : {}) }] });
    }
    if (path.includes("/_bulk")) {
      stored = JSON.parse(String(init?.body).trim().split("\n")[1]);
      return Response.json({ errors: false, items: [{ index: { _id: `${DEVELOPMENT_CORPUS_ID}:${node.id}`, status: 200 } }] });
    }
    return Response.json({ acknowledged: true });
  };
  const embeddings = async () => { embeddingCalls++; return [[1, 0]]; };
  const client = createSearchClient({ dimensions: 2, fetch: transport, embed: embeddings });
  await client.indexNodes(DEVELOPMENT_CORPUS_ID, [node]);
  await client.indexNodes(DEVELOPMENT_CORPUS_ID, [{ ...node, confidence: 0.9 }]);
  assert.equal(embeddingCalls, 1, "metadata-only changes must not re-embed");
  assert.equal(stored!.confidence, 0.9, "metadata must still update");
  const changed = { ...node, statement_md: "A changed statement." };
  await client.indexNodes(DEVELOPMENT_CORPUS_ID, [changed]);
  assert.equal(embeddingCalls, 2);
  const otherModel = createSearchClient({ dimensions: 2, fetch: transport, embed: embeddings, embeddingModel: "test-model-v2" });
  await otherModel.indexNodes(DEVELOPMENT_CORPUS_ID, [changed]);
  assert.equal(embeddingCalls, 3);
});
