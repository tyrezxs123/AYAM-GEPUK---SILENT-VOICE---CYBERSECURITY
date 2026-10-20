"""Verify audio (PRD F2-F4): POST /verify. No login required, by design."""
from __future__ import annotations

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile

from .. import config, ratelimit, service
from ..core.audio_io import AudioDecodeError

router = APIRouter(tags=["verify"])


@router.post("/verify")
async def verify(
    request: Request,
    audio: UploadFile = File(...),
    transcript: str | None = Form(default=None),
    source: str = Form(default="file"),
) -> dict:
    """One button, one verdict.

    `transcript` is optional: when the server has no Whisper installed, the
    browser's own speech recognition can supply the text for the phrase check.
    `source=live` marks audio captured during a Live Scan, which is what makes
    a signed clip played into a call come back as REPLAYED.
    """
    ratelimit.check(request, "verify", config.RATE_LIMIT_VERIFY)
    raw = await audio.read()
    try:
        return service.verify_audio(
            raw,
            client_transcript=transcript,
            mode="live" if source == "live" else "file",
            seen_in_live_scan=(source == "live"),
        )
    except AudioDecodeError as exc:
        raise HTTPException(400, str(exc)) from exc
