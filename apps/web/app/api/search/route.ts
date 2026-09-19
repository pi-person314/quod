// GET /api/search?q= — owner C (C2). Elasticsearch hybrid BM25 + dense, RRF-fused. -> {hits}
import { SearchResponse } from "@cairn/contracts";
import { createSearchClient, lexicalSearch } from "@cairn/intel";
import { badRequest, jsonOf } from "@/lib/http";
import { fixturesEnabled, loadGoldenCorpus } from "@/lib/fixtures";

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q") ?? "";
  if (q.length > 2000) return badRequest("search query is too long");
  if (fixturesEnabled()) return jsonOf(SearchResponse, { hits: lexicalSearch(loadGoldenCorpus().nodes, q) });
  try {
    return jsonOf(SearchResponse, { hits: await createSearchClient().search(q) });
  } catch {
    return Response.json({ error: "search_unavailable" }, { status: 503 });
  }
}
