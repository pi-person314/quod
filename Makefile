# Session A demo database. `make demo-db` is the A5 acceptance test:
# a working corpus from scratch in under 30 seconds with no network.

SHELL := /bin/bash

DATABASE_URL ?= postgres://cairn:cairn@localhost:5432/cairn
SCHEMA := packages/contracts/schema.sql
DUMP := fixtures/demo.dump
BUDGET := packages/contracts/migrations/001_api_budget.sql
WORKER := apps/worker/.venv/bin/quod-worker

# Prefer a local psql; fall back to the one inside the compose container.
# Both read the script from stdin so no bind mount is required.
PSQL := $(shell command -v psql 2>/dev/null)
ifeq ($(PSQL),)
  RUN_SQL = docker compose exec -T postgres psql -U cairn -d cairn -v ON_ERROR_STOP=1 -q
else
  RUN_SQL = $(PSQL) "$(DATABASE_URL)" -v ON_ERROR_STOP=1 -q
endif

.PHONY: demo-db demo-dump demo-fixtures

## Restore the pre-ingested demo corpus. Offline; the gate is < 30s.
demo-db:
	@test -f $(DUMP) || { echo "$(DUMP) missing — run 'make demo-dump' first"; exit 1; }
	@time { $(RUN_SQL) < $(SCHEMA) && $(RUN_SQL) < $(BUDGET) && $(RUN_SQL) < $(DUMP); }
	@echo "demo corpus restored"

## Regenerate fixtures/demo.dump from whatever is currently in Postgres.
demo-dump:
	$(WORKER) dump-demo

## Populate Postgres from fixtures/golden/* without parsing any PDF.
demo-fixtures:
	$(WORKER) load-fixtures
