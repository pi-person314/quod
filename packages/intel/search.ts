import { Node, Uuid } from "@cairn/contracts";
import { z } from "zod";
import { createHash } from "node:crypto";
import { embed, MODELS } from "./llm";

export interface SearchHit { node: Node; score: number }
export interface SearchOptions { corpusId?: string; limit?: number; excludeNodeId?: string }
export interface SearchDependencies {
  fetch?: typeof fetch;
  embed?: typeof embed;
  url?: string;
  index?: string;
  dimensions?: number;
  batchSize?: number;
  reuseEmbeddings?: boolean;
  embeddingModel?: string;
  meta?: Record<string, unknown>;
}

export function nodeSearchText(node: Node): string {
  return [node.label, node.title, node.statement_md, ...node.symbols.map((s) => `${s.sym} ${s.role}`)].filter(Boolean).join("\n");
}

/** Application-side RRF avoids depending on an Elasticsearch RRF license. */
export function reciprocalRankFusion(rankings: readonly (readonly SearchHit[])[], limit = 20): SearchHit[] {
  const hits = new Map<string, SearchHit>();
  for (const ranking of rankings) {
    const seen = new Set<string>();
    for (const [rank, hit] of ranking.entries()) {
      if (seen.has(hit.node.id)) continue;
      seen.add(hit.node.id);
      const previous = hits.get(hit.node.id);
      hits.set(hit.node.id, { node: hit.node, score: (previous?.score ?? 0) + 1 / (60 + rank + 1) });
    }
  }
  return [...hits.values()].sort((a, b) => b.score - a.score || a.node.id.localeCompare(b.node.id)).slice(0, limit);
}

/** Fixture fallback is lexical overlap, never a claim of semantic recall. */
export function lexicalSearch(nodes: readonly Node[], query: string, limit = 20): SearchHit[] {
  const tokens = (text: string) => text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const terms = new Set(tokens(query));
  return nodes.map((node) => {
    const words = new Set(tokens(nodeSearchText(node)));
    return { node, score: [...terms].filter((term) => words.has(term)).length };
  }).filter((hit) => hit.score > 0).sort((a, b) => b.score - a.score || a.node.id.localeCompare(b.node.id)).slice(0, limit);
}

const responseSchema = z.object({
  timed_out: z.boolean(), _shards: z.object({ failed: z.number() }),
  hits: z.object({ hits: z.array(z.object({ _source: Node.extend({ corpus_id: Uuid }), _score: z.number().finite() })) }),
});
const bulkSchema = z.object({ errors: z.boolean(), items: z.array(z.object({ index: z.object({ _id: z.string(), status: z.number(), error: z.unknown().optional() }) })) });
const errorSchema = z.object({ error: z.object({ type: z.string() }) });
const cachedSchema = z.object({ docs: z.array(z.object({ _id: z.string(), found: z.boolean(),
  _source: z.object({ embedding_key: z.string().optional(), embedding: z.array(z.number()).optional() }).optional(),
})) });

/** ES 8.15: top-level knn, pre-filtered by corpus; separate BM25 query fused locally.
 * https://www.elastic.co/guide/en/elasticsearch/reference/8.15/search-search.html
 * https://www.elastic.co/guide/en/elasticsearch/reference/8.15/docs-bulk.html
 */
