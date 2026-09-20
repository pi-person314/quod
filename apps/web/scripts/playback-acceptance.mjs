import { chromium } from "@playwright/test";
import ts from "typescript";
import { readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
const live = process.argv.includes("--live");
const base = process.env.QUOD_BASE_URL ?? process.env.CAIRN_BASE_URL ?? (live ? "http://127.0.0.1:3003" : "http://127.0.0.1:3004");
const source = await readFile("../../packages/intel/voice/playback.ts", "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const browser = await chromium.launch({ channel: "chrome" });
try {
  const page = await browser.newPage(); const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(base); await page.mouse.click(20, 20);
  await page.addScriptTag({ type: "module", content: compiled + "\nwindow.cairnPlayback = playSpeechResponse;" });
  await page.waitForFunction(() => typeof window.cairnPlayback === "function");
  let result;
  if (live) {
    const data = await (await fetch(base + "/api/library")).json();
    const node = data.nodes.find(node => node.kind === "theorem"); assert(node);
    result = await page.evaluate(async node => {
      const started = performance.now(); let onsetMs;
      const response = await fetch("/api/intel/voice/answer", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ doc_id: node.doc_id, page: node.page, visible_node_ids: [node.id], question: "What was that theorem again?" }) });
      if (!response.ok) throw new Error(`Answer failed: ${response.status}`);
      const answer = await response.json(); const answerMs = performance.now() - started;
      const speech = await fetch("/api/intel/voice/speak", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: answer.answer, doc_id: node.doc_id }) });
      if (!speech.ok) throw new Error(`Speech failed: ${speech.status}`);
      await window.cairnPlayback(speech, new AbortController().signal, audio => {
        audio.addEventListener("playing", () => { onsetMs ??= performance.now() - started; }); return () => {};
      });
      return { provider: "live", answer, answerMs, speechOnsetMs: onsetMs, totalPlaybackMs: performance.now() - started };
    }, node);
    assert(result.speechOnsetMs > 0);
  } else {
    const mp3 = [...await readFile("../../.cairn-sessions/current-browser/live-question.mp3")];
    result = await page.evaluate(async bytes => {
      const split = Math.floor(bytes.length * 0.75); let streamFinished = false, playedBeforeComplete = false;
      const response = new Response(new ReadableStream({ start(controller) {
        controller.enqueue(new Uint8Array(bytes.slice(0, split)));
        setTimeout(() => { controller.enqueue(new Uint8Array(bytes.slice(split))); streamFinished = true; controller.close(); }, 1500);
      } }), { headers: { "content-type": "audio/mpeg" } });
      await window.cairnPlayback(response, new AbortController().signal, audio => {
        audio.addEventListener("playing", () => { playedBeforeComplete ||= !streamFinished; }); return () => {};
      });
      const abort = new AbortController(); let cancelled = false, stopped;
      const pending = new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(bytes.slice(0, split))); }, cancel() { cancelled = true; } }), { headers: { "content-type": "audio/mpeg" } });
      try { await window.cairnPlayback(pending, abort.signal, audio => {
        audio.addEventListener("playing", () => abort.abort()); return () => { stopped = audio.paused; };
      }); } catch (error) { if (error.name !== "AbortError") throw error; }
      return { provider: "controlled stream", playedBeforeComplete, cancelled, stopped };
    }, mp3);
    assert(result.playedBeforeComplete); assert(result.cancelled); assert(result.stopped);
  }
  assert.deepEqual(errors, []);
  await writeFile(`../../.cairn-sessions/current-browser/playback${live ? "-live" : ""}-results.json`, JSON.stringify({ ...result, runtimeErrors: errors }, null, 2));
  console.log(JSON.stringify(result));
} finally { await browser.close(); }
