import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { PATCH as renameCorpus } from "../app/api/corpus/[id]/route";
import { PATCH as renameDocument } from "../app/api/doc/[id]/route";
import { dataset, LOCAL } from "../lib/data";

const originalFetch = globalThis.fetch;
const previous = {
  key: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  project: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  fixtures: process.env.USE_FIXTURES,
};
const corpusId = "00000000-0000-4000-8000-000000000001";
const docId = "00000000-0000-4000-8000-000000000012";

function token() {
  const claims = { aud: "test-project", iss: "https://securetoken.google.com/test-project", sub: "alice", exp: Date.now() / 1000 + 3600 };
  return `header.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.signature`;
}
function headers(origin = "https://cairn.test") {
  return { authorization: `Bearer ${token()}`, origin, "content-type": "application/json" };
}
function firestoreFields() {
  return {
    id: { stringValue: corpusId }, name: { stringValue: "Before" },
    created_at: { stringValue: "2026-09-19T00:00:00Z" }, owner_uid: { stringValue: "alice" },
  };
}
afterEach(async () => {
  globalThis.fetch = originalFetch;
  await rm(`${LOCAL}/doc-titles/${docId}.json`, { force: true });
  for (const [key, value] of Object.entries({
    NEXT_PUBLIC_FIREBASE_API_KEY: previous.key,
    NEXT_PUBLIC_FIREBASE_PROJECT_ID: previous.project,
    USE_FIXTURES: previous.fixtures,
  })) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

test("rename routes require an owner, validate trimmed text, and persist only mutable metadata", async () => {
  process.env.NEXT_PUBLIC_FIREBASE_API_KEY = "test-key";
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = "test-project";
  process.env.USE_FIXTURES = "1";
  const patches: { url: string; body: unknown }[] = [];
  globalThis.fetch = async (url, init) => {
    const value = String(url);
    if (value.includes("accounts:lookup")) return Response.json({ users: [{ localId: "alice" }] });
    if (init?.method === "PATCH") {
      patches.push({ url: value, body: JSON.parse(String(init.body)) });
      return Response.json({ fields: firestoreFields() });
    }
    return Response.json({ fields: firestoreFields() });
  };

  const corpusResponse = await renameCorpus(new Request(`https://cairn.test/api/corpus/${corpusId}`, {
    method: "PATCH", headers: headers(), body: JSON.stringify({ name: "  Renamed set  " }),
  }), { params: Promise.resolve({ id: corpusId }) });
  assert.equal(corpusResponse.status, 200);
  assert.deepEqual(await corpusResponse.json(), { corpus_id: corpusId, name: "Renamed set" });
  assert.deepEqual(patches, [{
    url: expectUrl(corpusId), body: { fields: { name: { stringValue: "Renamed set" } } },
  }]);

  const before = await dataset();
  const documentResponse = await renameDocument(new Request(`https://cairn.test/api/doc/${docId}`, {
    method: "PATCH", headers: headers(), body: JSON.stringify({ title: "  Renamed document  " }),
  }), { params: Promise.resolve({ id: docId }) });
  assert.equal(documentResponse.status, 200);
  assert.deepEqual(await documentResponse.json(), { doc_id: docId, title: "Renamed document", filename: "pset4.pdf" });
  const after = await dataset();
  assert.equal(after.docs.find(doc => doc.id === docId)?.title, "Renamed document");
  assert.equal(after.nodes.length, before.nodes.length, "golden rename must not duplicate fixture nodes");

  const invalid = await renameDocument(new Request(`https://cairn.test/api/doc/${docId}`, {
    method: "PATCH", headers: headers(), body: JSON.stringify({ title: "   " }),
  }), { params: Promise.resolve({ id: docId }) });
  assert.equal(invalid.status, 400);
  const crossOrigin = await renameCorpus(new Request(`https://cairn.test/api/corpus/${corpusId}`, {
    method: "PATCH", headers: headers("https://attacker.test"), body: JSON.stringify({ name: "Nope" }),
  }), { params: Promise.resolve({ id: corpusId }) });
  assert.equal(crossOrigin.status, 403);
});

function expectUrl(id: string) {
  return `https://firestore.googleapis.com/v1/projects/test-project/databases/(default)/documents/corpora/${id}?updateMask.fieldPaths=name`;
}
