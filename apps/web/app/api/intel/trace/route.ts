import { requireDocumentOwner } from "@/lib/data";
import { requireUser, authErrorResponse } from "@/lib/auth";
// POST /api/intel/trace — owner C (C4). {doc_id, selection, page?, read_node_ids?} -> {chain}
// Recursive CTE walk backward from every entity in the selection, depth <= 4,
// breadth <= 3 per level, filtered against reader state. B4 builds against a
// hand-written trace fixture first; swapping to this must need no component changes.
import { TraceRequest, TraceResponse } from "@quod/contracts";
import {
  documentCorpus,
  traceFromPostgres,
  traceSelection,
} from "@quod/intel";
import { jsonOf, notFound, parseBody } from "@/lib/http";
import { fixturesEnabled } from "@/lib/fixtures";
import { userDataset } from "@/lib/data";
import { demoProofTrace } from "@/lib/demo-trace";

export async function POST(req: Request) {
  try {
    const user = await requireUser(req);
    const body = await parseBody(req, TraceRequest);
    if (body instanceof Response) return body;
    await requireDocumentOwner(user, body.doc_id);
    const input = { ...body, read_node_ids: body.read_node_ids ?? [] };
    if (fixturesEnabled()) {
      const corpus = await userDataset(user);
      const document = corpus.docs.find((doc) => doc.id === body.doc_id);
      if (!document) return notFound("document");
      const docs = new Set(
        corpus.docs
          .filter((doc) => doc.corpus_id === document.corpus_id)
          .map((doc) => doc.id),
      );
      const authored = demoProofTrace(corpus, input);
      return jsonOf(
        TraceResponse,
        authored ??
          traceSelection(
            corpus.nodes.filter((node) => docs.has(node.doc_id)),
            corpus.edges,
            input,
            corpus.anchors,
          ),
      );
    }
    const corpusId = await documentCorpus(body.doc_id);
    if (!corpusId) return notFound("document");
    return jsonOf(TraceResponse, await traceFromPostgres(corpusId, input));
  } catch (error) {
    return authErrorResponse(error);
  }
}
