import assert from "node:assert/strict";
import WebSocket from "ws";
const base = process.env.CAIRN_BASE_URL ?? "http://127.0.0.1:3004";
const data = await (await fetch(base + "/api/library")).json();
const node = data.nodes[0];
const url = new URL("/api/intel/voice/stream", base); url.protocol = "ws:";
url.searchParams.set("viewport", JSON.stringify({ doc_id: node.doc_id, page: node.page, visible_node_ids: [node.id] }));
assert.equal((await (await fetch(base + "/api/intel/voice/status")).json()).available, false);
await new Promise<void>((resolve, reject) => {
  const socket = new WebSocket(url, { origin: "http://different.invalid", handshakeTimeout: 5000 });
  socket.on("unexpected-response", (_, response) => { assert.equal(response.statusCode, 403); response.resume(); socket.terminate(); resolve(); });
  socket.on("open", () => reject(new Error("cross-origin stream accepted")));
  socket.on("error", () => {});
});
await new Promise<void>((resolve, reject) => {
  const socket = new WebSocket(url, { origin: base, handshakeTimeout: 5000 });
  let denied = false;
  socket.on("message", data => { const result = JSON.parse(data.toString()); assert.equal(result.type, "Error"); denied = true; });
  socket.on("close", () => { try { assert(denied); resolve(); } catch (error) { reject(error); } });
  socket.on("error", reject);
});
console.log("Actual Next/WebSocket transport: cross-origin rejected; disabled live speech fails closed.");
