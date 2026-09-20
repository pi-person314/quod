import { mintVoiceToken } from "@cairn/intel/voice";
import { sameOrigin } from "@/lib/http";

export async function POST(req: Request) {
  if (!sameOrigin(req)) return Response.json({ error: "forbidden" }, { status: 403 });
  try {
    return Response.json(await mintVoiceToken(), { headers: { "cache-control": "no-store" } });
  } catch { return Response.json({ error: "voice_unavailable" }, { status: 503 }); }
}
