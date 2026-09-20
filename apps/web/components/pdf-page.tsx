"use client";
import { useEffect, useRef, useState } from "react";
import type { Anchor, Node } from "@cairn/contracts";
export async function pdfjs() {
  const lib = await import("pdfjs-dist");
  lib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  return lib;
}
export function PdfPage({
  docId,
  page,
  zoom,
  dark,
  anchors,
  nodes,
  highlight,
  onAnchor,
  onNode,
  onLeave,
  onSelect,
  onReady,
}: {
  docId: string;
  page: number;
  zoom: number;
  dark: boolean;
  anchors: Anchor[];
  nodes: Node[];
  /** Node to flash briefly after a jump. The nonce replays the animation. */
  highlight?: { id: string; nonce: number } | null;
  onAnchor: (a: Anchor, r: DOMRect) => void;
  onNode: (n: Node, r: DOMRect) => void;
  onLeave: () => void;
  onSelect: (text: string, r: DOMRect) => void;
  onReady: () => void;
}) {
  const wrap = useRef<HTMLDivElement>(null),
    canvas = useRef<HTMLCanvasElement>(null),
    text = useRef<HTMLDivElement>(null);
  const pageNodes = nodes.filter((n) => n.doc_id === docId && n.page === page);
  const flashed = highlight
    ? pageNodes.find((n) => n.id === highlight.id)
    : undefined;
  // Some fixtures already put an anchor on a heading; don't underline it twice.
  const unanchored = pageNodes.filter(
    (n) =>
      !anchors.some(
        (a) =>
          a.bbox[0] < n.bbox[2] &&
          n.bbox[0] < a.bbox[2] &&
          a.bbox[1] < n.bbox[3] &&
          n.bbox[1] < a.bbox[3],
      ),
  );
  const [width, setWidth] = useState(700),
    [size, setSize] = useState({ width: 612, height: 792 }),
    [points, setPoints] = useState({ width: 612, height: 792 }),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    const el = wrap.current!;
    const observer = new ResizeObserver((entries) =>
      setWidth(Math.max(280, entries[0].contentRect.width - 64)),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    let dead = false;
    let task:
      ReturnType<Awaited<ReturnType<typeof pdfjs>>["getDocument"]> | undefined;
    let render: { cancel: () => void } | undefined;
    setLoading(true);
    setError("");
    (async () => {
      try {
        const lib = await pdfjs();
        task = lib.getDocument(`/api/doc/${docId}/pdf`);
        const pdf = await task.promise;
        const p = await pdf.getPage(page);
        const base = p.getViewport({ scale: 1, rotation: 0 });
        const scale = (width / base.width) * zoom;
        const viewport = p.getViewport({ scale, rotation: 0 });
        if (dead) return;
        setPoints({ width: base.width, height: base.height });
        setSize({ width: viewport.width, height: viewport.height });
        const c = canvas.current!;
        const dpr = window.devicePixelRatio || 1;
        c.width = Math.floor(viewport.width * dpr);
        c.height = Math.floor(viewport.height * dpr);
        c.style.width = `${viewport.width}px`;
        c.style.height = `${viewport.height}px`;
        const content = await p.getTextContent();
        if (dead) return;
        text.current!.replaceChildren();
        text.current!.style.setProperty("--scale-factor", String(scale));
        const layer = new lib.TextLayer({
          textContentSource: content,
          container: text.current!,
          viewport,
        });
        const rendering = p.render({
          canvasContext: c.getContext("2d")!,
          viewport,
          transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
        });
        render = rendering;
        await Promise.all([rendering.promise, layer.render()]);
        if (!dead) {
          setLoading(false);
          onReady();
        }
      } catch (e) {
        if (!dead) {
          setError(e instanceof Error ? e.message : "Unable to render PDF");
          setLoading(false);
        }
      }
    })();
    return () => {
      dead = true;
      render?.cancel();
      void task?.destroy();
    };
  }, [docId, page, width, zoom]);

  return (
    <div
      className="pdf-scroll"
      ref={wrap}
      onMouseUp={() => {
        const selection = window.getSelection();
        if (
          selection?.toString().trim() &&
          selection.rangeCount &&
          text.current?.contains(selection.anchorNode)
        )
          onSelect(
            selection.toString(),
            selection.getRangeAt(0).getBoundingClientRect(),
          );
      }}
    >
      {error ? (
        <div className="empty error">
          This PDF could not be opened.<p>{error}</p>
          <button onClick={() => location.reload()}>Try again</button>
        </div>
      ) : (
        <div
          className={`pdf-page ${dark ? "dark-paper" : ""}`}
          style={{ width: size.width, height: size.height }}
          data-loading={loading}
          data-page-width={points.width}
          data-page-height={points.height}
        >
          <canvas ref={canvas} aria-label={`PDF page ${page}`} />
          <div className="textLayer" ref={text} />
          {flashed && (
            <div
              key={`${flashed.id}-${highlight!.nonce}`}
              className="node-flash"
              style={{
                left: `${(flashed.bbox[0] / points.width) * 100}%`,
                top: `${(flashed.bbox[1] / points.height) * 100}%`,
                width: `${((flashed.bbox[2] - flashed.bbox[0]) / points.width) * 100}%`,
                height: `${((flashed.bbox[3] - flashed.bbox[1]) / points.height) * 100}%`,
              }}
            />
          )}
          <div className="anchors">
            {anchors.map((a) => {
              const target = nodes.find((n) => n.id === a.target_node_id);
              return (
                <button
                  key={a.id}
                  data-anchor={a.id}
                  aria-label={`Reference: ${a.surface}`}
                  className={`anchor ${target?.doc_id !== docId ? "cross" : ""} ${target && target.confidence < 0.7 ? "uncertain" : ""}`}
                  style={{
                    left: `${(a.bbox[0] / points.width) * 100}%`,
                    top: `${(a.bbox[1] / points.height) * 100}%`,
                    width: `${((a.bbox[2] - a.bbox[0]) / points.width) * 100}%`,
                    height: `${((a.bbox[3] - a.bbox[1]) / points.height) * 100}%`,
                  }}
                  onMouseEnter={(e) =>
                    onAnchor(a, e.currentTarget.getBoundingClientRect())
                  }
                  onFocus={(e) =>
                    onAnchor(a, e.currentTarget.getBoundingClientRect())
                  }
                  onMouseLeave={onLeave}
                  onClick={(e) =>
                    onAnchor(a, e.currentTarget.getBoundingClientRect())
                  }
                />
              );
            })}
            {unanchored.map((n) => (
              <button
                key={n.id}
                aria-label={`Result: ${n.title ?? n.label ?? n.kind}`}
                className="anchor result-marker"
                style={{
                  left: `${(n.bbox[0] / points.width) * 100}%`,
                  top: `${(n.bbox[1] / points.height) * 100}%`,
                  width: `${((n.bbox[2] - n.bbox[0]) / points.width) * 100}%`,
                  height: `${((n.bbox[3] - n.bbox[1]) / points.height) * 100}%`,
                }}
                onMouseEnter={(e) =>
                  onNode(n, e.currentTarget.getBoundingClientRect())
                }
                onFocus={(e) =>
                  onNode(n, e.currentTarget.getBoundingClientRect())
                }
                onMouseLeave={onLeave}
                onClick={(e) =>
                  onNode(n, e.currentTarget.getBoundingClientRect())
                }
              />
            ))}
          </div>
          {loading && <div className="pdf-loading">Setting the page…</div>}
        </div>
      )}
    </div>
  );
}
