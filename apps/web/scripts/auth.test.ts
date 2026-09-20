import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { AuthError, requireUser, verifyIdToken, sessionCookie } from "../lib/auth";
import { assertCorpusOwner, listUserCorpora, createUserCorpus } from "../lib/firestore";
import { POST, DELETE } from "../app/api/auth/session/route";
const originalFetch = globalThis.fetch;
const oldKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
const oldProject = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const [key, value] of Object.entries({ NEXT_PUBLIC_FIREBASE_API_KEY: oldKey, NEXT_PUBLIC_FIREBASE_PROJECT_ID: oldProject })) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});
function token(overrides = {}) {
  return `header.${Buffer.from(JSON.stringify({ aud: "test-project", iss: "https://securetoken.google.com/test-project", sub: "alice", exp: Date.now() / 1000 + 3600, ...overrides })).toString("base64url")}.signature`;
}
function setup() {
  process.env.NEXT_PUBLIC_FIREBASE_API_KEY = "public-test-key";
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = "test-project";
}
const denied = (status: number) => (error: unknown) => error instanceof AuthError && error.status === status;
test("anonymous requests and forged/expired/wrong-project tokens fail closed", async () => {
  setup();
  let requests = 0;
  globalThis.fetch = async () => { requests++; return Response.json({ error: {} }, { status: 400 }); };
  await assert.rejects(requireUser(new Request("https://cairn.test/api/corpus")), denied(401));
  await assert.rejects(verifyIdToken(token({ exp: 0 })), denied(401));
  await assert.rejects(verifyIdToken(token({ aud: "other-project" })), denied(401));
  assert.equal(requests, 0);
  await assert.rejects(verifyIdToken(token()), denied(401));
  assert.equal(requests, 1, "Token claims alone are never trusted");
});
test("Firebase identity must match and disabled users are rejected", async () => {
  setup();
  globalThis.fetch = async () => Response.json({ users: [{ localId: "bob" }] });
  await assert.rejects(verifyIdToken(token()), denied(401));
  globalThis.fetch = async () => Response.json({ users: [{ localId: "alice", disabled: true }] });
  await assert.rejects(verifyIdToken(token()), denied(401));
});
test("session requires same origin and issues a private secure cookie; logout clears it", async () => {
  setup();
  globalThis.fetch = async () => Response.json({ users: [{ localId: "alice" }] });
  const makeRequest = (origin: string) => new Request("https://cairn.test/api/auth/session", {
    method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ idToken: token() }),
  });
  assert.equal((await POST(makeRequest("https://attacker.test"))).status, 403);
  const response = await POST(makeRequest("https://cairn.test"));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("set-cookie")!, /HttpOnly; SameSite=Lax; Max-Age=3600; Secure/);
  const logout = await DELETE(new Request("https://cairn.test/api/auth/session", { method: "DELETE", headers: { origin: "https://cairn.test" } }));
  assert.match(logout.headers.get("set-cookie")!, /Max-Age=0/);
  assert(!sessionCookie(new Request("http://localhost:3003"), "test").includes("; Secure"));
});
test("Firestore queries constrain owner and reject another owner's corpus even with permissive remote rules", async () => {
  setup();
  const user = { uid: "alice", token: "test-token" };
  const record = { id: "00000000-0000-4000-8000-000000000001", name: "Math", created_at: "2026-09-20T00:00:00Z" };
  const fields = (owner: string) => Object.fromEntries(Object.entries({ ...record, owner_uid: owner }).map(([k, v]) => [k, { stringValue: v }]));
  globalThis.fetch = async (url, init) => {
    assert(String(url).endsWith(":runQuery"));
    assert.equal(JSON.parse(String(init?.body)).structuredQuery.where.fieldFilter.value.stringValue, "alice");
    assert.equal((init?.headers as Record<string,string>).Authorization, "Bearer test-token");
    return Response.json([{ document: { fields: fields("alice") } }]);
  };
  assert.deepEqual(await listUserCorpora(user), [record]);
  globalThis.fetch = async () => Response.json({ fields: fields("bob") });
  await assert.rejects(assertCorpusOwner(user, record.id), denied(404));
  globalThis.fetch = async (url, init) => {
    assert(String(url).includes(`/corpora?documentId=${record.id}`));
    assert.equal(JSON.parse(String(init?.body)).fields.owner_uid.stringValue, "alice");
    return Response.json({});
  };
  await createUserCorpus(user, record);
});
test("created corpora return on the next login and stay out of another user's history", async () => {
  setup();
  const fixtureMode = process.env.USE_FIXTURES;
  process.env.USE_FIXTURES = "1";
  const saved = new Map<string, Record<string, { stringValue: string }>>();
  let createdId = "";
  try {
    globalThis.fetch = async (url, init) => {
      const body = JSON.parse(String(init?.body));
      if (String(url).includes("accounts:lookup")) {
        const claims = JSON.parse(Buffer.from(body.idToken.split(".")[1], "base64url").toString());
        return Response.json({ users: [{ localId: claims.sub }] });
      }
      if (String(url).endsWith(":runQuery")) {
        const uid = body.structuredQuery.where.fieldFilter.value.stringValue;
        return Response.json([...saved.values()].filter(f => f.owner_uid.stringValue === uid).map(fields => ({ document: { fields } })));
      }
      saved.set(body.fields.id.stringValue, body.fields);
      return Response.json({});
    };
    const { POST: create, GET: history } = await import("../app/api/corpus/route");
    const headers = (uid: string) => ({ authorization: `Bearer ${token({ sub: uid })}`, "content-type": "application/json" });
    const response = await create(new Request("https://cairn.test/api/corpus", { method: "POST", headers: headers("alice"), body: JSON.stringify({ name: "My uploaded notes" }) }));
    assert.equal(response.status, 200);
    createdId = (await response.json()).corpus_id;
    for (const uid of ["alice", "bob", "alice"]) {
      const result = await history(new Request("https://cairn.test/api/corpus", { headers: headers(uid) }));
      const records = (await result.json()).corpora;
      assert.deepEqual(records.map((c: { id: string }) => c.id), uid === "alice" ? [createdId] : []);
    }
  } finally {
    if (createdId) {
      const { rm } = await import("node:fs/promises");
      const { LOCAL } = await import("../lib/data");
      await rm(`${LOCAL}/corpora/${createdId}.json`, { force: true });
    }
    if (fixtureMode === undefined) delete process.env.USE_FIXTURES; else process.env.USE_FIXTURES = fixtureMode;
  }
});
