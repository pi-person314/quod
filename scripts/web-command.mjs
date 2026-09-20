// Node loads the repository .env before this launcher; Next runs in apps/web.
import { spawn } from "node:child_process";
const command = process.argv[2];
if (!["dev", "build", "start"].includes(command)) throw new Error("Expected dev, build, or start");
const child = spawn("pnpm", ["--filter", "@quod/web", command, ...process.argv.slice(3)], { stdio: "inherit", env: process.env });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("error", error => { console.error(error.message); process.exitCode = 1; });
child.on("exit", (code, signal) => { process.exitCode = code ?? (signal === "SIGINT" ? 130 : 1); });
