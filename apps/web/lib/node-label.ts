import type { Node } from "@quod/contracts";
type LabelNode = Pick<Node, "title" | "label" | "kind" | "page" | "statement_md">;
function clean(value: string | null | undefined): string {
  const text = value?.trim() ?? "";
  return /^(null|undefined|none|untitled result)$/i.test(text) ? "" : text;
}
export function nodeLabel(node: LabelNode): string {
  const title = clean(node.title), label = clean(node.label);
  if (title) return title;
  if (label && label.toLowerCase() !== node.kind.toLowerCase()) return label;
  const kind = node.kind[0].toUpperCase() + node.kind.slice(1);
  const statement = clean(node.statement_md).replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[$*_`#]/g, "").replace(/\s+/g, " ").trim();
  if (!statement) return `${kind} · p. ${node.page}`;
  const excerpt = statement.length > 64 ? `${statement.slice(0, 61).trimEnd()}…` : statement;
  return `${kind}: ${excerpt}`;
}
export function nodeDescription(node: LabelNode): string {
  const kind = node.kind[0].toUpperCase() + node.kind.slice(1);
  const label = clean(node.label) || kind;
  const text = nodeLabel(node);
  return `${text === label || text.toLowerCase().startsWith(`${label.toLowerCase()}:`) ? text : `${label} · ${text}`} · p. ${node.page}`;
}
