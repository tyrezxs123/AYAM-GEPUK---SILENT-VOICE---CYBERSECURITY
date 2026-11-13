"""Runtime configuration.  Everything has a safe default so `uvicorn app.main:app` just works."""
from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def _int(name: str, default: int) -> int:
    try:
        alt = name.replace("SILENTVOICE_", "SUARASAH_") if "SILENTVOICE_" in name else name.replace("SUARASAH_", "SILENTVOICE_")
        val = os.environ.get(name, os.environ.get(alt))
        return int(val) if val is not None else default
    except ValueError:
        return default


def _float(name: str, default: float) -> float:
    try:
        alt = name.replace("SILENTVOICE_", "SUARASAH_") if "SILENTVOICE_" in name else name.replace("SUARASAH_", "SILENTVOICE_")
        val = os.environ.get(name, os.environ.get(alt))
        return float(val) if val is not None else default
    except ValueError:
        return default


# --- audio -----------------------------------------------------------------
SAMPLE_RATE = 16_000
SEGMENT_SECONDS = 2.0
MAX_SIGN_SECONDS = _int("SILENTVOICE_MAX_SIGN_SECONDS", 60)
MAX_VERIFY_SECONDS = _int("SILENTVOICE_MAX_VERIFY_SECONDS", 300)
MAX_UPLOAD_BYTES = _int("SILENTVOICE_MAX_UPLOAD_BYTES", 25 * 1024 * 1024)

# --- provenance ------------------------------------------------------------
# A segment counts as matching when its fingerprint bit-error-rate is below this.
# Tuned so WhatsApp/Opus re-encode still matches while a 2 s splice does not.
FINGERPRINT_MATCH_BER = _float("SILENTVOICE_FP_BER", 0.28)
SESSION_TTL_SECONDS = _int("SILENTVOICE_SESSION_TTL", 15 * 60)  # signing session, not clip expiry
DEFAULT_CLIP_EXPIRY_SECONDS = _int("SILENTVOICE_CLIP_EXPIRY", 7 * 24 * 3600)

# --- detection thresholds (Section 8 of the PRD) ---------------------------
RISK_MEDIUM_AT = _float("SILENTVOICE_RISK_MEDIUM", 0.40)
RISK_HIGH_AT = _float("SILENTVOICE_RISK_HIGH", 0.70)

# --- live scan -------------------------------------------------------------
LIVE_WINDOW_SECONDS = 4.0
LIVE_SCORE_EVERY_SECONDS = 2.0
LIVE_SMOOTH_WINDOWS = 4
LIVE_RED_AFTER_CONSECUTIVE_HIGH = 2
LIVE_PHRASE_MEMORY_SECONDS = 30.0

# --- infra -----------------------------------------------------------------
DB_PATH = os.environ.get("SILENTVOICE_DB", os.environ.get("SUARASAH_DB", str(ROOT / "silentvoice.db")))
CORS_ORIGINS = [
    o.strip()
    for o in os.environ.get(
        "SILENTVOICE_CORS",
        os.environ.get("SUARASAH_CORS", "http://localhost:3000,http://127.0.0.1:3000,http://localhost:3001,http://127.0.0.1:3001"),
    ).split(",")
    if o.strip()
]
# Set to "1" to let any origin in - handy when demoing from a phone on the venue LAN.
CORS_ALLOW_ALL = os.environ.get("SILENTVOICE_CORS_ALL", os.environ.get("SUARASAH_CORS_ALL", "0")) == "1"

RATE_LIMIT_DISABLED = os.environ.get("SILENTVOICE_RL_DISABLE", os.environ.get("SUARASAH_RL_DISABLE", "0")) == "1"
RATE_LIMIT_VERIFY = _int("SILENTVOICE_RL_VERIFY", 30)        # per minute per IP
RATE_LIMIT_LIVE = _int("SILENTVOICE_RL_LIVE", 10)            # new sockets per minute per IP
RATE_LIMIT_SESSIONS = _int("SILENTVOICE_RL_SESSIONS", 20)

# Watermark strength in the log-magnitude domain.  Higher = more robust, less inaudible.
WM_ALPHA = _float("SILENTVOICE_WM_ALPHA", 0.25)
