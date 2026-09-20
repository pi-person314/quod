import assert from "node:assert/strict";
import test from "node:test";
import { BrowserVoiceCompanion } from "../voice/client";

const viewport = () => ({ doc_id: "document", page: 1, visible_node_ids: ["node"] });

test("release before microphone permission resolves stops late tracks without contacting a provider", async (t) => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  let release!: (stream: MediaStream) => void;
  let stopped = 0;
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { mediaDevices: {
    getUserMedia: async () => new Promise<MediaStream>((resolve) => { release = resolve; }),
  } } });
  t.mock.method(globalThis, "fetch", async () => assert.fail("cancelled recording must not mint a token"));
  try {
    const client = new BrowserVoiceCompanion(viewport);
    const starting = client.start();
    assert.equal(await client.stop(), undefined);
    release({ getTracks: () => [{ stop: () => { stopped++; } }] } as unknown as MediaStream);
    await starting;
    assert.equal(stopped, 1);
  } finally {
    if (original) Object.defineProperty(globalThis, "navigator", original);
    else Reflect.deleteProperty(globalThis, "navigator");
  }
});

test("unavailable speech endpoint releases the microphone", async (t) => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  let stopped = 0;
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { mediaDevices: {
    getUserMedia: async () => ({ getTracks: () => [{ stop: () => { stopped++; } }] }),
  } } });
  t.mock.method(globalThis, "fetch", async () => new Response(null, { status: 503 }));
  try {
    const client = new BrowserVoiceCompanion(viewport);
    await assert.rejects(client.start(), /unavailable/);
    assert.equal(stopped, 1);
  } finally {
    if (original) Object.defineProperty(globalThis, "navigator", original);
    else Reflect.deleteProperty(globalThis, "navigator");
  }
});

test("a delayed old stop cannot shut down the next recording's microphone", async (t) => {
  const originals = new Map(["navigator", "WebSocket", "location"].map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const stopped = [0, 0];
  let streamIndex = 0;
  const stopEvents: (() => void)[] = [];
  class Socket extends EventTarget {
    static OPEN = 1;
    readyState = 1;
    constructor(url: URL) {
      super(); assert.equal(url.origin, "ws://localhost:3003");
      queueMicrotask(() => this.dispatchEvent(new MessageEvent("message", { data: '{"type":"Ready"}' })));
    }
    close() { this.readyState = 3; this.dispatchEvent(new Event("close")); }
    send() {}
  }
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { mediaDevices: {
    getUserMedia: async () => {
      const index = streamIndex++;
      return { getTracks: () => [{ stop: () => { stopped[index]++; } }] };
    },
  } } });
  Object.defineProperty(globalThis, "WebSocket", { configurable: true, value: Socket });
  Object.defineProperty(globalThis, "location", { configurable: true, value: { href: "http://localhost:3003", protocol: "http:" } });
  t.mock.method(globalThis, "fetch", async () => Response.json({ available: true }));
  const client = new BrowserVoiceCompanion(viewport, () => {}, async () => ({
    stop: async () => new Promise<void>(resolve => stopEvents.push(resolve)), cancel: () => {},
  }));
  try {
    await client.start();
    const oldStop = client.stop();
    await client.start();
    stopEvents[0]();
    await oldStop;
    assert.equal(stopped[1], 0, "the second microphone must remain active");
  } finally {
    client.cancel();
    for (const [name, original] of originals) {
      if (original) Object.defineProperty(globalThis, name, original);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
});
