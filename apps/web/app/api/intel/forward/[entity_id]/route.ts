// GET /api/intel/forward/:entity_id — owner C (C4). Downstream nodes ranked by
// PageRank over reversed edges. -> {entity_id, downstream}
import { notImplemented } from "@/lib/http";

export async function GET(_req: Request, { params }: { params: Promise<{ entity_id: string }> }) {
  const { entity_id } = await params;
  return notImplemented(`GET /api/intel/forward/${entity_id}`, "C", "C4");
}
