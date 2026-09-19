-- PROPOSAL ONLY. Not applied. A owns the canonical shared schema.
-- Approval would allow this to be integrated into packages/contracts/schema.sql.
-- Installing tables alone must not enable live requests.

CREATE TABLE IF NOT EXISTS api_budgets (
  id text PRIMARY KEY,
  limit_microusd bigint NOT NULL DEFAULT 500000000
    CHECK (limit_microusd > 0 AND limit_microusd <= 500000000),
  opening_spend_microusd bigint NOT NULL DEFAULT 0
    CHECK (opening_spend_microusd >= 0),
  state text NOT NULL DEFAULT 'blocked' CHECK (state IN ('blocked', 'active')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (opening_spend_microusd <= limit_microusd)
);

CREATE TABLE IF NOT EXISTS api_reservations (
  request_id uuid PRIMARY KEY,
  budget_id text NOT NULL REFERENCES api_budgets(id) ON DELETE RESTRICT,
  stage text NOT NULL,
  model text NOT NULL,
  reserved_microusd bigint NOT NULL CHECK (reserved_microusd > 0),
  actual_microusd bigint CHECK (actual_microusd >= 0),
  status text NOT NULL DEFAULT 'reserved'
    CHECK (status IN ('reserved', 'settled', 'uncertain')),
  provider_request_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz,
  CHECK (status <> 'settled' OR (actual_microusd IS NOT NULL AND settled_at IS NOT NULL)),
  CHECK (status <> 'reserved' OR actual_microusd IS NULL)
);
CREATE INDEX IF NOT EXISTS api_reservations_budget ON api_reservations(budget_id);

-- Both wrappers SELECT the fixed budget row FOR UPDATE before checking usage
-- and inserting a reservation. Settled cost + outstanding reservations + opening
-- spend must fit the configured limit. Unknown outcomes retain a reservation;
-- actual-over-reserved reconciliation blocks the budget rather than dropping cost.
-- No budget row is inserted/reset here. Activation is a separate verified step.
