"""Stages 5 and 6 — resolve and bake are Session C's handlers; the worker calls them.

POST {WEB_BASE_URL}/api/intel/resolve  {corpus_id, node_ids} -> {decisions}
POST {WEB_BASE_URL}/api/intel/bake     {doc_id}              -> {cards_done}

Until C's handlers land they return 501; we log and continue so A's pipeline
is testable end to end from hour 1.
"""

from __future__ import annotations

import logging
from uuid import UUID

import httpx

from cairn_worker.config import settings

log = logging.getLogger(__name__)


def _post(path: str, body: dict) -> dict | None:
    url = f"{settings.web_base_url}{path}"
    try:
        r = httpx.post(url, json=body, timeout=600)
    except httpx.HTTPError as e:
        log.warning("%s unreachable (%s); skipping", url, e)
        return None
    if r.status_code == 501:
        log.warning("%s not implemented yet (owner C); skipping", path)
        return None
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
