import type { IncomingMessage, ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import { exposedRoute } from "../lib/deployment";
import { proxyHTTP, proxyUpgrade, rejectUpgrade, type ProxyConfig } from "./stream-proxy";

export function hostedRequest(req: IncomingMessage, res: ServerResponse, config: ProxyConfig): boolean {
  const path = (req.url ?? "").split("?")[0];
  if (path === "/health") {
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    res.end('{"online":true}'); return true;
  }
  if (path === "/api/auth/config" && req.method === "GET") return false;
  if (!path.startsWith("/api/")) return false;
  if (req.headers["sec-fetch-site"] === "cross-site" || (req.headers.origin && req.headers.origin !== config.origin)) {
    res.writeHead(403); res.end(); return true;
  }
  if (path === "/api/backend/status" && req.method === "GET") {
    proxyHTTP(req, res, { ...config, timeoutMs: 10000 }, "/health"); return true;
  }
  if (!exposedRoute(req.url ?? "", req.method)) { res.writeHead(404); res.end(); return true; }
  proxyHTTP(req, res, config); return true;
}
export function hostedUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer, config: ProxyConfig) {
  if (req.headers.origin !== config.origin || !exposedRoute(req.url ?? "", req.method, true)) { rejectUpgrade(socket); return; }
  proxyUpgrade(req, socket, head, config);
}
