import { Anchor, Card, Node, Uuid, type SymbolEntry } from "@cairn/contracts";
import { db } from "@cairn/contracts/db";
import { instantiateCard, INSTANTIATION_PROMPT_VERSION, type InstantiationModel } from "./prompts/instantiate";
import { callModel, MODELS } from "./llm";

export interface BakeRepository {
  anchors(docId: string): Promise<Anchor[]>;
  target(anchor: Anchor): Promise<Node | undefined>;
  existing(anchorId: string): Promise<Card | undefined>;
  context(anchor: Anchor): Promise<{ invokingParagraph: string; localSymbols: SymbolEntry[] } | undefined>;
  save(card: Card): Promise<Card>;
}

/** Accept context only when the anchor occurs once inside a containing parsed node. */
export function extractInvokingContext(anchor: Anchor, nodes: readonly Node[]) {
  const candidates = nodes.filter((node) => node.doc_id === anchor.doc_id && node.page === anchor.page &&
    node.bbox[0] <= anchor.bbox[0] && node.bbox[1] <= anchor.bbox[1] &&
    node.bbox[2] >= anchor.bbox[2] && node.bbox[3] >= anchor.bbox[3] && node.symbols.length > 0)
    .sort((a, b) => ((a.bbox[2] - a.bbox[0]) * (a.bbox[3] - a.bbox[1])) - ((b.bbox[2] - b.bbox[0]) * (b.bbox[3] - b.bbox[1])) || a.id.localeCompare(b.id));
  for (const node of candidates) {
    if (!anchor.surface.trim()) return undefined;
    const paragraphs = node.statement_md.split(/\n\s*\n/).filter((text) => text.includes(anchor.surface));
    if (paragraphs.length !== 1 || paragraphs[0].split(anchor.surface).length !== 2) continue;
    const symbols = new Map<string, SymbolEntry>();
    let ambiguous = false;
    for (const symbol of node.symbols) {
      if (symbols.has(symbol.sym) && symbols.get(symbol.sym)!.role !== symbol.role) ambiguous = true;
      symbols.set(symbol.sym, symbol);
    }
    if (ambiguous) continue;
    return { invokingParagraph: paragraphs[0], localSymbols: [...symbols.values()] };
  }
  return undefined;
}

export function instrumentedInstantiationModel(docId: string): InstantiationModel {
  return async (request) => (await callModel({ ...request, stage: "instantiate", model: MODELS.quality,
    docId, cache: "content", promptCacheKey: `instantiate:${docId}`, meta: { prompt_version: INSTANTIATION_PROMPT_VERSION } })).text;
}

/** Dependency seam lets A supply paragraph context without changing the frozen Anchor. */
export async function bakeDocument(docId: string, repository: BakeRepository = postgresBakeRepository(), model?: InstantiationModel) {
  Uuid.parse(docId);
  let cardsDone = 0;
  for (const raw of await repository.anchors(docId)) {
    const anchor = Anchor.parse(raw);
    if (anchor.doc_id !== docId) throw new Error("Anchor outside requested document");
    const target = await repository.target(anchor);
    if (!target) continue;
    const existing = await repository.existing(anchor.id);
    const context = await repository.context(anchor);
    const { card } = await instantiateCard({ target, anchor, ...context, cardId: existing?.id }, model ?? instrumentedInstantiationModel(docId));
    // This compares the entire output; stale source text/citations never survive re-baking.
    if (!existing || JSON.stringify(existing) !== JSON.stringify(card)) await repository.save(card);
    cardsDone++;
  }
  return { cards_done: cardsDone };
}

export function postgresBakeRepository(): BakeRepository {
  return {
    async anchors(docId) {
      const { rows } = await db().query("SELECT * FROM anchors WHERE doc_id = $1 ORDER BY page, id", [docId]);
      return rows.map((row) => Anchor.parse(row));
    },
    async target(anchor) {
      // Both source and invoking documents must belong to the same corpus.
      const { rows } = await db().query(`
        SELECT n.* FROM nodes n
        JOIN documents target_doc ON target_doc.id = n.doc_id
        JOIN documents invoking_doc ON invoking_doc.id = $1 AND invoking_doc.corpus_id = target_doc.corpus_id
        WHERE n.id = COALESCE($2::uuid, (SELECT canonical_node_id FROM entities WHERE id = $3))
        LIMIT 1`, [anchor.doc_id, anchor.target_node_id, anchor.target_entity_id]);
      return rows[0] ? Node.parse(rows[0]) : undefined;
    },
    async existing(anchorId) {
      const { rows } = await db().query(`SELECT id, anchor_id, headline, instantiated_md, full_md,
        substitutions, clause_ids, gloss, json_build_object('doc_id', source_doc_id, 'page', source_page) AS source
        FROM cards WHERE anchor_id = $1`, [anchorId]);
      return rows[0] ? Card.parse(rows[0]) : undefined;
    },
    async context(anchor) {
      const { rows } = await db().query("SELECT * FROM nodes WHERE doc_id=$1 AND page=$2 ORDER BY id", [anchor.doc_id, anchor.page]);
      return extractInvokingContext(anchor, rows.map((row) => Node.parse(row)));
    },
    async save(value) {
      const card = Card.parse(value);
      const connection = await db().connect();
      try {
        await connection.query("BEGIN");
        const { rows } = await connection.query(`INSERT INTO cards
          (id, anchor_id, headline, instantiated_md, full_md, substitutions, clause_ids, gloss, source_doc_id, source_page)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
          ON CONFLICT (anchor_id) DO UPDATE SET headline=EXCLUDED.headline, instantiated_md=EXCLUDED.instantiated_md,
            full_md=EXCLUDED.full_md, substitutions=EXCLUDED.substitutions, clause_ids=EXCLUDED.clause_ids,
            gloss=EXCLUDED.gloss, source_doc_id=EXCLUDED.source_doc_id, source_page=EXCLUDED.source_page
          RETURNING id`, [card.id, card.anchor_id, card.headline, card.instantiated_md, card.full_md,
          JSON.stringify(card.substitutions), JSON.stringify(card.clause_ids), card.gloss, card.source.doc_id, card.source.page]);
        const id: string = rows[0].id;
        const result = await connection.query("UPDATE anchors SET card_id=$1 WHERE id=$2", [id, card.anchor_id]);
        if (result.rowCount !== 1) throw new Error("Anchor disappeared during bake");
        await connection.query("COMMIT");
        return { ...card, id };
      } catch (error) {
        await connection.query("ROLLBACK");
        throw error;
      } finally { connection.release(); }
    },
  };
}
