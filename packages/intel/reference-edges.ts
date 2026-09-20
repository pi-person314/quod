import type { Anchor, Edge, Node } from "@quod/contracts";

/** Project resolved citations onto the graph. Caller supplies one document set.
 * No semantic inference: the anchor already identifies its target; geometry
 * identifies which passage cites it. Never guess between equal-sized owners.
 */
export function referenceDependencyEdges(nodes: readonly Node[], anchors: readonly Anchor[], preferStatement = true): Edge[] {
  const byId = new Map(nodes.map(node => [node.id, node]));
  const edges = new Map<string, Edge>();
  const area = (node: Node) => (node.bbox[2] - node.bbox[0]) * (node.bbox[3] - node.bbox[1]);
  for (const anchor of anchors) {
    let target = anchor.target_node_id ? byId.get(anchor.target_node_id)
      : anchor.target_entity_id ? nodes.filter(node => node.entity_id === anchor.target_entity_id)
        .sort((a, b) => a.id.localeCompare(b.id))[0] : undefined;
    if (!target) continue;
    // Historical equivalence groups can include a theorem and its proof.
    // A theorem citation should lead to its statement, not proof text. Only
    // substitute when the existing entity has one unambiguous statement.
    if (preferStatement && target.kind === "proof" && target.entity_id && !/\bproof\b/i.test(anchor.surface)) {
      const statements = nodes.filter(node => node.entity_id === target!.entity_id
        && node.kind !== "proof" && node.kind !== "example");
      if (statements.length === 1) target = statements[0];
    }
    const owners = nodes.filter(node => node.doc_id === anchor.doc_id && node.page === anchor.page
      && node.bbox[0] <= anchor.bbox[0] + 2 && node.bbox[1] <= anchor.bbox[1] + 2
      && node.bbox[2] >= anchor.bbox[2] - 2 && node.bbox[3] >= anchor.bbox[3] - 2)
      .sort((a, b) => area(a) - area(b) || a.id.localeCompare(b.id));
    const source = owners[0];
    if (!source || (owners[1] && Math.abs(area(source) - area(owners[1])) < 0.01)
      || source.id === target.id) continue;
    edges.set(`${source.id}:${target.id}`, { src: source.id, dst: target.id,
      kind: "depends_on", extractor: "deterministic", confidence: Math.min(0.95, target.confidence) });
  }
  return [...edges.values()].sort((a, b) => a.src.localeCompare(b.src) || a.dst.localeCompare(b.dst));
}

export async function saveReferenceEdges(
  query: (sql: string, values: unknown[]) => Promise<{ rowCount: number | null }>,
  edges: readonly Edge[],
): Promise<number> {
  let inserted = 0;
  for (const edge of edges) {
    const result = await query(`INSERT INTO edges (src,dst,kind,extractor,confidence)
      VALUES ($1,$2,$3,$4,$5) ON CONFLICT (src,dst,kind) DO NOTHING`,
    [edge.src, edge.dst, edge.kind, edge.extractor, edge.confidence]);
    inserted += result.rowCount ?? 0;
  }
  return inserted;
}

/** Replace only old projections of these exact citations, not inferred edges. */
export async function syncReferenceEdges(
  query: (sql: string, values: unknown[]) => Promise<{ rowCount: number | null }>,
  nodes: readonly Node[], anchors: readonly Anchor[],
): Promise<number> {
  const edges = referenceDependencyEdges(nodes, anchors);
  const keys = new Set(edges.map(edge => `${edge.src}:${edge.dst}`));
  for (const old of referenceDependencyEdges(nodes, anchors, false)) {
    if (keys.has(`${old.src}:${old.dst}`)) continue;
    await query(`DELETE FROM edges WHERE src=$1 AND dst=$2 AND kind='depends_on'
      AND extractor='deterministic' AND confidence=$3`, [old.src, old.dst, old.confidence]);
  }
  return saveReferenceEdges(query, edges);
}
