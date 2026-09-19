// POST /api/intel/resolve — owner C (C3). {corpus_id, node_ids} -> {decisions}
// Called by the worker at stage 4. ES top-8 recall, one batched Sol
// adjudication, union-find into entities, writes nodes.entity_id + entities.
import { ResolveRequest, ResolveResponse } from "@cairn/contracts";
import { jsonOf, notFound, parseBody } from "@/lib/http";
import { fixturesEnabled, loadGoldenCorpus } from "@/lib/fixtures";
import { requireLiveBudget, resolveWithDefaults } from "@cairn/intel";

export async function POST(req: Request) {
  const body = await parseBody(req, ResolveRequest);
  if (body instanceof Response) return body;
  if (fixturesEnabled()) {
    const corpus = loadGoldenCorpus();
    const docs = new Set(corpus.docs.filter((doc) => doc.corpus_id === body.corpus_id).map((doc) => doc.id));
    const requested = new Set(body.node_ids);
    const nodes = corpus.nodes.filter((node) => requested.has(node.id) && docs.has(node.doc_id));
    if (nodes.length !== requested.size) return notFound("nodes in corpus");
    const entities = new Set(corpus.entities.filter((entity) => entity.corpus_id === body.corpus_id).map((entity) => entity.id));
    return jsonOf(ResolveResponse, { decisions: nodes.filter((node) => node.entity_id && entities.has(node.entity_id)).map((node) => ({
      node_id: node.id, entity_id: node.entity_id!, verdict: "same" as const, confidence: node.confidence,
    })) });
  }
  try {
    await requireLiveBudget();
    return jsonOf(ResolveResponse, await resolveWithDefaults(body));
  } catch {
    return Response.json({ error: "resolution_unavailable", message: "Live resolution is unavailable; check spending protection and services." }, { status: 503 });
  }
}
