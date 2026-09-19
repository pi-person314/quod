import { GoldenFixture, type Node } from "@cairn/contracts";
import { instantiationCases } from "./instantiation-cases";
import { instantiateCard } from "../prompts/instantiate";

export const DEVELOPMENT_CORPUS_ID = "00000000-0000-4000-8000-000000000001";

/** Synthetic development corpus; deliberately no source PDF or live-quality claims. */
export async function developmentCorpus(): Promise<GoldenFixture[]> {
  const nodes = instantiationCases.map(({ input }, i) => ({ ...input.target,
    entity_id: `00000000-0000-4000-8000-${String(3000 + i).padStart(12, "0")}` }));
  const cards = await Promise.all(instantiationCases.map(async (fixture, i) => (await instantiateCard({
    ...fixture.input, target: nodes[i], cardId: `00000000-0000-4000-8000-${String(4000 + i).padStart(12, "0")}`,
  }, async () => fixture.expected)).card));
  const anchors = instantiationCases.map(({ input }, i) => ({ ...input.anchor, target_entity_id: nodes[i].entity_id, card_id: cards[i].id }));
  const restatements: Node[] = nodes.slice(0, 3).map((node, i) => ({ ...node,
    id: `00000000-0000-4000-8000-${String(5000 + i).padStart(12, "0")}`,
    doc_id: anchors[0].doc_id, label: `Exercise result ${i + 1}`, title: `Restatement of ${node.title}`,
    statement_md: cards[i].instantiated_md, symbols: [{ sym: "y", role: node.symbols[0].role }],
    clauses: node.clauses.map((clause) => ({ ...clause, text: clause.text.replace(/\bx\b/g, "y") })),
  }));
  const document = (id: string, title: string) => ({ id, corpus_id: DEVELOPMENT_CORPUS_ID, title,
    filename: `${title}.pdf`, file_hash: null, page_count: 20, quality: 1, status: "ready" as const });
  return [
    GoldenFixture.parse({ document: document(nodes[0].doc_id, "Synthetic chapter"), nodes,
      edges: [{ src: nodes[1].id, dst: nodes[0].id, kind: "depends_on", extractor: "deterministic", confidence: 1 }],
      anchors: [], cards: [], entities: nodes.map((node) => ({ id: node.entity_id, corpus_id: DEVELOPMENT_CORPUS_ID,
        canonical_node_id: node.id, name: node.title })) }),
    GoldenFixture.parse({ document: document(anchors[0].doc_id, "Synthetic exercises"), nodes: restatements,
      edges: restatements.map((node, i) => ({ src: node.id, dst: nodes[i].id, kind: "restates", extractor: "deterministic", confidence: 1 })),
      anchors, cards, entities: [] }),
  ];
}
