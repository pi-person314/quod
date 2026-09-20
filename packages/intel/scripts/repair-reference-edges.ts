import { db } from "@quod/contracts/db";
import { Anchor, Node } from "@quod/contracts";
import { syncReferenceEdges } from "../reference-edges";

// Uses process configuration only. Defaults to a dry run; --apply persists
// missing edges without regenerating documents, cards, or model responses.
const apply = process.argv.includes("--apply");
const pool = db();
try {
  const sets = await pool.query("SELECT id FROM corpora ORDER BY id");
  let total = 0;
  for (const { id } of sets.rows) {
    const connection = await pool.connect();
    try {
      await connection.query("BEGIN");
      const lock = await connection.query("SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS locked", [`cairn:ingest:${id}`]);
      if (!lock.rows[0].locked) { await connection.query("ROLLBACK"); console.log(`${id}: skipped active ingestion`); continue; }
      const nodes = await connection.query("SELECT n.* FROM nodes n JOIN documents d ON d.id=n.doc_id WHERE d.corpus_id=$1 AND d.status='ready'", [id]);
      const anchors = await connection.query("SELECT a.* FROM anchors a JOIN documents d ON d.id=a.doc_id WHERE d.corpus_id=$1 AND d.status='ready'", [id]);
      const inserted = await syncReferenceEdges((sql, values) => connection.query(sql, values),
        nodes.rows.map(n => Node.parse(n)), anchors.rows.map(a => Anchor.parse(a)));
      await connection.query(apply ? "COMMIT" : "ROLLBACK");
      total += inserted;
      if (inserted) console.log(`${id}: ${inserted} ${apply ? "added" : "missing"} citation edges`);
    } catch (error) { await connection.query("ROLLBACK"); throw error; }
    finally { connection.release(); }
  }
  console.log(`${apply ? "Added" : "Would add"} ${total} edges; no provider calls.`);
} finally { await pool.end(); }
