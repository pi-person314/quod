import { Corpus } from "@quod/contracts";
import { AuthError, type AuthUser } from "./auth";

type Document = { fields?: Record<string, { stringValue?: string }> };
function documents() {
  const project = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  if (!project) throw new AuthError(503, "Firestore is not configured.");
  return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(project)}/databases/(default)/documents`;
}
async function request(user: AuthUser, url: string, init?: RequestInit) {
  let response: Response;
  try {
    response = await fetch(url, { ...init, headers: { Authorization: `Bearer ${user.token}`, "Content-Type": "application/json" }, cache: "no-store", signal: AbortSignal.timeout(15000) });
  } catch { throw new AuthError(503, "Firestore is unavailable. Please try again."); }
  if (!response.ok) {
    if (response.status === 404) throw new AuthError(404, "Documents not found.");
    if (response.status === 401) throw new AuthError(401, "Please sign in again.");
    if (response.status === 403) throw new AuthError(403, "Firestore access denied. Check that the owner-only Firestore rules are deployed.");
    throw new AuthError(503, "Unable to access Firestore. Check that the Firestore database is enabled.");
  }
  return response;
}
function decode(doc: Document, user: AuthUser): Corpus {
  if (doc.fields?.owner_uid?.stringValue !== user.uid) throw new AuthError(404, "Documents not found.");
  return Corpus.parse(Object.fromEntries(Object.entries(doc.fields ?? {}).map(([key, value]) => [key, value.stringValue])));
}
export async function listUserCorpora(user: AuthUser): Promise<Corpus[]> {
  // A single global corpus ID prevents another user from claiming an existing
  // processing corpus by copying its ID into their own user subcollection.
  const response = await request(user, `${documents()}:runQuery`, {
    method: "POST", body: JSON.stringify({ structuredQuery: {
      from: [{ collectionId: "corpora" }],
      where: { fieldFilter: { field: { fieldPath: "owner_uid" }, op: "EQUAL", value: { stringValue: user.uid } } },
    } }),
  });
  const result = await response.json() as { document?: Document }[];
  return result.flatMap(row => row.document ? [decode(row.document, user)] : [])
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}
export async function createUserCorpus(user: AuthUser, record: Corpus) {
  await request(user, `${documents()}/corpora?documentId=${encodeURIComponent(record.id)}`, {
    method: "POST", body: JSON.stringify({ fields: Object.fromEntries(Object.entries({ ...record, owner_uid: user.uid }).map(([key, value]) => [key, { stringValue: value }])) }),
  });
}
export async function deleteUserCorpus(user: AuthUser, id: string) {
  await assertCorpusOwner(user, id);
  await request(user, `${documents()}/corpora/${encodeURIComponent(id)}`, { method: "DELETE" });
}
export async function assertCorpusOwner(user: AuthUser, id: string): Promise<Corpus> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new AuthError(404, "Documents not found.");
  const response = await request(user, `${documents()}/corpora/${encodeURIComponent(id)}`);
  const corpus = decode(await response.json(), user);
  if (corpus.id !== id) throw new AuthError(404, "Documents not found.");
  return corpus;
}
