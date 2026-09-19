/** USD 500 total for this work, not an automatically renewing monthly budget. */
export const SPEND_LIMIT_USD = 500;
const MICROS = 1_000_000;

export interface BudgetState {
  spentMicros: number;
  reservations: Record<string, number>;
}

function money(usd: number): number {
  if (!Number.isFinite(usd) || usd < 0 || usd > SPEND_LIMIT_USD) {
    throw new Error("Invalid budget amount");
  }
  return Math.ceil(usd * MICROS);
}

function validate(state: BudgetState): void {
  for (const n of [state.spentMicros, ...Object.values(state.reservations)]) {
    if (!Number.isSafeInteger(n) || n < 0) throw new Error("Invalid budget state");
  }
}

/** Pure transition. A durable store MUST apply read/check/write atomically. */
export function reserveSpend(state: BudgetState, requestId: string, maximumUsd: number): BudgetState {
  validate(state);
  if (!requestId || Object.hasOwn(state.reservations, requestId)) throw new Error("Duplicate or empty reservation");
  const reservation = money(maximumUsd);
  if (reservation === 0) throw new Error("A paid request needs a positive reservation");
  const committed = state.spentMicros + Object.values(state.reservations).reduce((a, b) => a + b, 0);
  if (committed + reservation > SPEND_LIMIT_USD * MICROS) throw new Error("API spending limit reached");
  return { spentMicros: state.spentMicros, reservations: { ...state.reservations, [requestId]: reservation } };
}

/** Unknown outcomes keep their reservation. Only verified billing may settle it. */
export function settleSpend(state: BudgetState, requestId: string, actualUsd: number): BudgetState {
  validate(state);
  if (!Object.hasOwn(state.reservations, requestId)) throw new Error("Unknown reservation");
  const actual = money(actualUsd);
  if (actual > state.reservations[requestId]) throw new Error("Actual cost exceeds reservation; reconciliation required");
  const reservations = { ...state.reservations };
  delete reservations[requestId];
  return { spentMicros: state.spentMicros + actual, reservations };
}

/** Fail closed until shared durable reservations and account controls are verified. */
export async function requireLiveBudget(): Promise<never> {
  throw new Error("Live API calls are disabled until the shared $500 spending guard is configured");
}
