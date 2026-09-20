import { request as httpRequest, type IncomingMessage, type ServerResponse, type OutgoingHttpHeaders } from "node:http";
import { request as httpsRequest } from "node:https";
import type { Duplex } from "node:stream";
import { BACKEND_OFFLINE, GATEWAY_HEADER, ORIGIN_HEADER } from "../lib/deployment";

export type ProxyConfig = { target: URL; key: string; origin: string; timeoutMs?: number; publicHost?: boolean };
const blocked = new Set(["host", "connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade"]);
export function proxyHeaders(req: IncomingMessage, config: ProxyConfig, websocket = false): OutgoingHttpHeaders {
  const headers: OutgoingHttpHeaders = {};
  const extra = String(req.headers.connection ?? "").toLowerCase().split(",").map(x => x.trim());
  for (const [key, value] of Object.entries(req.headers)) {
    if (blocked.has(key) || extra.includes(key) || key.startsWith("x-forwarded-") || key.startsWith("x-quod-") || key === "forwarded" || key === "ngrok-skip-browser-warning") continue;
    headers[key] = value;
  }
  headers.host = config.publicHost ? new URL(config.origin).host : config.target.host;
  headers[GATEWAY_HEADER] = config.key;
  headers[ORIGIN_HEADER] = config.origin;
  headers["ngrok-skip-browser-warning"] = "1";
  headers["accept-encoding"] = "identity";
  if (websocket) { headers.connection = "Upgrade"; headers.upgrade = "websocket"; }
  return headers;
}
export function offline(res: ServerResponse) {
  if (res.headersSent) { res.destroy(); return; }
  res.writeHead(503, { "content-type": "application/json", "cache-control": "no-store", "retry-after": "15" });
  res.end(JSON.stringify({ error: "backend_offline", message: BACKEND_OFFLINE }));
}
function responseHeaders(upstream: IncomingMessage): OutgoingHttpHeaders {
  const headers: OutgoingHttpHeaders = {};
  const extra = String(upstream.headers.connection ?? "").toLowerCase().split(",").map(x => x.trim());
  for (const [key, value] of Object.entries(upstream.headers)) {
    if (!blocked.has(key) && !extra.includes(key) && !key.startsWith("x-quod-")) headers[key] = value;
  }
  headers["cache-control"] = "no-store";
  return headers;
}
export function proxyHTTP(req: IncomingMessage, res: ServerResponse, config: ProxyConfig, path = req.url ?? "/") {
  const target = new URL(config.target); target.pathname = "/";
  const make = target.protocol === "https:" ? httpsRequest : httpRequest;
  const upstream = make(target, { method: req.method, path, headers: proxyHeaders(req, config) });
  upstream.setTimeout(config.timeoutMs ?? 120000, () => upstream.destroy(new Error("Backend timeout")));
  upstream.on("response", reply => {
    res.writeHead(reply.statusCode ?? 502, responseHeaders(reply));
    res.flushHeaders(); // SSE progress must reach the browser without buffering.
    reply.on("error", () => res.destroy());
    reply.pipe(res);
  });
  upstream.on("error", () => offline(res));
  req.on("aborted", () => upstream.destroy());
  res.on("close", () => upstream.destroy());
  req.pipe(upstream); // Uploads/PDFs are streamed with backpressure, never buffered here.
}
export function rejectUpgrade(socket: Duplex, status = 403) {
  socket.end(`HTTP/1.1 ${status} Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}
export function proxyUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer, config: ProxyConfig) {
  socket.on("error", () => socket.destroy());
  const make = config.target.protocol === "https:" ? httpsRequest : httpRequest;
  const upstream = make(config.target, { method: "GET", path: req.url, headers: proxyHeaders(req, config, true) });
  const timeout = setTimeout(() => upstream.destroy(new Error("Upgrade timeout")), config.timeoutMs ?? 15000);
  upstream.on("upgrade", (reply, peer, peerHead) => {
    clearTimeout(timeout);
    const headers = responseHeaders(reply);
    headers.connection = "Upgrade"; headers.upgrade = "websocket";
    const lines = Object.entries(headers).flatMap(([key, value]) => value === undefined ? [] : (Array.isArray(value) ? value : [value]).map(item => `${key}: ${item}`));
    socket.write(`HTTP/1.1 101 Switching Protocols\r\n${lines.join("\r\n")}\r\n\r\n`);
    if (peerHead.length) socket.write(peerHead);
    if (head.length) peer.write(head);
    peer.on("error", () => socket.destroy()); socket.on("error", () => peer.destroy());
    peer.on("close", () => socket.destroy()); socket.on("close", () => peer.destroy());
    peer.pipe(socket); socket.pipe(peer);
  });
  upstream.on("response", reply => { clearTimeout(timeout); reply.resume(); rejectUpgrade(socket, reply.statusCode ?? 502); });
  upstream.on("error", () => { clearTimeout(timeout); rejectUpgrade(socket, 503); });
  socket.on("close", () => { clearTimeout(timeout); upstream.destroy(); });
  upstream.end();
}
