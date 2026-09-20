import assert from "node:assert/strict";
import { pdfToViewport, viewportToPdf } from "../lib/coordinates";
import { demoProofTrace } from "../lib/demo-trace";
import { readFileSync, readdirSync } from "node:fs";
import { GoldenFixture } from "@quod/contracts";
import type { Dataset } from "../lib/data";
// The authored trace belongs to this demo, regardless of incoming A0 fixtures.
const fixtures = readdirSync("demo")
  .filter((f) => f.endsWith(".json"))
  .map((f) =>
    GoldenFixture.parse(JSON.parse(readFileSync(`demo/${f}`, "utf8"))),
  );
async function dataset(): Promise<Dataset> {
  return {
    docs: fixtures.map((f) => f.document),
    nodes: fixtures.flatMap((f) => f.nodes),
    edges: fixtures.flatMap((f) => f.edges),
    anchors: fixtures.flatMap((f) => f.anchors),
    cards: fixtures.flatMap((f) => f.cards),
    entities: fixtures.flatMap((f) => f.entities),
    fixture: true,
  };
}
const box: [number, number, number, number] = [72, 340.5, 468, 412];
for (const pageWidth of [595, 612, 792])
  for (const renderedWidth of [297.5, 612, 1224]) {
    const view = pdfToViewport(box, pageWidth, renderedWidth);
    const back = viewportToPdf(view, pageWidth, renderedWidth);
    assert(back.every((n, i) => Math.abs(n - box[i]) < 1e-9));
  }
async function main() {
  const data = await dataset();
  const trace = demoProofTrace(data, {
    doc_id: "b0000000-0000-4000-8000-000000000001",
    page: 4,
    selection: "Then the corresponding combination lies in the kernel.",
    read_node_ids: ["b0000000-0000-4000-8000-000000000101"],
  });
  assert(trace);
  assert.equal(trace.chain.length, 4);
  assert.equal(trace.chain[2].read, true);
  assert.equal(trace.chain[0].depth, 0);
  assert.equal(trace.chain[3].node.title, "Vector spaces");
  console.log(
    "PASS: arbitrary-page coordinate round trips and authored four-hop trace contract/order/read state.",
  );

  assert.equal(
    demoProofTrace(
      { ...data, nodes: [] },
      {
        doc_id: "b0000000-0000-4000-8000-000000000001",
        page: 4,
        selection: "proof",
        read_node_ids: [],
      },
    ),
    null,
  );
}
void main();
