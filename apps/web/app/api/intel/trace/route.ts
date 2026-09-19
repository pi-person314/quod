// POST /api/intel/trace — owner C (C4). {doc_id, selection, page?, read_node_ids?} -> {chain}
// Recursive CTE walk backward from every entity in the selection, depth <= 4,
// breadth <= 3 per level, filtered against reader state. B4 builds against a
// hand-written trace fixture first; swapping to this must need no component changes.
import { TraceRequest } from "@cairn/contracts";
import { notImplemented, parseBody } from "@/lib/http";

export async function POST(req: Request) {
  const body = await parseBody(req, TraceRequest);
  if (body instanceof Response) return body;
  return notImplemented("POST /api/intel/trace", "C", "C4");
}
