import { dataset } from "@/lib/data";
export const dynamic = "force-dynamic";
export async function GET() {
  return Response.json(await dataset());
}
