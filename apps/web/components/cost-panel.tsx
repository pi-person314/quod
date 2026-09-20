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
  return <section className="cost-ledger">
    <p className="cost-kicker">Measured, never guessed</p>
    <h2>{costs?.measured ? `$${costs.total_usd.toFixed(4)}` : "Cost ledger"}</h2>
    <p>{error ? "The cost ledger is unavailable. Please try again." : !costs ? "Loading cost ledger…"
      : costs.measured ? "Estimated from recorded API usage."
      : "No measured API usage has been recorded for these documents."}</p>
    {!!costs?.stages.length && <table><thead><tr><th>Stage</th><th>Calls</th><th>Input / output</th><th>Cached input</th><th>Cost</th></tr></thead>
      <tbody>{costs.stages.map(row => <tr key={row.stage}><td>{row.stage}</td><td>{row.calls}</td>
        <td>{row.input_tokens} / {row.output_tokens}</td><td>{row.cache_read_tokens}</td><td>${row.cost_usd.toFixed(4)}</td></tr>)}</tbody></table>}
    <p className="muted">Baked reference cards make no model calls while you read.</p>
  </section>;
}
