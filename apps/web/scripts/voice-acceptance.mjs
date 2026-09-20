import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
const base = process.env.QUOD_BASE_URL ?? process.env.CAIRN_BASE_URL ?? "http://127.0.0.1:3004";
const browser = await chromium.launch({ channel: "chrome", args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });
const context = await browser.newContext({ permissions: ["microphone"], viewport: { width: 1280, height: 800 } });
const page = await context.newPage();
const errors = [], sockets = [], questions = [];
page.on("pageerror", error => errors.push(error.message));
await page.addInitScript(() => {
  window.__microphones = [];
  window.__audios = [];
  window.__playbackStarts = 0;
  const OriginalAudio = window.Audio;
  window.Audio = function(...args) {
    const audio = new OriginalAudio(...args); window.__audios.push(audio);
    audio.addEventListener("playing", () => { window.__playbackStarts++; }); return audio;
  };
  window.Audio.prototype = OriginalAudio.prototype;
  const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = async options => {
    const stream = await original(options); window.__microphones.push(...stream.getTracks()); return stream;
  };
});
// Actual browser microphone, AudioWorklet and playback; provider transport is controlled.
await page.route("**/api/intel/voice/status", route => route.fulfill({ json: { available: true } }));
await page.routeWebSocket("**/api/intel/voice/stream**", socket => {
  const viewport = JSON.parse(new URL(socket.url()).searchParams.get("viewport"));
  const state = { viewport, bytes: 0, chunks: 0, closed: false }; sockets.push(state);
  socket.onMessage(message => {
    if (typeof message !== "string") { state.bytes += message.length; state.chunks++; assert.equal(message.length % 2, 0); }
    else {
      assert.deepEqual(JSON.parse(message), { type: "CloseStream" });
      socket.send(JSON.stringify({ type: "Results", is_final: true, start: 0, channel: { alternatives: [{ transcript: "Explain this result." }] } }));
      setTimeout(() => socket.close(), 50);
    }
  });
  socket.onClose(() => { state.closed = true; });
  socket.send(JSON.stringify({ type: "Ready" }));
});
await page.route("**/api/intel/voice/answer", async route => {
  const question = route.request().postDataJSON(); questions.push(question);
  await route.fulfill({ json: { answer: "Use the hypotheses of the visible theorem.", citations: [question.visible_node_ids[0]] } });
});
const wav = Buffer.alloc(44 + 3200);
wav.write("RIFF"); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8); wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28);
wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(3200, 40);
const mp3 = process.argv.includes("--mp3") ? await readFile("../../.cairn-sessions/current-browser/live-question.mp3") : undefined;
await page.route("**/api/intel/voice/speak", route => route.fulfill({ contentType: mp3 ? "audio/mpeg" : "audio/wav", body: mp3 ?? wav }));
try {
  const library = await (await page.request.get(base + "/api/library")).json();
  const doc = library.docs.find(doc => doc.id.startsWith("b000"));
  await page.goto(`${base}/read/${doc.id}?page=1`);
  await page.locator('.pdf-page[data-loading="false"]').waitFor();
  const button = page.getByRole("button", { name: "Hold to ask about this page" });
  await button.focus(); await page.keyboard.down("Space");
  await page.getByText("Listening… release to answer", { exact: true }).waitFor();
  await page.waitForTimeout(700); await page.keyboard.up("Space");
  await page.getByText("Use the hypotheses of the visible theorem.", { exact: true }).waitFor();
  await page.waitForFunction(() => window.__playbackStarts > 0);
  assert(sockets[0].bytes > 0 && sockets[0].bytes <= 960000);
  assert.equal(questions[0].question, "Explain this result.");
  assert.equal(questions[0].doc_id, doc.id);
  assert(questions[0].visible_node_ids.length > 0);
  assert(await page.evaluate(() => window.__microphones.every(track => track.readyState === "ended")));
  // Navigation while capturing cancels the microphone and cannot submit a stale question.
  await button.focus(); await page.keyboard.down("Space");
  await page.getByText("Listening… release to answer", { exact: true }).waitFor();
  assert(await page.evaluate(() => window.__audios.every(audio => audio.paused)));
  await page.getByRole("spinbutton", { name: "Page number" }).fill("2");
  await page.keyboard.up("Space");
  await page.waitForTimeout(400);
  assert.equal(questions.length, 1);
  assert(await page.evaluate(() => window.__microphones.every(track => track.readyState === "ended")));
  assert.deepEqual(errors, []);
  const result = { provider: "controlled; no paid calls", pcmBytes: sockets[0].bytes, pcmChunks: sockets[0].chunks,
    viewport: questions[0], playback: "pass", format: mp3 ? "streaming MP3" : "WAV blob fallback", navigationCancellation: "pass", runtimeErrors: errors };
  await mkdir("../../.cairn-sessions/current-browser", { recursive: true });
  await writeFile(`../../.cairn-sessions/current-browser/voice${mp3 ? "-streaming" : ""}-results.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally { await browser.close(); }
