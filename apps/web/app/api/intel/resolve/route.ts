// POST /api/intel/resolve — owner C (C3). {corpus_id, node_ids} -> {decisions}
// Called by the worker at stage 4. ES top-8 recall, one batched Sol
// adjudication, union-find into entities, writes nodes.entity_id + entities.
import { ResolveRequest } from "@cairn/contracts";
import { notImplemented, parseBody } from "@/lib/http";

export async function POST(req: Request) {
  const body = await parseBody(req, ResolveRequest);
  if (body instanceof Response) return body;
  return notImplemented("POST /api/intel/resolve", "C", "C3");
}
