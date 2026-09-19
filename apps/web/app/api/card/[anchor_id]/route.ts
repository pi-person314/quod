// GET /api/card/:anchor_id — owner B (B0). Baked card from Postgres. No model call, ever.
import { fixturesEnabled } from "@/lib/fixtures";
import { notImplemented } from "@/lib/http";

export async function GET(_req: Request, { params }: { params: Promise<{ anchor_id: string }> }) {
  const { anchor_id } = await params;
  if (fixturesEnabled()) {
    // B0: find loadGoldenCorpus().cards by anchor_id, return jsonOf(CardResponse, ...)
  }
  return notImplemented(`GET /api/card/${anchor_id}`, "B", "B0");
}
