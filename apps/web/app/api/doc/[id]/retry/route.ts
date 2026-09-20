import { Uuid } from "@cairn/contracts";
import { fixturesEnabled } from "@/lib/fixtures";
import { badRequest, notFound, sameOrigin } from "@/lib/http";
import { retryDocument } from "@/lib/retry-document";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(req)) return new Response("Forbidden", { status: 403 });
  const { id } = await params;
  if (!Uuid.safeParse(id).success) return badRequest("Invalid document");
  if (fixturesEnabled()) return Response.json({ message: "Add the source PDF again to retry this demonstration upload." }, { status: 409 });
  const result = await retryDocument(id);
  if (result === "missing") return notFound("document");
  if (result === "unavailable") return Response.json({ message: "Only failed documents with a stored PDF can be retried." }, { status: 409 });
  return Response.json({ doc_id: id, status: "queued" }, { status: 202 });
}
