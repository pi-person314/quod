import { CreateCorpusRequest, CreateCorpusResponse } from "@cairn/contracts";
import { db } from "@cairn/contracts/db";
import { fixturesEnabled } from "@/lib/fixtures";
import { corpora, saveLocal } from "@/lib/data";
import { jsonOf, parseBody } from "@/lib/http";
export async function GET() {
  return Response.json({ corpora: await corpora() });
}
export async function POST(req: Request) {
  const body = await parseBody(req, CreateCorpusRequest);
  if (body instanceof Response) return body;
  const id = crypto.randomUUID();
  if (fixturesEnabled())
    await saveLocal("corpora", id, {
      id,
      name: body.name,
      created_at: new Date().toISOString(),
    });
  else
    await db().query("INSERT INTO corpora(id,name) VALUES($1,$2)", [
      id,
      body.name,
    ]);
  return jsonOf(CreateCorpusResponse, { corpus_id: id });
}
