import { requireDocumentOwner, renameDocumentTitle } from "@/lib/data";
import { requireUser, authErrorResponse, AuthError } from "@/lib/auth";
import { Uuid } from "@quod/contracts";
import { badRequest, notFound } from "@/lib/http";
import { z } from "zod";

const RenameDocument = z.object({ title: z.string() }).strict();

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(req);
    const { id } = await params;
    if (!Uuid.safeParse(id).success) return badRequest("Invalid document");
    const parsed = RenameDocument.safeParse(await req.json().catch(() => undefined));
    if (!parsed.success) return badRequest("Invalid document title");
    const title = parsed.data.title.trim();
    if (!title || title.length > 200) throw new AuthError(400, "Document titles must contain 1–200 characters.");
    const doc = await requireDocumentOwner(user, id);
    if (!await renameDocumentTitle(id, title)) return notFound("document");
    return Response.json({ doc_id: id, title, filename: doc.filename });
  } catch (error) { return authErrorResponse(error); }
}
