"""Sign my voice (PRD F1): POST /sessions, /sessions/{id}/prepare, /sessions/{id}/sign.

The PRD sketches two endpoints. We use three, for one security reason: the
fingerprints are computed from audio, and we do not want to do DSP in the
browser, but we also refuse to let the private key sign bytes it has not
checked. So:

  1. /sessions          server issues session_id + nonce + wm_ref + timestamps
  2. /sessions/prepare  upload audio -> watermark is embedded, fingerprints are
                        computed over the WATERMARKED audio, server returns the
                        root hash and the exact payload bytes to sign
  3. /sessions/sign     device returns the Ed25519 signature; server verifies it
                        against the registered public key before storing, then
                        hands back the signed WAV and deletes the audio

Fingerprinting after embedding (not before) matters: the signed fingerprints
then describe exactly the file the recipient will receive.
"""
from __future__ import annotations

import secrets

from fastapi import APIRouter, File, Form, HTTPException, Request, Response, UploadFile
from pydantic import BaseModel, Field

from .. import config, db, ratelimit, service
from ..core import audio_io, crypto, fingerprint
from ..engines import registry

router = APIRouter(tags=["sign"])


class NewSession(BaseModel):
    device_key_id: str
    context: str = Field(default="", max_length=120)
    expiry_seconds: int | None = Field(default=None, ge=300, le=30 * 24 * 3600)


class SessionOut(BaseModel):
    session_id: str
    nonce: str
    wm_ref: int
    issued_at: int
    expires_at: int
    context: str
    max_seconds: int


@router.post("/sessions", response_model=SessionOut)
def create_session(body: NewSession, request: Request) -> SessionOut:
    ratelimit.check(request, "sessions", config.RATE_LIMIT_SESSIONS)
    key = db.one(
        "SELECT id, user_id, revoked_at FROM device_keys WHERE id = ?", (body.device_key_id,)
    )
    if not key:
        raise HTTPException(404, "Unknown device key. Register this device first.")
    if key["revoked_at"] is not None:
        raise HTTPException(403, "This device key has been revoked.")

    issued = db.now()
    expires = issued + (body.expiry_seconds or config.DEFAULT_CLIP_EXPIRY_SECONDS)
    pending = service.PendingSign(
        session_id=db.new_id(),
        user_id=key["user_id"],
        device_key_id=key["id"],
        wm_ref=service.new_wm_ref(),
        nonce=secrets.token_hex(16),  # 128-bit
        issued_at=issued,
        expires_at=expires,
        context=body.context or "",
    )
    service.put_pending(pending)
    return SessionOut(
        session_id=pending.session_id,
        nonce=pending.nonce,
        wm_ref=pending.wm_ref,
        issued_at=pending.issued_at,
        expires_at=pending.expires_at,
        context=pending.context,
        max_seconds=config.MAX_SIGN_SECONDS,
    )


class PrepareOut(BaseModel):
    session_id: str
    fingerprint_root: str
    payload_hex: str
    segment_count: int
    duration_s: float
    watermark_engine: str


@router.post("/sessions/{session_id}/prepare", response_model=PrepareOut)
async def prepare(session_id: str, request: Request, audio: UploadFile = File(...)) -> PrepareOut:
    ratelimit.check(request, "sessions", config.RATE_LIMIT_SESSIONS)
    pending = service.get_pending(session_id)
    if not pending:
        raise HTTPException(404, "Signing session expired. Start again.")

    raw = await audio.read()
    try:
        x = audio_io.load_audio(raw, max_seconds=config.MAX_SIGN_SECONDS)
    except audio_io.AudioDecodeError as exc:
        raise HTTPException(400, str(exc)) from exc
    if len(x) < config.SAMPLE_RATE // 2:
        raise HTTPException(400, "Recording is too short. Speak for at least one second.")

    marked = registry.watermarker.embed(x, pending.wm_ref)
    fps = fingerprint.fingerprint_all(marked)
    root = fingerprint.root_hash(fps)

    pending.audio = marked
    pending.fingerprints = fps
    pending.root = root
    pending.duration_s = len(marked) / config.SAMPLE_RATE
    service.put_pending(pending)

    payload = crypto.signing_payload(
        session_id=pending.session_id,
        nonce_hex=pending.nonce,
        issued_at=pending.issued_at,
        expires_at=pending.expires_at,
        context=pending.context,
        fingerprint_root=root,
    )
    return PrepareOut(
        session_id=session_id,
        fingerprint_root=root,
        payload_hex=payload.hex(),
        segment_count=len(fps),
        duration_s=round(pending.duration_s, 2),
        watermark_engine=getattr(registry.watermarker, "name", "unknown"),
    )


@router.post("/sessions/{session_id}/sign")
def sign(session_id: str, request: Request, signature: str = Form(...)) -> Response:
    """Returns the signed WAV as the response body. Raw audio is dropped here."""
    ratelimit.check(request, "sessions", config.RATE_LIMIT_SESSIONS)
    pending = service.get_pending(session_id)
    if not pending or pending.audio is None:
        raise HTTPException(404, "Nothing prepared for this session. Upload audio first.")

    key = db.one(
        "SELECT public_key, revoked_at FROM device_keys WHERE id = ?", (pending.device_key_id,)
    )
    if not key:
        raise HTTPException(404, "Unknown device key")
    if key["revoked_at"] is not None:
        raise HTTPException(403, "This device key has been revoked.")

    payload = crypto.signing_payload(
        session_id=pending.session_id,
        nonce_hex=pending.nonce,
        issued_at=pending.issued_at,
        expires_at=pending.expires_at,
        context=pending.context,
        fingerprint_root=pending.root,
    )
    if not crypto.verify(key["public_key"], payload, signature.strip()):
        raise HTTPException(400, "Signature does not match this device key.")

    db.run(
        "INSERT INTO voice_sessions (id, user_id, device_key_id, wm_ref, nonce, issued_at,"
        " expires_at, context, fingerprint_root, signature, duration_s, signed_at)"
        " VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        (
            pending.session_id, pending.user_id, pending.device_key_id, pending.wm_ref,
            pending.nonce, pending.issued_at, pending.expires_at, pending.context,
            pending.root, signature.strip(), pending.duration_s, db.now(),
        ),
    )
    db.runmany(
        "INSERT INTO segment_fingerprints (session_id, seq_no, fingerprint) VALUES (?,?,?)",
        [(pending.session_id, i, fp) for i, fp in enumerate(pending.fingerprints)],
    )

    wav = audio_io.write_wav(pending.audio)
    service.drop_pending(session_id)  # raw audio deleted (PRD Section 10, privacy)

    return Response(
        content=wav,
        media_type="audio/wav",
        headers={
            "Content-Disposition": f'attachment; filename="suarasah-{session_id[:8]}.wav"',
            "X-SuaraSah-Session": session_id,
            "X-SuaraSah-Segments": str(len(pending.fingerprints)),
        },
    )


@router.get("/sessions/{session_id}")
def session_info(session_id: str) -> dict:
    row = db.one(
        "SELECT s.id, s.issued_at, s.expires_at, s.context, s.duration_s, u.display_name"
        " FROM voice_sessions s LEFT JOIN users u ON u.id = s.user_id WHERE s.id = ?",
        (session_id,),
    )
    if not row:
        raise HTTPException(404, "Unknown session")
    return {
        "session_id": row["id"],
        "sender_name": row["display_name"],
        "issued_at": row["issued_at"],
        "expires_at": row["expires_at"],
        "expired": db.now() > int(row["expires_at"]),
        "context": row["context"],
        "duration_s": row["duration_s"],
    }
