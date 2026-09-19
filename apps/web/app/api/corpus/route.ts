// POST /api/corpus — owner B (B0). {name} -> {corpus_id}
import { CreateCorpusRequest } from "@cairn/contracts";
import { notImplemented, parseBody } from "@/lib/http";

export async function POST(req: Request) {
  const body = await parseBody(req, CreateCorpusRequest);
  if (body instanceof Response) return body;
  return notImplemented("POST /api/corpus", "B", "B0");
}
