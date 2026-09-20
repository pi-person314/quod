"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { IngestEvent, type NodeSummary } from "@cairn/contracts";
import { pdfjs } from "./pdf-page";
interface Column {
  id: string;
  name: string;
  stage: string;
  nodes: NodeSummary[];
  message?: string;
}
export function Upload() {
  const [drag, setDrag] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [columns, setColumns] = useState<Column[]>([]),
    [finished, setFinished] = useState(false);
  const input = useRef<HTMLInputElement>(null),
    source = useRef<EventSource | null>(null);
  const [corpus, setCorpus] = useState("");
  useEffect(() => () => source.current?.close(), []);
  const upload = async (files: File[]) => {
    setError("");
    setFinished(false);
    if (!files.length) return;
    if (files.length > 20 || files.some((f) => f.size > 50 * 1024 * 1024)) {
      setError("Choose up to 20 PDFs, each smaller than 50 MB.");
      return;
    }
    if (files.some((f) => !f.name.toLowerCase().endsWith(".pdf"))) {
      setError("Please choose PDF documents. Other formats are not supported.");
      return;
    }
    setBusy(true);
    setColumns(
      files.map((f, i) => ({
        id: String(i),
        name: f.name,
        stage: "reading",
        nodes: [],
      })),
    );
    try {
      const lib = await pdfjs();
      const metadata: {
        pages: number;
        nodes: {
          label: string;
          title: string;
          statement: string;
          page: number;
          bbox: number[];
        }[];
        error?: string;
      }[] = [];
      for (const file of files) {
        const nodes = [];
        let pages = 0,
          characters = 0,
          parseError = "";
        try {
          const task = lib.getDocument({
            data: new Uint8Array(await file.arrayBuffer()),
          });
          const pdf = await task.promise;
          pages = pdf.numPages;
          for (let page = 1; page <= pages; page++) {
            const p = await pdf.getPage(page),
              viewport = p.getViewport({ scale: 1, rotation: 0 }),
              content = await p.getTextContent();
            const items = content.items.filter(
              (i): i is import("pdfjs-dist/types/src/display/api").TextItem =>
                "str" in i,
            );
            characters += items.reduce((sum, i) => sum + i.str.length, 0);
            for (let j = 0; j < items.length; j++) {
              const item = items[j];
              const match = item.str.match(
                /^\s*(Definition|Theorem|Lemma|Proposition|Corollary|Example|Notation|Proof|Problem)\s+(\d+(?:\.\d+)*)\.?\s*(.*)/i,
              );
              if (match) {
                const [x, y] = viewport.convertToViewportPoint(
                  item.transform[4],
                  item.transform[5],
                );
                nodes.push({
                  label: `${match[1]} ${match[2]}`,
                  title: match[3].trim(),
                  statement: items
                    .slice(j + 1, j + 5)
                    .map((i) => i.str)
                    .join(" "),
                  page,
                  bbox: [x, y - item.height, x + item.width, y],
                });
              }
            }
          }
          if (characters < 30)
            parseError = "Unsupported PDF (scanned or no text layer)";
          await task.destroy();
        } catch {
          parseError = "Unsupported PDF (encrypted or unreadable)";
        }
        metadata.push({ pages, nodes, error: parseError || undefined });
      }
      const create = await fetch("/api/corpus", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name:
            files.length === 1
              ? files[0].name.replace(/\.pdf$/i, "")
              : "New course corpus",
        }),
      });
      if (!create.ok) throw new Error("Could not create the corpus.");
      const { corpus_id } = await create.json();
      setCorpus(corpus_id);
      const form = new FormData();
      files.forEach((f) => form.append("files", f));
      form.append("metadata", JSON.stringify(metadata));
      const res = await fetch(`/api/corpus/${corpus_id}/docs`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message ?? "Upload failed. Please try again.");
      }
      const { doc_ids } = await res.json();
      setColumns(
        files.map((f, i) => ({
          id: doc_ids[i],
          name: f.name,
          stage: "queued",
          nodes: [],
        })),
      );
      const events = new EventSource(`/api/corpus/${corpus_id}/events`);
      source.current = events;
      const terminal = new Set<string>();
      const failed = new Set<string>();
      let firstReady = "";
      events.onmessage = (event) => {
        const e = IngestEvent.parse(JSON.parse(event.data));
        if (e.stage === "done" || e.stage === "error") {
          terminal.add(e.doc_id);
          if (e.stage === "error") failed.add(e.doc_id);
          if (e.stage === "done" && !firstReady) firstReady = e.doc_id;
        }
        setColumns((old) =>
          old.map((c) =>
            c.id === e.doc_id
              ? {
                  ...c,
                  stage: e.stage,
                  message: e.message,
                  nodes:
                    e.node && !c.nodes.some((n) => n.id === e.node!.id)
                      ? [...c.nodes, e.node]
                      : c.nodes,
                }
              : c,
          ),
        );
        if (terminal.size === doc_ids.length) {
          events.close();
          setBusy(false);
          setFinished(true);
          if (
            firstReady &&
            failed.size === 0 &&
            terminal.size === doc_ids.length &&
            !metadata.some((m) => m.error)
          )
            setTimeout(() => location.assign(`/read/${firstReady}`), 1300);
        }
      };
      events.onerror = () => {
        if (terminal.size !== doc_ids.length) {
          setError(
            "The progress stream disconnected. Reopen the corpus to check completed documents.",
          );
          setBusy(false);
        }
        events.close();
      };
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
      setBusy(false);
    }
  };
  return (
    <main className="upload-page">
      <header>
        <Link className="wordmark" href="/">
          cairn<span> / </span>
        </Link>
        <Link href="/">Your corpora ↗</Link>
      </header>
      <div className="upload-intro">
        <span className="eyebrow">BRING THE COURSE TOGETHER</span>
        <h1>Start with what you’re reading.</h1>
        <p>Textbooks, lecture notes, problem sets. One connected corpus.</p>
      </div>
      <input
        ref={input}
        hidden
        type="file"
        multiple
        accept="application/pdf,.pdf"
        onChange={(e) => void upload(Array.from(e.target.files ?? []))}
      />
      <button
        className={`dropzone ${drag ? "dragging" : ""}`}
        disabled={busy}
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          if (!busy) void upload(Array.from(e.dataTransfer.files));
        }}
      >
        <span className="drop-symbol">+</span>
        <strong>
          {busy ? "Reading your documents…" : "Drop your PDFs here"}
        </strong>
        <span>
          {busy
            ? "The results will appear below as they are found."
            : "or choose files · up to 20 PDFs, 50 MB each"}
        </span>
      </button>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="ingest-columns">
        {columns.map((c, i) => (
          <section key={c.id}>
            <header>
              <i style={{ background: `var(--doc-${(i % 4) + 1})` }} />
              <h3>{c.name}</h3>
              <span className={c.stage === "error" ? "error" : "stage"}>
                {(
                  {
                    parse: "parsing",
                    segment: "segmenting",
                    bake: "preparing",
                    done: "ready",
                    error: /unsupported|parse quality/i.test(c.message ?? "") ? "unsupported" : "failed",
                  } as Record<string, string>
                )[c.stage] ?? c.stage}
              </span>
            </header>
            {c.stage === "error" ? (
              <div className="unsupported">
                <p>{c.message}</p>
                {!/unsupported|parse quality/i.test(c.message ?? "") && <p><Link href={`/read/${c.id}`}>Open document to retry ↗</Link></p>}
                <button
                  onClick={() =>
                    setColumns((old) => old.filter((v) => v.id !== c.id))
                  }
                >
                  Remove from view
                </button>
              </div>
            ) : (
              <>
                {c.message && <p className="muted" aria-live="polite">{c.message}</p>}
                <div className="detected-nodes">
                  {c.nodes.map((n) => (
                    <div key={n.id}>
                      <span className="eyebrow">{n.label}</span>
                      <span>{n.title ?? "Untitled result"}</span>
                      <small>p. {n.page}</small>
                    </div>
                  ))}
                </div>
                {c.stage === "done" && (
                  <p className="muted">
                    {c.nodes.length
                      ? `${c.nodes.length} results detected`
                      : "No numbered results found. The PDF is ready to read."}{" "}
                    <Link className="cross-link" href={`/read/${c.id}`}>
                      Open reader ↗
                    </Link>
                  </p>
                )}
                {!c.nodes.length && c.stage !== "done" && (
                  <div className="skeleton">
                    Looking for definitions and results…
                  </div>
                )}
              </>
            )}
          </section>
        ))}
      </div>
      {finished && (
        <p className="ingest-done">
          Processing finished.{" "}
          {columns.some((c) => c.stage === "error")
            ? "Some documents could not be prepared. See their messages above."
            : "Opening your reader…"}
        </p>
      )}
      <p className="upload-footnote">
        PDFs with selectable text work best. Scanned pages are not supported.
      </p>
    </main>
  );
}
