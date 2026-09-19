"use client";
import { useEffect, useRef, useState } from "react";
import {
  forceSimulation,
  forceManyBody,
  forceLink,
  forceCenter,
  forceCollide,
  forceX,
  forceY,
  type SimulationNodeDatum,
} from "d3-force";
import { select } from "d3-selection";
import { zoom, zoomIdentity } from "d3-zoom";
import type { Dataset } from "@/lib/data";
import type { Node, ReaderState } from "@cairn/contracts";
interface Dot extends SimulationNodeDatum {
  id: string;
  node: Node;
  rank: number;
}
export function CorpusMap({
  data,
  state,
  onJump,
  onClose,
}: {
  data: Dataset;
  state: Record<string, ReaderState>;
  onJump: (doc: string, page: number, node?: string) => void;
  onClose: () => void;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const [query, setQuery] = useState(""),
    [hover, setHover] = useState<Node | null>(null),
    [viewport, setViewport] = useState(0);
  const queryRef = useRef(query);
  queryRef.current = query;
  useEffect(() => {
    const resize = () => setViewport((v) => v + 1);
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  useEffect(() => {
    const el = svg.current!;
    const width = el.clientWidth,
      height = el.clientHeight;
    const root = select(el);
    root.selectAll("*").remove();
    if (!data.nodes.length) return;
    const canonical = new Map(
      data.entities.map((e) => [e.id, e.canonical_node_id]),
    );
    // Keep occurrences visible: source colour is meaningful across the whole corpus.
    const dots: Dot[] = data.nodes.map((n) => ({
      id: n.id,
      node: n,
      rank: 1 / data.nodes.length,
    }));
    const index = new Map(dots.map((n) => [n.id, n]));
    const links = data.edges
      .filter((e) => index.has(e.src) && index.has(e.dst))
      .map((e) => ({ source: e.src, target: e.dst }));
    for (let iteration = 0; iteration < 24; iteration++) {
      const next = new Map(dots.map((n) => [n.id, 0.15 / dots.length]));
      for (const n of dots) {
        const outgoing = links.filter((l) => l.source === n.id);
        if (outgoing.length)
          for (const l of outgoing)
            next.set(
              l.target,
              next.get(l.target)! + (0.85 * n.rank) / outgoing.length,
            );
        else
          for (const d of dots)
            next.set(d.id, next.get(d.id)! + (0.85 * n.rank) / dots.length);
      }
      for (const n of dots) n.rank = next.get(n.id)!;
    }
    const group = root.append("g");
    const lines = group
      .append("g")
      .selectAll("line")
      .data(links)
      .join("line")
      .attr("stroke", "#42424b")
      .attr("stroke-width", 0.8);
    const circles = group
      .append("g")
      .selectAll("circle")
      .data(dots)
      .join("circle")
      .attr("r", (n) => 4 + Math.sqrt(n.rank) * 28)
      .attr(
        "fill",
        (n) =>
          ["#e2b25a", "#6fc7bd", "#b79cf0", "#e58fc4"][
            data.docs.findIndex((d) => d.id === n.node.doc_id) % 4
          ],
      )
      .attr("stroke", "#0b0b0d")
      .attr("stroke-width", 2)
      .attr("tabindex", 0)
      .attr("role", "button")
      .attr("aria-label", (n) => `${n.node.label}: ${n.node.title}`)
      .style("cursor", "pointer");
    const labels = group
      .append("g")
      .selectAll("text")
      .data(dots)
      .join("text")
      .text((n) => n.node.title ?? n.node.label)
      .attr("fill", "#ececf1")
      .attr("font-size", 11)
      .attr("font-family", "IBM Plex Sans")
      .attr("pointer-events", "none");
    let fitScale = 1;
    const visibleLabels = new Set<string>();
    const reset = () => {
      const q = queryRef.current.toLowerCase();
      circles.attr("opacity", (n) =>
        q && !`${n.node.title} ${n.node.label}`.toLowerCase().includes(q)
          ? 0.12
          : state[n.id]?.seen
            ? 1
            : 0.62,
      );
      labels.attr("opacity", (n) =>
        q
          ? `${n.node.title} ${n.node.label}`.toLowerCase().includes(q)
            ? 1
            : 0
          : visibleLabels.has(n.id)
            ? 0.9
            : 0,
      );
      lines.attr("opacity", 0.45);
    };
    circles
      .on("mouseenter", (_, n) => {
        setHover(n.node);
        const near = new Set([n.id]);
        for (let i = 0; i < 2; i++) {
          const prev = new Set(near);
          for (const e of data.edges) {
            if (prev.has(e.src)) near.add(e.dst);
            if (prev.has(e.dst)) near.add(e.src);
          }
        }
        circles.attr("opacity", (d) => (near.has(d.id) ? 1 : 0.08));
        labels.attr("opacity", (d) => (near.has(d.id) ? 1 : 0));
        lines.attr("opacity", (l: any) =>
          near.has(l.source.id) && near.has(l.target.id) ? 0.8 : 0.05,
        );
      })
      .on("mouseleave", () => {
        setHover(null);
        reset();
      })
      .on("click", (_, n) => {
        const target =
          data.nodes.find(
            (d) => d.id === canonical.get(n.node.entity_id ?? ""),
          ) ?? n.node;
        onJump(target.doc_id, target.page, target.id);
      })
      .on("keydown", (event, n) => {
        if (event.key === "Enter") onJump(n.node.doc_id, n.node.page, n.id);
      });
    const behavior = zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.25, 5])
      .on("zoom", (event) =>
        group.attr("transform", event.transform.toString()),
      );
    root.call(behavior).call(behavior.transform, zoomIdentity);
    const simulation = forceSimulation(dots)
      .force(
        "link",
        forceLink<Dot, any>(links)
          .id((d) => d.id)
          .distance(dots.length > 100 ? 55 : 115)
          .strength(0.25),
      )
      .force("charge", forceManyBody().strength(dots.length > 100 ? -85 : -260))
      .force("center", forceCenter(width / 2, height / 2))
      .force("horizontal", forceX(width / 2).strength(0.015))
      .force("vertical", forceY(height / 2).strength(0.1))
      .force("collision", forceCollide(dots.length > 100 ? 14 : 42));
    const draw = () => {
      lines
        .attr("x1", (d: any) => d.source.x)
        .attr("y1", (d: any) => d.source.y)
        .attr("x2", (d: any) => d.target.x)
        .attr("y2", (d: any) => d.target.y);
      circles.attr("cx", (d) => d.x!).attr("cy", (d) => d.y!);
      labels.attr("x", (d) => d.x! + 10).attr("y", (d) => d.y! + 4);
    };
    simulation.stop();
    for (let i = 0; i < 180; i++) simulation.tick();
    const minX = Math.min(...dots.map((n) => n.x!)) - 35,
      maxX = Math.max(...dots.map((n) => n.x!)) + 140,
      minY = Math.min(...dots.map((n) => n.y!)) - 25,
      maxY = Math.max(...dots.map((n) => n.y!)) + 25;
    fitScale = Math.min(
      (width - 100) / (maxX - minX),
      (height - 280) / (maxY - minY),
      1.2,
    );
    const tx = (width - (maxX - minX) * fitScale) / 2 - minX * fitScale,
      ty = 215 - minY * fitScale;
    root.call(
      behavior.transform,
      zoomIdentity.translate(tx, ty).scale(fitScale),
    );
    labels.attr("font-size", 11 / fitScale);
    draw();
    const placeLabels = () => {
      if (!el.isConnected) return;
      visibleLabels.clear();
      const occupied: DOMRect[] = [];
      const elements = labels.nodes();
      for (const dot of [...dots].sort((a, b) => b.rank - a.rank)) {
        const element = elements[dots.indexOf(dot)];
        if (!(element instanceof SVGElement)) continue;
        const rect = element.getBoundingClientRect();
        if (
          !occupied.some(
            (r) =>
              rect.left < r.right + 7 &&
              rect.right + 7 > r.left &&
              rect.top < r.bottom + 4 &&
              rect.bottom + 4 > r.top,
          )
        ) {
          occupied.push(rect);
          visibleLabels.add(dot.id);
        }
      }
      reset();
    };
    placeLabels();
    void document.fonts.ready.then(placeLabels);
    let previousQuery = queryRef.current;
    const interval = setInterval(() => {
      if (previousQuery !== queryRef.current) {
        previousQuery = queryRef.current;
        reset();
      }
    }, 100);
    return () => {
      simulation.stop();
      clearInterval(interval);
      root.on(".zoom", null);
    };
  }, [data, state, onJump, viewport]);
  return (
    <section className="map-view" aria-label="Corpus map">
      <header className="map-heading">
        <div>
          <span className="eyebrow">THE SHAPE OF THE COURSE</span>
          <h2>Nothing is learned alone.</h2>
          <p>
            {data.nodes.length} results · {data.edges.length} relationships
          </p>
        </div>
        <input
          aria-label="Search map"
          placeholder="Find a result…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button onClick={onClose}>Back to reading ×</button>
      </header>
      <div className="map-legend">
        {data.docs.map((d, i) => (
          <span key={d.id}>
            <i style={{ background: `var(--doc-${(i % 4) + 1})` }} />
            {d.title.split(" · ")[0]}
          </span>
        ))}
      </div>
      <svg ref={svg} />
      {!data.nodes.length && (
        <p className="map-empty">
          No results detected yet. Read the PDF or add another document to begin
          connecting the course.
        </p>
      )}
      <footer>
        <span>
          {hover
            ? `${hover.label} · ${hover.title}`
            : "Hover to follow two steps of connection. Click to read the source."}
        </span>
        <span>Size: PageRank · Opacity: reading state · Scroll to zoom</span>
      </footer>
    </section>
  );
}
