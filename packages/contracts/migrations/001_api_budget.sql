-- Shared, non-renewing ceiling for both Python and TypeScript callers.
CREATE TABLE IF NOT EXISTS api_budget (
  id text PRIMARY KEY CHECK (id = 'cairn-total'),
  limit_microusd bigint NOT NULL CHECK (limit_microusd BETWEEN 1 AND 500000000),
  opening_microusd bigint NOT NULL DEFAULT 0 CHECK (opening_microusd >= 0),
  enabled boolean NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS api_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  maximum_microusd bigint NOT NULL CHECK (maximum_microusd > 0),
  actual_microusd bigint CHECK (actual_microusd >= 0),
  stage text NOT NULL,
  model text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- Historical calls are included once; rerunning this migration never resets spending.
INSERT INTO api_budget(id,limit_microusd,opening_microusd)
SELECT 'cairn-total',500000000,ceil(coalesce(sum(cost_usd),0)*1000000)::bigint
FROM llm_calls WHERE coalesce(meta->>'synthetic','false') <> 'true'
ON CONFLICT(id) DO NOTHING;

CREATE OR REPLACE FUNCTION cairn_reserve(p_maximum bigint, p_stage text, p_model text)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE budget api_budget%ROWTYPE; committed bigint; reservation uuid;
BEGIN
  SELECT * INTO STRICT budget FROM api_budget WHERE id='cairn-total' FOR UPDATE;
  IF NOT budget.enabled THEN RAISE EXCEPTION 'Live API calls are disabled'; END IF;
  IF p_maximum <= 0 THEN RAISE EXCEPTION 'Invalid reservation'; END IF;
  SELECT coalesce(sum(coalesce(actual_microusd,maximum_microusd)),0) INTO committed FROM api_reservations;
  IF budget.opening_microusd + committed + p_maximum > budget.limit_microusd THEN
    RAISE EXCEPTION 'API spending limit reached';
  END IF;
  INSERT INTO api_reservations(maximum_microusd,stage,model) VALUES(p_maximum,p_stage,p_model) RETURNING id INTO reservation;
  RETURN reservation;
END $$;

CREATE OR REPLACE FUNCTION cairn_settle(p_id uuid, p_actual bigint)
RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE reservation api_reservations%ROWTYPE;
BEGIN
  PERFORM 1 FROM api_budget WHERE id='cairn-total' FOR UPDATE;
  SELECT * INTO STRICT reservation FROM api_reservations WHERE id=p_id FOR UPDATE;
  IF p_actual < 0 OR reservation.actual_microusd IS NOT NULL THEN RAISE EXCEPTION 'Invalid settlement'; END IF;
  UPDATE api_reservations SET actual_microusd=p_actual WHERE id=p_id;
  IF p_actual > reservation.maximum_microusd THEN
    UPDATE api_budget SET enabled=false WHERE id='cairn-total';
    RETURN false;
  END IF;
  RETURN true;
END $$;
