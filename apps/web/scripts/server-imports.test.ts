import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

test("custom-server auth/data imports do not initialize Next request storage before its runtime", () => {
  const child = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
    import assert from "node:assert/strict";
    import { createRequire } from "node:module";
    const require = createRequire(import.meta.url);
    delete globalThis.AsyncLocalStorage;
    await import("./lib/auth.ts");
    await import("./lib/data.ts");
    assert.equal(Boolean(require.cache[require.resolve("next/headers")]), false,
      "Shared helpers must not load next/headers before Next initializes");
    require("next/dist/server/node-environment");
    const { workAsyncStorage } = require("next/dist/server/app-render/work-async-storage.external");
    const value = { page: "/" };
    workAsyncStorage.run(value, () => assert.equal(workAsyncStorage.getStore(), value));
  `], { encoding: "utf8", timeout: 15000 });
  assert.equal(child.status, 0, child.stderr || child.stdout);
});
