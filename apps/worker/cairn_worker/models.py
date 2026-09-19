"""Pydantic mirror of packages/contracts/types.ts. Keep field-for-field in sync.

Plus `Span`, the A1 intermediate record that never leaves the worker.
"""

from __future__ import annotations

from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

# [x0, y0, x1, y1] in PDF points, origin top-left, y down (PyMuPDF space).
BBox = tuple[float, float, float, float]

NodeKind = Literal["definition", "theorem", "lemma", "proposition", "corollary", "example", "proof", "notation"]
EdgeKind = Literal["depends_on", "uses_notation", "specialises", "restates"]
Extractor = Literal["deterministic", "heuristic", "notation", "llm"]
IngestStage = Literal["queued", "parse", "segment", "anchors", "edges", "resolve", "bake", "done", "error"]
DocStatus = Literal["queued", "ingesting", "ready", "unsupported", "error"]


# ---- A1 intermediate ------------------------------------------------------


class Span(BaseModel):
    """One PyMuPDF text span. Emitted to parsed/<doc_id>.jsonl."""

    text: str
    page: int = Field(ge=1)
    bbox: BBox
    font: str
    size: float
    bold: bool
    italic: bool
    block: int  # PyMuPDF block index on the page
    line: int  # line index within the page
    para: int | None = None  # paragraph id after grouping by vertical gap + indent


# ---- Core types (frozen) --------------------------------------------------


class Clause(BaseModel):
    id: str
    text: str


class SymbolEntry(BaseModel):
    sym: str
    role: str


class Node(BaseModel):
    id: UUID
    doc_id: UUID
    kind: NodeKind
    label: str | None  # "Theorem 3.4"; None for unnumbered environments
    title: str | None  # "Rank-Nullity"; None when the source gives none
    statement_md: str
    clauses: list[Clause] = []
    symbols: list[SymbolEntry] = []
    page: int = Field(ge=1)
    bbox: BBox
    entity_id: UUID | None = None
    confidence: float = Field(ge=0, le=1)


class Edge(BaseModel):
    """src depends on dst."""

    src: UUID
    dst: UUID
    kind: EdgeKind
    extractor: Extractor
    confidence: float = Field(ge=0, le=1)


class Anchor(BaseModel):
    id: UUID
    doc_id: UUID
    page: int = Field(ge=1)
    bbox: BBox
    surface: str  # "by Theorem 3.4"
    target_node_id: UUID | None = None  # A3 sets for explicit refs; C3 for soft/named
    target_entity_id: UUID | None = None
    card_id: UUID | None = None


class Substitution(BaseModel):
    from_: str = Field(alias="from")
    to: str

    model_config = {"populate_by_name": True}


class CardSource(BaseModel):
    doc_id: UUID
    page: int = Field(ge=1)


class Card(BaseModel):
    id: UUID
    anchor_id: UUID
    headline: str
    instantiated_md: str
    full_md: str
    substitutions: list[Substitution] = []
    clause_ids: list[str] = []
    gloss: str
    source: CardSource


# ---- Supporting types -----------------------------------------------------


class Doc(BaseModel):
    id: UUID
    corpus_id: UUID
    title: str
    filename: str
    file_hash: str | None = None  # sha256 of the PDF bytes; A5 idempotency key
    page_count: int = Field(ge=0)
    quality: float | None = Field(default=None, ge=0, le=1)
    status: DocStatus = "queued"


class Entity(BaseModel):
    id: UUID
    corpus_id: UUID
    canonical_node_id: UUID | None = None
    name: str


class IngestEvent(BaseModel):
    """Mirrors the ingest_progress row the SSE route streams."""

    stage: IngestStage
    doc_id: UUID
    nodes_done: int = 0
    total: int = 0
    message: str | None = None
