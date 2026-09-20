import assert from "node:assert/strict";
import test from "node:test";
import { sameOrigin } from "../lib/http";
test("voice accepts the browser's actual host when Next uses an internal hostname", () => {
  assert(sameOrigin(new Request("http://localhost:3003/api", { headers: { host: "127.0.0.1:3003", origin: "http://127.0.0.1:3003" } })));
  assert(!sameOrigin(new Request("http://localhost:3003/api", { headers: { host: "127.0.0.1:3003", origin: "http://localhost:3003" } })));
});
test("malformed, cross-origin and wrong-protocol requests are rejected", () => {
  for (const origin of ["null", "not-a-url", "http://elsewhere.test", "https://127.0.0.1:3003", "http://127.0.0.1:3004"])
    assert(!sameOrigin(new Request("http://localhost:3003/api", { headers: { host: "127.0.0.1:3003", origin } })));
  assert(sameOrigin(new Request("http://localhost:3003/api")));
});
