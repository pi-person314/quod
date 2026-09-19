"use client";
import { VoiceTurn, type SpokenAnswer } from "./turn";

export interface VoiceViewport { doc_id: string; page: number; visible_node_ids: string[] }

/** B binds start/stop to push-to-talk and calls cancel on navigation/unmount. */
export class BrowserVoiceCompanion {
  private generation = 0;
  private recording?: MediaRecorder;
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
  private turn: VoiceTurn;

  constructor(private readonly getViewport: () => VoiceViewport, private readonly onTranscript: (text: string) => void = () => {}) {
    this.turn = new VoiceTurn({
      stopPlayback: () => this.stopPlayback(),
      answer: async (question, signal) => {
        if (!this.viewport) throw new Error("No visible page");
        const response = await fetch("/api/intel/voice/answer", { method: "POST", signal,
          headers: { "content-type": "application/json" }, body: JSON.stringify({ ...this.viewport, question }) });
        if (!response.ok) throw new Error("Voice answer unavailable");
        const result = await response.json() as SpokenAnswer;
        if (typeof result.answer !== "string" || !Array.isArray(result.citations)) throw new Error("Invalid voice response");
        return result;
      },
      speak: async (text, signal) => {
        const response = await fetch("/api/intel/voice/speak", { method: "POST", signal,
          headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) });
        if (!response.ok) throw new Error("Speech playback unavailable");
        const blob = await response.blob();
        signal.throwIfAborted();
        const objectUrl = URL.createObjectURL(blob);
        const audio = new Audio(objectUrl);
        this.audioUrl = objectUrl;
        this.audio = audio;
        await new Promise<void>((resolve, reject) => {
          const abort = () => { audio.pause(); resolve(); };
          const clean = () => signal.removeEventListener("abort", abort);
          signal.addEventListener("abort", abort, { once: true });
          audio.onended = () => { clean(); resolve(); };
          audio.onerror = () => { clean(); reject(new Error("Audio playback failed")); };
          void audio.play().catch((error) => { clean(); reject(error); });
        }).finally(() => {
          URL.revokeObjectURL(objectUrl);
          if (this.audio === audio) { this.audio = undefined; this.audioUrl = undefined; }
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
    if (this.recording && this.recording.state !== "inactive") this.recording.stop();
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
      const response = await fetch("/api/intel/voice/token", { method: "POST", signal: setupAbort.signal });
      if (!response.ok) throw new Error("Speech recognition unavailable");
      const token = await response.json() as { access_token: string };
      if (generation !== this.generation) return;
      if (typeof token.access_token !== "string" || !token.access_token) throw new Error("Invalid voice token");
      // Deepgram's official SDK maps temporary JWTs to ["bearer", token] protocols.
      const socket = new WebSocket("wss://api.deepgram.com/v1/listen?model=nova-3&smart_format=true&interim_results=true&endpointing=300", ["bearer", token.access_token]);
      this.socket = socket;
      let resolveClosed!: () => void;
      this.closed = new Promise((resolve) => { resolveClosed = resolve; });
      this.closedResolve = resolveClosed;
      socket.addEventListener("close", () => { resolveClosed(); microphone.getTracks().forEach((track) => track.stop()); });
      socket.addEventListener("message", (event) => {
        if (generation !== this.generation || typeof event.data !== "string") return;
        try {
          const result = JSON.parse(event.data);
          const transcript = result.channel?.alternatives?.[0]?.transcript;
          if (result.type !== "Results" || typeof transcript !== "string") return;
          if (result.is_final && typeof result.start === "number") this.segments.set(result.start, transcript);
          this.onTranscript(transcript);
        } catch { /* Ignore metadata/malformed provider frames, never execute them. */ }
      });
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => { socket.close(); reject(new Error("Speech connection timed out")); }, 10_000);
        socket.addEventListener("open", () => { clearTimeout(timer); resolve(); }, { once: true });
        socket.addEventListener("error", () => { clearTimeout(timer); reject(new Error("Speech connection failed")); }, { once: true });
        socket.addEventListener("close", () => { clearTimeout(timer); reject(new Error("Speech connection closed")); }, { once: true });
      });
      if (generation !== this.generation) { socket.close(); return; }
      const mimeType = ["audio/webm;codecs=opus", "audio/mp4"].find((type) => MediaRecorder.isTypeSupported(type));
      if (!mimeType) throw new Error("This browser has no supported microphone format");
      const recorder = new MediaRecorder(microphone, { mimeType });
      recorder.ondataavailable = (event) => { if (event.data.size && socket.readyState === WebSocket.OPEN) socket.send(event.data); };
      this.recording = recorder;
      recorder.start(250);
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
    if (!recorder || !socket || recorder.state === "inactive") { this.cancel(); return undefined; }
    if (this.limit) clearTimeout(this.limit);
    await new Promise<void>((resolve) => { recorder.addEventListener("stop", () => resolve(), { once: true }); recorder.stop(); });
    microphone?.getTracks().forEach((track) => track.stop());
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "CloseStream" }));
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => { socket.close(); resolve(); }, 3000);
      void closed?.then(() => { clearTimeout(timer); resolve(); });
    });
    if (generation !== this.generation) return undefined;
    const question = [...this.segments].sort(([a], [b]) => a - b).map(([, text]) => text).join(" ").trim();
    this.recording = undefined;
    this.socket = undefined;
    return this.turn.ask(question);
  }
}
