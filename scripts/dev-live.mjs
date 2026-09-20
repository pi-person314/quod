import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function liveEnvironment(source, platform = process.platform, exists = existsSync) {
  if (!source.OPENAI_API_KEY?.trim()) throw new Error("Set OPENAI_API_KEY in the process environment before running pnpm dev:live.");
  const port = source.PORT ?? "3003";
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) throw new Error("PORT must be between 1 and 65535.");
  const executables = platform === "win32"
    ? ["Scripts/quod-worker.exe", "Scripts/cairn-worker.exe"]
    : ["bin/quod-worker", "bin/cairn-worker"];
  const worker = executables.flatMap(executable => [
    resolve(root, ".venv", executable),
    resolve(root, ".session-tools/worker-venv", executable),
  ]).find(exists);
  const workerCommand = source.QUOD_WORKER_COMMAND ?? source.CAIRN_WORKER_COMMAND ?? worker;
  if (!workerCommand) throw new Error("Install apps/worker in .venv or .session-tools/worker-venv, or set QUOD_WORKER_COMMAND (CAIRN_WORKER_COMMAND is also supported).");
  return { ...source, PORT: port, USE_FIXTURES: "0", QUOD_LIVE_API: "1", CAIRN_LIVE_API: "1", QUOD_INTELLIGENCE_MODE: "live", CAIRN_INTELLIGENCE_MODE: "live",
    DATABASE_URL: source.DATABASE_URL || "postgres://cairn:cairn@127.0.0.1:5432/cairn",
    ELASTICSEARCH_URL: source.ELASTICSEARCH_URL || "http://127.0.0.1:9200",
    WEB_BASE_URL: `http://127.0.0.1:${port}`, QUOD_WORKER_COMMAND: workerCommand,
    CAIRN_WORKER_COMMAND: workerCommand };
}

async function main() {
  const env = liveEnvironment(process.env);
  const require = createRequire(resolve(root, "packages/contracts/package.json"));
  const { Client } = require("pg");
  const database = new Client({ connectionString: env.DATABASE_URL, connectionTimeoutMillis: 5000 });
  try {
    await database.connect();
    const result = await database.query("SELECT enabled FROM api_budget WHERE id='cairn-total'");
    if (!result.rows[0]?.enabled) throw new Error("The shared API budget is disabled. Enable the existing budget explicitly before live ingestion; this launcher never resets spending.");
  } finally { await database.end(); }
  const search = await fetch(env.ELASTICSEARCH_URL, { signal: AbortSignal.timeout(5000) });
  if (!search.ok) throw new Error("Elasticsearch is unavailable. Run docker compose up -d --wait.");
  if (process.argv.includes("--check")) {
    console.log("Live startup checks passed: configuration, worker executable, database, enabled spending guard, and Elasticsearch. No provider calls were made.");
    return;
  }
  console.log(`Starting current source in live mode at ${env.WEB_BASE_URL}; the shared spending guard remains enforced.`);
  const webRequire = createRequire(resolve(root, "apps/web/package.json"));
  const child = spawn(process.execPath, [webRequire.resolve("tsx/cli"), "scripts/server.ts", "--dev"],
    { cwd: resolve(root, "apps/web"), env, stdio: "inherit" });
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
  child.on("error", () => { console.error("Could not start the web server."); process.exitCode = 1; });
  child.on("exit", (code, signal) => { process.exitCode = code ?? (signal === "SIGINT" ? 130 : 1); });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(`Live startup failed: ${error.message || error.code || "Could not reach local services. Run docker compose up -d --wait."}`); process.exitCode = 1; });
}
