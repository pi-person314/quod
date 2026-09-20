import { timingSafeEqual } from "node:crypto";

export const GATEWAY_HEADER = "x-quod-gateway-key";
export const ORIGIN_HEADER = "x-quod-public-origin";
export const BACKEND_OFFLINE = "The document server is offline. Please try again when it is back online.";
export const hostedFrontend = () => process.env.QUOD_MODE === "frontend";

export function gatewayKey(): string {
  const key = process.env.QUOD_GATEWAY_SECRET ?? "";
  if (!/^[a-f0-9]{64}$/i.test(key)) throw new Error("Set QUOD_GATEWAY_SECRET to a generated 64-character hexadecimal secret.");
  return key;
}
export function authorizedGateway(value: string | null | undefined, key = process.env.QUOD_GATEWAY_SECRET): boolean {
  if (!key || !value || !/^[a-f0-9]{64}$/i.test(key)) return false;
  const a = Buffer.from(value), b = Buffer.from(key);
  return a.length === b.length && timingSafeEqual(a, b);
}
export function validOrigin(value: string): string {
  const url = new URL(value);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash ||
      (url.protocol !== "https:" && !(url.protocol === "http:" && local))) throw new Error("Invalid public origin");
  return url.origin;
}
export function publicOrigin(): string {
  return validOrigin(process.env.QUOD_PUBLIC_ORIGIN ?? process.env.RENDER_EXTERNAL_URL ?? "");
}
export function backendURL(): URL {
  const url = new URL(process.env.QUOD_BACKEND_URL ?? "");
  validOrigin(url.href);
  return url;
}
/** Only the authenticated tunnel gateway can override the internal HTTP origin. */
export function requestOrigin(req: Request): string {
  if (authorizedGateway(req.headers.get(GATEWAY_HEADER))) {
    try { return validOrigin(req.headers.get(ORIGIN_HEADER) ?? ""); } catch { /* fail closed below */ }
  }
  const internal = new URL(req.url);
  return `${internal.protocol}//${req.headers.get("host") ?? internal.host}`;
}

/** A closed allowlist prevents URL encoding/normalization from reaching worker routes. */
export function exposedRoute(raw: string, method = "GET", websocket = false): boolean {
  const path = raw.split("?")[0];
  if (websocket) return method === "GET" && path === "/api/intel/voice/stream";
  const id = "[0-9a-fA-F-]{36}";
  const rules: [string, string][] = [
    ["/health", "GET"], ["/api/library", "GET"], ["/api/corpus", "GET|POST"],
    ["/api/auth/config", "GET"], ["/api/auth/session", "POST|DELETE"],
    [`/api/corpus/${id}`, "PATCH"], [`/api/corpus/${id}/docs`, "POST"], [`/api/corpus/${id}/events`, "GET"],
    [`/api/doc/${id}`, "PATCH"], [`/api/doc/${id}/(pdf|anchors)`, "GET"], [`/api/doc/${id}/retry`, "POST"],
    [`/api/card/${id}`, "GET"], ["/api/search", "GET"], ["/api/intel/costs", "GET"],
    [`/api/intel/forward/${id}`, "GET"], ["/api/intel/trace", "POST"],
    ["/api/intel/voice/status", "GET"], ["/api/intel/voice/(answer|speak|token)", "POST"],
  ];
  return rules.some(([pattern, methods]) => new RegExp(`^${pattern}$`).test(path) && methods.split("|").includes(method));
}
