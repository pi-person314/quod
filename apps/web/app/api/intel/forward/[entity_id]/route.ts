// GET /api/intel/forward/:entity_id — owner C (C4). Downstream nodes ranked by
// PageRank over reversed edges. -> {entity_id, downstream}
import { ForwardResponse, Uuid } from "@cairn/contracts";
import { canonicalEntity, entityCorpus, forwardGraph, loadCorpusGraph } from "@cairn/intel";
import { badRequest, jsonOf, notFound } from "@/lib/http";
import { fixturesEnabled, loadGoldenCorpus } from "@/lib/fixtures";

export async function GET(_req: Request, { params }: { params: Promise<{ entity_id: string }> }) {
  const { entity_id } = await params;
  if (!Uuid.safeParse(entity_id).success) return badRequest("invalid entity id");
  if (fixturesEnabled()) {
    const corpus = loadGoldenCorpus();
    const entity = corpus.entities.find((item) => item.id === entity_id);
    if (!entity) return notFound("entity");
    const docs = new Set(corpus.docs.filter((doc) => doc.corpus_id === entity.corpus_id).map((doc) => doc.id));
    const canonical = corpus.nodes.find((node) => node.id === entity.canonical_node_id)?.entity_id ?? entity_id;
    return jsonOf(ForwardResponse, { ...forwardGraph(corpus.nodes.filter((node) => docs.has(node.doc_id)), corpus.edges, canonical), entity_id });
  }
  const corpusId = await entityCorpus(entity_id);
  if (!corpusId) return notFound("entity");
  const graph = await loadCorpusGraph(corpusId);
  return jsonOf(ForwardResponse, { ...forwardGraph(graph.nodes, graph.edges, await canonicalEntity(entity_id) ?? entity_id), entity_id });
}
