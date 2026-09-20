import { requireUser, authErrorResponse } from "@/lib/auth";
import { CardResponse } from "@cairn/contracts";
import { userDataset } from "@/lib/data";
import { jsonOf, notFound } from "@/lib/http";
export async function GET(
  req: Request,
  { params }: { params: Promise<{ anchor_id: string }> },
) {
  try {
    const user = await requireUser(req);
    const { anchor_id } = await params;
    const data = await userDataset(user);
    let card = data.cards.find((c) => c.anchor_id === anchor_id);
    if (!card) {
      const anchor = data.anchors.find((a) => a.id === anchor_id);
      const targetId =
        anchor?.target_node_id ??
        data.entities.find((e) => e.id === anchor?.target_entity_id)
          ?.canonical_node_id;
      const target = data.nodes.find((n) => n.id === targetId);
      const corpusId = data.docs.find(
        (d) => d.id === anchor?.doc_id,
      )?.corpus_id;
      if (
        anchor &&
        target &&
        corpusId &&
        data.docs.some(
          (d) => d.id === target.doc_id && d.corpus_id === corpusId,
        )
      )
        card = {
          id: anchor.id,
          anchor_id: anchor.id,
          headline: target.title ?? target.label ?? target.kind,
          instantiated_md: target.statement_md,
          full_md: target.statement_md,
          substitutions: [],
          clause_ids: [],
          gloss: "Original statement; check its hypotheses before applying it.",
          source: { doc_id: target.doc_id, page: target.page },
        };
    }
    return card
      ? jsonOf(CardResponse, card, {
          headers: { "Cache-Control": "private, max-age=3600" },
        })
      : notFound("Resolved reference");
  } catch (error) {
    return authErrorResponse(error);
  }
}
