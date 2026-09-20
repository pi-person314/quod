import { requireUser, authErrorResponse } from "@/lib/auth";
import { mintVoiceToken } from "@cairn/intel/voice";
import { sameOrigin } from "@/lib/http";

export async function POST(req: Request) {
  try {
    const user = await requireUser(req);
    if (!sameOrigin(req))
      return Response.json({ error: "forbidden" }, { status: 403 });
    try {
      return Response.json(await mintVoiceToken(), {
        headers: { "cache-control": "no-store" },
      });
    } catch {
      return Response.json({ error: "voice_unavailable" }, { status: 503 });
    }
  } catch (error) {
    return authErrorResponse(error);
  }
}
