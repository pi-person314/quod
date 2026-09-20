// Explicit one-time reset for pre-login corpora. Preserves API spending records.
import { createRequire } from "node:module";
import { readdir, rm } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(resolve(root, "packages/contracts/package.json"));
const { Client } = require("pg");
const client = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000 });
async function reset() {
  if (!process.argv.includes("--confirm")) throw new Error("This deletes all pre-login corpora and PDFs. Run with --confirm after stopping the server.");
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
  await client.connect();
  await client.query("BEGIN");
  // Block concurrent uploads while capturing exactly the records to erase.
  await client.query("LOCK TABLE corpora IN ACCESS EXCLUSIVE MODE");
  const { rows } = await client.query("SELECT id FROM corpora");
  const ids = rows.map(row => row.id);
  const base = (process.env.ELASTICSEARCH_URL ?? "http://127.0.0.1:9200").replace(/\/$/, "");
  if (ids.length) {
    const response = await fetch(`${base}/cairn-nodes-v1/_delete_by_query?refresh=true`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: { terms: { corpus_id: ids } } }), signal: AbortSignal.timeout(30000),
    });
    if (!response.ok && response.status !== 404) throw new Error(`Search cleanup failed (${response.status}); database deletion cancelled.`);
    if (response.ok) {
      const result = await response.json();
      if (result.failures?.length || result.version_conflicts || result.timed_out) throw new Error("Search cleanup incomplete; database deletion cancelled.");
    }
    await client.query("DELETE FROM corpora WHERE id=ANY($1::uuid[])", [ids]);
  }
  await client.query("COMMIT");
  for (const folder of ["corpora", "docs", "pdf"]) {
    const directory = resolve(root, "apps/web/.local-data", folder);
    const files = await readdir(directory).catch(error => { if (error.code === "ENOENT") return []; throw error; });
    for (const file of files) await rm(resolve(directory, file), { force: true });
  }
  console.log(`Removed ${ids.length} database corpora and local uploads. Spending records were preserved.`);
}
try { await reset(); }
catch (error) { await client.query("ROLLBACK").catch(() => {}); console.error(`Reset failed: ${error.message || error.code}`); process.exitCode = 1; }
finally { await client.end(); }
