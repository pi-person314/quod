import { spawn } from "node:child_process";
import { db } from "@cairn/contracts/db";
/** Native local-worker adapter. Never invokes a shell; IDs and file paths are arguments. */
export function dispatchWorker(
  pdfPath: string,
  corpusId: string,
  docId: string,
) {
  const child = spawn(
    process.env.CAIRN_WORKER_COMMAND ?? "cairn-worker",
    ["ingest", pdfPath, "--corpus-id", corpusId],
    { windowsHide: true, stdio: "ignore", shell: false },
  );
  const fail = async (message: string) => {
    await db().query("UPDATE documents SET status='error' WHERE id=$1", [
      docId,
    ]);
    await db().query(
      "UPDATE ingest_progress SET message=CASE WHEN stage='error' AND message IS NOT NULL THEN message ELSE $2 END,stage='error',updated_at=now() WHERE doc_id=$1",
      [docId, message],
    );
  };
  child.on("error", () => {
    void fail(
      "The ingest worker could not be started. Configure CAIRN_WORKER_COMMAND on the web server.",
    ).catch(() => {});
  });
  child.on("exit", (code) => {
    if (code !== 0)
      void fail(`The ingest worker exited with code ${code}.`).catch(() => {});
  });
  child.unref();
}
