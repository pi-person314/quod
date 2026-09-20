/**
 * Cairn shared contracts. See CONTRACTS.md at the repo root.
 *
 * The four core types (Node, Edge, Anchor, Card) are frozen. Changing them is
 * a synchronous decision across all three sessions. API shapes may gain
 * optional fields if logged in INTEGRATION.md.
 *
 * Each schema is exported twice under the same name: as a zod value and as
 * the inferred TypeScript type. `import { Node } from "@quod/contracts"`
 * gives you both.
 */
import { z } from "zod";

// ---- Primitives -----------------------------------------------------------

export const Uuid = z.string().uuid();

/** [x0, y0, x1, y1] in PDF points, origin top-left, y down (PyMuPDF space). */
export const BBox = z.tuple([z.number(), z.number(), z.number(), z.number()]);
export type BBox = z.infer<typeof BBox>;

/** Pages are 1-indexed everywhere. */
export const PageNumber = z.number().int().positive();

export const Confidence = z.number().min(0).max(1);

// ---- Enums ----------------------------------------------------------------

export const NodeKind = z.enum([
  "definition",
  "theorem",
  "lemma",
  "proposition",
  "corollary",
  "example",
  "proof",
  "notation",
]);
export type NodeKind = z.infer<typeof NodeKind>;

export const EdgeKind = z.enum(["depends_on", "uses_notation", "specialises", "restates"]);
export type EdgeKind = z.infer<typeof EdgeKind>;

export const Extractor = z.enum(["deterministic", "heuristic", "notation", "llm"]);
export type Extractor = z.infer<typeof Extractor>;

/** Ingest pipeline stages, in order. `done` and `error` are terminal. */
export const IngestStage = z.enum([
  "queued",
  "parse",
  "segment",
  "anchors",
  "edges",
  "resolve",
  "bake",
  "done",
  "error",
]);
export type IngestStage = z.infer<typeof IngestStage>;

export const DocStatus = z.enum(["queued", "ingesting", "ready", "unsupported", "error"]);
export type DocStatus = z.infer<typeof DocStatus>;

// ---- Core types (frozen) --------------------------------------------------

export const Clause = z.object({ id: z.string(), text: z.string() });
export type Clause = z.infer<typeof Clause>;

export const SymbolEntry = z.object({ sym: z.string(), role: z.string() });
export type SymbolEntry = z.infer<typeof SymbolEntry>;

export const Node = z.object({
  id: Uuid,
  doc_id: Uuid,
  kind: NodeKind,
  /** "Theorem 3.4". null for unnumbered environments. */
  label: z.string().nullable(),
  /** "Rank-Nullity". null when the source gives none. */
  title: z.string().nullable(),
  statement_md: z.string(),
  clauses: z.array(Clause),
  /** Symbols this node introduces. */
  symbols: z.array(SymbolEntry),
  page: PageNumber,
  bbox: BBox,
  entity_id: Uuid.nullable(),
  confidence: Confidence,
});
export type Node = z.infer<typeof Node>;

/** `src` depends on `dst`. */
export const Edge = z.object({
  src: Uuid,
  dst: Uuid,
  kind: EdgeKind,
  extractor: Extractor,
  confidence: Confidence,
});
export type Edge = z.infer<typeof Edge>;

export const Anchor = z.object({
  id: Uuid,
  doc_id: Uuid,
  page: PageNumber,
  bbox: BBox,
  /** The literal reference text, e.g. "by Theorem 3.4", "the previous lemma". */
  surface: z.string(),
  /** Set by A3 for explicit references; null until C3 resolves soft/named ones. */
  target_node_id: Uuid.nullable(),
  target_entity_id: Uuid.nullable(),
  /** Set by the bake stage. */
  card_id: Uuid.nullable(),
});
export type Anchor = z.infer<typeof Anchor>;

export const Substitution = z.object({ from: z.string(), to: z.string() });
export type Substitution = z.infer<typeof Substitution>;

export const Card = z.object({
  id: Uuid,
  anchor_id: Uuid,
  /** "Rank-Nullity, clause (ii)" */
  headline: z.string(),
  /** Target statement rewritten in the invoking page's notation, narrowed to the clause in use. */
  instantiated_md: z.string(),
  /** Full target statement, original notation. Behind the "show full statement" toggle. */
  full_md: z.string(),
  substitutions: z.array(Substitution),
  /** Clause ids in use. Empty means the whole statement. */
  clause_ids: z.array(z.string()).default([]),
  /** Plain-language one-liner, shown above the formal statement for unread nodes. */
  gloss: z.string(),
  source: z.object({ doc_id: Uuid, page: PageNumber }),
});
export type Card = z.infer<typeof Card>;

// ---- Supporting types -----------------------------------------------------

export const Corpus = z.object({
  id: Uuid,
  name: z.string(),
  created_at: z.string().datetime(),
});
export type Corpus = z.infer<typeof Corpus>;

