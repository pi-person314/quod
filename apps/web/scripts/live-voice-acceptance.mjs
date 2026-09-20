// Explicit live test, through the user's already-configured HTTP/WebSocket server.
// No credential-file reads. Input speech was synthesized by the same speech route.
import { chromium } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import ts from "typescript";
if (!process.argv.includes("--live")) throw new Error("Pass --live to authorize provider-backed verification");
const base = process.env.CAIRN_BASE_URL ?? "http://127.0.0.1:3003";
const library = await (await fetch(base + "/api/library")).json();
const node = library.nodes.find(node => node.kind === "theorem"); assert(node);
const viewport = { doc_id: node.doc_id, page: node.page, visible_node_ids: [node.id] };
const speech = await readFile("../../.cairn-sessions/current-browser/live-question.mp3");
const browser = await chromium.launch({ channel: "chrome" });
try {
  const page = await browser.newPage(); await page.goto(base);
  await page.mouse.click(20, 20);
  const playback = ts.transpileModule(await readFile("../../packages/intel/voice/playback.ts", "utf8"),
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
  await page.addScriptTag({ type: "module", content: playback + "\nwindow.cairnPlayback = playSpeechResponse;" });
  await page.waitForFunction(() => typeof window.cairnPlayback === "function");
  const recognition = await page.evaluate(async ({ speech, viewport }) => {
    const context = new AudioContext();
    const decoded = await context.decodeAudioData(new Uint8Array(speech).buffer);
    await context.close();
    const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * 16000), 16000);
    const source = offline.createBufferSource(); source.buffer = decoded; source.connect(offline.destination); source.start();
    const audio = (await offline.startRendering()).getChannelData(0);
    const pcm = new ArrayBuffer(audio.length * 2), view = new DataView(pcm);
    audio.forEach((value, i) => view.setInt16(i * 2, Math.round(Math.max(-1, Math.min(1, value)) * (value < 0 ? 32768 : 32767)), true));
    const url = new URL("/api/intel/voice/stream", location.href); url.protocol = "ws:";
    url.searchParams.set("viewport", JSON.stringify(viewport));
    return await new Promise((resolve, reject) => {
      const socket = new WebSocket(url), parts = new Map(); let started = false;
      const timer = setTimeout(() => { socket.close(); reject(new Error("Live recognition timeout")); }, 25000);
      socket.onmessage = async event => {
        const result = JSON.parse(event.data);
        if (result.type === "Error") { clearTimeout(timer); socket.close(); reject(new Error(result.message)); }
        if (result.type === "Results" && result.is_final) parts.set(result.start, result.channel.alternatives[0].transcript);
        if (result.type === "Ready" && !started) {
          started = true;
          for (let offset = 0; offset < pcm.byteLength; offset += 6400) {
            if (socket.readyState !== WebSocket.OPEN) break;
            socket.send(pcm.slice(offset, offset + 6400)); await new Promise(resolve => setTimeout(resolve, 200));
          }
          if (socket.readyState === WebSocket.OPEN) { window.cairnReleasedAt = performance.now(); socket.send('{"type":"CloseStream"}'); }
        }
      };
      socket.onerror = () => { clearTimeout(timer); reject(new Error("Live recognition transport failed")); };
      socket.onclose = () => { clearTimeout(timer); resolve({ question: [...parts].sort(([a], [b]) => a - b).map(([, text]) => text).join(" "), audioBytes: pcm.byteLength }); };
    });
  }, { speech: [...speech], viewport });
  assert.match(recognition.question, /theorem/i);
  const spoken = await page.evaluate(async ({ viewport, question }) => {
    const started = window.cairnReleasedAt; let speechOnsetMs;
    const answerResponse = await fetch("/api/intel/voice/answer", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...viewport, question }) });
    if (!answerResponse.ok) throw new Error(`Answer failed (${answerResponse.status})`);
    const answer = await answerResponse.json(); const answerMs = performance.now() - started;
    const response = await fetch("/api/intel/voice/speak", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ doc_id: viewport.doc_id, text: answer.answer }) });
    if (!response.ok) throw new Error(`Synthesis failed (${response.status})`);
    await window.cairnPlayback(response, new AbortController().signal, audio => {
      audio.addEventListener("playing", () => { speechOnsetMs ??= performance.now() - started; }); return () => {};
    });
    return { answer, answerMs, speechOnsetMs, totalPlaybackMs: performance.now() - started };
  }, { viewport, question: recognition.question });
  assert(spoken.answer.citations.every(id => viewport.visible_node_ids.includes(id)));
  assert(spoken.speechOnsetMs > 0);
  const result = { recognition, ...spoken, providers: "live", timing: "recording release to first audible playback; includes final recognition" };
  await writeFile("../../.cairn-sessions/current-browser/live-voice-streaming-results.json", JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally { await browser.close(); }
