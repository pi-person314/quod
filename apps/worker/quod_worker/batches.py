"""Bound model batches while keeping progress and graph mutations on the caller thread."""
from concurrent.futures import ThreadPoolExecutor, as_completed

from quod_worker import db


def run_batches(ctx, items, batch_size, stage, label, run):
    if not items:
        return []
    chunks = [(off, items[off:off + batch_size]) for off in range(0, len(items), batch_size)]
    db.set_progress(ctx.conn, ctx.doc_id, stage, message=f"{label}: 0 / {len(items)}")
    results = {}
    completed = 0

    def invoke(off, chunk):
        # A ledger transaction must never share a connection with another call.
        with db.connect() as conn:
            return run(conn, chunk, off)

    pool = ThreadPoolExecutor(max_workers=3)
    futures = {pool.submit(invoke, off, chunk): (off, len(chunk)) for off, chunk in chunks}
    try:
        for future in as_completed(futures):
            off, count = futures[future]
            results[off] = future.result()
            completed += count
            db.set_progress(ctx.conn, ctx.doc_id, stage, message=f"{label}: {completed} / {len(items)}")
    finally:
        pool.shutdown(wait=True, cancel_futures=True)
    return sorted(results.items())
