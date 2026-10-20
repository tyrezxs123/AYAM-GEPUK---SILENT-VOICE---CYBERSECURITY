"""Tiny in-memory token bucket.  Good enough for a demo backend; swap for Redis in prod."""
from __future__ import annotations

import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request

from . import config

_hits: dict[str, deque[float]] = defaultdict(deque)


def _client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def check(request: Request, bucket: str, per_minute: int) -> None:
    if config.RATE_LIMIT_DISABLED:
        return
    key = f"{bucket}:{_client_ip(request)}"
    now = time.monotonic()
    q = _hits[key]
    while q and now - q[0] > 60.0:
        q.popleft()
    if len(q) >= per_minute:
        raise HTTPException(status_code=429, detail="Too many requests. Try again in a minute.")
    q.append(now)
