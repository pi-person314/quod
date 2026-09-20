import type { Dataset } from "./data";
import { demoProofTrace } from "./demo-trace";
import {
  TraceResponse,
  ForwardResponse,
  SearchResponse,
  type TraceRequest,
} from "@cairn/contracts";
async function request(url: string, init?: RequestInit) {
  const r = await fetch(url, init);
  if (!r.ok) throw new Error(`Request failed (${r.status})`);
  return r.json();
}
export async function trace(data: Dataset, body: TraceRequest) {
  try {
    return TraceResponse.parse(
      await request("/api/intel/trace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
  } catch (e) {
    if (!data.fixture) throw e;
    const authored = demoProofTrace(data, body);
    if (authored) return authored;
    const direct =
      data.nodes.find(
        (n) =>
          n.doc_id === body.doc_id &&
          body.selection
            .toLowerCase()
            .includes((n.title ?? n.label ?? "###").toLowerCase()),
      ) ??
      data.nodes.find((n) => n.doc_id === body.doc_id && n.page === body.page);
    const chain: TraceResponse["chain"] = [];
    let current = direct;
    const seen = new Set<string>();
    while (current && chain.length < 5 && !seen.has(current.id)) {
      seen.add(current.id);
      chain.push({
        node: current,
        entity_id: current.entity_id,
        reason: chain.length
          ? "This result supplies a prerequisite used by the step above."
          : "This is the result in the selected passage.",
        read: body.read_node_ids.includes(current.id),
        depth: chain.length,
      });
      const edge = data.edges.find(
        (e) => e.src === current!.id && e.kind === "depends_on",
      );
      current = data.nodes.find((n) => n.id === edge?.dst);
    }
    return TraceResponse.parse({ chain });
  }
}
export async function forward(data: Dataset, entity: string) {
  try {
    return ForwardResponse.parse(await request(`/api/intel/forward/${entity}`));
  } catch (e) {
    if (!data.fixture) throw e;
    const ids = new Set(
      data.nodes.filter((n) => n.entity_id === entity).map((n) => n.id),
    );
    return ForwardResponse.parse({
      entity_id: entity,
      downstream: data.edges
        .filter((e) => ids.has(e.dst) && e.kind !== "restates")
        .map((e) => ({
          node: data.nodes.find((n) => n.id === e.src)!,
          score: e.confidence,
        }))
        .filter((h) => h.node)
        .slice(0, 3),
    });
  }
}
export async function search(data: Dataset, q: string) {
  try {
    return SearchResponse.parse(
      await request(`/api/search?q=${encodeURIComponent(q)}&corpus_id=${encodeURIComponent(data.docs[0]?.corpus_id ?? "")}`),
    );
  } catch (e) {
    if (!data.fixture) throw e;
    const terms = q.toLowerCase().split(/\s+/);
    return SearchResponse.parse({
      hits: data.nodes
        .filter((n) =>
          terms.every((t) =>
            `${n.title} ${n.label} ${n.statement_md}`.toLowerCase().includes(t),
          ),
        )
        .slice(0, 20)
        .map((node) => ({ node, score: 1 })),
    });
  }
}
