"""Stages 5 and 6 — resolve and bake are Session C's handlers; the worker calls them.

POST {WEB_BASE_URL}/api/intel/resolve  {corpus_id, node_ids} -> {decisions}
POST {WEB_BASE_URL}/api/intel/bake     {doc_id}              -> {cards_done}

Failures must reach the pipeline error state: an unresolved/unbaked document
must never be advertised as ready.
"""

from __future__ import annotations

import logging
from uuid import UUID

import httpx

from cairn_worker.config import settings

log = logging.getLogger(__name__)


def _post(path: str, body: dict) -> dict | None:
    url = f"{settings.web_base_url}{path}"
    r = httpx.post(url, json=body, timeout=600)
    if r.is_error:
        try:
            payload = r.json()
            detail = payload.get("message") or payload.get("error")
        except (ValueError, AttributeError):
            detail = None
        if isinstance(detail, str) and detail:
            raise RuntimeError(f"Intelligence {path.rsplit('/', 1)[-1]} failed ({r.status_code}): {detail[:400]}")
    r.raise_for_status()
    return r.json()


def resolve(corpus_id: UUID, node_ids: list[UUID]) -> int:
    """Returns the number of decisions applied by C's handler (0 if skipped)."""
    if not node_ids:
        return 0
    out = _post("/api/intel/resolve", {"corpus_id": str(corpus_id), "node_ids": [str(n) for n in node_ids]})
    return len(out["decisions"]) if out else 0


def bake(doc_id: UUID) -> int:
    """Returns cards_done (0 if skipped)."""
    out = _post("/api/intel/bake", {"doc_id": str(doc_id)})
    return int(out["cards_done"]) if out else 0
