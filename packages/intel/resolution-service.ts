import { createHash } from "node:crypto";
import { z } from "zod";
import { Anchor, Entity, Node, ResolveRequest, ResolveResponse } from "@cairn/contracts";
import { db } from "@cairn/contracts/db";
import { callModel, MODELS } from "./llm";
import { createSearchClient } from "./search";
import { mapConcurrent } from "./concurrency";
import { matchReferences, type ReferenceModel } from "./reference-resolution";
import { adjudicatePairs, planResolution, type CandidatePair, type ResolutionPlan } from "./resolve";

export interface ResolutionSnapshot { nodes: Node[]; entities: Entity[]; anchors: Anchor[] }
export interface ResolutionRepository {
  load(corpusId: string): Promise<ResolutionSnapshot>;
  save(corpusId: string, snapshot: ResolutionSnapshot, plan: ResolutionPlan): Promise<void>;
}
export interface ResolutionSearch {
  indexNodes(corpusId: string, nodes: readonly Node[]): Promise<number>;
  removeStaleNodes?(corpusId: string, validNodeIds: readonly string[]): Promise<void>;
  resolutionCandidates(node: Node, corpusId: string): Promise<{ node: Node; score: number }[]>;
}
export type ResolutionModel = Parameters<typeof adjudicatePairs>[1];
type ResolveInput = z.infer<typeof ResolveRequest>;

/** Retrieval and paid work happen outside a DB transaction; save checks for stale input. */
export async function resolveCorpus(input: ResolveInput, deps: {
  repository: ResolutionRepository; search: ResolutionSearch; model: ResolutionModel;
  progress?: (message: string) => Promise<void>;
  referenceModel?: ReferenceModel;
}): Promise<ResolveResponse> {
  const request = ResolveRequest.parse(input);
  const snapshot = await deps.repository.load(request.corpus_id);
  const byId = new Map(snapshot.nodes.map((node) => [node.id, node]));
  const requested = [...new Set(request.node_ids)];
  if (requested.some((id) => !byId.has(id))) throw new Error("Requested node is outside the corpus");
  await deps.search.indexNodes(request.corpus_id, snapshot.nodes);
  await deps.search.removeStaleNodes?.(request.corpus_id, snapshot.nodes.map(node => node.id));
  await deps.progress?.(`Finding related results for ${requested.length} statements…`);
  const groups = await mapConcurrent(requested, 4, async id => {
    const pairs: CandidatePair[] = [];
    const node = byId.get(id)!;
    const seen = new Set<string>();
    for (const hit of await deps.search.resolutionCandidates(node, request.corpus_id)) {
      const candidate = byId.get(hit.node.id);
      if (!candidate || candidate.id === node.id) throw new Error("Candidate is outside the corpus or is the source node");
      if (seen.has(candidate.id)) continue;
      seen.add(candidate.id);
      if (seen.size > 8) break;
      // Use fresh Postgres text, never an outdated search copy, for adjudication.
      pairs.push({ node, candidate });
    }
    return pairs;
  });
  const pairs = groups.flat();
  await deps.progress?.(`Comparing related results: 0 / ${pairs.length}`);
  const decisions = await adjudicatePairs(pairs, deps.model, async (done, total) => {
    await deps.progress?.(`Comparing related results: ${done} / ${total}`);
  });
  await deps.progress?.("Saving result connections…");
  const plan = planResolution(request.corpus_id, snapshot.nodes, snapshot.entities, decisions);
  if (deps.referenceModel) {
    const exact = resolvedAnchorEntities(snapshot, plan);
    const unresolved = snapshot.anchors.filter(anchor => !exact.has(anchor.id));
    if (unresolved.length) {
      await deps.progress?.(`Matching ${unresolved.length} citations to source results…`);
      plan.anchorTargets = await matchReferences(unresolved, snapshot.nodes, async context =>
        (await deps.search.resolutionCandidates(context, request.corpus_id))
          .flatMap(hit => byId.has(hit.node.id) ? [byId.get(hit.node.id)!] : []), deps.referenceModel);
    }
  }
  await deps.repository.save(request.corpus_id, snapshot, plan);
  const refreshed = await deps.repository.load(request.corpus_id);
  await deps.search.indexNodes(request.corpus_id, refreshed.nodes);
  return ResolveResponse.parse({ decisions: plan.decisions });
}

