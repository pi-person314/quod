"use client";
import { documentColor } from "@/lib/document-colors";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "./auth-provider";
import { AccountMenu } from "./account-menu";
import { Brand } from "./brand";
import { IngestEvent, type NodeSummary } from "@quod/contracts";
import { pdfjs } from "./pdf-page";
interface Column {
  id: string;
  name: string;
  stage: string;
  nodes: NodeSummary[];
  message?: string;
}
const isTex = (file: File) => file.name.toLowerCase().endsWith(".tex");
const isPdf = (file: File) => file.name.toLowerCase().endsWith(".pdf");
const PENDING_UPLOAD = "quod.pending-upload";
export function Upload({ initialFiles }: { initialFiles?: File[] }) {
  const router = useRouter();
  const { user, loading, login } = useAuth();
  const pendingKey = user ? `${PENDING_UPLOAD}.${user.uid}` : "";
  const [drag, setDrag] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [columns, setColumns] = useState<Column[]>([]),
    [finished, setFinished] = useState(false),
    [uploaded, setUploaded] = useState(false);
  const input = useRef<HTMLInputElement>(null),
    source = useRef<EventSource | null>(null),
    consumedInitialFiles = useRef(false);
  const [corpus, setCorpus] = useState("");
  const redirect = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    // The server already owns the PDFs: restore progress after a reload.
    if (!pendingKey) return;
    const legacyKey = `cairn.pending-upload.${user!.uid}`;
    const saved = sessionStorage.getItem(pendingKey) ?? sessionStorage.getItem(legacyKey);
    if (saved) { sessionStorage.setItem(pendingKey, saved); sessionStorage.removeItem(legacyKey); }
    if (saved) {
      try {
        const pending = JSON.parse(saved) as { corpus: string; columns: Column[] };
        if (pending.corpus && Array.isArray(pending.columns) && pending.columns.length) {
          setColumns(pending.columns);
          setCorpus(pending.corpus);
          setBusy(true);
        }
      } catch { sessionStorage.removeItem(pendingKey); }
    }
    return () => {
      source.current?.close();
      if (redirect.current) clearTimeout(redirect.current);
    };
  }, [pendingKey]);
  useEffect(() => {
    if (!user) { setCorpus(""); setColumns([]); setBusy(false); setFinished(false); }
  }, [user]);
  useEffect(() => {
    if (!user || !corpus) return;
    let disposed = false;
    const events = new EventSource(`/api/corpus/${corpus}/events`);
    source.current = events;
    events.onmessage = (event) => {
      let value: unknown;
      try { value = JSON.parse(event.data); } catch { return; }
      const parsed = IngestEvent.safeParse(value);
      if (!parsed.success) return;
      const e = parsed.data;
      setError("");
      setColumns(old => old.map(c => c.id === e.doc_id ? {
        ...c, stage: e.stage, message: e.message,
        nodes: e.node && !c.nodes.some(n => n.id === e.node!.id) ? [...c.nodes, e.node] : c.nodes,
      } : c));
    };
    // EventSource reconnects automatically. Poll durable status as a fallback
    // when a deployment or network interruption closes the progress stream.
    const recover = async () => {
      try {
        const response = await fetch("/api/library");
        if (!response.ok) return;
        const data = await response.json();
        if (disposed) return;
        setColumns(old => old.map(c => {
          const doc = data.docs.find((d: { id: string }) => d.id === c.id);
          if (!doc) return c;
          const stage = doc.status === "ready" ? "done" : ["error", "unsupported"].includes(doc.status) ? "error" : c.stage;
          return { ...c, stage,
            message: c.message ?? (stage === "error" ? "Document processing failed. Open the document to retry." : undefined),
            nodes: data.nodes.filter((n: { doc_id: string }) => n.doc_id === c.id) };
        }));
      } catch { /* Leave the saved upload available for the next reconnect. */ }
    };
    events.onerror = () => { void recover(); };
    const timer = setInterval(() => void recover(), 5000);
    return () => { disposed = true; events.close(); clearInterval(timer); };
  }, [corpus, user]);
  useEffect(() => {
    if (!pendingKey || !corpus) return;
    if (!columns.length) { sessionStorage.removeItem(pendingKey); return; }
    sessionStorage.setItem(pendingKey, JSON.stringify({ corpus, columns: columns.map(c => ({ ...c, nodes: [] })) }));
    if (!columns.every(c => c.stage === "done" || c.stage === "error")) return;
    source.current?.close();
    setBusy(false);
    setFinished(true);
    if (columns.every(c => c.stage === "done")) {
      redirect.current = setTimeout(() => {
        sessionStorage.removeItem(pendingKey);
        router.push(`/read/${columns[0].id}`);
      }, 1300);
      return () => { if (redirect.current) clearTimeout(redirect.current); };
    }
  }, [corpus, columns, router, pendingKey]);
  const upload = async (files: File[]) => {
    if (!user) { await login().catch(() => {}); return; }
    setError("");
    setFinished(false);
    setUploaded(false);
    if (!files.length) return;
    if (files.length > 20 || files.some((f) => isPdf(f) ? f.size > 50 * 1024 * 1024 : f.size > 2 * 1024 * 1024)) {
      setError("Choose up to 20 files: PDFs up to 50 MB and .tex sources up to 2 MB.");
      return;
    }
    if (files.some((f) => !isPdf(f) && !isTex(f))) {
      setError("Choose PDF documents or standalone .tex source files.");
      return;
    }
    source.current?.close();
    setCorpus("");
    sessionStorage.removeItem(pendingKey);
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
      const lib = files.some(isPdf) ? await pdfjs() : undefined;
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
        // TeX is compiled and inspected on the server. Keep the source-order
        // placeholder so `metadata` stays aligned with the submitted files.
        if (isTex(file)) {
          metadata.push({ pages: 0, nodes: [] });
          continue;
        }
        const nodes = [];
        let pages = 0,
          characters = 0,
          parseError = "";
        try {
          const task = lib!.getDocument({
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
              ? files[0].name.replace(/\.(pdf|tex)$/i, "")
              : "New documents",
        }),
      });
      if (!create.ok) {
        const failure = await create.json().catch(() => ({}));
        throw new Error(failure.message ?? failure.error ?? "Could not add the documents.");
      }
      const { corpus_id } = await create.json();
      const form = new FormData();
      files.forEach((f) => form.append("files", f));
      form.append("metadata", JSON.stringify(metadata));
      const res = await fetch(`/api/corpus/${corpus_id}/docs`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message ?? body.error ?? "Upload failed. Please try again.");
      }
      const { doc_ids } = await res.json();
      setUploaded(true);
      setColumns(
        files.map((f, i) => ({
          id: doc_ids[i],
          name: f.name,
          stage: "queued",
          nodes: [],
        })),
      );
      setCorpus(corpus_id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
      setBusy(false);
    }
  };
  useEffect(() => {
    if (!initialFiles?.length || consumedInitialFiles.current || !user || loading) return;
    consumedInitialFiles.current = true;
    void upload(initialFiles);
  }, [initialFiles, user, loading]);
  const ready = columns.filter((column) => column.stage === "done").length;
  return (
    <main className="upload-page">
      <header>
        <Brand trail="Add documents" />
        <div className="header-actions"><Link href="/library">Your documents ↗</Link><AccountMenu /></div>
      </header>
      <div className="upload-intro">
        <span className="eyebrow">BRING THE COURSE TOGETHER</span>
        <h1>Start with what you’re reading.</h1>
        <p>Textbooks, lecture notes, problem sets. All your documents, connected.</p>
      </div>
      <input
        ref={input}
        hidden
        type="file"
        multiple
        accept="application/pdf,.pdf,text/x-tex,application/x-tex,.tex"
        onChange={(e) => void upload(Array.from(e.target.files ?? []))}
      />
      <button
        className={`dropzone ${drag ? "dragging" : ""}`}
        disabled={busy || loading}
        onClick={() => { if (user) input.current?.click(); else void login().catch(() => {}); }}
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
          {busy ? "Reading your documents…" : user ? "Drop PDFs or .tex files here" : "Log in with Google to add files"}
        </strong>
        <span>
          {busy
            ? uploaded
              ? "The PDFs are safely uploaded. Results will appear below as they are found."
              : "Checking each PDF before upload. Keep this tab open."
            : "or choose files · PDFs up to 50 MB, .tex sources up to 2 MB"}
        </span>
        {columns.length > 0 && (
          <span className="upload-progress" aria-live="polite">
            <span>{columns.length} document{columns.length === 1 ? "" : "s"}</span>
            <b>{ready} of {columns.length} ready</b>
            <i><i style={{ width: `${(ready / columns.length) * 100}%` }} /></i>
          </span>
        )}
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
              <i style={{ background: documentColor(c.id,columns) }} />
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
                      {n.title?.trim() && n.label && <span className="eyebrow">{n.label}</span>}
                      <span>{n.title?.trim() || n.label?.trim() || (n.kind[0].toUpperCase() + n.kind.slice(1))}</span>
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
        PDFs with selectable text work best. Standalone .tex files compile to a PDF before they are prepared; scanned PDFs are not supported.
      </p>
    </main>
  );
}
