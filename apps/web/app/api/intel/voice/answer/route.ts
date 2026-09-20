import { requireDocumentOwner } from "@/lib/data";
import { requireUser, authErrorResponse } from "@/lib/auth";
import { documentCorpus, loadCorpusGraph } from "@quod/intel";
import { answerFromViewport, VoiceQuestion } from "@quod/intel/voice";
import { parseBody, sameOrigin } from "@/lib/http";
import { fixturesEnabled } from "@/lib/fixtures";
import { userDataset } from "@/lib/data";

export async function POST(req: Request) {
  try {
    const user = await requireUser(req);
    const body = await parseBody(req, VoiceQuestion);
    if (body instanceof Response) return body;
    await requireDocumentOwner(user, body.doc_id);
    if (!sameOrigin(req))
      return Response.json({ error: "forbidden" }, { status: 403 });
    try {
      if (fixturesEnabled()) {
        const data = await userDataset(user);
        const document = data.docs.find(doc => doc.id === body.doc_id);
        if (!document) return Response.json({ error: "document_not_found" }, { status: 404 });
        const docs = new Set(data.docs.filter(doc => doc.corpus_id === document.corpus_id).map(doc => doc.id));
        const nodes = data.nodes.filter(node => docs.has(node.doc_id));
        const ids = new Set(nodes.map(node => node.id));
        return Response.json(await answerFromViewport(body, nodes,
          data.edges.filter(edge => ids.has(edge.src) && ids.has(edge.dst)),
          data.anchors.filter(anchor => docs.has(anchor.doc_id))));
      }
      const corpusId = await documentCorpus(body.doc_id);
      if (!corpusId) return Response.json({ error: "document_not_found" }, { status: 404 });
      const graph = await loadCorpusGraph(corpusId);
      return Response.json(await answerFromViewport(body, graph.nodes, graph.edges, graph.anchors));
    } catch {
      return Response.json({ error: "voice_unavailable" }, { status: 503 });
    }
  } catch (error) {
    return authErrorResponse(error);
  }
}
