// Build current source in an isolated project that contains no environment files.
// This allows verification without touching a user's .env, even implicitly.
import { cp, mkdir, mkdtemp, symlink, writeFile, readFile, access } from "node:fs/promises";
import { resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const web = resolve(root, "apps/web");
const state = process.env.QUOD_VERIFICATION_STATE
  ? resolve(process.env.QUOD_VERIFICATION_STATE)
  : resolve(root, ".session-tools/current-verification.json");
const command = process.argv[2] ?? "build";
let isolated;
if (command === "build") {
  await mkdir(resolve(root, ".session-tools"), { recursive: true });
  const project = await mkdtemp(resolve(root, ".session-tools/verify-"));
  isolated = resolve(project, "apps/web");
  await mkdir(isolated, { recursive: true });
  const filter = source => !basename(source).startsWith(".env") && !["node_modules", ".local-data", ".next", ".next-dev"].includes(basename(source));
  for (const name of ["app", "components", "lib", "public", "demo", "scripts", "package.json", "tsconfig.json", "next.config.ts", "postcss.config.mjs"])
    await cp(resolve(web, name), resolve(isolated, name), { recursive: true, filter });
  for (const name of ["tsconfig.base.json", "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml"])
    await cp(resolve(root, name), resolve(project, name));
  const configPath = resolve(isolated, "next.config.ts");
  const config = await readFile(configPath, "utf8");
  await writeFile(configPath, config.replace("export default nextConfig;", `nextConfig.outputFileTracingRoot = ${JSON.stringify(project)};\nexport default nextConfig;`));
  await symlink(resolve(root, "packages"), resolve(project, "packages"), "junction");
  await symlink(resolve(root, "node_modules"), resolve(project, "node_modules"), "junction");
  await symlink(resolve(web, "node_modules"), resolve(isolated, "node_modules"), "junction");
} else if (command === "start") {
  ({ isolated } = JSON.parse(await readFile(state, "utf8")));
  if (!isolated.startsWith(resolve(root, ".session-tools/verify-") )) throw new Error("Unexpected verification directory");
} else throw new Error("Expected build or start");
for (const directory of [isolated, resolve(isolated, "../..")]) for (const name of [".env", ".env.local", ".env.production", ".env.production.local"]) {
  const present = await access(resolve(directory, name)).then(() => true, () => false);
  if (present) throw new Error("Refusing environment-file access in verification project");
}
const args = command === "build" ? [resolve(web, "node_modules/next/dist/bin/next"), command]
  : ["--import", "tsx", resolve(isolated, "scripts/server.ts"), process.argv[3] ?? "3003"];
const child = spawn(process.execPath, args, {
  cwd: isolated, env: { ...process.env,
    QUOD_LIVE_API: command === "build" ? "0" : process.env.QUOD_LIVE_API ?? process.env.CAIRN_LIVE_API ?? "0",
    CAIRN_LIVE_API: command === "build" ? "0" : process.env.CAIRN_LIVE_API ?? process.env.QUOD_LIVE_API ?? "0",
    FIXTURES_DIR: process.env.FIXTURES_DIR ?? resolve(root, "apps/web/demo") }, stdio: "inherit", windowsHide: true,
});
child.on("error", error => { console.error(error.message); process.exit(1); });
child.on("exit", async code => {
  if (code === 0 && command === "build") await writeFile(state, JSON.stringify({ isolated }));
  process.exit(code ?? 1);
});