function fingerprint(snapshot: ResolutionSnapshot): string {
  const stable = {
    nodes: [...snapshot.nodes].sort((a, b) => a.id.localeCompare(b.id)),
    entities: [...snapshot.entities].sort((a, b) => a.id.localeCompare(b.id)),
    anchors: [...snapshot.anchors].sort((a, b) => a.id.localeCompare(b.id)),
  };
  return createHash("sha256").update(JSON.stringify(stable)).digest("hex");
}

type Query = (text: string, values: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
async function loadSnapshot(query: Query, corpusId: string): Promise<ResolutionSnapshot> {
  const nodes = await query("SELECT n.* FROM nodes n JOIN documents d ON d.id=n.doc_id WHERE d.corpus_id=$1", [corpusId]);
  const entities = await query("SELECT * FROM entities WHERE corpus_id=$1", [corpusId]);
  const anchors = await query("SELECT a.* FROM anchors a JOIN documents d ON d.id=a.doc_id WHERE d.corpus_id=$1", [corpusId]);
  return { nodes: nodes.rows.map((row) => Node.parse(row)), entities: entities.rows.map((row) => Entity.parse(row)),
    anchors: anchors.rows.map((row) => Anchor.parse(row)) };
}

/** Exact named anchors only; ambiguous names remain unresolved. */
export function resolvedAnchorEntities(snapshot: ResolutionSnapshot, plan: ResolutionPlan): Map<string, string> {
  const normalize = (text: string) => text.replace(/[‐‑–—]/g, "-").replace(/\s+/g, " ").trim();
  const assigned = new Map(plan.assignments.map((item) => [item.node_id, item.entity_id]));
  const existingAliases = new Map<string, string>();
  for (const node of snapshot.nodes) if (node.entity_id) existingAliases.set(node.entity_id, assigned.get(node.id)!);
  const result = new Map<string, string>();
  for (const anchor of snapshot.anchors) {
    const direct = anchor.target_node_id ? assigned.get(anchor.target_node_id) : undefined;
    const matched = plan.anchorTargets?.find(target => target.anchor_id === anchor.id)?.node_id;
    if (matched && assigned.has(matched)) { result.set(anchor.id, assigned.get(matched)!); continue; }
    const previous = anchor.target_entity_id ? existingAliases.get(anchor.target_entity_id) : undefined;
    if (direct || previous) { result.set(anchor.id, (direct ?? previous)!); continue; }
    const candidates = new Set<string>();
    for (const node of snapshot.nodes) for (const name of [node.label, node.title]) {
      if (!name?.trim()) continue;
      const escaped = normalize(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}]|\\.\\d)`, "iu").test(normalize(anchor.surface))) {
        candidates.add(assigned.get(node.id)!);
      }
    }
    if (candidates.size === 1) result.set(anchor.id, [...candidates][0]);
  }
  return result;
}

export function postgresResolutionRepository(): ResolutionRepository {
  return {
    load: (corpusId) => loadSnapshot((text, values) => db().query(text, values), corpusId),
    async save(corpusId, snapshot, plan) {
      const connection = await db().connect();
      try {
        await connection.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
        const corpus = await connection.query("SELECT id FROM corpora WHERE id=$1 FOR UPDATE", [corpusId]);
        if (corpus.rowCount !== 1) throw new Error("Corpus not found");
        const current = await loadSnapshot((text, values) => connection.query(text, values), corpusId);
        if (fingerprint(current) !== fingerprint(snapshot)) throw new Error("Corpus changed during resolution; retry required");
        for (const entity of plan.entities) await connection.query(`INSERT INTO entities (id,corpus_id,canonical_node_id,name)
          VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO UPDATE SET canonical_node_id=EXCLUDED.canonical_node_id, name=EXCLUDED.name
          WHERE entities.corpus_id=EXCLUDED.corpus_id`, [entity.id, corpusId, entity.canonical_node_id, entity.name]);
        for (const assignment of plan.assignments) await connection.query("UPDATE nodes SET entity_id=$1 WHERE id=$2", [assignment.entity_id, assignment.node_id]);
        const confidences = new Map<string, number>();
        for (const decision of plan.decisions) if (decision.verdict === "same") {
          confidences.set(decision.node_id, Math.max(confidences.get(decision.node_id) ?? 0, decision.confidence));
        }
        for (const [nodeId, confidence] of confidences) await connection.query("UPDATE nodes SET confidence=$1 WHERE id=$2", [confidence, nodeId]);
        for (const edge of plan.edges) await connection.query(`INSERT INTO edges (src,dst,kind,extractor,confidence)
          VALUES ($1,$2,$3,$4,$5) ON CONFLICT (src,dst,kind) DO UPDATE SET confidence=GREATEST(edges.confidence,EXCLUDED.confidence)`,
          [edge.src, edge.dst, edge.kind, edge.extractor, edge.confidence]);
        for (const [anchorId, entityId] of resolvedAnchorEntities(snapshot, plan)) {
          await connection.query("UPDATE anchors SET target_entity_id=$1,target_node_id=COALESCE(target_node_id,(SELECT canonical_node_id FROM entities WHERE id=$1)) WHERE id=$2", [entityId, anchorId]);
        }
        for (const target of plan.anchorTargets ?? []) {
          if (!snapshot.anchors.some(a => a.id === target.anchor_id) || !snapshot.nodes.some(n => n.id === target.node_id)) throw new Error("Reference target outside corpus");
          await connection.query("UPDATE anchors SET target_node_id=$1 WHERE id=$2", [target.node_id, target.anchor_id]);
        }
        // Preserve old entity IDs as aliases through their canonical node; no destructive deletion.
        await connection.query(`UPDATE entities old SET canonical_node_id=canonical.canonical_node_id
          FROM nodes n JOIN entities canonical ON canonical.id=n.entity_id
          WHERE old.corpus_id=$1 AND old.canonical_node_id=n.id AND old.id<>canonical.id`, [corpusId]);
        await connection.query("COMMIT");
      } catch (error) { await connection.query("ROLLBACK"); throw error; }
      finally { connection.release(); }
    },
  };
}

export function resolveWithDefaults(input: ResolveInput): Promise<ResolveResponse> {
  return resolveCorpus(input, { repository: postgresResolutionRepository(), search: createSearchClient(),
    progress: async message => {
      await db().query(`UPDATE ingest_progress p SET message=$2,updated_at=now() FROM documents d
        WHERE p.doc_id=d.id AND d.corpus_id=$1 AND p.stage='resolve' AND d.status='ingesting'`, [input.corpus_id, message]);
    },
    model: async (request) => (await callModel({ ...request, stage: "resolve", model: MODELS.quality,
      corpusId: input.corpus_id, maxOutputTokens: 16384, cache: "content", promptCacheKey: `resolve:${input.corpus_id}`, meta: { prompt_version: "adjudicate-v3" } })).text,
    referenceModel: async request => (await callModel({ ...request, stage: "resolve", model: MODELS.quality,
      corpusId: input.corpus_id, maxOutputTokens: 4096, cache: "content", promptCacheKey: `references:${input.corpus_id}`, meta: { prompt_version: "reference-v1" } })).text });
}

/** Explicit offline mode: merge only byte-identical statements of the same kind.
 * Semantic equivalence still requires the model path and a live quality evaluation.
 */
export async function resolveDeterministically(input: ResolveInput): Promise<ResolveResponse> {
  const request = ResolveRequest.parse(input);
  const repository = postgresResolutionRepository();
  const snapshot = await repository.load(request.corpus_id);
  const requested = new Set(request.node_ids);
  if (request.node_ids.some(id => !snapshot.nodes.some(node => node.id === id))) throw new Error("Requested node is outside the corpus");
  const decisions = snapshot.nodes.flatMap(node => requested.has(node.id) ? snapshot.nodes
    .filter(other => other.id !== node.id && other.kind === node.kind && node.statement_md.trim().length > 0
      && other.statement_md === node.statement_md)
    .map(other => ({ node_id: node.id, candidate_id: other.id, verdict: "same" as const, confidence: 1 })) : []);
  const plan = planResolution(request.corpus_id, snapshot.nodes, snapshot.entities, decisions);
  plan.edges = plan.edges.map(edge => ({ ...edge, extractor: "deterministic" as const }));
  await repository.save(request.corpus_id, snapshot, plan);
  return ResolveResponse.parse({ decisions: plan.decisions });
}
