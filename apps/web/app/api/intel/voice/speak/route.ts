import { z } from "zod";
import { synthesizeSpeech } from "@cairn/intel/voice";
import { parseBody, sameOrigin } from "@/lib/http";
import { Uuid } from "@cairn/contracts";
import { dataset } from "@/lib/data";

export async function POST(req: Request) {
  const body = await parseBody(req, z.object({ text: z.string().trim().min(1).max(1000), doc_id: Uuid.optional() }).strict());
  if (body instanceof Response) return body;
  if (!sameOrigin(req)) return Response.json({ error: "forbidden" }, { status: 403 });
  try {
    if (!body.doc_id) return await synthesizeSpeech(body.text, req.signal);
    const data = await dataset();
    const doc = data.docs.find(doc => doc.id === body.doc_id);
    if (!doc) return Response.json({ error: "document_not_found" }, { status: 404 });
    return await synthesizeSpeech(body.text, req.signal, { docId: data.fixture ? undefined : doc.id,
      sourceDocId: doc.id, sourceCorpusId: doc.corpus_id });
  }
  catch { return Response.json({ error: "voice_unavailable" }, { status: 503 }); }
}
