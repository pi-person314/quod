import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
const source = await readFile(new URL("../public/voice-pcm-worklet.js", import.meta.url), "utf8");
for (const sampleRate of [16000, 44100, 48000]) {
  test(`PCM worklet produces exactly one second at 16kHz from ${sampleRate}Hz`, () => {
    const messages = [];
    let Processor;
    runInNewContext(source, { sampleRate, AudioWorkletProcessor: class {
      port = { postMessage: value => messages.push(value) };
    }, registerProcessor: (_, Type) => { Processor = Type; } });
    const processor = new Processor();
    for (let offset = 0; offset < sampleRate; offset += 128)
      processor.process([[new Float32Array(Math.min(128, sampleRate - offset)).fill(-1)]]);
    processor.port.onmessage({ data: "stop" });
    assert.equal(messages.pop(), "stopped");
    assert.equal(messages.reduce((sum, buffer) => sum + buffer.byteLength, 0), 32000);
    assert(messages.every(buffer => buffer.byteLength <= 6400));
    for (const buffer of messages) {
      const bytes = new Uint8Array(buffer);
      for (let i = 0; i < bytes.length; i += 2) { assert.equal(bytes[i], 0); assert.equal(bytes[i + 1], 128); }
    }
    assert.equal(processor.process([]), false);
  });
}
