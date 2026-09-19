import type { Edge, ForwardResponse, Node } from "@cairn/contracts";

/** Reversed-edge PageRank over the reachable downstream subgraph, including roots. */
export function forwardGraph(nodes: readonly Node[], edges: readonly Edge[], entityId: string): ForwardResponse {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const roots = new Set(nodes.filter((node) => node.entity_id === entityId).map((node) => node.id));
  const reverse = new Map<string, Set<string>>();
  for (const edge of edges) {
    if (!byId.has(edge.src) || !byId.has(edge.dst)) continue;
    const targets = reverse.get(edge.dst) ?? new Set<string>();
    targets.add(edge.src);
    reverse.set(edge.dst, targets);
  }
  const reachable = new Set(roots);
  const queue = [...roots].sort();
  for (let i = 0; i < queue.length; i++) {
    for (const id of [...(reverse.get(queue[i]!) ?? [])].sort()) {
      if (reachable.has(id)) continue;
      reachable.add(id);
      queue.push(id);
    }
  }
  const ids = [...reachable].sort();
  if (ids.length === 0) return { entity_id: entityId, downstream: [] };
  const outgoing = new Map(ids.map((id) => [id, [...(reverse.get(id) ?? [])].filter((target) => reachable.has(target)).sort()]));
  let scores = new Map(ids.map((id) => [id, 1 / ids.length]));
  const damping = 0.85;
  for (let iteration = 0; iteration < 100; iteration++) {
    const dangling = ids.reduce((total, id) => total + (outgoing.get(id)!.length ? 0 : scores.get(id)!), 0);
    const next = new Map(ids.map((id) => [id, (1 - damping + damping * dangling) / ids.length]));
    for (const id of ids) {
      const targets = outgoing.get(id)!;
      for (const target of targets) next.set(target, next.get(target)! + damping * scores.get(id)! / targets.length);
    }
    const delta = ids.reduce((total, id) => total + Math.abs(next.get(id)! - scores.get(id)!), 0);
    scores = next;
    if (delta < 1e-10) break;
  }
  return {
    entity_id: entityId,
    downstream: ids.filter((id) => !roots.has(id)).map((id) => ({ node: byId.get(id)!, score: scores.get(id)! }))
      .sort((a, b) => b.score - a.score || a.node.id.localeCompare(b.node.id)),
  };
}
