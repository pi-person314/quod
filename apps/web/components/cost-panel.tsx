"use client";
import { useEffect, useState } from "react";
type Costs = { measured: boolean; total_usd: number; stages: {
  stage: string; calls: number; input_tokens: string; output_tokens: string; cache_read_tokens: string; cost_usd: number;
}[] };
export function CostPanel({ corpusId }: { corpusId: string }) {
  const [costs, setCosts] = useState<Costs>();
  const [error, setError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/intel/costs?corpus_id=${encodeURIComponent(corpusId)}`, { signal: controller.signal })
      .then(async response => { if (!response.ok) throw new Error("Cost ledger unavailable"); return response.json(); })
      .then(setCosts).catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [corpusId]);
  return <>
    <h2>Measured, never guessed.</h2>
    <p>{error ? "The cost ledger is unavailable. Please try again." : !costs ? "Loading cost ledger…"
      : costs.measured ? `Estimated cost from recorded API usage: $${costs.total_usd.toFixed(4)}.`
      : "No measured API usage has been recorded for this corpus."}</p>
    {!!costs?.stages.length && <table><thead><tr><th>Stage</th><th>Calls</th><th>Input / output</th><th>Cached input</th><th>Cost</th></tr></thead>
      <tbody>{costs.stages.map(row => <tr key={row.stage}><td>{row.stage}</td><td>{row.calls}</td>
        <td>{row.input_tokens} / {row.output_tokens}</td><td>{row.cache_read_tokens}</td><td>${row.cost_usd.toFixed(4)}</td></tr>)}</tbody></table>}
    <p className="muted">Baked reference cards make no model calls while you read. A measured baseline and optimized run are still required to establish savings. Synthetic test calls are excluded.</p>
  </>;
}
