import type { ZodType } from "zod";

/** 501 for a route shell whose handler has not landed yet. Names the owner so nobody guesses. */
export function notImplemented(route: string, owner: "A" | "B" | "C", phase: string): Response {
  return Response.json({ error: "not_implemented", route, owner, phase }, { status: 501 });
}

export function badRequest(message: string, details?: unknown): Response {
  return Response.json({ error: "bad_request", message, details }, { status: 400 });
}

export function notFound(what: string): Response {
  return Response.json({ error: "not_found", what }, { status: 404 });
}

/** Validate an outgoing payload against its contract before sending it. Cheap insurance across sessions. */
export function jsonOf<T>(schema: ZodType<T>, data: T, init?: ResponseInit): Response {
  return Response.json(schema.parse(data), init);
}

/** Parse a JSON body against its contract; returns a 400 Response on failure. */
export async function parseBody<T>(req: Request, schema: ZodType<T>): Promise<T | Response> {
  const result = schema.safeParse(await req.json().catch(() => undefined));
  return result.success ? result.data : badRequest("invalid body", result.error.issues);
}
