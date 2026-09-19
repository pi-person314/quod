import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { developmentCorpus } from "./development-corpus";

const output = new URL("./generated/", import.meta.url);
await mkdir(output, { recursive: true });
for (const [i, fixture] of (await developmentCorpus()).entries()) {
  await writeFile(new URL(`${i === 0 ? "chapter" : "exercises"}.json`, output), JSON.stringify(fixture, null, 2) + "\n");
}
console.log(`Synthetic fixtures written to ${fileURLToPath(output)}`);
console.log("Use this directory as FIXTURES_DIR in the process environment; no environment files are loaded.");
