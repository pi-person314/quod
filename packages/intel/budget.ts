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

/** Explicit process opt-in plus a durable account-wide switch; never reads .env. */
export async function requireLiveBudget(): Promise<void> {
  if ((process.env.QUOD_LIVE_API ?? process.env.CAIRN_LIVE_API) !== "1") throw new Error("Live API calls are disabled; set QUOD_LIVE_API explicitly after configuring the shared budget");
  const { db } = await import("@quod/contracts/db");
  const result = await db().query("SELECT enabled FROM api_budget WHERE id='cairn-total'");
  if (!result.rows[0]?.enabled) throw new Error("Live API calls are disabled by the shared budget");
}

export async function reserveApiSpend(maximumUsd: number, stage: string, model: string): Promise<string> {
  await requireLiveBudget();
  const { db } = await import("@quod/contracts/db");
  const result = await db().query("SELECT cairn_reserve($1,$2,$3) AS id", [money(maximumUsd), stage, model]);
  return result.rows[0].id;
}

export async function settleApiSpend(id: string, actualUsd: number): Promise<void> {
  if (!Number.isFinite(actualUsd) || actualUsd < 0) throw new Error("Invalid cost");
  const { db } = await import("@quod/contracts/db");
  const result = await db().query("SELECT cairn_settle($1,$2) AS ok", [id, Math.ceil(actualUsd * MICROS)]);
  if (!result.rows[0].ok) throw new Error("Cost exceeded reservation; shared budget blocked for reconciliation");
}
