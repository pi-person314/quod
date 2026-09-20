import { authErrorResponse } from "@/lib/auth";
// POST /api/intel/bake — owner C (C1). {doc_id} -> {cards_done}
// Called by the worker at stage 5. For every anchor in the doc with a target,
// run the instantiation prompt and write a cards row + anchors.card_id.
import { BakeRequest, BakeResponse } from "@quod/contracts";
import { bakeDocument, documentCorpus } from "@quod/intel";
import { jsonOf, notFound, parseBody, sameOrigin } from "@/lib/http";
import { fixturesEnabled, loadGoldenCorpus } from "@/lib/fixtures";

export async function POST(req: Request) {
  try {
    if (!sameOrigin(req)) return new Response("Forbidden", { status: 403 });
    const body = await parseBody(req, BakeRequest);
    if (body instanceof Response) return body;
    if (fixturesEnabled()) {
      const corpus = loadGoldenCorpus();
      if (!corpus.docs.some((doc) => doc.id === body.doc_id))
        return notFound("document");
      const anchors = new Set(
        corpus.anchors
          .filter((anchor) => anchor.doc_id === body.doc_id)
          .map((anchor) => anchor.id),
      );
      return jsonOf(BakeResponse, {
        cards_done: new Set(
          corpus.cards
            .filter((card) => anchors.has(card.anchor_id))
            .map((card) => card.anchor_id),
        ).size,
      });
    }
    if (!(await documentCorpus(body.doc_id))) return notFound("document");
    return jsonOf(BakeResponse, await bakeDocument(body.doc_id));
  } catch (error) {
    return authErrorResponse(error);
  }
}
