import { AuthError } from "./auth";
import { backendURL, gatewayKey, publicOrigin, GATEWAY_HEADER, ORIGIN_HEADER, BACKEND_OFFLINE } from "./deployment";

export class BackendOfflineError extends Error {
  constructor() { super(BACKEND_OFFLINE); }
}
export async function remoteData<T>(path: "/api/library" | "/api/corpus", token: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(new URL(path, backendURL()), {
      headers: { authorization: `Bearer ${token}`, [GATEWAY_HEADER]: gatewayKey(), [ORIGIN_HEADER]: publicOrigin(), "ngrok-skip-browser-warning": "1" },
      cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15000),
    });
  } catch { throw new BackendOfflineError(); }
  if (response.status === 401 || response.status === 404) throw new AuthError(response.status, "Please sign in again or return to your documents.");
  if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) throw new BackendOfflineError();
  try { return await response.json() as T; } catch { throw new BackendOfflineError(); }
}
