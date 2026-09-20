"""Compatibility import alias for pre-Quod worker integrations.

New code imports :mod:`quod_worker`. Keeping this path lets an already-installed
integration upgrade its distribution without changing its Python import at once.
"""

import importlib
import sys

import quod_worker as _quod_worker

# Register the legacy spelling as the same module objects, so models and DB
# helpers cannot be loaded twice under different package names.
for _name in ("batches", "cli", "config", "db", "fixtures", "llm", "models", "pipeline", "stages"):
    sys.modules[f"{__name__}.{_name}"] = importlib.import_module(f"quod_worker.{_name}")
sys.modules[__name__] = _quod_worker
