import { requireDocumentOwner } from "@/lib/data";
import { requireUser, authErrorResponse } from "@/lib/auth";
import { AnchorsResponse, Uuid } from "@quod/contracts";
import { userDataset } from "@/lib/data";
import { jsonOf, badRequest } from "@/lib/http";
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser(req);
    const { id } = await params;
    const page = Number(new URL(req.url).searchParams.get("page"));
    if (!Uuid.safeParse(id).success || !Number.isInteger(page) || page < 1)
      return badRequest("Valid document and 1-indexed page required");
    await requireDocumentOwner(user, id);
    return jsonOf(AnchorsResponse, {
      anchors: (await userDataset(user)).anchors.filter(
        (a) => a.doc_id === id && a.page === page,
      ),
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}
