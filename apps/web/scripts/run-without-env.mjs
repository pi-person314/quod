// Refuse framework startup if it could implicitly load a forbidden .env file.
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = resolve(web, "../..");
for (const directory of [root, web]) {
  for (const name of [".env", ".env.local", ".env.production", ".env.production.local", ".env.development", ".env.development.local"]) {
    if (existsSync(resolve(directory, name))) throw new Error(`Refusing implicit environment-file access: ${directory}/${name}`);
  }
}
const command = process.argv[2] ?? "start";
if (!["build", "start", "dev"].includes(command)) throw new Error("Expected build, start, or dev");
const args = command === "build" ? [command] : [command, "--hostname", "127.0.0.1", "--port", process.argv[3] ?? "3003"];
const child = spawn(process.execPath, [resolve(web, "node_modules/next/dist/bin/next"), ...args], {
  cwd: web, env: process.env, stdio: "inherit", windowsHide: true,
});
child.on("exit", code => process.exit(code ?? 1));
child.on("error", error => { console.error(error.message); process.exit(1); });
