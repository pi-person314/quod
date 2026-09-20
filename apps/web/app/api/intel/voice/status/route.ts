import { requireLiveBudget } from "@cairn/intel";
export async function GET() {
  let available = false;
  if (process.env.CAIRN_VOICE_RELAY === "1" && process.env.DEEPGRAM_API_KEY
    && (process.env.USE_FIXTURES !== "0" || process.env.OPENAI_API_KEY)) {
    try { await requireLiveBudget(); available = true; } catch { /* No secrets in status responses. */ }
  }
  return Response.json({ available, message: available ? "Hold to ask about this page." : "Voice is unavailable in this workspace." },
    { headers: { "cache-control": "no-store" } });
}
