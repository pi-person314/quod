import { createServer, type IncomingMessage } from "node:http";
import { authorizedGateway, exposedRoute, GATEWAY_HEADER, ORIGIN_HEADER, validOrigin } from "../lib/deployment";
import { proxyHTTP, proxyUpgrade, rejectUpgrade, type ProxyConfig } from "./stream-proxy";

export function createGateway(target: URL, key: string) {
  if (target.protocol !== "http:" || target.hostname !== "127.0.0.1" || target.pathname !== "/") throw new Error("Gateway target must be the loopback backend.");
  function config(req: IncomingMessage): ProxyConfig | undefined {
    if (!authorizedGateway(String(req.headers[GATEWAY_HEADER] ?? ""), key)) return;
    try {
      const origin = validOrigin(String(req.headers[ORIGIN_HEADER] ?? ""));
      if (req.headers.origin && req.headers.origin !== origin) return;
      return { target, key, origin, publicHost: true };
    } catch { return; }
  }
  const server = createServer((req, res) => {
    const settings = config(req);
    if (!settings) { res.writeHead(401); res.end(); return; }
    if (!exposedRoute(req.url ?? "", req.method)) { res.writeHead(404); res.end(); return; }
    proxyHTTP(req, res, settings);
  });
  server.on("upgrade", (req, socket, head) => {
    const settings = config(req);
    if (!settings || !req.headers.origin || !exposedRoute(req.url ?? "", req.method, true)) { rejectUpgrade(socket); return; }
    proxyUpgrade(req, socket, head, settings);
  });
  return server;
}
