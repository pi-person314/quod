"""Environment. Loads the repo-root .env so all three sessions share one file."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

REPO_ROOT = Path(__file__).resolve().parents[3]
load_dotenv(REPO_ROOT / ".env")

SCHEMA_SQL = REPO_ROOT / "packages" / "contracts" / "schema.sql"
FIXTURES_DIR = REPO_ROOT / "fixtures"


@dataclass(frozen=True)
class Settings:
    database_url: str = os.environ.get("DATABASE_URL", "postgres://cairn:cairn@localhost:5432/cairn")
    web_base_url: str = os.environ.get("WEB_BASE_URL", "http://localhost:3000")
    model_fast: str = os.environ.get("MODEL_FAST", "gpt-5.6-luna")
    model_quality: str = os.environ.get("MODEL_QUALITY", "gpt-5.6-sol")
    embedding_model: str = os.environ.get("EMBEDDING_MODEL", "text-embedding-3-small")
    # A1: documents scoring under this are flagged unsupported rather than producing garbage.
    min_parse_quality: float = 0.8


settings = Settings()
