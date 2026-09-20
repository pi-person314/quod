import { requireDocumentOwner } from "@/lib/data";
import { requireUser, authErrorResponse } from "@/lib/auth";
import { pdfBytes } from "@/lib/data";
import { Uuid } from "@quod/contracts";
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser(req);
    const { id } = await params;
    if (!Uuid.safeParse(id).success)
      return new Response("Invalid document", { status: 400 });
    await requireDocumentOwner(user, id);
    try {
      const bytes = await pdfBytes(id);
      if (!bytes) return new Response("PDF not found", { status: 404 });
      return new Response(new Uint8Array(bytes), {
        headers: {
          "Content-Type": "application/pdf",
          "Cache-Control": "private, max-age=3600",
        },
      });
    } catch {
      return new Response("PDF not found", { status: 404 });
    }
  } catch (error) {
    return authErrorResponse(error);
  }
}
