import { WebSocket, WebSocketServer } from "ws";
import type { Server, IncomingMessage } from "node:http";
import { reserveApiSpend, settleApiSpend } from "../budget";
import { logCall } from "../llm";
import { VoiceQuestion, type VoiceQuestion as Viewport } from "./server";

export const AUDIO_BYTES_PER_SECOND = 16000 * 2;
export const MAX_AUDIO_BYTES = 30 * AUDIO_BYTES_PER_SECOND;
const STT_RESERVATION_USD = 0.01;
// Conservative non-promotional PAYG estimate, checked 2026-09-19:
// https://deepgram.com/pricing (Nova-3 monolingual regular rate).
const STT_USD_PER_MINUTE = 0.0077;
export interface RelayLease { complete(seconds: number, requestId?: string): Promise<void> }
export interface RelayDependencies {
  authorize(viewport: Viewport): Promise<RelayLease>;
  open(): WebSocket;
  timeoutMs?: number;
}

/** Raw mono 16kHz PCM makes both duration and spending bounded by byte count. */
export async function relaySpeech(browser: WebSocket, viewport: Viewport, deps: RelayDependencies) {
  let provider: WebSocket | undefined;
  let bytes = 0, finished = false, settled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let drain: ReturnType<typeof setTimeout> | undefined;
  const close = (message?: string) => {
    finished = true;
    if (timer) clearTimeout(timer);
    if (drain) clearTimeout(drain);
    if (message && browser.readyState === WebSocket.OPEN) browser.send(JSON.stringify({ type: "Error", message }));
    browser.close();
    provider?.terminate();
  };
  browser.once("close", () => close());
  browser.once("error", () => close());
  try {
    const lease = await deps.authorize(viewport);
    if (finished || browser.readyState !== WebSocket.OPEN) return;
    provider = deps.open();
    timer = setTimeout(() => finalize(), deps.timeoutMs ?? 30000);
    const finalize = () => {
      if (finished) return;
      finished = true;
      if (timer) clearTimeout(timer);
      if (provider?.readyState === WebSocket.OPEN) provider.send(JSON.stringify({ type: "CloseStream" }));
      else return close("Speech connection did not become ready.");
      drain = setTimeout(() => close(), 3000);
    };
    provider.once("open", () => {
      if (finished) return close();
      browser.send(JSON.stringify({ type: "Ready" }));
    });
    provider.once("error", () => close("Speech recognition is unavailable. Please try again."));
    provider.once("close", () => close());
    provider.on("message", (data, binary) => {
      const buffer = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as ArrayBuffer);
      if (binary || buffer.byteLength > 128000) return;
      try {
        const result = JSON.parse(buffer.toString());
        if (result.type === "Results" && browser.readyState === WebSocket.OPEN) {
          const transcript = result.channel?.alternatives?.[0]?.transcript;
          if (typeof transcript === "string" && transcript.length <= 10000 && Number.isFinite(result.start))
            browser.send(JSON.stringify({ type: "Results", start: result.start, is_final: result.is_final === true,
              channel: { alternatives: [{ transcript }] } }));
        }
        if (result.type === "Metadata" && !settled && Number.isFinite(result.duration)
          && result.duration >= 0 && result.duration <= 31 && result.channels === 1) {
          settled = true;
          void lease.complete(Math.max(bytes / AUDIO_BYTES_PER_SECOND, result.duration), result.request_id)
            .catch(() => { /* Failed accounting retains the durable reservation. */ });
        }
      } catch { /* Provider metadata is data, never executable instructions. */ }
    });
    browser.on("message", (data, binary) => {
      if (finished) return;
      if (!binary) {
        if (data.toString() === '{"type":"CloseStream"}') finalize();
        else close("Invalid speech control message.");
        return;
      }
      const size = Array.isArray(data) ? data.reduce((sum, part) => sum + part.byteLength, 0) : data.byteLength;
      if (provider?.readyState !== WebSocket.OPEN || size % 2 || size > 32768 || bytes + size > MAX_AUDIO_BYTES
        || provider.bufferedAmount > 65536) return close("Recording limit reached. Try a shorter question.");
      bytes += size;
      provider.send(data, { binary: true });
      if (bytes === MAX_AUDIO_BYTES) finalize();
    });
  } catch { close("Voice is unavailable in this workspace. Please try again later."); }
}

/** Attach before Next's upgrade handler; no provider token is ever sent to the browser. */
export function attachVoiceRelay(server: Server, validateViewport: (input: Viewport, request: IncomingMessage) => Promise<{ corpusId: string; fixture: boolean }>) {
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 32768, perMessageDeflate: false });
  server.on("upgrade", (request, socket, head) => {
    const path = request.url?.split("?")[0];
    if (path !== "/api/intel/voice/stream") return;
    let viewport: Viewport;
    try {
      const origin = new URL(request.headers.origin ?? "");
      if (origin.host !== request.headers.host || !["http:", "https:"].includes(origin.protocol)
        || (request.url?.length ?? 0) > 5000) throw new Error("Invalid origin");
      viewport = VoiceQuestion.parse({ ...JSON.parse(new URL(request.url!, origin).searchParams.get("viewport") ?? "null"), question: "voice" });
    } catch { socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n"); socket.destroy(); return; }
    sockets.handleUpgrade(request, socket, head, browser => {
      void relaySpeech(browser, viewport, {
        async authorize(input) {
          const source = await validateViewport(input, request);
          if (!process.env.DEEPGRAM_API_KEY) throw new Error("Speech is not configured");
          const reservation = await reserveApiSpend(STT_RESERVATION_USD, "voice", "nova-3");
          const started = Date.now();
          return { async complete(seconds, requestId) {
            await logCall({ stage: "voice", model: "nova-3", docId: source.fixture ? undefined : input.doc_id,
              usage: { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0 },
              costUsd: seconds / 60 * STT_USD_PER_MINUTE, latencyMs: Date.now() - started,
              meta: { reservation_id: reservation, source_doc_id: input.doc_id, source_corpus_id: source.corpusId,
                request_id: requestId, audio_seconds: seconds, cost_basis: "published-rate estimate" } });
            // Keep the conservative full ceiling booked; provider invoices can reconcile it later.
            await settleApiSpend(reservation, STT_RESERVATION_USD);
          } };
        },
        open: () => new WebSocket("wss://api.deepgram.com/v1/listen?model=nova-3&language=en&encoding=linear16&sample_rate=16000&channels=1&smart_format=true&interim_results=true&endpointing=300&mip_opt_out=true", {
          headers: { Authorization: `Token ${process.env.DEEPGRAM_API_KEY}` }, handshakeTimeout: 10000, maxPayload: 128000,
        }),
      });
    });
  });
  return sockets;
}
