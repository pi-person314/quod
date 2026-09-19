-- Cairn Postgres schema. Single source of truth; see CONTRACTS.md.
-- Idempotent: safe to re-run. `pnpm db:schema` applies it to the compose DB.
-- Enums are text + CHECK so re-runs never fight with CREATE TYPE.

CREATE EXTENSION IF NOT EXISTS ltree;

CREATE TABLE IF NOT EXISTS corpora (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS documents (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  corpus_id   uuid NOT NULL REFERENCES corpora(id) ON DELETE CASCADE,
  title       text NOT NULL,
  filename    text NOT NULL,
  file_hash   text,                       -- sha256; idempotent re-ingest key (A5)
  page_count  integer NOT NULL DEFAULT 0,
  quality     real,                       -- A1 parse quality, < 0.8 => unsupported
  status      text NOT NULL DEFAULT 'queued'
              CHECK (status IN ('queued','ingesting','ready','unsupported','error')),
  pdf_bytes   bytea,                      -- original PDF; swap for MinIO if it hurts
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS documents_corpus_hash ON documents (corpus_id, file_hash);

-- One canonical result, possibly occurring as several nodes across documents (F3).
CREATE TABLE IF NOT EXISTS entities (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  corpus_id          uuid NOT NULL REFERENCES corpora(id) ON DELETE CASCADE,
  canonical_node_id  uuid,                -- FK added below, after nodes exists
  name               text NOT NULL
);

CREATE TABLE IF NOT EXISTS nodes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_id        uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  kind          text NOT NULL CHECK (kind IN
                ('definition','theorem','lemma','proposition','corollary','example','proof','notation')),
  label         text,                     -- "Theorem 3.4"; null if unnumbered
  title         text,                     -- "Rank-Nullity"; null if none
  statement_md  text NOT NULL,
  clauses       jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{id, text}]
  symbols       jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{sym, role}]
  page          integer NOT NULL CHECK (page >= 1),
  bbox          real[] NOT NULL CHECK (cardinality(bbox) = 4),  -- [x0,y0,x1,y1], PyMuPDF space
  entity_id     uuid REFERENCES entities(id) ON DELETE SET NULL,
  confidence    real NOT NULL DEFAULT 0 CHECK (confidence BETWEEN 0 AND 1),
  -- Optional structural path for ltree queries, e.g. 'ch3.sec2.thm4'. Filled by A2 if cheap.
  path          ltree
);
CREATE INDEX IF NOT EXISTS nodes_doc_page ON nodes (doc_id, page);
CREATE INDEX IF NOT EXISTS nodes_entity ON nodes (entity_id);
CREATE INDEX IF NOT EXISTS nodes_label ON nodes (doc_id, label);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'entities_canonical_node_fk') THEN
    ALTER TABLE entities ADD CONSTRAINT entities_canonical_node_fk
      FOREIGN KEY (canonical_node_id) REFERENCES nodes(id) ON DELETE SET NULL;
  END IF;
END $$;

-- src depends on dst.
CREATE TABLE IF NOT EXISTS edges (
  src         uuid NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  dst         uuid NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('depends_on','uses_notation','specialises','restates')),
  extractor   text NOT NULL CHECK (extractor IN ('deterministic','heuristic','notation','llm')),
  confidence  real NOT NULL DEFAULT 0 CHECK (confidence BETWEEN 0 AND 1),
  PRIMARY KEY (src, dst, kind)
);
CREATE INDEX IF NOT EXISTS edges_dst ON edges (dst);

CREATE TABLE IF NOT EXISTS anchors (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_id            uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  page              integer NOT NULL CHECK (page >= 1),
  bbox              real[] NOT NULL CHECK (cardinality(bbox) = 4),
  surface           text NOT NULL,        -- "by Theorem 3.4"
  target_node_id    uuid REFERENCES nodes(id) ON DELETE SET NULL,
  target_entity_id  uuid REFERENCES entities(id) ON DELETE SET NULL,
  card_id           uuid                  -- FK added below, after cards exists
);
CREATE INDEX IF NOT EXISTS anchors_doc_page ON anchors (doc_id, page);

CREATE TABLE IF NOT EXISTS cards (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  anchor_id        uuid NOT NULL UNIQUE REFERENCES anchors(id) ON DELETE CASCADE,
  headline         text NOT NULL,
  instantiated_md  text NOT NULL,
  full_md          text NOT NULL,
  substitutions    jsonb NOT NULL DEFAULT '[]'::jsonb,  -- [{from, to}]
  clause_ids       jsonb NOT NULL DEFAULT '[]'::jsonb,  -- ["ii"]
  gloss            text NOT NULL DEFAULT '',
  source_doc_id    uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  source_page      integer NOT NULL CHECK (source_page >= 1)
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'anchors_card_fk') THEN
    ALTER TABLE anchors ADD CONSTRAINT anchors_card_fk
      FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Per-node local reading state (F6). Single user, no accounts unless F10 is greenlit.
CREATE TABLE IF NOT EXISTS reader_state (
  node_id      uuid PRIMARY KEY REFERENCES nodes(id) ON DELETE CASCADE,
  seen         boolean NOT NULL DEFAULT false,
  dwell_ms     integer NOT NULL DEFAULT 0,
  hover_count  integer NOT NULL DEFAULT 0,
  known        boolean NOT NULL DEFAULT false,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- Worker writes one row per document at every stage boundary; the SSE route
-- (GET /api/corpus/:id/events) polls it. Mirrors IngestEvent in types.ts.
CREATE TABLE IF NOT EXISTS ingest_progress (
  doc_id      uuid PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
  stage       text NOT NULL DEFAULT 'queued' CHECK (stage IN
              ('queued','parse','segment','anchors','edges','resolve','bake','done','error')),
  nodes_done  integer NOT NULL DEFAULT 0,
  total       integer NOT NULL DEFAULT 0,
  message     text,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- The cost ledger. Every model call from any process writes one row here.
-- Written by packages/intel/llm.ts (TS) and apps/worker/cairn_worker/llm.py (Python).
-- The Token Company table is `SELECT stage, sum(cost_usd) ... GROUP BY stage`.
-- input_tokens EXCLUDES cache reads (OpenAI's usage.input_tokens includes them;
-- the wrappers split it). cache_write_tokens stays 0 until the SDK reports writes.
CREATE TABLE IF NOT EXISTS llm_calls (
  id                  bigserial PRIMARY KEY,
  stage               text NOT NULL,      -- 'segment' | 'edges' | 'resolve' | 'instantiate' | 'trace' | 'voice' | ...
  model               text NOT NULL,
  input_tokens        integer NOT NULL DEFAULT 0,
  output_tokens       integer NOT NULL DEFAULT 0,
  cache_read_tokens   integer NOT NULL DEFAULT 0,
  cache_write_tokens  integer NOT NULL DEFAULT 0,
  latency_ms          integer NOT NULL DEFAULT 0,
  cost_usd            numeric(12, 6) NOT NULL DEFAULT 0,
  corpus_id           uuid,
  doc_id              uuid,
  -- Free-form: batch size, cache hit, optimisations enabled/disabled (C5 A/B run).
  meta                jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS llm_calls_stage ON llm_calls (stage);
CREATE INDEX IF NOT EXISTS llm_calls_doc ON llm_calls (doc_id);
