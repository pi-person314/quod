/**
 * USE_FIXTURES=1 makes every API route serve from fixtures/golden/* instead of
 * Postgres. Keep this working to the end: it is the demo fallback if the live
 * parser breaks. Server-side only.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  GoldenFixture,
  type Anchor,
  type Card,
  type Doc,
  type Edge,
  type Entity,
  type Node,
} from "@quod/contracts";

export function fixturesEnabled(): boolean {
  return process.env.USE_FIXTURES !== "0";
}

/** Override for deploys where the repo layout differs (Vercel root = apps/web). */
export const GOLDEN_DIR =
  process.env.FIXTURES_DIR ?? resolve(process.cwd(), "../../fixtures/golden");

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

/** Reload at request boundaries so newly arrived A0 fixtures take precedence. */
export function loadGoldenCorpus(): GoldenCorpus {
  const pdfByDoc = new Map<string, string>();
  const corpus: GoldenCorpus = {
    docs: [],
    nodes: [],
    edges: [],
    anchors: [],
    cards: [],
    entities: [],
    pdfPath: (docId) => pdfByDoc.get(docId),
  };
  const dir =
    existsSync(GOLDEN_DIR) &&
    readdirSync(GOLDEN_DIR).some((f) => f.endsWith(".json"))
      ? GOLDEN_DIR
      : resolve(process.cwd(), "demo");
  for (const file of readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()) {
    const fx = GoldenFixture.parse(
      JSON.parse(readFileSync(join(dir, file), "utf8")),
    );
    corpus.docs.push(fx.document);
    corpus.nodes.push(...fx.nodes);
    corpus.edges.push(...fx.edges);
    corpus.anchors.push(...fx.anchors);
    corpus.cards.push(...fx.cards);
    corpus.entities.push(...fx.entities);
    if (fx.pdf) pdfByDoc.set(fx.document.id, join(dir, fx.pdf));
  }
  return corpus;
}
