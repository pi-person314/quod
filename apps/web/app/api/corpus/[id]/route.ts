import { assertCorpusOwner } from "@/lib/firestore";
import { saveLocal } from "@/lib/data";
import { requireUser, authErrorResponse, AuthError } from "@/lib/auth";
import { db } from "@quod/contracts/db";
import { Uuid } from "@quod/contracts";
import { fixturesEnabled } from "@/lib/fixtures";
import { badRequest, notFound } from "@/lib/http";
import { z } from "zod";

const RenameCorpus = z.object({ name: z.string() }).strict();

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(req);
    const { id } = await params;
    if (!Uuid.safeParse(id).success) return badRequest("Invalid document group");
    const parsed = RenameCorpus.safeParse(await req.json().catch(() => undefined));
    if (!parsed.success) return badRequest("Invalid document group name");
    const name = parsed.data.name.trim();
    if (!name || name.length > 200) throw new AuthError(400, "Document group names must contain 1–200 characters.");
    const previous = await assertCorpusOwner(user, id);

    // Display names live with document metadata. Firestore continues to own
    // access control; renaming never needs to alter immutable ownership records.
    if (fixturesEnabled()) await saveLocal("corpora", id, { ...previous, name });
    else {
      const result = await db().query("UPDATE corpora SET name=$2 WHERE id=$1", [id, name]);
      if (!result.rowCount) return notFound("document set");
    }
    return Response.json({ corpus_id: id, name });
  } catch (error) { return authErrorResponse(error); }
}
