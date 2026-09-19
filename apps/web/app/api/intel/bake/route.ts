// POST /api/intel/bake — owner C (C1). {doc_id} -> {cards_done}
// Called by the worker at stage 5. For every anchor in the doc with a target,
// run the instantiation prompt and write a cards row + anchors.card_id.
import { BakeRequest } from "@cairn/contracts";
import { notImplemented, parseBody } from "@/lib/http";

export async function POST(req: Request) {
  const body = await parseBody(req, BakeRequest);
  if (body instanceof Response) return body;
  return notImplemented("POST /api/intel/bake", "C", "C1");
}
