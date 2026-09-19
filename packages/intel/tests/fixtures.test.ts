import assert from "node:assert/strict";
import test from "node:test";
import { GoldenFixture } from "@cairn/contracts";
import { developmentCorpus } from "../evals/development-corpus";

test("development fixtures validate and cross-document references are complete", async () => {
  const fixtures = await developmentCorpus();
  fixtures.forEach((fixture) => GoldenFixture.parse(fixture));
  const nodes = new Set(fixtures.flatMap((fixture) => fixture.nodes.map((node) => node.id)));
  const entities = new Set(fixtures.flatMap((fixture) => fixture.entities.map((entity) => entity.id)));
  const cards = new Map(fixtures.flatMap((fixture) => fixture.cards.map((card) => [card.id, card] as const)));
  assert.equal(cards.size, 20);
  for (const fixture of fixtures) {
    for (const edge of fixture.edges) assert.ok(nodes.has(edge.src) && nodes.has(edge.dst));
    for (const anchor of fixture.anchors) {
      assert.ok(nodes.has(anchor.target_node_id!));
      assert.ok(entities.has(anchor.target_entity_id!));
      assert.equal(cards.get(anchor.card_id!)!.anchor_id, anchor.id);
    }
    for (const node of fixture.nodes) assert.ok(entities.has(node.entity_id!));
  }
});
