import { requireUser, authErrorResponse } from "@/lib/auth";
import { userDataset } from "@/lib/data";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const user = await requireUser(req);

    return Response.json(await userDataset(user));
  } catch (error) {
    return authErrorResponse(error);
  }
}