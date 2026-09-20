import type { Anchor, Edge, Node, TraceHop, TraceRequest, TraceResponse } from "@quod/contracts";

function normalized(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/[‐‑–—]/g, "-").replace(/\s+/g, " ").trim();
}

function mentioned(selection: string, name: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}]|\\.\\d)`, "u").test(selection);
}

/** Explicit labels/titles only. Ambiguous references stay unresolved. */
export function matchTraceRoots(nodes: readonly Node[], request: TraceRequest): string[] {
  const selection = normalized(request.selection);
  const names = new Map<string, Node[]>();
  for (const node of nodes) {
    if (node.doc_id !== request.doc_id) continue;
    for (const name of new Set([node.label, node.title].filter((s): s is string => !!s).map(normalized))) {
      if (!name || !mentioned(selection, name)) continue;
      const occurrences = names.get(name) ?? [];
      occurrences.push(node);
      names.set(name, occurrences);
    }
  }
  const roots = new Set<string>();
  for (const [, occurrences] of [...names].sort(([a], [b]) => a.localeCompare(b))) {
    const onPage = occurrences.filter((node) => node.page === request.page);
    const candidates = onPage.length ? onPage : occurrences;
    const identities = new Set(candidates.map((node) => node.entity_id ?? node.id));
    if (identities.size !== 1) continue;
    const first = [...candidates].sort((a, b) => a.page - b.page || a.id.localeCompare(b.id))[0];
    if (first) roots.add(first.id);
  }
  return [...roots].sort();
}

/** Caller supplies a corpus-scoped graph and verified root node IDs. */
export function traceGraph(
  nodes: readonly Node[], edges: readonly Edge[], rootIds: readonly string[],
  readNodeIds: readonly string[] = [],
): TraceResponse {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const adjacency = new Map<string, Edge[]>();
  for (const edge of edges) {
    if (!byId.has(edge.src) || !byId.has(edge.dst)) continue;
    const list = adjacency.get(edge.src) ?? [];
    list.push(edge);
    adjacency.set(edge.src, list);
  }
  for (const list of adjacency.values()) {
    list.sort((a, b) => b.confidence - a.confidence || a.dst.localeCompare(b.dst) || a.kind.localeCompare(b.kind));
  }
  const read = new Set(readNodeIds);
  const visited = new Set<string>();
  const queue: { id: string; depth: number; reason: string }[] = [];
  for (const id of [...new Set(rootIds)].filter((id) => byId.has(id)).sort().slice(0, 3)) {
    visited.add(id);
    queue.push({ id, depth: 0, reason: "Explicitly referenced in the selected text." });
  }
  const chain: TraceHop[] = [];
  for (let i = 0; i < queue.length; i++) {
    const item = queue[i]!;
    const node = byId.get(item.id)!;
    chain.push({ node, entity_id: node.entity_id, read: read.has(node.id), depth: item.depth, reason: item.reason });
    if (item.depth === 4) continue;
    let count = 0;
    for (const edge of adjacency.get(node.id) ?? []) {
      if (visited.has(edge.dst)) continue;
      if (count === 3) break;
      visited.add(edge.dst);
      count++;
      const relation = { depends_on: "depends on this result", uses_notation: "uses this notation", specialises: "specialises this result", restates: "restates this result" }[edge.kind];
      queue.push({ id: edge.dst, depth: item.depth + 1, reason: `${node.label ?? node.title ?? node.kind} ${relation}.` });
    }
  }
  return { chain };
}

export function matchSelectionRoots(nodes: readonly Node[], request: TraceRequest, anchors: readonly Anchor[] = []): string[] {
  const roots = new Set(matchTraceRoots(nodes, request));
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const selection = normalized(request.selection);
  const groups = new Map<string, Set<string>>();
  // PDF selections generally contain the proof text rather than its heading.
  // A unique containing node on the selected page is grounded evidence too.
  if (selection.length >= 24 && selection.split(/\s+/).length >= 4) {
    const containing = nodes.filter(node => node.doc_id === request.doc_id
      && (request.page === undefined || node.page === request.page)
      && normalized(node.statement_md).includes(selection));
    if (containing.length === 1) roots.add(containing[0]!.id);
  }
  for (const anchor of anchors) {
    if (anchor.doc_id !== request.doc_id || (request.page !== undefined && anchor.page !== request.page)) continue;
    const surface = normalized(anchor.surface);
    if (!surface || !mentioned(selection, surface)) continue;
    const target = anchor.target_node_id ? byId.get(anchor.target_node_id) :
      nodes.filter((node) => anchor.target_entity_id !== null && node.entity_id === anchor.target_entity_id)
        .sort((a, b) => a.id.localeCompare(b.id))[0];
    if (!target) continue;
    const group = groups.get(surface) ?? new Set<string>();
    group.add(target.id);
    groups.set(surface, group);
  }
  for (const group of groups.values()) {
    const identities = new Set([...group].map((id) => byId.get(id)!.entity_id ?? id));
    if (identities.size === 1) roots.add([...group].sort()[0]);
  }
  return [...roots];
}

export function traceSelection(nodes: readonly Node[], edges: readonly Edge[], request: TraceRequest, anchors: readonly Anchor[] = []): TraceResponse {
  return traceGraph(nodes, edges, matchSelectionRoots(nodes, request, anchors), request.read_node_ids);
}
