import { z } from "zod";
import { synthesizeSpeech } from "@cairn/intel/voice";
import { parseBody } from "@/lib/http";

export async function POST(req: Request) {
  const body = await parseBody(req, z.object({ text: z.string().trim().min(1).max(1000) }).strict());
  if (body instanceof Response) return body;
  const origin = req.headers.get("origin");
  if (origin && origin !== new URL(req.url).origin) return Response.json({ error: "forbidden" }, { status: 403 });
  try { return await synthesizeSpeech(body.text, req.signal); }
  catch { return Response.json({ error: "voice_unavailable" }, { status: 503 }); }
}