export function createSearchClient(options: SearchDependencies = {}) {
  const transport = options.fetch ?? fetch;
  const embeddings = options.embed ?? embed;
  const url = (options.url ?? process.env.ELASTICSEARCH_URL ?? "http://localhost:9200").replace(/\/$/, "");
  const index = options.index ?? "cairn-nodes-v1";
  const dimensions = options.dimensions ?? 1536;
  const batchSize = options.batchSize ?? 64;
  const embeddingModel = options.embeddingModel ?? MODELS.embedding;
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(index)) throw new Error("Invalid search index name");
  if (!Number.isInteger(dimensions) || dimensions < 1 || dimensions > 4096) throw new Error("Invalid embedding dimensions");
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 256) throw new Error("Invalid indexing batch size");

  async function request(path: string, body: unknown, method = "POST", ndjson = false) {
    const response = await transport(`${url}/${index}${path}`, {
      method, headers: { "content-type": ndjson ? "application/x-ndjson" : "application/json" },
      ...(body === undefined ? {} : { body: ndjson ? String(body) : JSON.stringify(body) }),
      signal: AbortSignal.timeout(30_000),
    });
    const data: unknown = await response.json();
    return { response, data };
  }
  function vectors(values: number[][], count: number) {
    if (values.length !== count || values.some((v) => v.length !== dimensions || !v.every(Number.isFinite) || !v.some((n) => n !== 0))) {
      throw new Error("Embedding count, dimensions, or values do not match the search index");
    }
  }
  function errorType(data: unknown) { const parsed = errorSchema.safeParse(data); return parsed.success ? parsed.data.error.type : "unknown_error"; }

  async function ensureIndex(): Promise<void> {
    const { response, data } = await request("", { mappings: { properties: {
      id: { type: "keyword" }, corpus_id: { type: "keyword" }, doc_id: { type: "keyword" }, entity_id: { type: "keyword" },
      kind: { type: "keyword" }, label: { type: "text" }, title: { type: "text" }, statement_md: { type: "text" },
      symbols: { properties: { sym: { type: "text" }, role: { type: "text" } } },
      embedding: { type: "dense_vector", dims: dimensions, index: true, similarity: "cosine" },
      embedding_key: { type: "keyword", index: false },
    } } }, "PUT");
    if (response.ok) return;
    if (response.status !== 400 || errorType(data) !== "resource_already_exists_exception") throw new Error(`Search index creation failed (${response.status})`);
    const mapping = await request("/_mapping", undefined, "GET");
    const schema = z.record(z.object({ mappings: z.object({ properties: z.object({ embedding: z.object({ type: z.literal("dense_vector"), dims: z.literal(dimensions), index: z.boolean().optional(), similarity: z.literal("cosine") }), corpus_id: z.object({ type: z.literal("keyword") }) }) }) }));
    const parsed = schema.safeParse(mapping.data);
    if (!mapping.response.ok || !parsed.success || !parsed.data[index] || parsed.data[index].mappings.properties.embedding.index === false) throw new Error("Existing search index mapping is incompatible");
  }

  async function indexNodes(corpusId: string, nodes: readonly Node[]): Promise<number> {
    Uuid.parse(corpusId);
    const unique = new Map(nodes.map((node) => { const parsed = Node.parse(node); return [parsed.id, parsed] as const; }));
    if (!unique.size) return 0;
    await ensureIndex();
    const all = [...unique.values()];
    for (let offset = 0; offset < all.length; offset += batchSize) {
      const chunk = all.slice(offset, offset + batchSize);
      const keys = chunk.map((node) => createHash("sha256").update(JSON.stringify({
        model: embeddingModel, dimensions, text: nodeSearchText(node), version: 1,
      })).digest("hex"));
      const values: number[][] = new Array(chunk.length);
      if (options.reuseEmbeddings !== false) {
        const cached = await request("/_mget?_source=embedding_key,embedding", { ids: chunk.map((node) => `${corpusId}:${node.id}`) });
        if (!cached.response.ok) throw new Error(`Embedding cache lookup failed (${cached.response.status})`);
        const docs = cachedSchema.parse(cached.data).docs;
        if (docs.length !== chunk.length || docs.some((doc, i) => doc._id !== `${corpusId}:${chunk[i].id}`)) throw new Error("Embedding cache returned unexpected IDs");
        for (const [i, doc] of docs.entries()) {
          if (doc.found && doc._source?.embedding_key === keys[i] && doc._source.embedding) {
            vectors([doc._source.embedding], 1);
            values[i] = doc._source.embedding;
          }
        }
      }
      const missing = chunk.map((_node, i) => i).filter((i) => values[i] === undefined);
      if (missing.length) {
        const generated = await embeddings(missing.map((i) => nodeSearchText(chunk[i])), { corpusId, meta: options.meta });
        vectors(generated, missing.length);
        for (const [position, i] of missing.entries()) values[i] = generated[position];
      }
      vectors(values, chunk.length);
      const body = chunk.flatMap((node, i) => [JSON.stringify({ index: { _id: `${corpusId}:${node.id}` } }), JSON.stringify({ ...node, corpus_id: corpusId, embedding: values[i], embedding_key: keys[i] })]).join("\n") + "\n";
      const { response, data } = await request("/_bulk?refresh=wait_for", body, "POST", true);
      if (!response.ok) throw new Error(`Search bulk indexing failed (${response.status})`);
      const parsed = bulkSchema.parse(data);
      if (parsed.errors || parsed.items.length !== chunk.length || parsed.items.some((item, i) => item.index._id !== `${corpusId}:${chunk[i]!.id}` || item.index.status < 200 || item.index.status >= 300 || item.index.error !== undefined)) {
        throw new Error("Search bulk indexing partially failed; retry with the same IDs after resolving the error");
      }
    }
    return all.length;
  }

  async function search(query: string, opts: SearchOptions = {}): Promise<SearchHit[]> {
    const limit = opts.limit ?? 20;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("Search limit must be between 1 and 100");
    if (opts.corpusId !== undefined) Uuid.parse(opts.corpusId);
    if (!query.trim()) return [];
    const filter = opts.corpusId ? [{ term: { corpus_id: opts.corpusId } }] : [];
    const mustNot = opts.excludeNodeId ? [{ term: { id: opts.excludeNodeId } }] : [];
    const scope = { bool: { filter, must_not: mustNot } };
    const window = Math.max(50, limit);
    async function retrieve(body: object): Promise<SearchHit[] | null> {
      const { response, data } = await request("/_search?allow_partial_search_results=false", { size: window, _source: { excludes: ["embedding"] }, ...body });
      if (response.status === 404 && errorType(data) === "index_not_found_exception") return null;
      if (!response.ok) throw new Error(`Search request failed (${response.status})`);
      const parsed = responseSchema.parse(data);
      if (parsed.timed_out || parsed._shards.failed > 0) throw new Error("Search returned incomplete results");
      return parsed.hits.hits.map((hit) => {
        if ((opts.corpusId && hit._source.corpus_id !== opts.corpusId) || hit._source.id === opts.excludeNodeId) throw new Error("Search result violated requested scope");
        return { node: Node.parse(hit._source), score: hit._score };
      });
    }
    // Check lexical retrieval first: an absent index needs no paid query embedding.
    const lexical = await retrieve({ query: { bool: { ...scope.bool, must: [{ multi_match: { query, fields: ["label^3", "title^3", "statement_md", "symbols.sym", "symbols.role"] } }] } }, sort: [{ _score: "desc" }, { id: "asc" }] });
    if (lexical === null) return [];
    const values = await embeddings([query], { corpusId: opts.corpusId, meta: options.meta });
    vectors(values, 1);
    const dense = await retrieve({ knn: { field: "embedding", query_vector: values[0], k: window, num_candidates: Math.max(100, window * 2), filter: scope } });
    if (dense === null) throw new Error("Search index disappeared during hybrid retrieval");
    return reciprocalRankFusion([lexical, dense], limit);
  }

  async function resolutionCandidates(node: Node, corpusId: string): Promise<SearchHit[]> {
    Uuid.parse(corpusId);
    return search(nodeSearchText(node), { corpusId, excludeNodeId: node.id, limit: 8 });
  }
  return { ensureIndex, indexNodes, search, resolutionCandidates };
}
