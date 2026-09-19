import { CardResponse } from "@cairn/contracts";
import { dataset } from "@/lib/data";
import { jsonOf, notFound } from "@/lib/http";
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ anchor_id: string }> },
) {
  const { anchor_id } = await params;
  const card = (await dataset()).cards.find((c) => c.anchor_id === anchor_id);
  return card
    ? jsonOf(CardResponse, card, {
        headers: { "Cache-Control": "private, max-age=3600" },
      })
    : notFound("Baked card");
}
