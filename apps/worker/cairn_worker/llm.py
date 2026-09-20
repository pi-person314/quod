"""call_model(): the one wrapper every Python model call goes through.

Writes the same llm_calls rows as packages/intel/llm.ts. Keep PRICING in sync
with the TS file; the Token Company table is built from this ledger.

OpenAI Responses API. Cached input is automatic on a stable prefix; pass
``prompt_cache_key`` per chapter so the 20-node batches route to one cache.
"""

from __future__ import annotations

import json
import math
import os
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
        _client = OpenAI(max_retries=0)
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
        raise ValueError("Missing usage; billing reconciliation required")
    cached = u.input_tokens_details.cached_tokens if u.input_tokens_details else 0
    writes = getattr(u.input_tokens_details, "cache_write_tokens", 0) or 0
    values = (u.input_tokens - cached - writes, u.output_tokens, cached, writes)
    if any(not isinstance(n, int) or n < 0 for n in values):
        raise ValueError("Invalid token usage")
    return LedgerUsage(*values)


def estimate_cost_usd(model: str, u: LedgerUsage) -> float:
    p = PRICING.get(model)
    if not p:
        raise ValueError(f"No verified pricing for model: {model}")
    if u.input_tokens + u.cache_read_tokens + u.cache_write_tokens > 272000:
        raise ValueError("Long-context pricing requires reconciliation")
    return (
        u.input_tokens * p["input"]
        + u.cache_read_tokens * p["cached_input"]
        + u.cache_write_tokens * p["cache_write"]
        + u.output_tokens * p["output"]
    ) / 1_000_000


def call_model(
    conn: psycopg.Connection | None,
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
    if os.environ.get("CAIRN_LIVE_API") != "1":
        raise RuntimeError("Live API calls are disabled")
    if conn is None or not conn.autocommit:
        raise RuntimeError("Paid calls require an autocommit ledger connection")
    if not os.environ.get("OPENAI_API_KEY"):
        raise RuntimeError("OPENAI_API_KEY is not configured in the process environment")
    estimate_cost_usd(model, LedgerUsage(0, 0))
    if not isinstance(max_output_tokens, int) or not 0 < max_output_tokens <= 128000:
        raise ValueError("Invalid maximum output tokens")
    if not isinstance(input, str):
        if not all(isinstance(item, dict) and isinstance(item.get("content"), str) and "role" in item for item in input):
            raise ValueError("Only text model inputs are supported")
    if len(json.dumps([input, instructions, json_schema], ensure_ascii=False).encode()) > 240000:
        raise ValueError("Input exceeds short-context budget")
    price = PRICING[model]
    maximum = math.ceil(272000 * max(price["input"], price["cache_write"]) + max_output_tokens * price["output"])
    reservation_row = conn.execute("SELECT cairn_reserve(%s,%s,%s) AS id", (maximum, stage, model)).fetchone()
    reservation = reservation_row["id"] if isinstance(reservation_row, dict) else reservation_row[0]
    kwargs: dict[str, Any] = {}
    if instructions is not None:
        kwargs["instructions"] = instructions
    if prompt_cache_key is not None:
        kwargs["prompt_cache_key"] = prompt_cache_key
    if json_schema is not None:
        kwargs["text"] = {"format": {"type": "json_schema", "strict": True, **json_schema}}

    started = time.perf_counter()
    response = _openai().responses.create(model=model, input=input, max_output_tokens=max_output_tokens, service_tier="default", **kwargs)
    latency_ms = int((time.perf_counter() - started) * 1000)

    usage = to_ledger_usage(response)
    if conn is not None:
        log_call(conn, stage=stage, model=model, usage=usage, latency_ms=latency_ms,
                 cost_usd=estimate_cost_usd(model, usage), doc_id=doc_id, corpus_id=corpus_id,
                 meta={**(meta or {}), "reservation_id": str(reservation), "response_id": response.id})
    # Cache-write usage is not exposed by every SDK: settle a conservative upper bound.
    actual = math.ceil((usage.input_tokens + usage.cache_write_tokens) * max(price["input"], price["cache_write"])
                       + usage.cache_read_tokens * price["cached_input"] + usage.output_tokens * price["output"])
    settled = conn.execute("SELECT cairn_settle(%s,%s) AS ok", (reservation, actual)).fetchone()
    if not (settled["ok"] if isinstance(settled, dict) else settled[0]):
        raise RuntimeError("Cost exceeded reservation; budget blocked")
    if response.status != "completed" or not response.output_text.strip():
        raise RuntimeError("Model response incomplete, refused, or empty")
    if json_schema is not None:
        json.loads(response.output_text)
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
