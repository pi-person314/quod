// POST /api/corpus/:id/docs — owner B (B0/B3). Multipart upload; stores the PDF,
// inserts documents + ingest_progress rows, enqueues the worker. -> {doc_ids}
import { notImplemented } from "@/lib/http";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return notImplemented(`POST /api/corpus/${id}/docs`, "B", "B3");
}
