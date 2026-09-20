import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import type { WebSocket } from "ws";
import { relaySpeech, MAX_AUDIO_BYTES, type RelayLease } from "../voice/relay";

class Socket extends EventEmitter {
  readyState = 1;
  bufferedAmount = 0;
  sent: (string | Buffer)[] = [];
  send(value: string | Buffer) { this.sent.push(value); }
  close() { if (this.readyState === 3) return; this.readyState = 3; this.emit("close"); }
  terminate() { this.close(); }
}
const viewport = { doc_id: "document", page: 1, visible_node_ids: ["node"], question: "voice" };
const ws = (socket: Socket) => socket as unknown as WebSocket;
const tick = () => new Promise(resolve => setImmediate(resolve));

test("relay reserves before provider access, forwards bounded PCM and strips provider metadata", async () => {
  const browser = new Socket(), provider = new Socket();
  const events: string[] = [];
  await relaySpeech(ws(browser), viewport, {
    authorize: async () => { events.push("reserved"); return { complete: async seconds => { assert.equal(seconds, 1); events.push("settled"); } }; },
    open: () => { events.push("provider"); return ws(provider); },
  });
  provider.emit("open");
  browser.emit("message", Buffer.alloc(32000), true);
  provider.emit("message", Buffer.from(JSON.stringify({ type: "Results", start: 0, is_final: true, secret: "private",
    channel: { alternatives: [{ transcript: "a theorem", words: ["private"] }] } })), false);
  provider.emit("message", Buffer.from(JSON.stringify({ type: "Metadata", duration: 1, channels: 1, request_id: "request" })), false);
  await tick();
  assert.deepEqual(events, ["reserved", "provider", "settled"]);
  assert.equal((provider.sent[0] as Buffer).length, 32000);
  assert(!JSON.stringify(browser.sent).includes("private"));
  browser.close();
});

test("odd PCM, oversized chunks, backpressure and excess duration stop forwarding", async () => {
  for (const invalid of ["odd", "chunk", "buffer", "duration"]) {
    const browser = new Socket(), provider = new Socket();
    await relaySpeech(ws(browser), viewport, { authorize: async () => ({ complete: async () => assert.fail() }), open: () => ws(provider) });
    provider.emit("open");
    if (invalid === "buffer") provider.bufferedAmount = 70000;
    if (invalid === "duration") for (let bytes = 0; bytes < MAX_AUDIO_BYTES; bytes += 32000) browser.emit("message", Buffer.alloc(32000), true);
    const before = provider.sent.filter(Buffer.isBuffer).length;
    browser.emit("message", Buffer.alloc(invalid === "odd" ? 3 : invalid === "chunk" ? 40000 : 32000), true);
    assert.equal(provider.sent.filter(Buffer.isBuffer).length, before);
    browser.close();
  }
});

test("cancellation during authorization cannot open a provider connection", async () => {
  const browser = new Socket();
  let complete!: (lease: RelayLease) => void;
  const pending = relaySpeech(ws(browser), viewport, {
    authorize: () => new Promise(resolve => { complete = resolve; }), open: () => assert.fail(),
  });
  browser.close(); complete({ complete: async () => assert.fail() }); await pending;
});

test("denied budget, bad control messages and timeout cannot leave a stream running", async () => {
  const denied = new Socket();
  await relaySpeech(ws(denied), viewport, { authorize: async () => { throw new Error("budget"); }, open: () => assert.fail() });
  assert.equal(denied.readyState, 3);
  const browser = new Socket(), provider = new Socket();
  await relaySpeech(ws(browser), viewport, { authorize: async () => ({ complete: async () => {} }), open: () => ws(provider), timeoutMs: 10 });
  provider.emit("open");
  await new Promise(resolve => setTimeout(resolve, 25));
  assert(provider.sent.includes('{"type":"CloseStream"}'));
  browser.close(); assert.equal(provider.readyState, 3);
});
