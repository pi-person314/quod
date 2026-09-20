"use client";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type {
  Anchor,
  Card,
  Node,
  ReaderState,
  TraceResponse,
} from "@cairn/contracts";
import type { Dataset } from "@/lib/data";
import { trace, search } from "@/lib/intelligence";
import { PdfPage } from "./pdf-page";
import { ReferenceCard } from "./reference-card";
import { CorpusMap } from "./corpus-map";
import { MathText } from "./math-text";
import { CostPanel } from "./cost-panel";
import { VoiceControl } from "./voice-control";
import { referenceOverlays } from "@/lib/reference-overlays";
const STATE_KEY = "cairn.reader.v1";
export function Reader({
  data,
  initialDoc,
}: {
  data: Dataset;
  initialDoc: string;
}) {
  const [docId, setDocId] = useState(initialDoc),
    [page, setPage] = useState(1),
    [zoom, setZoom] = useState(1),
    [dark, setDark] = useState(true),
    [outline, setOutline] = useState(true);
  const [state, setState] = useState<Record<string, ReaderState>>({}),
    [hydrated, setHydrated] = useState(false),
    [pins, setPins] = useState<Card[]>([]),
    [floating, setFloating] = useState<{
      card?: Card;
      reference?: string;
      x: number;
      y: number;
    } | null>(null),
    [panel, setPanel] = useState(""),
    [map, setMap] = useState(false),
    [selection, setSelection] = useState<{
      text: string;
      x: number;
      y: number;
    } | null>(null),
    [chain, setChain] = useState<TraceResponse["chain"]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [query, setQuery] = useState(""),
    [hits, setHits] = useState<Node[]>([]),
    [ready, setReady] = useState(false);
  /** The node a jump asked for. The nonce replays scroll and flash on a repeat click. */
  const [focus, setFocus] = useState<{ id: string; nonce: number } | null>(
    null,
  );
  const [flash, setFlash] = useState<{ id: string; nonce: number } | null>(
    null,
  );
  const [activeResult, setActiveResult] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState("");
  const [ingestStage, setIngestStage] = useState("");
  const dialog = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!panel) return;
    const previous = document.activeElement as HTMLElement | null;
    (
      dialog.current?.querySelector<HTMLElement>("input") ??
      dialog.current?.querySelector<HTMLElement>("button")
    )?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const controls = Array.from(
        dialog.current?.querySelectorAll<HTMLElement>(
          "button:not(:disabled), input, a[href], summary",
        ) ?? [],
      );
      const first = controls[0],
        last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      }
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", trap);
    return () => {
      document.removeEventListener("keydown", trap);
      previous?.focus();
    };
  }, [panel]);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null),
    closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cache = useRef(new Map(data.cards.map((c) => [c.anchor_id, c])));
  const hoverSequence = useRef(0);
  useEffect(() => { hoverSequence.current++; setFloating(null); }, [docId, page]);
  const doc = data.docs.find((d) => d.id === docId)!;
  useEffect(() => {
    setRetryError(""); setIngestStage("");
    if (!["queued", "ingesting"].includes(doc.status)) return;
    const events = new EventSource(`/api/corpus/${doc.corpus_id}/events`);
    events.onmessage = event => {
      const progress = JSON.parse(event.data);
      if (progress.doc_id !== doc.id) return;
      setIngestStage(progress.stage);
      if (["done", "error"].includes(progress.stage)) { events.close(); location.reload(); }
    };
    return () => events.close();
  }, [doc.id, doc.corpus_id, doc.status]);
  async function retry() {
    setRetrying(true); setRetryError("");
    try {
      const response = await fetch(`/api/doc/${doc.id}/retry`, { method: "POST" });
      if (!response.ok) throw new Error("Retry could not start. Please try again.");
      location.reload();
    } catch (error) { setRetryError(error instanceof Error ? error.message : "Retry could not start."); setRetrying(false); }
  }
  const anchors = referenceOverlays(data.anchors.filter(
    (a) => a.doc_id === docId && a.page === page,
  ));
  const documentNodes = data.nodes.filter(n => n.doc_id === docId)
    .sort((a, b) => a.page - b.page || a.bbox[1] - b.bbox[1] || a.bbox[0] - b.bbox[0] || a.id.localeCompare(b.id));
  const pageNodes = data.nodes.filter(
    (n) => n.doc_id === docId && n.page === page,
  );
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STATE_KEY) ?? "{}");
      setState(saved.state ?? {});
      setPins(
        (saved.pins ?? [])
          .filter((c: Card) => data.cards.some((v) => v.id === c.id))
          .slice(0, 3),
      );
      setDark(saved.dark ?? true);
      const url = new URL(location.href);
      const deepLink = url.hash.slice(1);
      if (deepLink) setFocus({ id: deepLink, nonce: 0 });
      setPage(
        Math.max(
          1,
          Math.min(
            doc.page_count,
            Number(url.searchParams.get("page")) ||
              saved.positions?.[initialDoc] ||
              1,
          ),
        ),
      );
    } catch {}
    setHydrated(true);
  }, []);
  useEffect(() => {
    if (!hydrated) return;
    const url = new URL(location.href);
    url.searchParams.set("page", String(page));
    const source = data.nodes.find((n) => n.id === url.hash.slice(1));
    if (source && (source.doc_id !== docId || source.page !== page))
      url.hash = "";
    history.replaceState({}, "", url);
    try {
      const saved = JSON.parse(localStorage.getItem(STATE_KEY) ?? "{}");
      localStorage.setItem(
        STATE_KEY,
        JSON.stringify({
          state,
          pins,
          dark,
          positions: { ...saved.positions, [docId]: page },
        }),
      );
    } catch {}
  }, [state, pins, dark, docId, page, hydrated]);
  const update = useCallback(
    (
      id: string,
      patch: Partial<ReaderState> | ((s: ReaderState) => Partial<ReaderState>),
    ) =>
      setState((old) => {
        const s = old[id] ?? {
          node_id: id,
          seen: false,
          dwell_ms: 0,
          hover_count: 0,
          known: false,
        };
        return {
          ...old,
          [id]: { ...s, ...(typeof patch === "function" ? patch(s) : patch) },
        };
      }),
    [],
  );
  useEffect(() => {
    if (!ready || map || panel) return;
    let last = Date.now();
    const visible = () => {
      const paper = document.querySelector<HTMLElement>(".pdf-page");
      const scroll = document.querySelector<HTMLElement>(".pdf-scroll");
      if (!paper || !scroll || document.hidden) return [];
      const bounds = paper.getBoundingClientRect(),
        viewport = scroll.getBoundingClientRect();
      const scale = bounds.width / Number(paper.dataset.pageWidth);
      return pageNodes.filter((n) => {
        const [x0, y0, x1, y1] = n.bbox;
        const width = Math.max(
          0,
          Math.min(bounds.left + x1 * scale, viewport.right) -
            Math.max(bounds.left + x0 * scale, viewport.left),
        );
        const height = Math.max(
          0,
          Math.min(bounds.top + y1 * scale, viewport.bottom) -
            Math.max(bounds.top + y0 * scale, viewport.top),
        );
        return (
          (width * height) /
            Math.max(1, (x1 - x0) * (y1 - y0) * scale * scale) >=
          0.35
        );
      });
    };
    const flush = (closing = false) => {
      const elapsed = Math.min(1500, Date.now() - last);
      last = Date.now();
      const nodes = visible();
      if (closing) {
        try {
          const saved = JSON.parse(localStorage.getItem(STATE_KEY) ?? "{}");
          for (const n of nodes) {
            const row = saved.state?.[n.id];
            if (row) {
              row.dwell_ms += elapsed;
              row.seen ||= row.dwell_ms >= 4000;
            }
          }
          localStorage.setItem(STATE_KEY, JSON.stringify(saved));
        } catch {}
      } else
        nodes.forEach((n) =>
          update(n.id, (s) => ({
            dwell_ms: s.dwell_ms + elapsed,
            seen: s.seen || s.dwell_ms + elapsed >= 4000,
          })),
        );
    };
    const timer = setInterval(() => flush(), 1000);
    const closing = () => flush(true);
    window.addEventListener("pagehide", closing);
    return () => {
      clearInterval(timer);
      window.removeEventListener("pagehide", closing);
      flush();
    };
  }, [docId, page, ready, map, panel, update]);
  const jump = useCallback(
    (id: string, p: number, node?: string) => {
      setDocId(id);
      setPage(p);
      setFloating(null);
      setMap(false);
      setPanel("");
      setSelection(null);
      setFocus(node ? { id: node, nonce: Date.now() } : null);
      // Staying on the same page never re-renders the PDF, so onReady would
      // never fire again and everything gated on `ready` would stall.
      if (id !== docId || p !== page) setReady(false);
      history.pushState(
        {},
        "",
        `/read/${id}?page=${p}${node ? `#${node}` : ""}`,
      );
    },
    [docId, page],
  );
  useEffect(() => {
    const pop = () => {
      const id = location.pathname.split("/").pop();
      if (data.docs.some((d) => d.id === id)) {
        setDocId(id!);
        setPage(Number(new URL(location.href).searchParams.get("page")) || 1);
        setFloating(null);
      }
    };
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, [data]);
  useEffect(() => {
    if (!ready) return;
    const target = focus
      ? data.nodes.find(
          (n) => n.id === focus.id && n.doc_id === docId && n.page === page,
        )
      : undefined;
    const surface = document.querySelector<HTMLElement>(".pdf-scroll");
    const paper = document.querySelector<HTMLElement>(".pdf-page");
    if (target && surface && paper) {
      const pageWidth = Number(paper.dataset.pageWidth) || 612;
      surface.scrollTop = (target.bbox[1] * paper.offsetWidth) / pageWidth - 45;
    } else if (surface) surface.scrollTop = 0;
  }, [ready, focus, docId, page, data]);
  useEffect(() => {
    if (!focus || !ready) return;
    setFlash(focus);
    const timer = setTimeout(() => setFlash(null), 2400);
    return () => clearTimeout(timer);
  }, [focus, ready]);
  const cancelClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  };
  const leave = () => {
    hoverSequence.current++;
    if (openTimer.current) clearTimeout(openTimer.current);
    cancelClose();
    closeTimer.current = setTimeout(() => setFloating(null), 300);
  };
  const hover = (a: Anchor, r: DOMRect) => {
    const sequence = ++hoverSequence.current;
    setError("");
    cancelClose();
    if (openTimer.current) clearTimeout(openTimer.current);
    openTimer.current = setTimeout(async () => {
      const position = { x: Math.max(12, Math.min(r.left, innerWidth - 432)), y: Math.max(12, Math.min(r.bottom + 10, innerHeight - 570)) };
      if (!a.card_id && !a.target_node_id && !a.target_entity_id) {
        setFloating({ ...position, reference: a.surface });
        return;
      }
      let card = cache.current.get(a.id);
      if (!card) {
        try {
          const response = await fetch(`/api/card/${a.id}`);
          if (sequence !== hoverSequence.current) return;
          if (response.status === 404) { setFloating({ ...position, reference: a.surface }); return; }
          if (!response.ok) throw new Error("Could not load this reference. Please try again.");
          card = await response.json();
          cache.current.set(a.id, card!);
        } catch (e) {
          if (sequence !== hoverSequence.current) return;
          setError(String(e));
          return;
        }
      }
      if (sequence !== hoverSequence.current) return;
      setFloating({
        card: card!,
        x: Math.max(12, Math.min(r.left, innerWidth - 432)),
        y: Math.max(12, Math.min(r.bottom + 10, innerHeight - 570)),
      });
      const targetId = a.target_node_id ?? data.entities.find(e => e.id === a.target_entity_id)?.canonical_node_id;
      if (targetId)
        update(targetId, (s) => ({ hover_count: s.hover_count + 1 }));
    }, 120);
  };
  /** A result stated on this page has no anchor pointing at it, so build its card here. */
  const hoverNode = (n: Node, r: DOMRect) => {
    setError("");
    cancelClose();
    if (openTimer.current) clearTimeout(openTimer.current);
    openTimer.current = setTimeout(() => {
      setFloating({
        card: {
          id: n.id,
          anchor_id: n.id,
          headline: n.title ?? n.label ?? "Result",
          instantiated_md: n.statement_md,
          full_md: n.statement_md,
          substitutions: [],
          clause_ids: n.clauses.map((c) => c.id),
          gloss: `Stated here as ${n.label ?? `a ${n.kind}`}.`,
          source: { doc_id: n.doc_id, page: n.page },
        },
        x: Math.max(12, Math.min(r.left, innerWidth - 432)),
        y: Math.max(12, Math.min(r.bottom + 10, innerHeight - 570)),
      });
    }, 120);
  };
  useEffect(
    () => () => {
      if (openTimer.current) clearTimeout(openTimer.current);
      if (closeTimer.current) clearTimeout(closeTimer.current);
    },
    [],
  );
  const known = (id: string) =>
    update(id, (s) => ({ known: !s.known, seen: true }));
  const pin = (card: Card) => {
    setPins((old) =>
      old.some((p) => p.id === card.id)
        ? old
        : old.length < 3
          ? [...old, card]
          : old,
    );
    setFloating(null);
  };
  const runTrace = async () => {
    if (!selection) return;
    setPanel("trace");
    setBusy(true);
    setError("");
    try {
      setChain(
        (
          await trace(data, {
            doc_id: docId,
            page,
            selection: selection.text,
            read_node_ids: Object.values(state)
              .filter((s) => s.seen || s.known)
              .map((s) => s.node_id),
          })
        ).chain,
      );
    } catch (e) {
      setError(String(e));
    }
    setBusy(false);
  };
  useEffect(() => {
    if (panel !== "search") return;
    let active = true;
    const timer = setTimeout(async () => {
      setBusy(true);
      try {
        const r = await search(data, query);
        if (active) {
          setHits(
            r.hits
              .map((h) => h.node)
              .filter((n) => data.nodes.some((local) => local.id === n.id)),
          );
          setActiveResult(0);
        }
      } catch (e) {
        if (active) setError(String(e));
      }
      if (active) setBusy(false);
    }, 180);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query, panel, data]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setFloating(null);
        setPanel("");
        setMap(false);
        setSelection(null);
        return;
      }
      if ((e.target as HTMLElement).matches("input,textarea,select")) return;
      if (e.key === "/" || (e.key === "k" && (e.ctrlKey || e.metaKey))) {
        e.preventDefault();
        setPanel("search");
      }
      if (e.key === "m") setMap((v) => !v);
      if (e.key === "?") setPanel("help");
      if (e.key === "ArrowRight")
        setPage((p) => Math.min(doc.page_count, p + 1));
      if (e.key === "ArrowLeft") setPage((p) => Math.max(1, p - 1));
      if (e.key === "p") setDark((v) => !v);
      if (e.key === "[") setOutline((v) => !v);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [doc.page_count]);
  const weak = data.nodes.filter((n) => (state[n.id]?.hover_count ?? 0) >= 3);
  const exportCsv = () => {
    const quote = (s: string) => `"${s.replace(/"/g, '""')}"`;
    const csv = weak
      .map((n) =>
        [
          n.title ?? n.label ?? "Result",
          n.statement_md,
          `${data.docs.find((d) => d.id === n.doc_id)?.title} p. ${n.page}`,
        ]
          .map(quote)
          .join(","),
      )
      .join("\r\n");
    const url = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "cairn-weak-spots.csv";
    a.click();
    URL.revokeObjectURL(url);
  };
  if (map)
    return (
      <CorpusMap
        data={data}
        state={state}
        onJump={jump}
        onClose={() => setMap(false)}
      />
    );
  return (
    <div className="reader">
      <header className="topbar">
        <Link href="/" className="wordmark">
          cairn<span> / </span>
        </Link>
        <span className="course-name">
          {doc.corpus_id === "00000000-0000-4000-8000-000000000001"
            ? "Linear algebra"
            : "Your corpus"}
        </span>
        <nav>
          <button onClick={() => setPanel("search")}>
            Search <kbd>/</kbd>
          </button>
          <button onClick={() => setMap(true)}>Corpus map</button>
          <button onClick={() => setPanel("weak")}>
            Weak spots{weak.length ? ` · ${weak.length}` : ""}
          </button>
          <Link href="/upload">Add documents</Link>
          <button onClick={() => setPanel("cost")}>Costs</button>
          <button
            aria-label="Keyboard shortcuts"
            onClick={() => setPanel("help")}
          >
            ?
          </button>
        </nav>
      </header>
      <div className="reader-body">
        {outline && (
          <aside className="outline-rail">
            <span className="eyebrow">YOUR CORPUS</span>
            <div className="doc-list">
              {data.docs.map((d, i) => (
                <button
                  key={d.id}
                  className={d.id === docId ? "active" : ""}
                  onClick={() => jump(d.id, 1)}
                >
                  <i style={{ background: `var(--doc-${(i % 4) + 1})` }} />
                  <span>{d.title}</span>
                  <small>{d.page_count}</small>
                </button>
              ))}
            </div>
            <div className="outline-heading">
              <span className="eyebrow">IN THIS DOCUMENT</span>
              <span>{documentNodes.length}</span>
            </div>
            <div className="outline-nodes">
              {documentNodes.map((n, i) => (
                <Fragment key={n.id}>
                  {(i === 0 || documentNodes[i - 1].page !== n.page) && <h3 className="outline-page-label">Page {n.page}</h3>}
                  <button
                    data-node={n.id}
                    className={n.page === page ? "current" : ""}
                    onClick={() => jump(n.doc_id, n.page, n.id)}
                  >
                    <span className="eyebrow">
                      {n.label ?? n.kind}{" "}
                      {state[n.id]?.known
                        ? "· known"
                        : state[n.id]?.seen
                          ? "· read"
                          : ""}
                    </span>
                    <span>{n.title}</span>
                    <small>p. {n.page}</small>
                  </button>
                </Fragment>
                ))}
            </div>
            <div className="outline-bottom">
              Follow the reference.
              <br />
              Keep your place.
            </div>
          </aside>
        )}
        <main className="reading-surface">
          <div className="page-toolbar">
            <button
              aria-label="Toggle outline"
              onClick={() => setOutline(!outline)}
            >
              ☰
            </button>
            <span className="document-title">{doc.title}</span>
            <div className="page-controls">
              <button
                aria-label="Previous page"
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
              >
                ‹
              </button>
              <label>
                <input
                  aria-label="Page number"
                  type="number"
                  min={1}
                  max={doc.page_count}
                  value={page}
                  onChange={(e) => {
                    const p = Number(e.target.value);
                    if (p >= 1 && p <= doc.page_count) setPage(p);
                  }}
                />{" "}
                / {doc.page_count}
              </label>
              <button
                aria-label="Next page"
                disabled={page >= doc.page_count}
                onClick={() => setPage(page + 1)}
              >
                ›
              </button>
              <select
                aria-label="Zoom"
                value={zoom}
                onChange={(e) => setZoom(Number(e.target.value))}
              >
                {[0.5, 0.75, 1, 1.25, 1.5, 2].map((z) => (
                  <option key={z} value={z}>
                    {z * 100}%
                  </option>
                ))}
              </select>
              <button onClick={() => setDark(!dark)}>
                {dark ? "White paper" : "Dark paper"}
              </button>
            </div>
          </div>
          {doc.status === "unsupported" ? (
            <div className="empty error">
              Unsupported PDF (scanned or no text layer).
              <p>Choose a PDF with selectable text.</p>
            </div>
          ) : doc.status === "error" ? (
            <div className="empty error">
              This document could not be prepared.
              {data.fixture ? <><p>Try adding the PDF again.</p><Link href="/upload">Add a document ↗</Link></> : <>
                <p>Your PDF is saved. Retry to finish preparing it.</p>
                <button disabled={retrying} onClick={() => void retry()}>{retrying ? "Starting retry…" : "Retry document"}</button>
                {retryError && <p role="alert">{retryError}</p>}
              </>}
            </div>
          ) : doc.status !== "ready" ? (
            <div className="empty">
              <div className="skeleton">Preparing this document…</div>
              <p aria-live="polite">{ingestStage ? `Current step: ${ingestStage}. ` : ""}This page will update when it is ready.</p>
              <button onClick={() => location.reload()}>Check again</button>
            </div>
          ) : (
            <PdfPage
              docId={docId}
              page={page}
              zoom={zoom}
              dark={dark}
              anchors={anchors}
              nodes={data.nodes}
              highlight={flash}
              onAnchor={hover}
              onNode={hoverNode}
              onLeave={leave}
              onSelect={(text, r) =>
                setSelection({
                  text,
                  x: Math.min(r.left, innerWidth - 190),
                  y: Math.min(r.bottom + 8, innerHeight - 50),
                })
              }
              onReady={() => setReady(true)}
            />
          )}
          <footer className="reader-status">
            <VoiceControl docId={docId} page={page} nodes={pageNodes} onJump={jump} />
            <span>
              {doc.id.startsWith("b000")
                ? "Demonstration corpus"
                : "Your corpus"}{" "}
              · {anchors.length} references on this page
            </span>
            <span>
              Blue references connect documents{" "}
              <span className="cross-link">↗</span>
            </span>
          </footer>
        </main>
        {pins.length > 0 && (
          <aside className="pin-rail">
            <div className="rail-heading">
              <span className="eyebrow">IN THE MARGIN</span>
              <span>{pins.length} / 3</span>
            </div>
            {pins.map((card) => (
              <ReferenceCard
                key={card.id}
                card={card}
                data={data}
                state={state}
                onJump={jump}
                onKnown={known}
                onPin={() => {}}
                pinned
                onClose={() =>
                  setPins((p) => p.filter((c) => c.id !== card.id))
                }
              />
            ))}
          </aside>
        )}
      </div>
      {floating && (
        <div
          className="floating-card"
          style={{
            left: floating.x,
            top: floating.y,
            maxHeight: `calc(100dvh - ${floating.y + 12}px)`,
          }}
          onMouseEnter={cancelClose}
          onMouseLeave={leave}
        >
          {floating.card ? <ReferenceCard
            card={floating.card}
            data={data}
            state={state}
            onJump={jump}
            onKnown={known}
            onPin={() => pin(floating.card!)}
          /> : <article className="reference-card" aria-label="Unmatched reference">
            <h3>{floating.reference}</h3>
            <p>This reference has not been matched to a result in this corpus.</p>
            <p className="muted">The referenced document may be missing, or it may use a different name.</p>
          </article>}
          {pins.length === 3 && (
            <p className="pin-limit">
              Three cards pinned. Unpin one to make room.
            </p>
          )}
        </div>
      )}
      {selection && panel !== "trace" && (
        <button
          className="selection-action"
          style={{ left: selection.x, top: selection.y }}
          onMouseDown={(e) => e.preventDefault()}
          onClick={runTrace}
        >
          Why am I stuck? ↗
        </button>
      )}
      {panel && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setPanel("");
          }}
        >
          <section
            ref={dialog}
            className={`panel ${panel === "search" ? "search-panel" : ""}`}
            role="dialog"
            aria-modal="true"
            aria-label={panel}
          >
            <header>
              <span className="eyebrow">
                {panel === "trace"
                  ? "PREREQUISITES"
                  : panel === "weak"
                    ? "WEAK SPOTS"
                    : panel === "cost"
                      ? "COST LEDGER"
                      : panel === "help"
                        ? "KEYBOARD SHORTCUTS"
                        : "FIND A RESULT"}
              </span>
              <button aria-label="Close panel" onClick={() => setPanel("")}>
                ×
              </button>
            </header>
            {panel === "trace" && (
              <>
                <h2>Why am I stuck?</h2>
                <blockquote>{selection?.text}</blockquote>
                {busy ? (
                  <div className="skeleton">Finding the earlier steps…</div>
                ) : chain.length ? (
                  chain.map((hop, i) => (
                    <details
                      className={`trace-hop ${hop.read ? "read" : ""}`}
                      key={hop.node.id}
                      open={!hop.read}
                    >
                      <summary>
                        <span className="step-number">
                          {String(i + 1).padStart(2, "0")}
                        </span>
                        <span>
                          {hop.node.title ?? hop.node.label}
                          <small>
                            {hop.node.label} {hop.read ? "· read" : ""}
                          </small>
                        </span>
                      </summary>
                      <MathText text={hop.node.statement_md} />
                      <p>{hop.reason}</p>
                      <button
                        className="cross-link"
                        onClick={() =>
                          jump(hop.node.doc_id, hop.node.page, hop.node.id)
                        }
                      >
                        Read source · p. {hop.node.page} ↗
                      </button>
                    </details>
                  ))
                ) : (
                  <p className="empty">
                    No prerequisites were found for this passage.
                  </p>
                )}
              </>
            )}
            {panel === "search" && (
              <>
                <input
                  autoFocus
                  aria-label="Search corpus"
                  placeholder="Theorem, concept, or notation…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "ArrowDown") {
                      e.preventDefault();
                      setActiveResult((i) => Math.min(hits.length - 1, i + 1));
                    }
                    if (e.key === "ArrowUp") {
                      e.preventDefault();
                      setActiveResult((i) => Math.max(0, i - 1));
                    }
                    if (e.key === "Enter" && hits[activeResult]) {
                      const n = hits[activeResult];
                      jump(n.doc_id, n.page, n.id);
                    }
                  }}
                />
                {busy ? (
                  <p className="skeleton">Searching the corpus…</p>
                ) : (
                  hits.map((n, index) => (
                    <button
                      className={`search-result ${index === activeResult ? "selected" : ""}`}
                      key={n.id}
                      onClick={() => jump(n.doc_id, n.page, n.id)}
                    >
                      <span>
                        {n.title ?? n.label}
                        <small>
                          {n.label} ·{" "}
                          {data.docs.find((d) => d.id === n.doc_id)?.title}
                        </small>
                      </span>
                      <span>p. {n.page} ↗</span>
                    </button>
                  ))
                )}
                {!busy && !hits.length && (
                  <p className="empty">
                    No results. Try a theorem name or a symbol.
                  </p>
                )}
              </>
            )}
            {panel === "weak" && (
              <>
                <h2>A little more attention.</h2>
                <p>Results you have returned to at least three times.</p>
                {weak.length ? (
                  <>
                    <button className="primary" onClick={exportCsv}>
                      Export to Anki · CSV
                    </button>
                    {weak.map((n) => (
                      <button
                        className="search-result"
                        key={n.id}
                        onClick={() => jump(n.doc_id, n.page, n.id)}
                      >
                        {n.title ?? n.label}
                        <span>{state[n.id].hover_count} visits ↗</span>
                      </button>
                    ))}
                  </>
                ) : (
                  <p className="empty">
                    No weak spots yet. Your repeated reference visits will
                    appear here.
                  </p>
                )}
              </>
            )}
            {panel === "cost" && (
              <CostPanel corpusId={doc.corpus_id} />
            )}
            {panel === "help" && (
              <>
                <h2>Stay with the page.</h2>
                {[
                  ["/ or Ctrl K", "Search the corpus"],
                  ["← / →", "Previous / next page"],
                  ["M", "Open corpus map"],
                  ["P", "Change paper"],
                  ["[", "Toggle outline"],
                  ["Esc", "Close panel or card"],
                  ["?", "These shortcuts"],
                ].map(([key, label]) => (
                  <div className="shortcut" key={key}>
                    <kbd>{key}</kbd>
                    <span>{label}</span>
                  </div>
                ))}
              </>
            )}
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
          </section>
        </div>
      )}
      {error && !panel && (
        <div className="reader-toast" role="alert">
          {error}
          <button aria-label="Dismiss error" onClick={() => setError("")}>
            ×
          </button>
        </div>
      )}
    </div>
  );
}
