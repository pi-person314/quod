import type { Node } from "@quod/contracts";
type LabelNode = Pick<Node, "title" | "label" | "kind" | "page" | "statement_md"> & Partial<Pick<Node, "id" | "doc_id" | "bbox">>;
function clean(value: string | null | undefined): string {
  const text = value?.trim() ?? "";
  return /^(null|undefined|none|untitled result)$/i.test(text) ? "" : text;
}
function proofNumber(node: LabelNode, context: readonly Node[]): string | undefined {
  // Only proof headings identify the result being proved. A theorem cited in
  // the body is a dependency, not evidence that this is its proof.
  const heading = /^\s*proof\s*(?:(?:[(:.]\s*)?of\s+(?:the\s+)?(?:theorem|lemma|proposition|corollary)\s+|\s+)(\d+(?:\.\d+)*[a-z]?)(?=\b|\))/i;
  for (const text of [clean(node.label), clean(node.title), clean(node.statement_md)]) {
    const match = text.match(heading); if (match) return match[1];
  }
  if (!node.doc_id || !node.bbox) return;
  const ordered = context.filter(n => n.doc_id === node.doc_id)
    .sort((a, b) => a.page - b.page || a.bbox[1] - b.bbox[1] || a.bbox[0] - b.bbox[0]);
  const index = ordered.findIndex(n => n.id === node.id);
  const previous = ordered[index - 1];
  if (!previous || !["theorem", "lemma", "proposition", "corollary"].includes(previous.kind)
      || node.page - previous.page > 1) return;
  return clean(previous.label).match(/^(?:theorem|lemma|proposition|corollary)\s+(\d+(?:\.\d+)*[a-z]?)\b/i)?.[1];
}
export function nodeLabel(node: LabelNode, context: readonly Node[] = []): string {
  const title = clean(node.title), label = clean(node.label);
  if (node.kind === "proof") {
    const number = proofNumber(node, context);
    if (number) return `Proof ${number}`;
    const content = (title && !/^proof[\s.:]*$/i.test(title) ? title : clean(node.statement_md))
      .replace(/^\s*proof\b[\s.:()-]*/i, "").replace(/[$*_`#]/g, "")
      .replace(/^the\s+/i, "").trim().split(/\s+/).filter(Boolean);
    return content.length ? `Proof: ${content.slice(0, 4).join(" ")}${content.length > 4 ? "…" : ""}` : "Proof";
  }
  if (title) return title;
  if (label && label.toLowerCase() !== node.kind.toLowerCase()) return label;
  const kind = node.kind[0].toUpperCase() + node.kind.slice(1);
  const statement = clean(node.statement_md).replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[$*_`#]/g, "").replace(/\s+/g, " ").trim();
  if (!statement) return `${kind} · p. ${node.page}`;
  const excerpt = statement.length > 64 ? `${statement.slice(0, 61).trimEnd()}…` : statement;
  return `${kind}: ${excerpt}`;
}
export function nodeDescription(node: LabelNode, context: readonly Node[] = []): string {
  const kind = node.kind[0].toUpperCase() + node.kind.slice(1);
  const label = clean(node.label) || kind;
  const text = nodeLabel(node, context);
  if (node.kind === "proof" || text === `${kind} · p. ${node.page}`)
    return text.endsWith(` · p. ${node.page}`) ? text : `${text} · p. ${node.page}`;
  return `${text === label || text.toLowerCase().startsWith(`${label.toLowerCase()}:`) ? text : `${label} · ${text}`} · p. ${node.page}`;
}
