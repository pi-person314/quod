import { mintVoiceToken } from "@cairn/intel/voice";

export async function POST(req: Request) {
  const origin = req.headers.get("origin");
  if (origin && origin !== new URL(req.url).origin) return Response.json({ error: "forbidden" }, { status: 403 });
  try {
    return Response.json(await mintVoiceToken(), { headers: { "cache-control": "no-store" } });
  } catch { return Response.json({ error: "voice_unavailable" }, { status: 503 }); }
}
