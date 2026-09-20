import { CreateCorpusRequest, CreateCorpusResponse } from "@quod/contracts";
import { db } from "@quod/contracts/db";
import { fixturesEnabled } from "@/lib/fixtures";
import { saveLocal, LOCAL, corpora } from "@/lib/data";
import { jsonOf, parseBody } from "@/lib/http";
import { authErrorResponse, AuthError, requireUser } from "@/lib/auth";
import { createUserCorpus, listUserCorpora } from "@/lib/firestore";
import { rm } from "node:fs/promises";
import { join } from "node:path";
export async function GET(req: Request) {
  try {
    const owned = await listUserCorpora(await requireUser(req));
    const names = new Map((owned.length ? await corpora() : []).map(record => [record.id, record.name]));
    return Response.json({ corpora: owned.map(record => ({ ...record, name: names.get(record.id) ?? record.name })) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return authErrorResponse(error); }
}
export async function POST(req: Request) {
  try {
    const user = await requireUser(req);
    const body = await parseBody(req, CreateCorpusRequest);
    if (body instanceof Response) return body;
    const name = body.name.trim();
    if (!name || name.length > 200) throw new AuthError(400, "Document group names must contain 1–200 characters.");
    const record = { id: crypto.randomUUID(), name, created_at: new Date().toISOString() };
    // Persist processing metadata first. If Firestore fails, remove the local row
    // so the API never reports a corpus that cannot be retrieved on next login.
    const fixture = fixturesEnabled();
    if (fixture) await saveLocal("corpora", record.id, record);
    else await db().query("INSERT INTO corpora(id,name,created_at) VALUES($1,$2,$3)", [record.id, name, record.created_at]);
    try { await createUserCorpus(user, record); }
    catch (error) {
      if (fixture) await rm(join(LOCAL, "corpora", `${record.id}.json`), { force: true });
      else await db().query("DELETE FROM corpora WHERE id=$1", [record.id]);
      throw error;
    }
    return jsonOf(CreateCorpusResponse, { corpus_id: record.id });
  } catch (error) { return authErrorResponse(error); }
}
