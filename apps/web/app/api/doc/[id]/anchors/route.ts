import { AnchorsResponse, Uuid } from "@cairn/contracts";
import { dataset } from "@/lib/data";
import { jsonOf, badRequest } from "@/lib/http";
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const page = Number(new URL(req.url).searchParams.get("page"));
  if (!Uuid.safeParse(id).success || !Number.isInteger(page) || page < 1)
    return badRequest("Valid document and 1-indexed page required");
  return jsonOf(AnchorsResponse, {
    anchors: (await dataset()).anchors.filter(
      (a) => a.doc_id === id && a.page === page,
    ),
  });
}
