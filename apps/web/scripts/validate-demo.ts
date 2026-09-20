import { GoldenFixture, TraceResponse } from "@quod/contracts";
import { readFileSync, readdirSync } from "node:fs";
import assert from "node:assert/strict";
const fixtures = readdirSync("demo")
  .filter((f) => f.endsWith(".json"))
  .map((f) =>
    GoldenFixture.parse(JSON.parse(readFileSync(`demo/${f}`, "utf8"))),
  );
const nodes = fixtures.flatMap((f) => f.nodes),
  anchors = fixtures.flatMap((f) => f.anchors),
  cards = fixtures.flatMap((f) => f.cards);
for (const a of anchors) {
  assert(nodes.some((n) => n.id === a.target_node_id));
  assert(cards.some((c) => c.anchor_id === a.id && c.id === a.card_id));
  assert(a.bbox[2] > a.bbox[0] && a.bbox[3] > a.bbox[1]);
}
for (const f of fixtures)
  assert(readFileSync(`demo/${f.pdf}`).subarray(0, 5).toString() === "%PDF-");
console.log(
  `Validated ${fixtures.length} local fixtures, ${nodes.length} nodes, ${anchors.length} anchors, ${cards.length} cards with referential integrity and real PDF bytes.`,
);
