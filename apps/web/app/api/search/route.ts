// GET /api/search?q= — owner C (C2). Elasticsearch hybrid BM25 + dense, RRF-fused. -> {hits}
import { notImplemented } from "@/lib/http";

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q") ?? "";
  return notImplemented(`GET /api/search?q=${encodeURIComponent(q)}`, "C", "C2");
}
