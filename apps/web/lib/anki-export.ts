import type { Doc, Node } from "@quod/contracts";
import { nodeDescription } from "./node-label";
function html(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function statementHtml(text: string): string {
  return html(text)
    .replace(/\$\$([\s\S]*?)\$\$/g, (_, math: string) => `\\[${math.replace(/\r?\n/g, " ")}\\]`)
    .replace(/(?<!\\)\$([^$\n]+?)(?<!\\)\$/g, (_, math: string) => `\\(${math}\\)`)
    .replace(/\r?\n/g, "<br>");
}
export function ankiCsv(nodes: readonly Node[], docs: readonly Pick<Doc, "id" | "title">[], context: readonly Node[] = nodes): string {
  const quote = (text: string) => `"${text.replace(/"/g, '""')}"`;
  const rows = nodes.map(node => {
    const source = docs.find(doc => doc.id === node.doc_id)?.title || "Source document";
    const front = `${html(nodeDescription(node, context))}<br><small>${html(source)}</small>`;
    const back = `${statementHtml(node.statement_md)}<br><br><small>${html(source)} · p. ${node.page}</small>`;
    return [front, back].map(quote).join(",");
  });
  return ["#separator:Comma", "#html:true", "#columns:Front,Back", "#tags:quod", ...rows, ""].join("\r\n");
}
