import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { writeFile, mkdir, copyFile } from "node:fs/promises";
import { createRequire } from "node:module";
import fontkit from "@pdf-lib/fontkit";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
const require = createRequire(import.meta.url);
await mkdir("demo", { recursive: true });
await mkdir("public", { recursive: true });
await copyFile(
  require.resolve("pdfjs-dist/build/pdf.worker.min.mjs"),
  "public/pdf.worker.min.mjs",
);
const uid = (n) => `b0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const corpus = "00000000-0000-4000-8000-000000000001";
const titles = [
  "Linear algebra · Chapter 3",
  "Lecture notes · Linear maps",
  "Problem set 4",
  "Seminar slides · Structure",
];
const names = [
  "Vector spaces",
  "Linear maps",
  "Kernel and image",
  "Rank-Nullity",
  "Injectivity criterion",
  "Basis extension",
  "Direct sums",
  "Isomorphisms",
  "Composition",
  "Dimension formula",
  "Quotient spaces",
  "First isomorphism theorem",
];
const statements = [
  "A vector space is a set closed under addition and scalar multiplication.",
  "A map T is linear when T(au + bv) = aT(u) + bT(v).",
  "The kernel is the set of vectors sent to zero. The image is the range of T.",
  "(i) The kernel and image of A are subspaces. (ii) If V is finite dimensional, dim ker A + dim im A = dim V.",
  "A linear map is injective if and only if its kernel contains only zero.",
  "Every linearly independent list extends to a basis of a finite dimensional space.",
  "If U and W intersect only at zero, their sum is a direct sum.",
  "An invertible linear map identifies two vector spaces of equal dimension.",
  "The composition of two linear maps is linear.",
  "The dimension of U + W equals dim U + dim W minus dim of their intersection.",
  "The quotient V/U consists of cosets of U, with the induced vector operations.",
  "The quotient of V by ker T is isomorphic to the image of T.",
];
const kinds = [
  "definition",
  "definition",
  "definition",
  "theorem",
  "corollary",
  "lemma",
  "definition",
  "definition",
  "proposition",
  "theorem",
  "definition",
  "theorem",
];
const all = [];
const fontDir = join(
  dirname(require.resolve("katex/package.json")),
  "dist/fonts",
);
const regular = await readFile(join(fontDir, "KaTeX_Main-Regular.ttf"));
const boldBytes = await readFile(join(fontDir, "KaTeX_Main-Bold.ttf"));
const italicBytes = await readFile(join(fontDir, "KaTeX_Main-Italic.ttf"));
for (let d = 0; d < 4; d++) {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(regular, { subset: true });
  const bold = await pdf.embedFont(boldBytes, { subset: true });
  const italic = await pdf.embedFont(italicBytes, { subset: true });
  const fx = {
    document: {
      id: uid(d + 1),
      corpus_id: corpus,
      title: titles[d],
      filename: `demo-${d}.pdf`,
      file_hash: null,
      page_count: 3,
      quality: 1,
      status: "ready",
    },
    pdf: `demo-${d}.pdf`,
    nodes: [],
    edges: [],
    anchors: [],
    cards: [],
    entities: [],
  };
  for (let p = 0; p < 3; p++) {
    const page = pdf.addPage([612, 792]);
    const line = (text, x, y, size = 12, f = font) =>
      page.drawText(text, {
        x,
        y: 792 - y,
        size,
        font: f,
        color: rgb(0.12, 0.12, 0.13),
      });
    line("QUOD / LINEAR ALGEBRA", 62, 44, 9);
    line(String(p + 1), 540, 44, 10);
    line(
      d === 2
        ? `Problem set 4 / ${["Linear transformations", "A proof in context", "Further problems"][p]}`
        : `${p + 1}. ${["Maps and their structure", "Bases and dimension", "The quotient construction"][p]}`,
      62,
      100,
      23,
      bold,
    );
    line(
      "A short course in the relationships behind the results.",
      62,
      129,
      12,
      italic,
    );
    for (let j = 0; j < 4; j++) {
      const k = p * 4 + j,
        y = 186 + j * 135,
        id = uid(100 + d * 20 + k),
        entity = uid(500 + (d === 2 && k === 0 ? 3 : k));
      const isProblem = d === 2 && k === 0;
      const label = isProblem
        ? "Problem 4.1"
        : `${kinds[k][0].toUpperCase() + kinds[k].slice(1)} 3.${k + 1}`;
      const title = isProblem ? "A linear map in local notation" : names[k];
      const statement = isProblem
        ? "Let T: R^n -> R^m be linear. Prove that dim ker T + dim im T = n."
        : statements[k];
      line(`${label}.  ${title}`, 62, y, 14, bold);
      const words = statement.split(" ");
      let text = "",
        lines = [];
      for (const word of words) {
        if (font.widthOfTextAtSize(text + word, 12) > 475) {
          lines.push(text.trim());
          text = "";
        }
        text += word + " ";
      }
      lines.push(text.trim());
      lines.forEach((s, i) => line(s, 62, y + 23 + i * 17));
      const target = (k + 3) % 12;
      const surface =
        d === 2 && k === 0
          ? "the dimension theorem"
          : `Theorem 3.${target + 1}`;
      const prefix =
        d === 2 && k === 0
          ? "Show that the claim follows from "
          : "The argument follows from ";
      line(prefix + surface + ".", 62, y + 70, 12);
      const x = 62 + font.widthOfTextAtSize(prefix, 12),
        width = font.widthOfTextAtSize(surface, 12);
      const aid = uid(1000 + d * 20 + k),
        cid = uid(2000 + d * 20 + k);
      fx.nodes.push({
        id,
        doc_id: uid(d + 1),
        kind: isProblem ? "example" : kinds[k],
        label,
        title,
        statement_md: statement,
        clauses: [],
        symbols: [],
        page: p + 1,
        bbox: [62, y - 14, 550, y + 48],
        entity_id: entity,
        confidence: k === 2 ? 0.64 : 0.98,
      });
      fx.anchors.push({
        id: aid,
        doc_id: uid(d + 1),
        page: p + 1,
        bbox: [x, y + 59, x + width, y + 73],
        surface,
        target_node_id: uid(100 + target),
        target_entity_id: uid(500 + target),
        card_id: cid,
      });
      fx.cards.push({
        id: cid,
        anchor_id: aid,
        headline: names[target] + (target === 3 ? " · clause (ii)" : ""),
        instantiated_md:
          target === 3
            ? "$\\dim\\ker T + \\dim\\operatorname{im} T = n$. Every input dimension is either lost in the kernel or preserved in the image."
            : statements[target],
        full_md: statements[target],
        substitutions:
          target === 3
            ? [
                { from: "A", to: "T" },
                { from: "V", to: "\\mathbb{R}^{n}" },
              ]
            : [],
        clause_ids: target === 3 ? ["ii"] : [],
        gloss:
          target === 3
            ? "The dimensions that disappear and the dimensions that survive add up to the whole space."
            : "Keep this earlier result in view while following the argument.",
        source: { doc_id: uid(1), page: Math.floor(target / 4) + 1 },
      });
      for (const prerequisite of [
        [],
        [0],
        [1],
        [2, 5],
        [2],
        [0],
        [0],
        [1],
        [1],
        [6, 3],
        [0],
        [10, 2, 1],
      ][k])
        fx.edges.push({
          src: id,
          dst: uid(100 + d * 20 + prerequisite),
          kind: "depends_on",
          extractor: "deterministic",
          confidence: 1,
        });
      if (d > 0)
        fx.edges.push({
          src: id,
          dst: uid(100 + (isProblem ? 3 : k)),
          kind: "restates",
          extractor: "deterministic",
          confidence: 1,
        });
      if (d === 0)
        fx.entities.push({
          id: entity,
          corpus_id: corpus,
          canonical_node_id: id,
          name: names[k],
        });
    }
    line(
      "Quod demonstration corpus / original teaching material",
      62,
      757,
      9,
      italic,
    );
  }
  if (d === 0) {
    const page = pdf.addPage([612, 792]);
    const line = (text, y, size = 12, f = font) =>
      page.drawText(text, {
        x: 62,
        y: 792 - y,
        size,
        font: f,
        color: rgb(0.12, 0.12, 0.13),
      });
    line("QUOD / LINEAR ALGEBRA", 44, 9);
    line("4. A proof of Rank-Nullity", 100, 23, bold);
    line(
      "The dimensions that disappear, and the dimensions that remain.",
      133,
      12,
      italic,
    );
    const proof = [
      ["Let T: V -> W be linear, with V finite dimensional.", 195],
      ["Choose a basis v(1), ..., v(k) of the kernel of T.", 227],
      [
        "By Basis extension, complete this to a basis v(1), ..., v(n) of V.",
        259,
      ],
      ["We claim T(v(k+1)), ..., T(v(n)) is a basis of the image of T.", 307],
      ["Linearity shows that these vectors span the image.", 339],
      [
        "To prove independence, suppose a linear combination of them is zero.",
        387,
      ],
      [
        "Then the corresponding combination of v(k+1), ..., v(n) lies in ker T.",
        419,
      ],
      ["By Kernel and image, this is a combination of v(1), ..., v(k).", 451],
      [
        "Independence of the full basis forces every coefficient to vanish.",
        483,
      ],
      ["Thus dim ker T = k, while dim im T = n - k.", 547],
      ["Adding the two dimensions gives dim V = n, as required.", 579],
    ];
    proof.forEach(([text, y]) => line(text, y));
    const proofId = uid(112);
    fx.nodes.push({
      id: proofId,
      doc_id: uid(1),
      kind: "proof",
      label: "Proof 3.4",
      title: "Why Rank-Nullity holds",
      statement_md: proof.map(([t]) => t).join(" "),
      clauses: [],
      symbols: [],
      page: 4,
      bbox: [62, 180, 555, 590],
      entity_id: null,
      confidence: 1,
    });
    for (const [i, target, surface, y] of [
      [0, 5, "Basis extension", 259],
      [1, 2, "Kernel and image", 451],
    ]) {
      const aid = uid(1012 + i),
        cid = uid(2012 + i),
        x = 62 + font.widthOfTextAtSize("By ", 12);
      fx.anchors.push({
        id: aid,
        doc_id: uid(1),
        page: 4,
        bbox: [x, y - 12, x + font.widthOfTextAtSize(surface, 12), y + 3],
        surface,
        target_node_id: uid(100 + target),
        target_entity_id: uid(500 + target),
        card_id: cid,
      });
      fx.cards.push({
        id: cid,
        anchor_id: aid,
        headline: names[target],
        instantiated_md: statements[target],
        full_md: statements[target],
        substitutions: [],
        clause_ids: [],
        gloss:
          target === 5
            ? "A basis for a smaller space can be completed to one for the whole space."
            : "A vector lies in the kernel precisely when the map sends it to zero.",
        source: { doc_id: uid(1), page: Math.floor(target / 4) + 1 },
      });
      fx.edges.push({
        src: proofId,
        dst: uid(100 + target),
        kind: "depends_on",
        extractor: "deterministic",
        confidence: 1,
      });
    }
    line(
      "Quod demonstration corpus / original teaching material",
      757,
      9,
      italic,
    );
    fx.document.page_count = 4;
  }
  await writeFile(`demo/demo-${d}.pdf`, await pdf.save());
  await writeFile(`demo/demo-${d}.json`, JSON.stringify(fx, null, 2));
  all.push(fx);
}
console.log("Generated 4 real PDFs, 49 nodes, 50 aligned anchors and cards.");
