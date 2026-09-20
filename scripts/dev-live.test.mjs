import test from "node:test";
import assert from "node:assert/strict";
import { liveEnvironment } from "./dev-live.mjs";

test("live startup overrides fixture mode and points the worker at the actual port without requiring voice credentials", () => {
  const env = liveEnvironment({ OPENAI_API_KEY: "test-placeholder", USE_FIXTURES: "1", WEB_BASE_URL: "http://localhost:3000" }, "darwin", () => true);
  assert.equal(env.USE_FIXTURES, "0");
  assert.equal(env.QUOD_LIVE_API, "1");
  assert.equal(env.CAIRN_LIVE_API, "1");
  assert.equal(env.WEB_BASE_URL, "http://127.0.0.1:3003");
  assert.match(env.QUOD_WORKER_COMMAND, /\.venv[\\/]bin[\\/]quod-worker$/);
  assert.equal(env.CAIRN_WORKER_COMMAND, env.QUOD_WORKER_COMMAND);
  assert.equal(env.DEEPGRAM_API_KEY, undefined);
});
test("custom Quod worker takes precedence over the legacy alias", () => {
  const env = liveEnvironment({ OPENAI_API_KEY: "test-placeholder", PORT: "3010", QUOD_WORKER_COMMAND: "/custom/quod-worker", CAIRN_WORKER_COMMAND: "/custom/cairn-worker" }, "darwin", () => false);
  assert.equal(env.WEB_BASE_URL, "http://127.0.0.1:3010");
  assert.equal(env.QUOD_WORKER_COMMAND, "/custom/quod-worker");
  assert.equal(env.CAIRN_WORKER_COMMAND, "/custom/quod-worker");
});
test("legacy worker command remains usable", () => {
  const env = liveEnvironment({ OPENAI_API_KEY: "test-placeholder", CAIRN_WORKER_COMMAND: "/custom/cairn-worker" }, "darwin", () => false);
  assert.equal(env.QUOD_WORKER_COMMAND, "/custom/cairn-worker");
  assert.equal(env.CAIRN_WORKER_COMMAND, "/custom/cairn-worker");
});
test("existing session worker and Windows environments are discovered", () => {
  const env = liveEnvironment({ OPENAI_API_KEY: "test-placeholder" }, "win32", path => path.includes("worker-venv"));
  assert.match(env.QUOD_WORKER_COMMAND, /worker-venv[\\/]Scripts[\\/]quod-worker\.exe$/);
});
test("missing key, missing worker and invalid ports fail before launch", () => {
  assert.throws(() => liveEnvironment({}), /OPENAI_API_KEY/);
  assert.throws(() => liveEnvironment({ OPENAI_API_KEY: "test-placeholder" }, "darwin", () => false), /Install apps\/worker/);
  assert.throws(() => liveEnvironment({ OPENAI_API_KEY: "test-placeholder", PORT: "0" }), /PORT/);
});
