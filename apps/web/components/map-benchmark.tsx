"use client";
import { useCallback, useMemo } from "react";
import type { Dataset } from "@/lib/data";
import { CorpusMap } from "./corpus-map";
export function MapBenchmark({ data }: { data: Dataset }) {
  const graph = useMemo<Dataset>(() => {
    const nodes = Array.from({ length: 200 }, (_, i) => ({
      ...data.nodes[i % data.nodes.length],
      id: `f0000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
      entity_id: null,
      title: `${data.nodes[i % data.nodes.length].title} ${Math.floor(i / data.nodes.length) + 1}`,
      doc_id: data.docs[i % 4].id,
    }));
    const edges = nodes.flatMap((n, i) =>
      [1, 4, 13]
        .filter((step) => i >= step)
        .map((step) => ({
          src: n.id,
          dst: nodes[i - step].id,
          kind: "depends_on" as const,
          extractor: "deterministic" as const,
          confidence: 1,
        })),
    );
    return { ...data, nodes, edges, entities: [] };
  }, [data]);
  const jump = useCallback(
    (doc: string, page: number) => location.assign(`/read/${doc}?page=${page}`),
    [],
  );
  return (
    <CorpusMap
      data={graph}
      state={{}}
      onJump={jump}
      onClose={() => location.assign("/")}
    />
  );
}
