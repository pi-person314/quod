import { db } from "@cairn/contracts/db";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { LOCAL } from "./data";
import { dispatchWorker } from "./worker";

/** Lock the document so concurrent clicks can enqueue only one retry. */
export async function retryDocument(id: string, dispatch = dispatchWorker): Promise<"queued" | "missing" | "unavailable"> {
  const connection = await db().connect();
  let job: { path: string; corpusId: string } | undefined;
  try {
    await connection.query("BEGIN");
    const { rows } = await connection.query("SELECT corpus_id,status,pdf_bytes FROM documents WHERE id=$1 FOR UPDATE", [id]);
    const doc = rows[0];
    if (!doc) { await connection.query("ROLLBACK"); return "missing"; }
    if (doc.status !== "error" || !doc.pdf_bytes) {
      await connection.query("ROLLBACK"); return "unavailable";
    }
    const path = join(LOCAL, "pdf", `${id}.pdf`);
    await mkdir(join(LOCAL, "pdf"), { recursive: true });
    await writeFile(path, doc.pdf_bytes);
    await connection.query("UPDATE documents SET status='queued' WHERE id=$1", [id]);
    await connection.query(`INSERT INTO ingest_progress(doc_id,stage) VALUES($1,'queued')
      ON CONFLICT(doc_id) DO UPDATE SET stage='queued',message=NULL,nodes_done=0,total=0,updated_at=now()`, [id]);
    await connection.query("COMMIT");
    job = { path, corpusId: doc.corpus_id };
  } catch (error) {
    await connection.query("ROLLBACK"); throw error;
  } finally { connection.release(); }
  dispatch(job.path, job.corpusId, id);
  return "queued";
}
