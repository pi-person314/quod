// GET /api/doc/:id/anchors?page=N — owner B (B0). The reader's hot path. -> {anchors}
import { fixturesEnabled } from "@/lib/fixtures";
import { notImplemented } from "@/lib/http";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const page = Number(new URL(req.url).searchParams.get("page"));
  if (fixturesEnabled()) {
    // B0: filter loadGoldenCorpus().anchors by doc_id + page, return jsonOf(AnchorsResponse, ...)
  }
  return notImplemented(`GET /api/doc/${id}/anchors?page=${page}`, "B", "B0");
}
