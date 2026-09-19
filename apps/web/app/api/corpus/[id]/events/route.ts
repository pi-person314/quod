// GET /api/corpus/:id/events — owner B (B3). SSE stream of IngestEvent, polled
// from the ingest_progress table. In fixture mode, replay a canned sequence.
import { notImplemented } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return notImplemented(`GET /api/corpus/${id}/events`, "B", "B3");
}
