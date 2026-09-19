import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { developmentCorpus } from "../evals/development-corpus";

test("fixture API contracts work without Next startup, a database, or model calls", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cairn-c-routes-"));
  try {
    const fixtures = await developmentCorpus();
    for (const [i, fixture] of fixtures.entries()) await writeFile(join(directory, `${i}.json`), JSON.stringify(fixture));
    const child = spawnSync(process.execPath, ["--import", "tsx", "scripts/check-routes.mjs"], {
      cwd: fileURLToPath(new URL("../", import.meta.url)), encoding: "utf8",
      env: { ...process.env, USE_FIXTURES: "1", FIXTURES_DIR: directory,
        TSX_TSCONFIG_PATH: fileURLToPath(new URL("../../../apps/web/tsconfig.json", import.meta.url)) },
      timeout: 30_000,
    });
    assert.equal(child.status, 0, `${child.error?.message ?? ""}\n${child.stdout}\n${child.stderr}`);
    assert.match(child.stdout, /fixture routes passed/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
