import test from "node:test";
import assert from "node:assert/strict";
import { liveEnvironment } from "./dev-live.mjs";

test("live startup overrides fixture mode and points the worker at the actual port without requiring voice credentials", () => {
  const env = liveEnvironment({ OPENAI_API_KEY: "test-placeholder", USE_FIXTURES: "1", WEB_BASE_URL: "http://localhost:3000" }, "darwin", () => true);
  assert.equal(env.USE_FIXTURES, "0");
  assert.equal(env.CAIRN_LIVE_API, "1");
  assert.equal(env.WEB_BASE_URL, "http://127.0.0.1:3003");
  assert.match(env.CAIRN_WORKER_COMMAND, /\.venv\/bin\/cairn-worker$/);
  assert.equal(env.DEEPGRAM_API_KEY, undefined);
});
test("custom port and worker are preserved", () => {
  const env = liveEnvironment({ OPENAI_API_KEY: "test-placeholder", PORT: "3010", CAIRN_WORKER_COMMAND: "/custom/worker" }, "darwin", () => false);
  assert.equal(env.WEB_BASE_URL, "http://127.0.0.1:3010");
  assert.equal(env.CAIRN_WORKER_COMMAND, "/custom/worker");
});
test("existing session worker and Windows environments are discovered", () => {
  const env = liveEnvironment({ OPENAI_API_KEY: "test-placeholder" }, "win32", path => path.includes("worker-venv"));
  assert.match(env.CAIRN_WORKER_COMMAND, /worker-venv\/Scripts\/cairn-worker.exe$/);
});
test("missing key, missing worker and invalid ports fail before launch", () => {
  assert.throws(() => liveEnvironment({}), /OPENAI_API_KEY/);
  assert.throws(() => liveEnvironment({ OPENAI_API_KEY: "test-placeholder" }, "darwin", () => false), /Install apps\/worker/);
  assert.throws(() => liveEnvironment({ OPENAI_API_KEY: "test-placeholder", PORT: "0" }), /PORT/);
});
