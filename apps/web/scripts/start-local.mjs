// Run this yourself with Node's --env-file option to keep credential-file access private.
// The launcher only consumes the inherited process environment.
import { existsSync, watchFile, unwatchFile } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const port = process.argv[2] ?? "3003";
const { Client } = createRequire(resolve(root, "packages/contracts/package.json"))("pg");
if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) throw new Error("Invalid port");
const missing = ["OPENAI_API_KEY", "DEEPGRAM_API_KEY"].filter(name => !process.env[name]);
if (missing.length) throw new Error(`Missing process configuration: ${missing.join(", ")}. No credential file was opened by this launcher.`);
const localQuodWorker = resolve(root, ".session-tools/worker-venv", process.platform === "win32" ? "Scripts/quod-worker.exe" : "bin/quod-worker");
const localCairnWorker = resolve(root, ".session-tools/worker-venv", process.platform === "win32" ? "Scripts/cairn-worker.exe" : "bin/cairn-worker");
const env = { ...process.env,
  DATABASE_URL: process.env.DATABASE_URL ?? "postgres://cairn:cairn@127.0.0.1:5432/cairn",
  ELASTICSEARCH_URL: process.env.ELASTICSEARCH_URL ?? "http://127.0.0.1:9200",
  USE_FIXTURES: "0", QUOD_LIVE_API: "1", CAIRN_LIVE_API: "1", QUOD_INTELLIGENCE_MODE: "live", CAIRN_INTELLIGENCE_MODE: "live",
  WEB_BASE_URL: `http://127.0.0.1:${port}`,
  QUOD_WORKER_COMMAND: process.env.QUOD_WORKER_COMMAND ?? process.env.CAIRN_WORKER_COMMAND ?? (existsSync(localQuodWorker) ? localQuodWorker : existsSync(localCairnWorker) ? localCairnWorker : "quod-worker"),
};
console.log("Starting database-backed Quod with live providers and the shared spending guard.");
const state = resolve(root, ".session-tools/current-verification.json");
let child, stopping = false, restarting = false;
function launch() {
  child = spawn(process.execPath, [resolve(root, "apps/web/scripts/isolated-verification.mjs"), "start", port],
    { cwd: root, env, stdio: "inherit", windowsHide: true, detached: process.platform !== "win32" });
  child.on("error", error => { console.error(error.message); unwatchFile(state); process.exitCode = 1; });
  child.on("exit", code => {
    if (!restarting && !stopping) {
      console.log(`Quod stopped (${code ?? "signal"}). Restart this launcher after resolving the reported error.`);
      unwatchFile(state); process.exitCode = code ?? 1;
    }
  });
}
async function stopChild() {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  const closed = new Promise(resolve => child.once("close", resolve));
  if (process.platform === "win32") {
    await new Promise(resolve => {
      const stop = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
      stop.once("exit", resolve); stop.once("error", resolve);
    });
  } else process.kill(-child.pid, "SIGTERM");
  await closed;
}
let updates = Promise.resolve();
watchFile(state, { interval: 1000 }, (current, previous) => {
  if (current.mtimeMs === previous.mtimeMs || stopping) return;
  updates = updates.then(async () => {
    if (stopping) return;
    // A successful build must not kill an ingestion worker halfway through a job.
    let announced = false;
    while (!stopping && child?.exitCode === null) {
      // Private HTTP routes now require a signed-in user. Check worker activity
      // through the launcher's existing database connection settings instead.
      const status = new Client({ connectionString: env.DATABASE_URL, connectionTimeoutMillis: 5000 });
      let idle = false;
      try {
        await status.connect();
        const result = await status.query("SELECT EXISTS (SELECT 1 FROM documents WHERE status IN ('queued','ingesting')) AS busy");
        idle = result.rows[0]?.busy === false;
      } catch { /* Unavailable status is not evidence that workers are idle. */ }
      finally { await status.end().catch(() => {}); }
      if (idle) break;
      if (!announced) { console.log("Verified build ready; waiting for ingestion to finish before restarting."); announced = true; }
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    if (stopping) return;
    restarting = true;
    console.log("Verified build changed; restarting Quod with the existing private process configuration.");
    await stopChild(); restarting = false;
    if (!stopping) launch();
  }).catch(error => { restarting = false; console.error(`Build reload failed: ${error.message}`); });
});
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => {
  stopping = true; unwatchFile(state);
  void stopChild().finally(() => process.exit(0));
});
launch();
