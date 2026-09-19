import { UploadDocsResponse, Uuid, Node as NodeSchema } from "@cairn/contracts";
import { db } from "@cairn/contracts/db";
import { fixturesEnabled } from "@/lib/fixtures";
import { LOCAL, saveLocal, corpora } from "@/lib/data";
import { badRequest, jsonOf } from "@/lib/http";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { dispatchWorker } from "@/lib/worker";
import { z } from "zod";
import { createHash } from "node:crypto";
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!Uuid.safeParse(id).success) return badRequest("Invalid corpus");
  if (!(await corpora()).some((c) => c.id === id))
    return new Response("Corpus not found", { status: 404 });
  const form = await req.formData();
  const files = form
    .getAll("files")
    .filter((f): f is File => f instanceof File);
  if (!files.length || files.length > 20)
    return badRequest("Choose between 1 and 20 PDFs");
  let metadata: {
    pages: number;
    nodes: {
      label: string;
      title: string;
      statement: string;
      page: number;
      bbox: number[];
    }[];
    error?: string;
  }[];
  try {
    metadata = z
      .array(
        z.object({
          pages: z.number().int().min(0),
          nodes: z
            .array(
              z.object({
                label: z.string().regex(/^(Definition|Theorem|Lemma|Proposition|Corollary|Example|Notation|Proof|Problem)\s/i),
                title: z.string(),
                statement: z.string(),
                page: z.number().int().positive(),
                bbox: z.tuple([
                  z.number().finite(),
                  z.number().finite(),
                  z.number().finite(),
                  z.number().finite(),
                ]),
              }),
            )
            .max(5000),
          error: z.string().optional(),
        }),
      )
      .parse(JSON.parse(String(form.get("metadata") ?? "[]")));
  } catch {
    return badRequest("Invalid PDF extraction metadata");
  }
  const ids: string[] = [];
  for (const [index, file] of files.entries()) {
    if (file.size > 50 * 1024 * 1024)
      return badRequest("PDFs must be smaller than 50 MB");
    const bytes = Buffer.from(await file.arrayBuffer());
    if (bytes.subarray(0, 5).toString() !== "%PDF-")
      return badRequest(`${file.name} is not a PDF`);
    const docId = crypto.randomUUID(),
      meta = metadata[index];
    const hash = createHash("sha256").update(bytes).digest("hex");
    const doc = {
      id: docId,
      corpus_id: id,
      title: file.name.replace(/\.pdf$/i, ""),
      filename: file.name,
      file_hash: hash,
      page_count: meta?.pages ?? 0,
      quality: meta?.error ? 0 : 1,
      status: meta?.error ? ("unsupported" as const) : ("ready" as const),
    };
    const nodes = (meta?.nodes ?? []).slice(0, 5000).map((n) =>
      NodeSchema.parse({
        id: crypto.randomUUID(),
        doc_id: docId,
        kind: /^problem/i.test(n.label)
          ? "example"
          : n.label.split(/\s/)[0].toLowerCase(),
        label: n.label,
        title: n.title || null,
        statement_md: n.statement,
        clauses: [],
        symbols: [],
        page: n.page,
        bbox: n.bbox,
        entity_id: null,
        confidence: 0.85,
      }),
    );
    if (fixturesEnabled()) {
      await mkdir(join(LOCAL, "pdf"), { recursive: true });
      await writeFile(join(LOCAL, "pdf", `${docId}.pdf`), bytes);
      await saveLocal("docs", docId, { doc, nodes, message: meta?.error });
    } else {
      await db().query(
        "INSERT INTO documents(id,corpus_id,title,filename,file_hash,pdf_bytes,status) VALUES($1,$2,$3,$4,$5,$6,'queued')",
        [docId, id, doc.title, file.name, hash, bytes],
      );
      await db().query(
        "INSERT INTO ingest_progress(doc_id,stage) VALUES($1,'queued')",
        [docId],
      );
      await mkdir(join(LOCAL, "pdf"), { recursive: true });
      const path = join(LOCAL, "pdf", `${docId}.pdf`);
      await writeFile(path, bytes);
      dispatchWorker(path, id, docId);
    }
    ids.push(docId);
  }
  return jsonOf(UploadDocsResponse, { doc_ids: ids });
}
