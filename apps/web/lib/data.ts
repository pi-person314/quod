import { db } from "@cairn/contracts/db";
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import type {
  Corpus,
  Doc,
  Node,
  Edge,
  Anchor,
  Card,
  Entity,
} from "@cairn/contracts";
import { fixturesEnabled, loadGoldenCorpus } from "./fixtures";
export interface Dataset {
  docs: Doc[];
  nodes: Node[];
  edges: Edge[];
  anchors: Anchor[];
  cards: Card[];
  entities: Entity[];
  fixture: boolean;
}
export function scopeDataset(data: Dataset, corpusId: string): Dataset {
  const docs = data.docs.filter((d) => d.corpus_id === corpusId),
    docIds = new Set(docs.map((d) => d.id));
  const nodes = data.nodes.filter((n) => docIds.has(n.doc_id)),
    nodeIds = new Set(nodes.map((n) => n.id));
  return {
    ...data,
    docs,
    nodes,
    anchors: data.anchors.filter((a) => docIds.has(a.doc_id)),
    cards: data.cards.filter((c) => docIds.has(c.source.doc_id)),
    edges: data.edges.filter((e) => nodeIds.has(e.src) && nodeIds.has(e.dst)),
    entities: data.entities.filter((e) => e.corpus_id === corpusId),
  };
}
export const LOCAL = resolve(process.cwd(), ".local-data");
export async function localRecords<T>(folder: string): Promise<T[]> {
  const dir = join(LOCAL, folder);
  await mkdir(dir, { recursive: true });
  const files = await readdir(dir);
  return Promise.all(
    files
      .filter((f) => f.endsWith(".json"))
      .map(async (f) => JSON.parse(await readFile(join(dir, f), "utf8"))),
  );
}
export async function saveLocal(folder: string, id: string, value: unknown) {
  await mkdir(join(LOCAL, folder), { recursive: true });
  await writeFile(join(LOCAL, folder, `${id}.json`), JSON.stringify(value));
}
export async function dataset(): Promise<Dataset> {
  if (fixturesEnabled()) {
    const g = loadGoldenCorpus();
    const uploads = await localRecords<{ doc: Doc; nodes: Node[] }>("docs");
    return {
      docs: [...g.docs, ...uploads.map((x) => x.doc)],
      nodes: [...g.nodes, ...uploads.flatMap((x) => x.nodes)],
      edges: g.edges,
      anchors: g.anchors,
      cards: g.cards,
      entities: g.entities,
      fixture: true,
    };
  }
  const [docs, nodes, edges, anchors, cards, entities] = await Promise.all(
    ["documents", "nodes", "edges", "anchors", "cards", "entities"].map((t) =>
      db().query(`SELECT * FROM ${t}`),
    ),
  );
  return {
    docs: docs.rows,
    nodes: nodes.rows,
    edges: edges.rows,
    anchors: anchors.rows,
    cards: cards.rows.map((c) => ({
      ...c,
      source: { doc_id: c.source_doc_id, page: c.source_page },
    })),
    entities: entities.rows,
    fixture: false,
  };
}
export async function corpora(): Promise<Corpus[]> {
  if (!fixturesEnabled())
    return (await db().query("SELECT * FROM corpora ORDER BY created_at DESC"))
      .rows;
  return [
    {
      id: "00000000-0000-4000-8000-000000000001",
      name: "Linear algebra · Demonstration",
      created_at: "2026-09-19T00:00:00Z",
    },
    ...(await localRecords<Corpus>("corpora")),
  ];
}
export async function pdfBytes(id: string) {
  if (fixturesEnabled()) {
    const path = loadGoldenCorpus().pdfPath(id);
    return readFile(path ?? join(LOCAL, "pdf", `${id}.pdf`));
  }
  const row = await db().query("SELECT pdf_bytes FROM documents WHERE id=$1", [
    id,
  ]);
  return row.rows[0]?.pdf_bytes as Buffer | undefined;
}
