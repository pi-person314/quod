/**
 * USE_FIXTURES=1 makes every API route serve from fixtures/golden/* instead of
 * Postgres. Keep this working to the end: it is the demo fallback if the live
 * parser breaks. Server-side only.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { GoldenFixture, type Anchor, type Card, type Doc, type Edge, type Entity, type Node } from "@cairn/contracts";

export function fixturesEnabled(): boolean {
  return process.env.USE_FIXTURES === "1";
}

/** Override for deploys where the repo layout differs (Vercel root = apps/web). */
export const GOLDEN_DIR = process.env.FIXTURES_DIR ?? resolve(process.cwd(), "../../fixtures/golden");

export interface GoldenCorpus {
  docs: Doc[];
  nodes: Node[];
  edges: Edge[];
  anchors: Anchor[];
  cards: Card[];
  entities: Entity[];
  /** Absolute path to a document's PDF, if the fixture declares one. */
  pdfPath: (docId: string) => string | undefined;
}

let cache: GoldenCorpus | undefined;

/** All golden files merged into one corpus. Cached for the process lifetime. */
export function loadGoldenCorpus(): GoldenCorpus {
  if (cache) return cache;
  const pdfByDoc = new Map<string, string>();
  const corpus: GoldenCorpus = {
    docs: [], nodes: [], edges: [], anchors: [], cards: [], entities: [],
    pdfPath: (docId) => pdfByDoc.get(docId),
  };
  if (!existsSync(GOLDEN_DIR)) return (cache = corpus);
  for (const file of readdirSync(GOLDEN_DIR).filter((f) => f.endsWith(".json")).sort()) {
    const fx = GoldenFixture.parse(JSON.parse(readFileSync(join(GOLDEN_DIR, file), "utf8")));
    corpus.docs.push(fx.document);
    corpus.nodes.push(...fx.nodes);
    corpus.edges.push(...fx.edges);
    corpus.anchors.push(...fx.anchors);
    corpus.cards.push(...fx.cards);
    corpus.entities.push(...fx.entities);
    if (fx.pdf) pdfByDoc.set(fx.document.id, join(GOLDEN_DIR, fx.pdf));
  }
  return (cache = corpus);
}
