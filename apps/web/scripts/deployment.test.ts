import test from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { createRequire } from "node:module";
import { once } from "node:events";
import { createGateway } from "./tunnel-gateway";
import { hostedRequest, hostedUpgrade } from "./hosted-handler";
import { exposedRoute, GATEWAY_HEADER, ORIGIN_HEADER } from "../lib/deployment";
import { sameOrigin } from "../lib/http";
import { sessionCookie } from "../lib/auth";
const key = "a".repeat(64), id = "00000000-0000-4000-8000-000000000001";
async function listen(server: Server) {
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}
async function close(server: Server) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }

test("worker routes and encoded paths are never publicly exposed", () => {
  for (const path of ["/api/intel/bake", "/api/intel/resolve", "/api/%69ntel/bake", "/api/corpus/../intel/bake", "//api/library", "/api/library/", "/api/library%3f"]) assert.equal(exposedRoute(path, "POST"), false);
  assert.equal(exposedRoute("/api/library", "POST"), false);
  assert.equal(exposedRoute(`/api/doc/${id}/pdf?download=1`), true);
});
test("forwarded origins are trusted only with the secret, and HTTPS cookies stay secure", () => {
  const previous = process.env.QUOD_GATEWAY_SECRET; process.env.QUOD_GATEWAY_SECRET = key;
  try {
    const headers = { host: "127.0.0.1:3003", origin: "https://quod.example", [ORIGIN_HEADER]: "https://quod.example" };
    assert.equal(sameOrigin(new Request("http://127.0.0.1:3003/api/auth/session", { headers })), false);
    const req = new Request("http://127.0.0.1:3003/api/auth/session", { headers: { ...headers, [GATEWAY_HEADER]: key } });
    assert.equal(sameOrigin(req), true);
    assert.match(sessionCookie(req, "token"), /; Secure$/);
  } finally { if (previous === undefined) delete process.env.QUOD_GATEWAY_SECRET; else process.env.QUOD_GATEWAY_SECRET = previous; }
});
test("two-hop proxy preserves auth, uploads, PDF ranges, SSE, cookies, WebSockets and offline responses", { timeout: 20000 }, async () => {
  const { WebSocket, WebSocketServer } = createRequire(require.resolve("@quod/intel/voice/relay"))("ws");
  let expectedOrigin = "";
  let finishEvents: (() => void) | undefined;
  const backend = createServer(async (req, res) => {
    assert.equal(req.headers[GATEWAY_HEADER], key);
    assert.equal(req.headers[ORIGIN_HEADER], expectedOrigin);
    assert.equal(req.headers.host, new URL(expectedOrigin).host);
    if (req.url === "/health") { res.setHeader("content-type", "application/json"); res.end('{"online":true}'); return; }
    if (req.headers.authorization !== "Bearer user") { res.writeHead(401); res.end(); return; }
    if (req.url === "/api/auth/session") { res.setHeader("set-cookie", ["a=1; Path=/; HttpOnly; Secure", "b=2; Path=/; Secure"]); res.end("ok"); return; }
    if (req.url?.endsWith("/pdf")) {
      assert.equal(req.headers.range, "bytes=2-5");
      res.writeHead(206, { "content-range": "bytes 2-5/10", "content-type": "application/pdf" }); res.end("2345"); return;
    }
    if (req.url?.endsWith("/events")) {
      res.writeHead(200, { "content-type": "text/event-stream" }); res.write("data: first\n\n");
      finishEvents = () => res.end("data: done\n\n"); return;
    }
    let size = 0; for await (const chunk of req) size += chunk.length;
    res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ size }));
  });
  const wsServer = new WebSocketServer({ noServer: true });
  backend.on("upgrade", (req, socket, head) => {
    assert.equal(req.headers.host, new URL(expectedOrigin).host);
    assert.equal(req.headers.cookie, "session=test");
    wsServer.handleUpgrade(req, socket, head, (peer: any) => { peer.on("message", (data: Buffer) => peer.send(data)); });
  });
  const backendURL = await listen(backend);
  const gateway = createGateway(new URL(backendURL), key);
  const gatewayURL = await listen(gateway);
  const settings = { target: new URL(gatewayURL), key, origin: "" };
  const frontend = createServer((req, res) => { if (!hostedRequest(req, res, settings)) res.end("Quod homepage"); });
  frontend.on("upgrade", (req, socket, head) => hostedUpgrade(req, socket, head, settings));
  const frontURL = await listen(frontend); settings.origin = expectedOrigin = frontURL;
  const headers = { authorization: "Bearer user", origin: frontURL };
  try {
    assert.equal((await fetch(`${gatewayURL}/api/library`)).status, 401);
    const gatewayHeaders = { [GATEWAY_HEADER]: key, [ORIGIN_HEADER]: frontURL };
    assert.equal((await fetch(`${gatewayURL}/api/intel/resolve`, { method: "POST", headers: gatewayHeaders })).status, 404);
    assert.equal((await fetch(`${frontURL}/api/intel/bake`, { method: "POST", headers })).status, 404);
    assert.equal((await fetch(`${frontURL}/api/library`)).status, 401, "gateway does not bypass user authentication");
    assert.equal((await fetch(`${frontURL}/api/corpus`, { method: "POST", headers: { ...headers, origin: "https://evil.example" } })).status, 403);
    const auth = await fetch(`${frontURL}/api/auth/session`, { method: "POST", headers });
    assert.equal(auth.headers.getSetCookie().length, 2);
    assert.match(auth.headers.getSetCookie()[0], /Secure/);
    const pdf = await fetch(`${frontURL}/api/doc/${id}/pdf`, { headers: { ...headers, range: "bytes=2-5", [GATEWAY_HEADER]: "forged", [ORIGIN_HEADER]: "https://evil.example" } });
    assert.equal(pdf.status, 206); assert.equal(await pdf.text(), "2345");
    assert.equal(pdf.headers.get("content-range"), "bytes 2-5/10");
    const upload = await fetch(`${frontURL}/api/corpus/${id}/docs`, { method: "POST", headers, body: Buffer.alloc(1024 * 1024, 7) });
    assert.deepEqual(await upload.json(), { size: 1024 * 1024 });
    const events = await fetch(`${frontURL}/api/corpus/${id}/events`, { headers });
    const reader = events.body!.getReader();
    const first = await reader.read(); assert.match(new TextDecoder().decode(first.value), /first/);
    assert.equal(first.done, false, "first progress event arrives before stream closes");
    finishEvents!(); while (!(await reader.read()).done) { /* drain */ }
    const client = new WebSocket(frontURL.replace("http:", "ws:") + "/api/intel/voice/stream", { origin: frontURL, headers: { cookie: "session=test" } });
    await once(client, "open"); client.send("voice-test");
    const [echo] = await once(client, "message"); assert.equal(String(echo), "voice-test");
    client.close(); await once(client, "close");
    const health = await fetch(`${frontURL}/api/backend/status`); assert.deepEqual(await health.json(), { online: true });
    await close(backend);
    assert.equal((await fetch(`${frontURL}/health`)).status, 200);
    assert.equal(await (await fetch(`${frontURL}/`)).text(), "Quod homepage");
    const offline = await fetch(`${frontURL}/api/library`, { headers });
    assert.equal(offline.status, 503); assert.equal((await offline.json()).error, "backend_offline");
  } finally { wsServer.close(); await close(frontend); await close(gateway); if (backend.listening) await close(backend); }
});
