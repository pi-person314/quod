import { assertCorpusOwner } from "@/lib/firestore";
import { requireUser, authErrorResponse } from "@/lib/auth";
import { IngestEvent, Uuid } from "@cairn/contracts";
import { db } from "@cairn/contracts/db";
import { dataset } from "@/lib/data";
import { fixturesEnabled } from "@/lib/fixtures";
export const dynamic = "force-dynamic";
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser(req);
    const { id } = await params;
    if (!Uuid.safeParse(id).success)
      return new Response("Invalid corpus", { status: 400 });
    await assertCorpusOwner(user, id);
    const encoder = new TextEncoder();
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;
    const stream = new ReadableStream({
      async start(controller) {
        const send = (value: unknown) => {
          const event = value as Record<string, unknown>;
          if (!stopped)
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify(IngestEvent.parse({ ...event, message: event.message ?? undefined }))}\n\n`,
              ),
            );
        };
        const close = () => {
          if (!stopped) {
            stopped = true;
            clearTimeout(timer);
            controller.close();
          }
        };
        req.signal.addEventListener("abort", close);
        if (fixturesEnabled()) {
          const data = await dataset();
          const docs = data.docs.filter((d) => d.corpus_id === id);
          let step = 0;
          const tick = () => {
            if (stopped) return;
            let finished = true;
            for (const d of docs) {
              const nodes = data.nodes.filter((n) => n.doc_id === d.id);
              if (d.status === "unsupported") {
                if (step === 0)
                  send({
                    stage: "error",
                    doc_id: d.id,
                    nodes_done: 0,
                    total: 0,
                    message: "Unsupported PDF (scanned or no text layer)",
                  });
                continue;
              }
              const max = nodes.length + 3;
              if (step <= max) {
                finished = false;
                send({
                  stage:
                    step === 0
                      ? "parse"
                      : step <= nodes.length
                        ? "segment"
                        : step === max
                          ? "done"
                          : "bake",
                  doc_id: d.id,
                  nodes_done: Math.min(step, nodes.length),
                  total: nodes.length,
                  ...(step > 0 && step <= nodes.length
                    ? { node: nodes[step - 1] }
                    : {}),
                });
              }
            }
            step++;
            if (finished) close();
            else timer = setTimeout(tick, 350);
          };
          tick();
        } else {
          const seen = new Map<string, string>();
          const tick = async () => {
            if (stopped) return;
            try {
              const rows = await db().query(
                "SELECT p.* FROM ingest_progress p JOIN documents d ON d.id=p.doc_id WHERE d.corpus_id=$1",
                [id],
              );
              for (const p of rows.rows) {
                const key = JSON.stringify(p);
                if (seen.get(p.doc_id) !== key) {
                  send(p);
                  seen.set(p.doc_id, key);
                }
                const nodes = await db().query(
                  "SELECT id,kind,label,title,page FROM nodes WHERE doc_id=$1 ORDER BY page,id",
                  [p.doc_id],
                );
                for (const node of nodes.rows) send({ ...p, node });
              }
              if (
                rows.rows.length &&
                rows.rows.every(
                  (p) => p.stage === "done" || p.stage === "error",
                )
              )
                return close();
              timer = setTimeout(tick, 1000);
            } catch {
              close();
            }
          };
          await tick();
        }
      },
      cancel() {
        stopped = true;
        clearTimeout(timer);
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}