/** Named Doc rather than Document to avoid shadowing the DOM global in apps/web. */
export const Doc = z.object({
  id: Uuid,
  corpus_id: Uuid,
  title: z.string(),
  filename: z.string(),
  /** sha256 of the PDF bytes; idempotent re-ingest key (A5). null for fixtures. */
  file_hash: z.string().nullable(),
  page_count: z.number().int().nonnegative(),
  /** A1 parse quality score in [0, 1]. Under 0.8 => status "unsupported". null before parse. */
  quality: Confidence.nullable(),
  status: DocStatus,
});
export type Doc = z.infer<typeof Doc>;

/** One canonical result that may occur as several Nodes across documents (F3). */
export const Entity = z.object({
  id: Uuid,
  corpus_id: Uuid,
  /** The occurrence the reader jumps to. Usually the textbook one. */
  canonical_node_id: Uuid.nullable(),
  name: z.string(),
});
export type Entity = z.infer<typeof Entity>;

/** Per-node local reading state (F6). Single user, no accounts. */
export const ReaderState = z.object({
  node_id: Uuid,
  seen: z.boolean(),
  dwell_ms: z.number().int().nonnegative(),
  hover_count: z.number().int().nonnegative(),
  known: z.boolean(),
});
export type ReaderState = z.infer<typeof ReaderState>;

/** Summary of a node, small enough to put on an SSE event. */
export const NodeSummary = Node.pick({ id: true, kind: true, label: true, title: true, page: true });
export type NodeSummary = z.infer<typeof NodeSummary>;

/** One SSE message on GET /api/corpus/:id/events. */
export const IngestEvent = z.object({
  stage: IngestStage,
  doc_id: Uuid,
  nodes_done: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  /** Present when this event announces a newly committed node (B3 growing list). */
  node: NodeSummary.optional(),
  /** Human-readable detail; required when stage is "error". */
  message: z.string().optional(),
});
export type IngestEvent = z.infer<typeof IngestEvent>;

// ---- Fixtures -------------------------------------------------------------

/** Every golden fixture file shares this corpus id. */
export const FIXTURE_CORPUS_ID = "00000000-0000-4000-8000-000000000001";

/** Envelope of one fixtures/golden/<name>.json file. One file per source document. */
export const GoldenFixture = z.object({
  document: Doc,
  /** Source PDF, relative to fixtures/golden/. B1 renders it. */
  pdf: z.string().optional(),
  nodes: z.array(Node),
  edges: z.array(Edge),
  anchors: z.array(Anchor),
  cards: z.array(Card),
  entities: z.array(Entity).default([]),
});
export type GoldenFixture = z.infer<typeof GoldenFixture>;

// ---- API shapes -----------------------------------------------------------
// Route owners may add optional fields; log each in INTEGRATION.md.

export const CreateCorpusRequest = z.object({ name: z.string().min(1) });
export const CreateCorpusResponse = z.object({ corpus_id: Uuid });

export const UploadDocsResponse = z.object({ doc_ids: z.array(Uuid) });

export const AnchorsResponse = z.object({ anchors: z.array(Anchor) });

export const CardResponse = Card;

export const SearchHit = z.object({ node: Node, score: z.number() });
export const SearchResponse = z.object({ hits: z.array(SearchHit) });

export const TraceRequest = z.object({
  doc_id: Uuid,
  /** The selected sentence, verbatim. */
  selection: z.string().min(1),
  page: PageNumber.optional(),
  /** Nodes the reader has already read; these come back with read: true and B greys them out. */
  read_node_ids: z.array(Uuid).default([]),
});
export type TraceRequest = z.infer<typeof TraceRequest>;

export const TraceHop = z.object({
  node: Node,
  entity_id: Uuid.nullable(),
  /** One line: why this hop is needed for the one above it. */
  reason: z.string(),
  read: z.boolean(),
  /** 0 = mentioned directly in the selection. Capped at 4. */
  depth: z.number().int().min(0).max(4),
});
export type TraceHop = z.infer<typeof TraceHop>;

/** chain[0] is the selection's direct dependency; the last hop is the innermost prerequisite. */
export const TraceResponse = z.object({ chain: z.array(TraceHop) });
export type TraceResponse = z.infer<typeof TraceResponse>;

export const ResolveRequest = z.object({ corpus_id: Uuid, node_ids: z.array(Uuid).min(1) });
export const ResolveVerdict = z.enum(["same", "different", "specialisation"]);
export const ResolveDecision = z.object({
  node_id: Uuid,
  entity_id: Uuid,
  verdict: ResolveVerdict,
  confidence: Confidence,
});
export const ResolveResponse = z.object({ decisions: z.array(ResolveDecision) });
export type ResolveResponse = z.infer<typeof ResolveResponse>;

export const BakeRequest = z.object({ doc_id: Uuid });
export const BakeResponse = z.object({ cards_done: z.number().int().nonnegative() });

export const ForwardHit = z.object({ node: Node, score: z.number() });
export const ForwardResponse = z.object({ entity_id: Uuid, downstream: z.array(ForwardHit) });
export type ForwardResponse = z.infer<typeof ForwardResponse>;
