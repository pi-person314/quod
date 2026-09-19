import { pdfBytes } from "@/lib/data";
import { Uuid } from "@cairn/contracts";
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!Uuid.safeParse(id).success)
    return new Response("Invalid document", { status: 400 });
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
}
