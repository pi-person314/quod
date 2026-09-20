import { assertCorpusOwner } from "@/lib/firestore";
import { requireUser, authErrorResponse } from "@/lib/auth";
import { UploadDocsResponse, Uuid, Node as NodeSchema } from "@quod/contracts";
import { db } from "@quod/contracts/db";
import { fixturesEnabled } from "@/lib/fixtures";
import { LOCAL, saveLocal } from "@/lib/data";
import { badRequest, jsonOf } from "@/lib/http";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { dispatchWorker } from "@/lib/worker";
import { retryDocument } from "@/lib/retry-document";
import { z } from "zod";
import { createHash } from "node:crypto";
import { compileTex, isTexUpload, TexCompileError } from "@/lib/tex";
import { PDFDocument } from "pdf-lib";
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser(req);
    const { id } = await params;
    if (!Uuid.safeParse(id).success) return badRequest("Invalid document group");
    await assertCorpusOwner(user, id);
    const form = await req.formData();
    const files = form
      .getAll("files")
      .filter((f): f is File => f instanceof File);
    if (!files.length || files.length > 20)
      return badRequest("Choose between 1 and 20 PDF or TeX documents");
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
                  label: z
                    .string()
                    .regex(
                      /^(Definition|Theorem|Lemma|Proposition|Corollary|Example|Notation|Proof|Problem)\s/i,
                    ),
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
    // Compile and validate the whole batch before creating any records. A bad
    // source must not leave earlier documents queued without a returned ID.
    const prepared: { file: File; tex: boolean; bytes: Buffer; pageCount: number }[] = [];
    for (const file of files) {
      const tex = isTexUpload(file);
      if (tex && file.size > 2 * 1024 * 1024)
        return badRequest("TeX source must be smaller than 2 MB");
      if (!tex && file.size > 50 * 1024 * 1024)
        return badRequest("PDFs must be smaller than 50 MB");
      if (!tex && !file.name.toLowerCase().endsWith(".pdf"))
        return badRequest("Choose PDF documents or standalone .tex files");
      let bytes: Buffer;
      try {
        bytes = tex ? await compileTex(Buffer.from(await file.arrayBuffer())) : Buffer.from(await file.arrayBuffer());
      } catch (error) {
        if (error instanceof TexCompileError)
          return Response.json({ error: error.message }, { status: error.status });
        throw error;
      }
      if (bytes.subarray(0, 5).toString() !== "%PDF-")
        return badRequest(`${file.name} did not produce a PDF`);
      let pageCount = 0;
      if (tex) {
        try { pageCount = (await PDFDocument.load(bytes, { ignoreEncryption: false })).getPageCount(); }
        catch { return badRequest(`${file.name} produced an unreadable PDF`); }
      }
      prepared.push({ file, tex, bytes, pageCount });
    }
    const ids: string[] = [];
    for (const [index, { file, tex, bytes, pageCount }] of prepared.entries()) {
      const docId = crypto.randomUUID(),
        meta = tex ? undefined : metadata[index];
      const hash = createHash("sha256").update(bytes).digest("hex");
      const doc = {
        id: docId,
        corpus_id: id,
        title: file.name.replace(/\.(?:pdf|tex)$/i, ""),
        filename: file.name,
        file_hash: hash,
        page_count: tex ? pageCount : (meta?.pages ?? 0),
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
        const inserted = await db().query(
          "INSERT INTO documents(id,corpus_id,title,filename,file_hash,pdf_bytes,status) VALUES($1,$2,$3,$4,$5,$6,'queued') ON CONFLICT(corpus_id,file_hash) DO NOTHING RETURNING id",
          [docId, id, doc.title, file.name, hash, bytes],
        );
        if (!inserted.rowCount) {
          const existing = await db().query(
            "SELECT id FROM documents WHERE corpus_id=$1 AND file_hash=$2",
            [id, hash],
          );
          const existingId = existing.rows[0].id;
          await retryDocument(existingId);
          ids.push(existingId);
          continue;
        }
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
  } catch (error) {
    return authErrorResponse(error);
  }
}
