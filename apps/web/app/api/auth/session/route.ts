import { assertSameOrigin, authErrorResponse, AuthError, sessionCookie, verifyIdToken } from "@/lib/auth";
export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    const body = await req.json().catch(() => null);
    if (typeof body?.idToken !== "string") throw new AuthError(400, "A sign-in token is required.");
    const user = await verifyIdToken(body.idToken);
    return Response.json({ uid: user.uid }, { headers: { "Set-Cookie": sessionCookie(req, user.token), "Cache-Control": "no-store" } });
  } catch (error) { return authErrorResponse(error); }
}
export async function DELETE(req: Request) {
  try {
    assertSameOrigin(req);
    return Response.json({ ok: true }, { headers: { "Set-Cookie": sessionCookie(req, "", 0), "Cache-Control": "no-store" } });
  } catch (error) { return authErrorResponse(error); }
}
