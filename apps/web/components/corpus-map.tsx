"use client";
import { documentColor } from "@/lib/document-colors";
import { nodeLabel, nodeDescription } from "@/lib/node-label";
import { useEffect, useId, useMemo, useRef, useState } from "react";
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
import type { Node, ReaderState } from "@quod/contracts";
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
  const markerId = `map-arrow-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const [query, setQuery] = useState(""),
    [hover, setHover] = useState<Node | null>(null),
    [viewport, setViewport] = useState(0);
  const queryRef = useRef(query);
  const captions = useMemo(() => new Map(data.nodes.map(node => [node.id, {
    label: nodeLabel(node, data.nodes), description: nodeDescription(node, data.nodes),
  }])), [data.nodes]);
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
      .filter((e) => e.src !== e.dst && index.has(e.src) && index.has(e.dst))
      .map((e) => ({ source: e.src, target: e.dst, kind: e.kind }));
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
    const defs = root.append("defs");
    for (const [suffix, color] of [["", "#587b9d"], ["-active", "#a9cbed"]]) {
      defs.append("marker").attr("id", `${markerId}${suffix}`)
        .attr("viewBox", "0 -4 8 8").attr("refX", 8).attr("refY", 0)
        .attr("markerWidth", 8).attr("markerHeight", 8)
        .attr("markerUnits", "userSpaceOnUse").attr("orient", "auto")
        .append("path").attr("d", "M0,-3.5L8,0L0,3.5Z").attr("fill", color);
    }
    const radius = (n: Dot) => 4 + Math.sqrt(n.rank) * 28;
    const group = root.append("g");
    const lines = group.append("g").attr("class", "map-edges")
      .selectAll("path").data(links).join("path")
      .attr("data-kind", edge => edge.kind)
      .attr("fill", "none").attr("stroke", "#587b9d").attr("stroke-width", 1)
      .attr("stroke-dasharray", edge => edge.kind === "restates" ? "5 4" : null)
      .attr("marker-end", edge => edge.kind === "restates" ? null : `url(#${markerId})`)
      .attr("pointer-events", "none");
    const edgePath = (edge: typeof links[number]) => {
      // D3 replaces link IDs with Dot objects when the simulation initializes.
      const source = edge.source as unknown as Dot, target = edge.target as unknown as Dot;
      const dx = target.x! - source.x!, dy = target.y! - source.y!;
      const distance = Math.hypot(dx, dy);
      const start = radius(source) + 2, end = radius(target) + 3;
      if (distance <= start + end) return "";
      return `M${source.x! + dx * start / distance},${source.y! + dy * start / distance}`
        + `L${target.x! - dx * end / distance},${target.y! - dy * end / distance}`;
    };
    const circles = group
      .append("g")
      .selectAll("circle")
      .data(dots)
      .join("circle")
      .attr("r", radius)
      .attr(
        "fill",
        (n) =>
          documentColor(n.node.doc_id,data.docs),
      )
      .attr("stroke", "#04070b")
      .attr("stroke-width", 2)
      .attr("tabindex", 0)
      .attr("role", "button")
      .attr("aria-label", (n) => captions.get(n.id)!.description)
      .style("cursor", "pointer");
    const leaders = group.append("g").attr("aria-hidden", "true")
      .selectAll("line").data(dots).join("line")
      .attr("stroke", "#58708b").attr("stroke-width", 0.7)
      .attr("pointer-events", "none");
    const labels = group
      .append("g")
      .selectAll("text")
      .data(dots)
      .join("text")
      .text((n) => captions.get(n.id)!.label)
      .attr("fill", "#f4f1de")
      .attr("font-size", 11)
      .attr("font-family", "Instrument Sans, sans-serif")
      .attr("paint-order", "stroke")
      .attr("stroke", "#0c1b28")
      .attr("stroke-width", 3)
      .attr("stroke-linejoin", "round")
      .attr("pointer-events", "none");
    let fitScale = 1;
    const reset = () => {
      const q = queryRef.current.toLowerCase();
      circles.attr("opacity", (n) =>
        q && !captions.get(n.id)!.description.toLowerCase().includes(q)
          ? 0.12
          : state[n.id]?.seen
            ? 1
            : 0.62,
      );
      labels.attr("opacity", (n) =>
        q
          ? captions.get(n.id)!.description.toLowerCase().includes(q)
            ? 1
            : 0
          : 0.9,
      );
      labels.style("display", (n) => (!q || captions.get(n.id)!.description.toLowerCase().includes(q)) ? null : "none");
      lines.attr("opacity", 0.7).attr("stroke", "#587b9d")
        .attr("marker-end", edge => edge.kind === "restates" ? null : `url(#${markerId})`);
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
        labels.attr("opacity", (d) => (near.has(d.id) ? 1 : 0.35));
        labels.style("display", null);
        const connected = (edge: typeof links[number]) => near.has((edge.source as unknown as Dot).id)
          && near.has((edge.target as unknown as Dot).id);
        lines.attr("opacity", edge => connected(edge) ? 1 : 0.06)
          .attr("stroke", edge => connected(edge) ? "#a9cbed" : "#587b9d")
          .attr("marker-end", edge => edge.kind === "restates" ? null
            : `url(#${markerId}${connected(edge) ? "-active" : ""})`);
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
      lines.attr("d", edgePath);
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
      labels.style("display", null);
      const occupied: DOMRect[] = [];
      const elements = labels.nodes();
      const bounds = el.getBoundingClientRect();
      for (const dot of [...dots].sort((a, b) => b.rank - a.rank)) {
        const element = elements[dots.indexOf(dot)];
        if (!(element instanceof SVGElement)) continue;
        // Move colliding labels instead of silently hiding them until hover.
        // All labels remain in the graph, including on dense maps.
        let bestY = dot.y! + 4, bestScore = Infinity;
        for (let attempt = 0; attempt < 32; attempt++) {
          const row = Math.ceil(attempt / 2) * (attempt % 2 ? 1 : -1);
          const y = dot.y! + 4 + row * 17 / fitScale;
          element.setAttribute("y", String(y));
          const rect = element.getBoundingClientRect();
          const collisions = occupied.filter(r => rect.left < r.right + 7 && rect.right + 7 > r.left
            && rect.top < r.bottom + 3 && rect.bottom + 3 > r.top).length;
          const score = collisions + (rect.top < bounds.top + 200 || rect.bottom > bounds.bottom - 45 ? 1000 : 0);
          if (score < bestScore) { bestScore = score; bestY = y; }
          if (score === 0) break;
        }
        element.setAttribute("y", String(bestY));
        occupied.push(element.getBoundingClientRect());
        leaders.filter(d => d.id === dot.id)
          .attr("x1", dot.x!).attr("y1", dot.y!)
          .attr("x2", dot.x! + 8).attr("y2", bestY - 4)
          .attr("opacity", Math.abs(bestY - dot.y! - 4) > 1 ? 0.5 : 0);
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
  }, [data, state, onJump, viewport, captions, markerId]);
  return (
    <section className="map-view" aria-label="Document map">
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
            <i style={{ background: documentColor(d.id,data.docs) }} />
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
            ? captions.get(hover.id)!.description
            : "Hover to follow two steps of connection. Click to read the source."}
        </span>
        <span>Size: PageRank · Opacity: reading state · Scroll to zoom</span>
      </footer>
    </section>
  );
}
