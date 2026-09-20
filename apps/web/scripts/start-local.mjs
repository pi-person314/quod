// Run this yourself with Node's --env-file option to keep credential-file access private.
// The launcher only consumes the inherited process environment.
import { existsSync, watchFile, unwatchFile } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const port = process.argv[2] ?? "3003";
if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) throw new Error("Invalid port");
const missing = ["OPENAI_API_KEY", "DEEPGRAM_API_KEY"].filter(name => !process.env[name]);
if (missing.length) throw new Error(`Missing process configuration: ${missing.join(", ")}. No credential file was opened by this launcher.`);
const localWorker = resolve(root, ".session-tools/worker-venv", process.platform === "win32" ? "Scripts/cairn-worker.exe" : "bin/cairn-worker");
const env = { ...process.env,
  DATABASE_URL: process.env.DATABASE_URL ?? "postgres://cairn:cairn@127.0.0.1:5432/cairn",
  ELASTICSEARCH_URL: process.env.ELASTICSEARCH_URL ?? "http://127.0.0.1:9200",
  USE_FIXTURES: "0", CAIRN_LIVE_API: "1", CAIRN_INTELLIGENCE_MODE: "live",
  WEB_BASE_URL: `http://127.0.0.1:${port}`,
  CAIRN_WORKER_COMMAND: process.env.CAIRN_WORKER_COMMAND ?? (existsSync(localWorker) ? localWorker : "cairn-worker"),
};
console.log("Starting database-backed Cairn with live providers and the shared spending guard.");
const state = resolve(root, ".session-tools/current-verification.json");
let child, stopping = false, restarting = false;
function launch() {
  child = spawn(process.execPath, [resolve(root, "apps/web/scripts/isolated-verification.mjs"), "start", port],
    { cwd: root, env, stdio: "inherit", windowsHide: true, detached: process.platform !== "win32" });
  child.on("error", error => { console.error(error.message); unwatchFile(state); process.exitCode = 1; });
  child.on("exit", code => {
    if (!restarting && !stopping) {
      console.log(`Cairn stopped (${code ?? "signal"}). Restart this launcher after resolving the reported error.`);
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
      const library = await fetch(`http://127.0.0.1:${port}/api/library`, { signal: AbortSignal.timeout(5000) })
        .then(response => response.ok ? response.json() : null).catch(() => null);
      // A timeout or failed status request is not evidence that workers are idle.
      // Builds can briefly contend with the running server for CPU and connections.
      if (Array.isArray(library?.docs) && !library.docs.some(doc => ["queued", "ingesting"].includes(doc.status))) break;
      if (!announced) { console.log("Verified build ready; waiting for ingestion to finish before restarting."); announced = true; }
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    if (stopping) return;
    restarting = true;
    console.log("Verified build changed; restarting Cairn with the existing private process configuration.");
    await stopChild(); restarting = false;
    if (!stopping) launch();
  }).catch(error => { restarting = false; console.error(`Build reload failed: ${error.message}`); });
});
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => {
  stopping = true; unwatchFile(state);
  void stopChild().finally(() => process.exit(0));
});
launch();
