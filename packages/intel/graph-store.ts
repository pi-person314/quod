import { Anchor, Edge, Node, Uuid, type TraceRequest } from "@cairn/contracts";
import { db } from "@cairn/contracts/db";
import { matchSelectionRoots, traceGraph } from "./trace";

/** Corpus boundaries are applied before passing data to pure graph functions. */
export async function documentCorpus(docId: string): Promise<string | undefined> {
  Uuid.parse(docId);
  const { rows } = await db().query("SELECT corpus_id FROM documents WHERE id=$1", [docId]);
  return rows[0]?.corpus_id;
}

export async function entityCorpus(entityId: string): Promise<string | undefined> {
  Uuid.parse(entityId);
  const { rows } = await db().query("SELECT corpus_id FROM entities WHERE id=$1", [entityId]);
  return rows[0]?.corpus_id;
}

export async function canonicalEntity(entityId: string): Promise<string | undefined> {
  Uuid.parse(entityId);
  const { rows } = await db().query(`SELECT COALESCE(n.entity_id,e.id) AS id FROM entities e
    LEFT JOIN nodes n ON n.id=e.canonical_node_id WHERE e.id=$1`, [entityId]);
  return rows[0]?.id;
}

/** Full corpus graph for forward-ranking; trace uses the bounded query below. */
export async function loadCorpusGraph(corpusId: string) {
  Uuid.parse(corpusId);
  const [nodes, edges, anchors] = await Promise.all([
    db().query("SELECT n.* FROM nodes n JOIN documents d ON d.id=n.doc_id WHERE d.corpus_id=$1", [corpusId]),
    db().query(`SELECT e.* FROM edges e JOIN nodes s ON s.id=e.src JOIN nodes t ON t.id=e.dst
      JOIN documents sd ON sd.id=s.doc_id JOIN documents td ON td.id=t.doc_id
      WHERE sd.corpus_id=$1 AND td.corpus_id=$1`, [corpusId]),
    db().query("SELECT a.* FROM anchors a JOIN documents d ON d.id=a.doc_id WHERE d.corpus_id=$1", [corpusId]),
  ]);
  return { nodes: nodes.rows.map((row) => Node.parse(row)), edges: edges.rows.map((row) => Edge.parse(row)),
    anchors: anchors.rows.map((row) => Anchor.parse(row)) };
}

/** Discover explicit roots in one document, then fetch only a bounded prerequisite subgraph. */
export async function traceFromPostgres(corpusId: string, request: TraceRequest) {
  Uuid.parse(corpusId);
  const rootRows = await db().query(`SELECT n.* FROM nodes n JOIN documents d ON d.id=n.doc_id
    WHERE d.corpus_id=$1 AND (n.doc_id=$2 OR n.id IN (
      SELECT COALESCE(a.target_node_id,e.canonical_node_id) FROM anchors a
      LEFT JOIN entities e ON e.id=a.target_entity_id AND e.corpus_id=$1
      WHERE a.doc_id=$2 AND ($3::int IS NULL OR a.page=$3)
    ))`, [corpusId, request.doc_id, request.page ?? null]);
  const anchorRows = await db().query(`SELECT a.* FROM anchors a JOIN documents d ON d.id=a.doc_id
    WHERE d.corpus_id=$1 AND a.doc_id=$2 AND ($3::int IS NULL OR a.page=$3)`, [corpusId, request.doc_id, request.page ?? null]);
  const roots = matchSelectionRoots(rootRows.rows.map((row) => Node.parse(row)), request,
    anchorRows.rows.map((row) => Anchor.parse(row))).sort().slice(0, 3);
  if (!roots.length) return { chain: [] };
  const graph = await db().query(`WITH RECURSIVE walk AS (
    SELECT n.id, 0 AS depth, ARRAY[n.id] AS path FROM nodes n
    JOIN documents d ON d.id=n.doc_id WHERE d.corpus_id=$1 AND n.id=ANY($2::uuid[])
    UNION ALL
    SELECT child.dst, walk.depth+1, walk.path || child.dst FROM walk
    CROSS JOIN LATERAL (
      SELECT e.dst, MAX(e.confidence) AS confidence FROM edges e
      JOIN nodes target ON target.id=e.dst JOIN documents d ON d.id=target.doc_id
      WHERE e.src=walk.id AND d.corpus_id=$1 AND NOT e.dst=ANY(walk.path)
      GROUP BY e.dst ORDER BY confidence DESC,e.dst LIMIT 3
    ) child WHERE walk.depth<4
  ), ids AS (SELECT DISTINCT id FROM walk)
  SELECT COALESCE((SELECT jsonb_agg(n ORDER BY n.id) FROM nodes n JOIN ids ON ids.id=n.id),'[]'::jsonb) AS nodes,
    COALESCE((SELECT jsonb_agg(e ORDER BY e.src,e.dst,e.kind) FROM edges e
      WHERE e.src IN (SELECT id FROM ids) AND e.dst IN (SELECT id FROM ids)),'[]'::jsonb) AS edges`, [corpusId, roots]);
  return traceGraph(graph.rows[0].nodes.map((row: unknown) => Node.parse(row)),
    graph.rows[0].edges.map((row: unknown) => Edge.parse(row)), roots, request.read_node_ids);
}
