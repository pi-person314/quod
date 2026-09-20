import { db } from "@quod/contracts/db";
import { Doc as DocSchema } from "@quod/contracts";
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
} from "@quod/contracts";
import { fixturesEnabled, loadGoldenCorpus } from "./fixtures";
import { AuthError, type AuthUser } from "./auth";
import { listUserCorpora, assertCorpusOwner } from "./firestore";
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
    // Golden documents have no local upload record. Keep a title-only overlay
    // so renaming one never copies its fixture nodes into writable storage.
    const titles = new Map((await localRecords<{ id: string; title: string }>("doc-titles"))
      .map(({ id, title }) => [id, title]));
    return {
      docs: [...g.docs, ...uploads.map((x) => x.doc)].map(doc => titles.has(doc.id) ? { ...doc, title: titles.get(doc.id)! } : doc),
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
    // Never serialize bytea PDF contents into the React client payload.
    docs: docs.rows.map(row => DocSchema.parse(row)),
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
  const defaults = [
    {
      id: "00000000-0000-4000-8000-000000000001",
      name: "Linear algebra · Demonstration",
      created_at: "2026-09-19T00:00:00Z",
    },
  ];
  return [...new Map([...defaults, ...(await localRecords<Corpus>("corpora"))].map(record => [record.id, record])).values()];
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

/** Only serialize records belonging to the authenticated user's Firestore library. */
export async function userDataset(user: AuthUser): Promise<Dataset> {
  const owned = new Set((await listUserCorpora(user)).map(c => c.id));
  if (!owned.size) return { docs: [], nodes: [], edges: [], anchors: [], cards: [], entities: [], fixture: fixturesEnabled() };
  const data = await dataset();
  const docs = data.docs.filter(d => owned.has(d.corpus_id));
  const docIds = new Set(docs.map(d => d.id));
  const nodes = data.nodes.filter(n => docIds.has(n.doc_id));
  const nodeIds = new Set(nodes.map(n => n.id));
  return { ...data, docs, nodes,
    edges: data.edges.filter(e => nodeIds.has(e.src) && nodeIds.has(e.dst)),
    anchors: data.anchors.filter(a => docIds.has(a.doc_id)),
    cards: data.cards.filter(c => docIds.has(c.source.doc_id)),
    entities: data.entities.filter(e => owned.has(e.corpus_id)),
  };
}
export async function requireDocumentOwner(user: AuthUser, docId: string): Promise<Doc> {
  const doc = (await dataset()).docs.find(d => d.id === docId);
  if (!doc) throw new AuthError(404, "Document not found.");
  await assertCorpusOwner(user, doc.corpus_id);
  return doc;
}

/** Rename metadata only; a fixture title overlay deliberately contains no nodes. */
export async function renameDocumentTitle(id: string, title: string): Promise<boolean> {
  if (fixturesEnabled()) {
    const exists = (await dataset()).docs.some(doc => doc.id === id);
    if (!exists) return false;
    await saveLocal("doc-titles", id, { id, title });
    return true;
  }
  const result = await db().query("UPDATE documents SET title=$2 WHERE id=$1", [id, title]);
  return result.rowCount === 1;
}
