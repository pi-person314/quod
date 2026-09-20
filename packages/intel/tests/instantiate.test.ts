import assert from "node:assert/strict";
import test from "node:test";
import { Card } from "@quod/contracts";
import { instantiationCases } from "../evals/instantiation-cases.js";
import { instantiateCard } from "../prompts/instantiate.js";

const sample = instantiationCases[0];

test("20 synthetic answer replays preserve source metadata and hypotheses", async () => {
  assert.equal(instantiationCases.length, 20);
  for (const fixture of instantiationCases) {
    const result = await instantiateCard(fixture.input, async () => fixture.expected);
    assert.equal(result.mode, "instantiated", fixture.name);
    assert.deepEqual(result.card.clause_ids, fixture.expected.clause_ids);
    assert.equal(result.card.full_md, fixture.input.target.statement_md);
    assert.deepEqual(result.card.source, { doc_id: fixture.input.target.doc_id, page: fixture.input.target.page });
    assert.ok(Card.safeParse(result.card).success);
  }
});

test("absent context and absent model perform no network work", async () => {
  let called = false;
  const result = await instantiateCard({ ...sample.input, invokingParagraph: undefined }, async () => {
    called = true;
    return sample.expected;
  });
  assert.equal(called, false);
  assert.equal(result.fallbackReason, "missing-context");
  assert.equal((await instantiateCard(sample.input)).fallbackReason, "no-model");
  assert.equal(result.card.instantiated_md, sample.input.target.statement_md);
  assert.deepEqual(result.card.substitutions, []);
});

test("malformed and failed generation fall back", async () => {
  for (const output of ["not JSON", null, {}, { ...sample.expected, source: { page: 999 } }]) {
    assert.equal((await instantiateCard(sample.input, async () => output)).fallbackReason, "invalid-output");
  }
  assert.equal((await instantiateCard(sample.input, async () => { throw new Error("offline"); })).fallbackReason, "model-error");
});

test("unknown/duplicate clauses, invented symbols and altered hypotheses are rejected", async () => {
  for (const output of [
    { ...sample.expected, clause_ids: ["iii"] },
    { ...sample.expected, clause_ids: ["ii", "ii"] },
    { ...sample.expected, substitutions: [{ from: "x", to: "z" }] },
    { ...sample.expected, substitutions: [{ from: "q", to: "y" }] },
    { ...sample.expected, substitutions: [{ from: "x", to: "y" }, { from: "x", to: "y" }] },
    { ...sample.expected, instantiated_md: "$y = 0$" },
    { ...sample.expected, gloss: "<script>alert(1)</script>" },
  ]) {
    const result = await instantiateCard(sample.input, async () => output);
    assert.equal(result.fallbackReason, "invalid-output");
    assert.equal(result.card.instantiated_md, sample.input.target.statement_md);
    assert.deepEqual(result.card.clause_ids, []);
  }
});

test("destination must occur in paragraph even when present in symbol table", async () => {
  const input = { ...sample.input, invokingParagraph: "Apply the theorem without naming any symbol." };
  assert.equal((await instantiateCard(input, async () => sample.expected)).fallbackReason, "invalid-output");
});

test("exact JSON response accepted, card identity retained", async () => {
  const input = { ...sample.input, anchor: { ...sample.input.anchor, card_id: "00000000-0000-4000-8000-000000009999" } };
  const result = await instantiateCard(input, async () => JSON.stringify(sample.expected));
  assert.equal(result.mode, "instantiated");
  assert.equal(result.card.id, input.anchor.card_id);
});

test("wrong target is rejected before generation", async () => {
  await assert.rejects(instantiateCard({
    ...sample.input,
    anchor: { ...sample.input.anchor, target_node_id: "00000000-0000-4000-8000-000000008888" },
  }), /does not resolve/);
});

test("structural validation explicitly does not prove clause relevance", async () => {
  const result = await instantiateCard(sample.input, async () => ({ ...sample.expected, clause_ids: ["i"] }));
  assert.equal(result.mode, "instantiated");
  assert.notDeepEqual(result.card.clause_ids, sample.expected.clause_ids);
});

test("token replacement preserves commands and indexed symbols", async () => {
  const statement = "For real $x$, $exp(x) + x_1 + \\max(x, 0) + 2x$ is defined.";
  const input = { ...sample.input, target: { ...sample.input.target, statement_md: statement } };
  const output = {
    ...sample.expected,
    instantiated_md: "For real $y$, $exp(y) + x_1 + \\max(y, 0) + 2y$ is defined.",
  };
  assert.equal((await instantiateCard(input, async () => output)).mode, "instantiated");
  assert.equal((await instantiateCard(input, async () => ({ ...output, instantiated_md: output.instantiated_md.replace("x_1", "y_1") }))).mode, "original");
});

test("renaming is simultaneous and rejects symbol capture", async () => {
  const input = {
    ...sample.input,
    target: {
      ...sample.input.target, statement_md: "$x + y$",
      symbols: [{ sym: "x", role: "real" }, { sym: "y", role: "real" }],
    },
    invokingParagraph: "Let x and y be real.",
    localSymbols: [{ sym: "x", role: "real" }, { sym: "y", role: "real" }],
  };
  const swapped = {
    ...sample.expected, instantiated_md: "$y + x$",
    substitutions: [{ from: "x", to: "y" }, { from: "y", to: "x" }],
  };
  assert.equal((await instantiateCard(input, async () => swapped)).mode, "instantiated");
  assert.equal((await instantiateCard(input, async () => ({
    ...swapped, instantiated_md: "$y + y$", substitutions: [{ from: "x", to: "y" }],
  }))).mode, "original");
});

test("LaTeX command symbols can be renamed without altering longer commands", async () => {
  const input = {
    ...sample.input,
    target: { ...sample.input.target, statement_md: "$\\alpha + \\alphabet$", symbols: [{ sym: "\\alpha", role: "scalar" }] },
    invokingParagraph: "Let $\\beta$ be a scalar.",
    localSymbols: [{ sym: "\\beta", role: "scalar" }],
  };
  assert.equal((await instantiateCard(input, async () => ({
    ...sample.expected, instantiated_md: "$\\beta + \\alphabet$", substitutions: [{ from: "\\alpha", to: "\\beta" }],
  }))).mode, "instantiated");
});

test("entity-only anchors may use a matching canonical target", async () => {
  const entityId = "00000000-0000-4000-8000-000000007777";
  const input = {
    ...sample.input,
    target: { ...sample.input.target, entity_id: entityId },
    anchor: { ...sample.input.anchor, target_node_id: null, target_entity_id: entityId },
  };
  assert.equal((await instantiateCard(input, async () => sample.expected)).mode, "instantiated");
});
