"use client";
import { useEffect, useRef, useState } from "react";
import { BrowserVoiceCompanion } from "@quod/intel/voice/client";
import type { Node } from "@quod/contracts";

export function VoiceControl({ docId, page, nodes, onJump }: { docId: string; page: number; nodes: Node[]; onJump: (doc: string, page: number, node: string) => void }) {
  const [available, setAvailable] = useState(false);
  const [mode, setMode] = useState<"idle" | "starting" | "listening" | "answering">("idle");
  const [transcript, setTranscript] = useState("");
  const [answer, setAnswer] = useState("");
  const [citations, setCitations] = useState<string[]>([]);
  const [error, setError] = useState("");
  const client = useRef<BrowserVoiceCompanion | undefined>(undefined);
  const generation = useRef(0);
  const limit = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const held = useRef(false);
  const currentPage = useRef({ docId, page, nodes });
  currentPage.current = { docId, page, nodes };
  useEffect(() => {
    const abort = new AbortController();
    fetch("/api/intel/voice/status", { signal: abort.signal }).then(async response => {
      if (response.ok) setAvailable((await response.json()).available === true);
    }).catch(() => {});
    return () => abort.abort();
  }, []);
  useEffect(() => {
    client.current = new BrowserVoiceCompanion(() => {
      const { docId, page, nodes } = currentPage.current;
      const paper = document.querySelector<HTMLElement>(".pdf-page");
      const scroll = document.querySelector<HTMLElement>(".pdf-scroll");
      const bounds = paper?.getBoundingClientRect();
      const view = scroll?.getBoundingClientRect();
      const scale = bounds && paper ? bounds.width / Number(paper.dataset.pageWidth) : 0;
      const visible = bounds && view && scale > 0 ? nodes.filter(node => {
        const [x0, y0, x1, y1] = node.bbox;
        return Math.min(bounds.right, bounds.left + x1 * scale, view.right, innerWidth) > Math.max(bounds.left + x0 * scale, view.left, 0)
          && Math.min(bounds.bottom, bounds.top + y1 * scale, view.bottom, innerHeight) > Math.max(bounds.top + y0 * scale, view.top, 0);
      }) : [];
      return { doc_id: docId, page, visible_node_ids: visible.slice(0, 20).map(node => node.id) };
    }, setTranscript, undefined, result => { setAnswer(result.answer); setCitations(result.citations); });
    setMode("idle"); setAnswer(""); setCitations([]); setTranscript(""); setError("");
    return () => {
      generation.current++; held.current = false;
      clearTimeout(limit.current); client.current?.cancel();
    };
  }, [docId, page]);
  const stop = async () => {
    if (!held.current) return;
    held.current = false;
    clearTimeout(limit.current);
    const current = generation.current;
    setMode("answering");
    try {
      const result = await client.current?.stop();
      if (generation.current === current) {
        setAnswer(result?.answer ?? "");
        setCitations(result?.citations ?? []);
        if (!result) setError("No speech captured. Hold the button while asking a question.");
      }
    } catch (cause) {
      if (generation.current === current) setError(cause instanceof Error ? cause.message : "Voice is unavailable.");
    } finally { if (generation.current === current) setMode("idle"); }
  };
  const start = async () => {
    if (held.current || !available || !nodes.length) return;
    const current = ++generation.current;
    held.current = true;
    setMode("starting"); setTranscript(""); setAnswer(""); setCitations([]); setError("");
    try {
      await client.current?.start();
      if (generation.current !== current || !held.current) return;
      setMode("listening");
      limit.current = setTimeout(() => { void stop(); }, 29000);
    } catch (cause) {
      if (generation.current === current) {
        held.current = false; setMode("idle");
        setError(cause instanceof Error ? cause.message : "Microphone unavailable.");
      }
    }
  };
  return <div className="voice-control">
    <button disabled={!available || !nodes.length} aria-label="Hold to ask about this page"
      aria-pressed={held.current} title={available ? "Hold to speak; release for an answer" : "Voice is unavailable in this workspace"}
      onPointerDown={event => { if (event.button !== 0) return; event.currentTarget.setPointerCapture(event.pointerId); void start(); }}
      onPointerUp={() => { void stop(); }} onPointerCancel={() => { void stop(); }}
      onKeyDown={event => { if ([" ", "Enter"].includes(event.key)) { event.preventDefault(); if (!event.repeat) void start(); } }}
      onKeyUp={event => { if ([" ", "Enter"].includes(event.key)) { event.preventDefault(); void stop(); } }}
      onBlur={() => { void stop(); }}>
      <i aria-hidden="true" />{mode === "listening" ? "Listening… release to answer" : mode === "starting" ? "Opening microphone…"
        : mode === "answering" ? "Answering… hold to interrupt" : "Hold to ask aloud"}
    </button>
    {(transcript || answer || error) && <div className="voice-feedback" role="status" aria-live="polite">
      <button className="voice-dismiss" aria-label="Dismiss voice response" onClick={() => {
        generation.current++; held.current = false; clearTimeout(limit.current); client.current?.cancel();
        setMode("idle"); setAnswer(""); setCitations([]); setTranscript(""); setError("");
      }}>×</button>
      {transcript && <p className="muted">{transcript}</p>}
      {answer && <p>{answer}</p>}
      {citations.map(id => nodes.find(node => node.id === id)).filter(node => node !== undefined).map(node =>
        <button key={node.id} onClick={() => onJump(node.doc_id, node.page, node.id)}>{node.label ?? node.title ?? "View source"}</button>)}
      {error && <p className="voice-error">{error}</p>}
    </div>}
  </div>;
}
