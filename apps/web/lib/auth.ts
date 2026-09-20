import { sameOrigin } from "./http";

export type AuthUser = { uid: string; token: string };
export const SESSION_COOKIE = "cairn_session";
export class AuthError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export function authErrorResponse(error: unknown): Response {
  if (error instanceof AuthError)
    return Response.json({ error: error.message }, { status: error.status });
  console.error("Corpus request failed", error);
  return Response.json({ error: "Unable to save or retrieve your corpora. Please try again." }, { status: 500 });
}
export function assertSameOrigin(req: Request) {
  if (!sameOrigin(req) || req.headers.get("sec-fetch-site") === "cross-site")
    throw new AuthError(403, "Cross-origin request denied.");
}
export async function verifyIdToken(token: string): Promise<AuthUser> {
  const key = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  const project = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  if (!key || !project) throw new AuthError(503, "Firebase authentication is not configured.");
  if (!token || token.length > 16000) throw new AuthError(401, "Please sign in to continue.");
  // These claims are checked against the configured project, but are trusted only
  // after accounts:lookup has validated the token with Firebase itself.
  let claims: { aud?: string; iss?: string; sub?: string; exp?: number };
  try { claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()); }
  catch { throw new AuthError(401, "Invalid sign-in token."); }
  if (claims.aud !== project || claims.iss !== `https://securetoken.google.com/${project}` ||
      !claims.sub || typeof claims.exp !== "number" || claims.exp <= Date.now() / 1000)
    throw new AuthError(401, "Your session expired. Please sign in again.");
  let response: Response;
  try {
    response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(key)}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken: token }), cache: "no-store", signal: AbortSignal.timeout(15000),
    });
  } catch { throw new AuthError(503, "Firebase authentication is unavailable. Please try again."); }
  if (!response.ok) throw new AuthError(response.status >= 500 ? 503 : 401, "Unable to verify your session. Please sign in again.");
  const body = await response.json() as { users?: { localId: string; disabled?: boolean }[] };
  const user = body.users?.[0];
  if (!user || user.disabled || user.localId !== claims.sub)
    throw new AuthError(401, "Invalid sign-in session.");
  return { uid: user.localId, token };
}
export async function requireUser(req?: Request): Promise<AuthUser> {
  let token: string | undefined;
  if (req) {
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) assertSameOrigin(req);
    const authorization = req.headers.get("authorization");
    token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : undefined;
    if (!token) token = req.headers.get("cookie")?.split(";").map(p => p.trim()).find(p => p.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length + 1);
  } else {
    // The custom server also imports this module before Next initializes.
    // Load request-scoped helpers only inside a Next server-component request.
    const { cookies } = await import("next/headers");
    token = (await cookies()).get(SESSION_COOKIE)?.value;
  }
  if (!token) throw new AuthError(401, "Please sign in to continue.");
  return verifyIdToken(token);
}
export function sessionCookie(req: Request, token: string, maxAge = 3600): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${new URL(req.url).protocol === "https:" ? "; Secure" : ""}`;
}
