import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

const MAX_SOURCE_BYTES = 2 * 1024 * 1024;
const MAX_PDF_BYTES = 50 * 1024 * 1024;
const TIMEOUT_MS = 45_000;

export class TexCompileError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

/** Accept a single standalone document. Referenced files are deliberately absent. */
export function assertStandaloneTex(source: string) {
  if (!/\\documentclass(?:\[[^\]]*\])?\s*\{[^}]+\}/.test(source) || !/\\begin\s*\{document\}/.test(source))
    throw new TexCompileError("TeX uploads must be standalone LaTeX documents with \\documentclass and \\begin{document}.");
  if (/\\(?:input|include|includegraphics|bibliography|addbibresource|subfile|import|openin|openout|read)\b/i.test(source))
    throw new TexCompileError("TeX uploads must be self-contained; referenced files and file I/O are not supported.");
  if (/\\(?:write18|immediate\s*\\write|input\s*\|)/i.test(source))
    throw new TexCompileError("TeX shell escape is not supported.");
}

function run(command: string, args: string[], timeout = TIMEOUT_MS, onTimeout?: () => void): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: false, windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", chunk => { stderr = (stderr + String(chunk)).slice(-4000); });
    const timer = setTimeout(() => { child.kill(); onTimeout?.(); reject(new TexCompileError("TeX compilation timed out.", 422)); }, timeout);
    child.once("error", error => { clearTimeout(timer); reject(error); });
    child.once("exit", code => { clearTimeout(timer); resolve({ code, stderr }); });
  });
}

async function compilerAvailable(image: string) {
  try { return (await run("docker", ["image", "inspect", image], 20_000)).code === 0; }
  catch { return false; }
}

/**
 * Compiles inside an isolated Docker container. The repository and its
 * environment files are never mounted or read; only a new source/output pair
 * under the OS temp directory is visible to TeX.
 */
export async function compileTex(source: Buffer): Promise<Buffer> {
  if (source.length > MAX_SOURCE_BYTES) throw new TexCompileError("TeX source must be smaller than 2 MB.");
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(source); }
  catch { throw new TexCompileError("TeX source must be valid UTF-8 text."); }
  if (text.includes("\0")) throw new TexCompileError("TeX source must be valid UTF-8 text.");
  assertStandaloneTex(text);
  // Pin the pre-cached compiler image. Deployments may replace it with their
  // own reviewed image through QUOD_TEX_IMAGE without changing the sandbox.
  const image = process.env.QUOD_TEX_IMAGE ?? "dxjoke/tectonic-docker@sha256:bfc560f1dcd8be573a18be77700494fd18e7f4d8c147c13ccb33d4a23dc537f7";
  if (!(await compilerAvailable(image)))
    throw new TexCompileError("TeX compilation is unavailable: install the configured Quod Tectonic Docker image before uploading .tex files.", 503);
  const tempRoot = resolve(tmpdir());
  const scratch = await mkdtemp(join(tempRoot, "quod-tex-"));
  if (dirname(scratch) !== tempRoot || !basename(scratch).startsWith("quod-tex-"))
    throw new TexCompileError("Unable to create an isolated TeX workspace.", 503);
  const input = join(scratch, "input"), output = join(scratch, "output");
  const container = `quod-tex-${randomUUID()}`;
  try {
    await mkdir(input); await mkdir(output);
    await writeFile(join(input, "main.tex"), source, { mode: 0o444 });
    const result = await run("docker", [
      "run", "--name", container, "--rm", "--network", "none", "--read-only", "--cap-drop", "ALL",
      "--security-opt", "no-new-privileges", "--pids-limit", "128", "--memory", "512m", "--cpus", "1",
      "--tmpfs", "/tmp:rw,noexec,nosuid,size=128m",
      "--mount", `type=bind,src=${input},dst=/input,readonly`,
      "--mount", `type=bind,src=${output},dst=/output`,
      "-w", "/tmp", "-e", "TECTONIC_UNTRUSTED_MODE=1", image,
      "tectonic", "--untrusted", "--only-cached", "--outdir", "/output", "/input/main.tex",
    ], TIMEOUT_MS, () => { void run("docker", ["rm", "--force", container], 5_000).catch(() => {}); });
    if (result.code !== 0) throw new TexCompileError("TeX compilation failed. Fix document syntax or use supported self-contained packages.", 422);
    const pdf = await readFile(join(output, "main.pdf")).catch(() => undefined);
    if (!pdf?.subarray(0, 5).equals(Buffer.from("%PDF-")) || pdf.length > MAX_PDF_BYTES)
      throw new TexCompileError("TeX compilation did not produce a valid PDF.", 422);
    return pdf;
  } finally {
    await run("docker", ["rm", "--force", container], 5_000).catch(() => {});
    await rm(scratch, { recursive: true, force: true });
  }
}

export function isTexUpload(file: File) {
  return file.name.toLowerCase().endsWith(".tex") || ["text/x-tex", "application/x-tex"].includes(file.type.toLowerCase());
}
