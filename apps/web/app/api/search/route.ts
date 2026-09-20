import { assertCorpusOwner, listUserCorpora } from "@/lib/firestore";
import { requireUser, authErrorResponse } from "@/lib/auth";
// GET /api/search?q= — owner C (C2). Elasticsearch hybrid BM25 + dense, RRF-fused. -> {hits}
import { SearchResponse, Uuid } from "@cairn/contracts";
import { createSearchClient, lexicalSearch } from "@cairn/intel";
import { badRequest, jsonOf } from "@/lib/http";
import { fixturesEnabled } from "@/lib/fixtures";
import { userDataset, scopeDataset } from "@/lib/data";

export async function GET(req: Request) {
  try {
    const user = await requireUser(req);
    const params = new URL(req.url).searchParams;
    const q = params.get("q") ?? "";
    const corpusId = params.get("corpus_id") ?? undefined;
    if (corpusId !== undefined && !Uuid.safeParse(corpusId).success)
      return badRequest("Invalid corpus_id");
    if (corpusId) await assertCorpusOwner(user, corpusId);
    if (q.length > 2000) return badRequest("search query is too long");
    if (
      fixturesEnabled() ||
      process.env.CAIRN_INTELLIGENCE_MODE === "deterministic"
    ) {
      const data = await userDataset(user);
      return jsonOf(SearchResponse, {
        hits: lexicalSearch(
          corpusId ? scopeDataset(data, corpusId).nodes : data.nodes,
          q,
        ),
      });
    }
    try {
      const corpora = corpusId
        ? [{ id: corpusId }]
        : await listUserCorpora(user);
      const client = createSearchClient();
      const results = await Promise.all(
        corpora.map((corpus) => client.search(q, { corpusId: corpus.id })),
      );
      return jsonOf(SearchResponse, { hits: results.flat() });
    } catch {
      return Response.json({ error: "search_unavailable" }, { status: 503 });
    }
  } catch (error) {
    return authErrorResponse(error);
  }
}
