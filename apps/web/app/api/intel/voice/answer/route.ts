import { Node } from "@cairn/contracts";
import { db } from "@cairn/contracts/db";
import { answerFromViewport, VoiceQuestion } from "@cairn/intel/voice";
import { parseBody } from "@/lib/http";
import { fixturesEnabled, loadGoldenCorpus } from "@/lib/fixtures";

export async function POST(req: Request) {
  const body = await parseBody(req, VoiceQuestion);
  if (body instanceof Response) return body;
  const origin = req.headers.get("origin");
  if (origin && origin !== new URL(req.url).origin) return Response.json({ error: "forbidden" }, { status: 403 });
  if (fixturesEnabled()) {
    const nodes = loadGoldenCorpus().nodes;
    const node = nodes.find((item) => item.doc_id === body.doc_id && item.page === body.page && body.visible_node_ids.includes(item.id));
    if (!node) return Response.json({ error: "viewport_not_found" }, { status: 404 });
    try {
      const answer = await answerFromViewport(body, nodes, async () => ({
        answer: node.statement_md.length <= 940 ? `Original statement: ${node.statement_md}` : "The visible statement is too long to read here. Open the full statement to check all its hypotheses.",
        citations: [node.id],
      }));
      return Response.json(answer);
    } catch { return Response.json({ error: "invalid_viewport" }, { status: 400 }); }
  }
  try {
    const { rows } = await db().query("SELECT * FROM nodes WHERE doc_id=$1 AND page=$2 AND id=ANY($3::uuid[])", [body.doc_id, body.page, body.visible_node_ids]);
    return Response.json(await answerFromViewport(body, rows.map((row) => Node.parse(row))));
  } catch { return Response.json({ error: "voice_unavailable" }, { status: 503 }); }
}
