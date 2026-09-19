"""call_model(): the one wrapper every Python model call goes through.

Writes the same llm_calls rows as packages/intel/llm.ts. Keep PRICING in sync
with the TS file; the Token Company table is built from this ledger.

OpenAI Responses API. Cached input is automatic on a stable prefix; pass
``prompt_cache_key`` per chapter so the 20-node batches route to one cache.
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass
from typing import Any
from uuid import UUID

import psycopg
from openai import OpenAI
from openai.types.responses import Response, ResponseInputParam

from cairn_worker.config import settings

# USD per million tokens, from the OpenAI pricing page on 2026-09-19. Sol is on
# promotional pricing through at least 2026-11-21; re-pull at the venue. Cache
# writes bill at 1.25x input but the SDK's usage object does not report them.
PRICING: dict[str, dict[str, float]] = {
    "gpt-5.6-luna": {"input": 0.2, "cached_input": 0.02, "cache_write": 0.25, "output": 1.2},
    "gpt-5.6-sol": {"input": 4.0, "cached_input": 0.4, "cache_write": 5.0, "output": 20.0},
    "text-embedding-3-small": {"input": 0.02, "cached_input": 0.02, "cache_write": 0.0, "output": 0.0},
}

_client: OpenAI | None = None


def _openai() -> OpenAI:
    global _client
    if _client is None:
        _client = OpenAI()
    return _client


@dataclass(frozen=True)
class LedgerUsage:
    """Ledger token columns. input_tokens EXCLUDES cache reads so the columns are disjoint."""

    input_tokens: int
    output_tokens: int
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0


def to_ledger_usage(response: Response) -> LedgerUsage:
    """OpenAI's input_tokens includes cached_tokens; split them for the ledger."""
    u = response.usage
    if u is None:
        return LedgerUsage(0, 0)
    cached = u.input_tokens_details.cached_tokens if u.input_tokens_details else 0
    return LedgerUsage(u.input_tokens - cached, u.output_tokens, cached, 0)


def estimate_cost_usd(model: str, u: LedgerUsage) -> float:
    p = PRICING.get(model)
    if not p:
        return 0.0
    return (
        u.input_tokens * p["input"]
        + u.cache_read_tokens * p["cached_input"]
        + u.cache_write_tokens * p["cache_write"]
        + u.output_tokens * p["output"]
    ) / 1_000_000


def call_model(
    conn: psycopg.Connection,
    *,
    stage: str,
    input: str | ResponseInputParam,
    instructions: str | None = None,
    model: str | None = None,
    prompt_cache_key: str | None = None,
    json_schema: dict[str, Any] | None = None,
    max_output_tokens: int = 8192,
    doc_id: UUID | None = None,
    corpus_id: UUID | None = None,
    meta: dict[str, Any] | None = None,
) -> tuple[str, Response]:
    """Returns (output_text, full response). Logs one ledger row.

    Keep the chapter context in ``instructions`` byte-identical across a batch
    and pass one ``prompt_cache_key`` per chapter so cached input hits (A2, C5).
    ``json_schema`` = {"name": ..., "schema": {...}} enables strict JSON output.
    """
    model = model or settings.model_fast
    kwargs: dict[str, Any] = {}
    if instructions is not None:
        kwargs["instructions"] = instructions
    if prompt_cache_key is not None:
        kwargs["prompt_cache_key"] = prompt_cache_key
    if json_schema is not None:
        kwargs["text"] = {"format": {"type": "json_schema", "strict": True, **json_schema}}

    started = time.perf_counter()
    response = _openai().responses.create(model=model, input=input, max_output_tokens=max_output_tokens, **kwargs)
    latency_ms = int((time.perf_counter() - started) * 1000)

    usage = to_ledger_usage(response)
    log_call(conn, stage=stage, model=model, usage=usage, latency_ms=latency_ms,
             cost_usd=estimate_cost_usd(model, usage), doc_id=doc_id, corpus_id=corpus_id, meta=meta)
    return response.output_text, response


def log_call(
    conn: psycopg.Connection,
    *,
    stage: str,
    model: str,
    usage: LedgerUsage,
    latency_ms: int,
    cost_usd: float,
    doc_id: UUID | None = None,
    corpus_id: UUID | None = None,
    meta: dict[str, Any] | None = None,
) -> None:
    conn.execute(
        """
        INSERT INTO llm_calls
          (stage, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
           latency_ms, cost_usd, corpus_id, doc_id, meta)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb)
        """,
        (
            stage, model, usage.input_tokens, usage.output_tokens,
            usage.cache_read_tokens, usage.cache_write_tokens,
            latency_ms, cost_usd, corpus_id, doc_id, json.dumps(meta or {}),
        ),
    )
