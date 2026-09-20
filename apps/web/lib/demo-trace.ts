import { TraceResponse, type TraceRequest } from "@quod/contracts";
import type { Dataset } from "./data";
/** Hand-authored acceptance trace for the demo's independence argument. */
export function demoProofTrace(
  data: Dataset,
  request: TraceRequest,
): TraceResponse | null {
  if (
    request.doc_id !== "b0000000-0000-4000-8000-000000000001" ||
    request.page !== 4
  )
    return null;
  const steps = [
    [
      "112",
      "The selected independence argument is the central step of this proof.",
    ],
    [
      "102",
      "A combination sent to zero belongs to the kernel, so it can be written in the chosen kernel basis.",
    ],
    [
      "101",
      "Linearity moves the coefficients through T and turns the relation among images into a vector in the kernel.",
    ],
    [
      "100",
      "A basis is linearly independent; the resulting relation therefore has only zero coefficients.",
    ],
  ];
  const nodes = steps.map(([suffix]) =>
    data.nodes.find(
      (n) => n.id === `b0000000-0000-4000-8000-${suffix.padStart(12, "0")}`,
    ),
  );
  if (nodes.some((node) => !node)) return null;
  const selected = request.selection.toLowerCase().replace(/\s+/g, " ").trim();
  // This authored fallback applies to the known proof passage, not arbitrary text on its page.
  if (selected.length < 24 || (!nodes[0]!.statement_md.toLowerCase().replace(/\s+/g, " ").includes(selected)
    && selected !== "then the corresponding combination lies in the kernel.")) return null;
  const chain = steps.map(([, reason], depth) => {
    const node = nodes[depth]!;
    return {
      node,
      entity_id: node.entity_id,
      reason,
      read: request.read_node_ids.includes(node.id),
      depth,
    };
  });
  return TraceResponse.parse({ chain });
}
