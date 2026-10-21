"""SilentVoice API.

    uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload

Run order of the three engines is fixed in service.py: provenance, then
AI-voice detection, then scam phrases. Detection never runs on audio that
already verified, and detection can never produce VERIFIED.
"""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import config, db
from .core.phrase_list import total_phrase_count
from .engines import registry
from .routes import keys, live, reports, sessions, verify

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
log = logging.getLogger("suarasah")


@asynccontextmanager
async def lifespan(_: FastAPI):
    db.connect()
    st = registry.status()
    log.info("watermark=%s", st["watermark"]["engine"])
    log.info("detector=%s (calibrated=%s)", st["detector"]["engine"],
             st["detector"]["calibrated"])
    log.info("transcriber=%s", st["transcriber"]["engine"])
    yield


app = FastAPI(
    lifespan=lifespan,
    title="SilentVoice API",
    version="0.1.0",
    description=(
        "Voice provenance (verify what is real) plus AI-voice and scam-phrase "
        "screening (warn about what looks fake). Only the signature path can "
        "return VERIFIED."
    ),
)

# Private network (RFC 1918 + loopback) origin regex to safely permit local phone demos
# without exposing the API to public arbitrary websites on the internet.
CORS_LAN_REGEX = (
    r"^https?://(localhost|127\.0\.0\.1|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|"
    r"172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}|"
    r"192\.168\.\d{1,3}\.\d{1,3})(:\d+)?$"
)

if config.CORS_ALLOW_ALL:
    log.warning(
        "SECURITY WARNING: SUARASAH_CORS_ALL=1 is enabled. All origins ('*') are permitted! "
        "Do not run with this setting on untrusted or public/campus networks."
    )
    cors_kwargs = {
        "allow_origins": ["*"],
        "allow_credentials": False,
    }
else:
    cors_kwargs = {
        "allow_origins": config.CORS_ORIGINS,
        "allow_origin_regex": CORS_LAN_REGEX,
        "allow_credentials": True,
    }

app.add_middleware(
    CORSMiddleware,
    **cors_kwargs,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-SuaraSah-Session", "X-SuaraSah-Segments", "Content-Disposition"],
)

app.include_router(keys.router)
app.include_router(sessions.router)
app.include_router(verify.router)
app.include_router(live.router)
app.include_router(reports.router)


@app.get("/health")
def health() -> dict:
    return {
        "ok": True,
        "sample_rate": config.SAMPLE_RATE,
        "segment_seconds": config.SEGMENT_SECONDS,
        "engines": registry.status(),
        "phrase_rules": total_phrase_count(),
        "thresholds": {
            "fingerprint_match_ber": config.FINGERPRINT_MATCH_BER,
            "risk_medium_at": config.RISK_MEDIUM_AT,
            "risk_high_at": config.RISK_HIGH_AT,
        },
    }


@app.get("/metrics")
def metrics() -> dict:
    """Anonymous counters only - no audio, no transcripts (PRD Section 9)."""
    return db.metrics()
