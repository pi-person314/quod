import type { Anchor, Node } from "@cairn/contracts";
import type { InstantiationInput, InstantiationOutput } from "../prompts/instantiate.js";

const sourceDoc = "00000000-0000-4000-8000-000000000101";
const invokingDoc = "00000000-0000-4000-8000-000000000102";
function id(n: number): string {
  return `00000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
}

export interface SyntheticInstantiationCase {
  name: string;
  input: InstantiationInput;
  expected: InstantiationOutput;
}

// Hand-authored toy mathematics: these are development fixtures, not A's PDFs
// and not evidence that a live model meets the 17/20 clause-selection target.
const examples = [
  ["Absolute value", "For real $x$, (i) $|x| >= 0$; (ii) $|x| = 0$ iff $x = 0$.", "|x| >= 0", "|x| = 0 iff x = 0", "For real y, use the zero case to conclude y = 0.", "ii", "Absolute value vanishes exactly at zero."],
  ["Square", "For real $x$, (i) $x^2 >= 0$; (ii) $x^2 = 0$ iff $x = 0$.", "x^2 >= 0", "x^2 = 0 iff x = 0", "For real y, its square is nonnegative.", "i", "A real square is nonnegative."],
  ["Triangle inequality", "For real $x,a$, (i) $|x+a| <= |x|+|a|$; (ii) $|x-a| <= |x|+|a|$.", "|x+a| <= |x|+|a|", "|x-a| <= |x|+|a|", "Bound the difference of real y and a by the sum of their magnitudes.", "ii", "The magnitude of a difference is bounded by the two magnitudes."],
  ["Exponential", "For real $x$, (i) $exp(x) > 0$; (ii) $exp(-x) = 1/exp(x)$.", "exp(x) > 0", "exp(-x) = 1/exp(x)", "For real y, exp(y) is positive.", "i", "The real exponential is positive."],
  ["Logarithm", "For positive real $x$, (i) $exp(log(x)) = x$; (ii) $log(x^2) = 2log(x)$.", "exp(log(x)) = x", "log(x^2) = 2log(x)", "For positive y, simplify log(y^2) to twice log(y).", "ii", "The logarithm of a positive number squared doubles its logarithm."],
  ["Reciprocal", "For positive real $x$, (i) $1/x > 0$; (ii) $1/(1/x) = x$.", "1/x > 0", "1/(1/x) = x", "For positive y, establish positivity of its reciprocal.", "i", "A positive number has a positive reciprocal."],
  ["Sine bounds", "For real $x$, (i) $-1 <= sin(x) <= 1$; (ii) $sin(-x) = -sin(x)$.", "-1 <= sin(x) <= 1", "sin(-x) = -sin(x)", "For real y, use oddness to simplify sin(-y).", "ii", "Sine is odd."],
  ["Cosine bounds", "For real $x$, (i) $-1 <= cos(x) <= 1$; (ii) $cos(-x) = cos(x)$.", "-1 <= cos(x) <= 1", "cos(-x) = cos(x)", "For real y, bound cos(y) between minus one and one.", "i", "Real cosine lies between minus one and one."],
  ["Norm", "For a vector $x$, (i) $||x|| >= 0$; (ii) $||x|| = 0$ iff $x = 0$.", "||x|| >= 0", "||x|| = 0 iff x = 0", "The vector y has zero norm, so y is zero.", "ii", "A vector with zero norm is zero."],
  ["Inner product", "For a real inner-product vector $x$, (i) $<x,x> >= 0$; (ii) $<x,x> = ||x||^2$.", "<x,x> >= 0", "<x,x> = ||x||^2", "For vector y, identify its self inner product with its squared norm.", "ii", "The self inner product is the squared norm."],
  ["Finite set", "For a finite set $x$, (i) $|x| >= 0$; (ii) $|x| = 0$ iff $x$ is empty.", "|x| >= 0", "|x| = 0 iff x is empty", "Finite set y has cardinality zero, hence is empty.", "ii", "A finite set of size zero is empty."],
  ["Set complement", "For a subset $x$ of $U$, (i) $x union x^c = U$; (ii) $x intersection x^c$ is empty.", "x union x^c = U", "x intersection x^c is empty", "Subset y and its complement together cover U.", "i", "A set and its complement cover the universe."],
  ["Probability", "For an event $x$, (i) $0 <= P(x) <= 1$; (ii) $P(x^c) = 1-P(x)$.", "0 <= P(x) <= 1", "P(x^c) = 1-P(x)", "Find the probability of the complement of event y.", "ii", "Complementary events have probabilities summing to one."],
  ["Expectation", "For an integrable random variable $x$, (i) $E(2x) = 2E(x)$; (ii) $E(x+1) = E(x)+1$.", "E(2x) = 2E(x)", "E(x+1) = E(x)+1", "For integrable y, move the constant factor out of E(2y).", "i", "Expectation respects multiplication by a constant."],
  ["Determinant", "For a square matrix $x$, (i) $det(x^T) = det(x)$; (ii) $det(x^2) = det(x)^2$.", "det(x^T) = det(x)", "det(x^2) = det(x)^2", "For square matrix y, simplify the determinant of its square.", "ii", "The determinant of a square is the squared determinant."],
  ["Trace", "For a square matrix $x$, (i) $tr(x^T) = tr(x)$; (ii) $tr(2x) = 2tr(x)$.", "tr(x^T) = tr(x)", "tr(2x) = 2tr(x)", "For square matrix y, transposing preserves its trace.", "i", "Trace is unchanged by transposition."],
  ["Integer parity", "For an integer $x$, (i) $2x$ is even; (ii) $2x+1$ is odd.", "2x is even", "2x+1 is odd", "For integer y, establish that 2y+1 is odd.", "ii", "Twice an integer plus one is odd."],
  ["Divisibility", "For an integer $x$, (i) $x$ divides $2x$; (ii) $1$ divides $x$.", "x divides 2x", "1 divides x", "For integer y, show that y divides twice itself.", "i", "An integer divides twice itself."],
  ["Complex conjugation", "For complex $x$, (i) $conj(conj(x)) = x$; (ii) $x conj(x) = |x|^2$.", "conj(conj(x)) = x", "x conj(x) = |x|^2", "For complex y, multiply it by its conjugate to obtain its squared magnitude.", "ii", "A complex number times its conjugate gives its squared magnitude."],
  ["Idempotent set union", "For a set $x$, (i) $x union x = x$; (ii) $x intersection x = x$.", "x union x = x", "x intersection x = x", "Simplify the intersection of set y with itself.", "ii", "Intersecting a set with itself leaves it unchanged."],
] as const;

export const instantiationCases: SyntheticInstantiationCase[] = examples.map((entry, index) => {
  const [title, statement, first, second, paragraph, selected, gloss] = entry;
  const target: Node = {
    id: id(1000 + index), doc_id: sourceDoc, kind: "theorem", label: `Toy ${index + 1}`,
    title, statement_md: statement, clauses: [{ id: "i", text: first }, { id: "ii", text: second }],
    symbols: [{ sym: "x", role: title }], page: index + 1, bbox: [0, 0, 100, 50],
    entity_id: null, confidence: 1,
  };
  const anchor: Anchor = {
    id: id(2000 + index), doc_id: invokingDoc, page: index + 1, bbox: [0, 0, 100, 20],
    surface: `by ${target.label}`, target_node_id: target.id, target_entity_id: null, card_id: null,
  };
  return {
    name: title,
    input: { target, anchor, invokingParagraph: paragraph, localSymbols: [{ sym: "y", role: title }] },
    expected: {
      clause_ids: [selected],
      // Independent replacement specification: x is the only bound symbol in
      // these toy inputs; occurrences in exp must remain untouched.
      instantiated_md: statement.replace(/(?<![A-Za-z])x(?![A-Za-z])/g, "y"),
      substitutions: [{ from: "x", to: "y" }], gloss,
    },
  };
});
