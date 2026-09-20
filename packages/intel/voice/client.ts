"use client";
import { VoiceTurn, type SpokenAnswer } from "./turn";
import { createPcmCapture, type PcmCapture } from "./capture";
import { playSpeechResponse } from "./playback";

export interface VoiceViewport { doc_id: string; page: number; visible_node_ids: string[] }

/** B binds start/stop to push-to-talk and calls cancel on navigation/unmount. */
export class BrowserVoiceCompanion {
  private generation = 0;
  private recording?: PcmCapture;
  private microphone?: MediaStream;
  private socket?: WebSocket;
  private audio?: HTMLAudioElement;
  private audioUrl?: string;
  private limit?: ReturnType<typeof setTimeout>;
  private segments = new Map<number, string>();
  private viewport?: VoiceViewport;
  private closed?: Promise<void>;
  private closedResolve?: () => void;
  private setupAbort?: AbortController;
  private failure?: Error;
  private turn: VoiceTurn;

  constructor(private readonly getViewport: () => VoiceViewport, private readonly onTranscript: (text: string) => void = () => {},
    private readonly capture: typeof createPcmCapture = createPcmCapture,
    private readonly onAnswer: (answer: SpokenAnswer) => void = () => {}) {
    this.turn = new VoiceTurn({
      stopPlayback: () => this.stopPlayback(),
      answer: async (question, signal) => {
        if (!this.viewport) throw new Error("No visible page");
        const response = await fetch("/api/intel/voice/answer", { method: "POST", signal,
          headers: { "content-type": "application/json" }, body: JSON.stringify({ ...this.viewport, question }) });
        if (!response.ok) throw new Error("Voice answer unavailable");
        const result = await response.json() as SpokenAnswer;
        if (typeof result.answer !== "string" || !Array.isArray(result.citations)) throw new Error("Invalid voice response");
        if (!signal.aborted) this.onAnswer(result);
        return result;
      },
      speak: async (text, signal) => {
        const response = await fetch("/api/intel/voice/speak", { method: "POST", signal,
          headers: { "content-type": "application/json" }, body: JSON.stringify({ text, doc_id: this.viewport?.doc_id }) });
        if (!response.ok) throw new Error("Speech playback unavailable");
        await playSpeechResponse(response, signal, (audio, url) => {
          this.audioUrl = url; this.audio = audio;
          return () => { if (this.audio === audio) { this.audio = undefined; this.audioUrl = undefined; } };
        });
      },
    });
  }

  private stopPlayback() {
    this.audio?.pause();
    if (this.audioUrl) URL.revokeObjectURL(this.audioUrl);
    this.audio = undefined;
    this.audioUrl = undefined;
  }

  cancel(): void {
    this.generation++;
    this.turn.interrupt();
    this.setupAbort?.abort();
    if (this.limit) clearTimeout(this.limit);
    this.recording?.cancel();
    this.microphone?.getTracks().forEach((track) => track.stop());
    this.socket?.close();
    this.closedResolve?.();
    this.recording = undefined;
    this.microphone = undefined;
    this.socket = undefined;
    this.segments.clear();
  }

  async start(): Promise<void> {
    this.cancel(); // Barge-in stops speech immediately, before permissions/network work.
    this.failure = undefined;
    const generation = this.generation;
    const setupAbort = new AbortController();
    this.setupAbort = setupAbort;
    const viewport = this.getViewport();
    this.viewport = { ...viewport, visible_node_ids: [...viewport.visible_node_ids] };
    if (!viewport.visible_node_ids.length) throw new Error("No visible results to ask about");
    try {
      const microphone = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (generation !== this.generation) { microphone.getTracks().forEach((track) => track.stop()); return; }
      this.microphone = microphone;
      const response = await fetch("/api/intel/voice/status", { signal: setupAbort.signal });
      if (!response.ok) throw new Error("Speech recognition unavailable");
      const status = await response.json() as { available: boolean };
      if (generation !== this.generation) return;
      if (!status.available) throw new Error("Voice is unavailable in this workspace");
      const url = new URL("/api/intel/voice/stream", location.href);
      url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
      url.searchParams.set("viewport", JSON.stringify(this.viewport));
      const socket = new WebSocket(url);
      this.socket = socket;
      let resolveClosed!: () => void;
      this.closed = new Promise((resolve) => { resolveClosed = resolve; });
      this.closedResolve = resolveClosed;
      socket.addEventListener("close", () => { resolveClosed(); microphone.getTracks().forEach((track) => track.stop()); });
      socket.addEventListener("message", (event) => {
        if (generation !== this.generation || typeof event.data !== "string") return;
        try {
          const result = JSON.parse(event.data);
          if (result.type === "Error") { this.failure = new Error(String(result.message)); return; }
          const transcript = result.channel?.alternatives?.[0]?.transcript;
          if (result.type !== "Results" || typeof transcript !== "string") return;
          if (result.is_final && typeof result.start === "number") this.segments.set(result.start, transcript);
          this.onTranscript([...this.segments].sort(([a], [b]) => a - b).map(([, text]) => text).join(" ") + (result.is_final ? "" : ` ${transcript}`));
        } catch { /* Ignore metadata/malformed provider frames, never execute them. */ }
      });
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => { socket.close(); reject(new Error("Speech connection timed out")); }, 10_000);
        socket.addEventListener("message", event => {
          try {
            const result = JSON.parse(String(event.data));
            if (result.type === "Ready") { clearTimeout(timer); resolve(); }
            if (result.type === "Error") { clearTimeout(timer); reject(new Error(result.message)); }
          } catch { /* Ignore malformed frames while waiting for the relay. */ }
        });
        socket.addEventListener("error", () => { clearTimeout(timer); reject(new Error("Speech connection failed")); }, { once: true });
        socket.addEventListener("close", () => { clearTimeout(timer); reject(new Error("Speech connection closed")); }, { once: true });
      });
      if (generation !== this.generation) { socket.close(); return; }
      const recorder = await this.capture(microphone, bytes => {
        if (generation === this.generation && socket.readyState === WebSocket.OPEN) socket.send(bytes);
      });
      if (generation !== this.generation) { recorder.cancel(); return; }
      this.recording = recorder;
      this.limit = setTimeout(() => this.cancel(), 30_000);
    } catch (error) {
      if (generation !== this.generation) return;
      this.cancel();
      throw error;
    }
  }

  async stop(): Promise<SpokenAnswer | undefined> {
    const generation = this.generation;
    const recorder = this.recording;
    const socket = this.socket;
    const microphone = this.microphone;
    const closed = this.closed;
    if (!recorder || !socket) { this.cancel(); return undefined; }
    if (this.limit) clearTimeout(this.limit);
    await recorder.stop();
    microphone?.getTracks().forEach((track) => track.stop());
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "CloseStream" }));
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => { socket.close(); resolve(); }, 3000);
      void closed?.then(() => { clearTimeout(timer); resolve(); });
    });
    if (generation !== this.generation) return undefined;
    if (this.failure) { const error = this.failure; this.cancel(); throw error; }
    const question = [...this.segments].sort(([a], [b]) => a - b).map(([, text]) => text).join(" ").trim();
    this.recording = undefined;
    this.socket = undefined;
    return this.turn.ask(question);
  }
}
