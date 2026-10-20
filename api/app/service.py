"""Orchestration: the three engines in the order the PRD specifies.

    provenance check  ->  AI-voice detection  ->  scam-phrase check

Detection only ever runs on audio that is NOT verified, and detection can only
raise a warning. Only the signature path can return VERIFIED.
"""
from __future__ import annotations

import secrets
import threading
import time
from dataclasses import dataclass, field

import numpy as np

from . import config, db
from .core import audio_io, crypto, fingerprint, guidance
from .core import verdict as V
from .core.phrases import PhraseResult, analyse
from .core.risk import fuse
from .engines import registry


# --------------------------------------------------------------------------
# signing sessions held in memory only: raw audio never touches the disk
# --------------------------------------------------------------------------
@dataclass
class PendingSign:
    session_id: str
    user_id: str
    device_key_id: str
    wm_ref: int
    nonce: str
    issued_at: int
    expires_at: int
    context: str
    created: float = field(default_factory=time.monotonic)
    audio: np.ndarray | None = None
    fingerprints: list[bytes] = field(default_factory=list)
    root: str = ""
    duration_s: float = 0.0


_pending: dict[str, PendingSign] = {}
_pending_lock = threading.Lock()


def _sweep_pending() -> None:
    now = time.monotonic()
    with _pending_lock:
        stale = [
            sid for sid, p in _pending.items()
            if now - p.created > config.SESSION_TTL_SECONDS
        ]
        for sid in stale:
            _pending.pop(sid, None)


def put_pending(p: PendingSign) -> None:
    _sweep_pending()
    with _pending_lock:
        _pending[p.session_id] = p


def get_pending(session_id: str) -> PendingSign | None:
    _sweep_pending()
    with _pending_lock:
        return _pending.get(session_id)


def drop_pending(session_id: str) -> None:
    with _pending_lock:
        _pending.pop(session_id, None)


def new_wm_ref() -> int:
    """16-bit pointer. Collisions are fine and expected (PRD Section 9): the
    signature plus the fingerprint match picks the right record."""
    return secrets.randbits(16)


# --------------------------------------------------------------------------
# provenance
# --------------------------------------------------------------------------
def _load_record_fingerprints(session_id: str) -> list[bytes]:
    rows = db.q(
        "SELECT seq_no, fingerprint FROM segment_fingerprints WHERE session_id = ? ORDER BY seq_no",
        (session_id,),
    )
    return [bytes(r["fingerprint"]) for r in rows]


def issued_refs() -> list[int]:
    """Every ref we have actually signed. The watermark detector soft-matches
    against this list instead of hard-decoding a CRC, which is what makes the
    mark survive an Opus re-encode (see core/watermark.score_ref)."""
    rows = db.q(
        "SELECT DISTINCT wm_ref FROM voice_sessions WHERE signature IS NOT NULL"
    )
    return [int(r["wm_ref"]) for r in rows]


def check_provenance(x: np.ndarray, *, seen_in_live_scan: bool = False) -> V.ProvenanceResult:
    hit = registry.watermarker.detect(x, candidate_refs=issued_refs())

    if not hit.present or hit.ref is None:
        return V.ProvenanceResult(
            verdict=V.UNVERIFIED,
            notes=["no_watermark"],
            watermark_confidence=round(hit.confidence, 3),
            watermark_engine=hit.engine,
        )

    candidates = db.q(
        "SELECT s.*, u.display_name, k.public_key, k.revoked_at"
        " FROM voice_sessions s"
        " LEFT JOIN users u ON u.id = s.user_id"
        " LEFT JOIN device_keys k ON k.id = s.device_key_id"
        " WHERE s.wm_ref = ? AND s.signature IS NOT NULL"
        " ORDER BY s.signed_at DESC",
        (hit.ref,),
    )
    if not candidates:
        # Watermark pointer resolves to nothing we issued: we have no claim to
        # check, so this is UNVERIFIED (see core/verdict.py for why not TAMPERED).
        return V.ProvenanceResult(
            verdict=V.UNVERIFIED,
            notes=["watermark_without_record"],
            watermark_confidence=round(hit.confidence, 3),
            watermark_engine=hit.engine,
        )

    uploaded = fingerprint.fingerprint_all(x)
    best: V.ProvenanceResult | None = None

    for row in candidates:
        signed_fps = _load_record_fingerprints(row["id"])
        payload = crypto.signing_payload(
            session_id=row["id"],
            nonce_hex=row["nonce"],
            issued_at=row["issued_at"],
            expires_at=row["expires_at"],
            context=row["context"] or "",
            fingerprint_root=row["fingerprint_root"],
        )
        sig_ok = bool(row["public_key"]) and crypto.verify(
            row["public_key"], payload, row["signature"]
        )
        root_ok = fingerprint.root_hash(signed_fps) == row["fingerprint_root"]

        segments: list[V.SegmentResult] = []
        n = max(len(signed_fps), len(uploaded))
        for i in range(n):
            ref_fp = signed_fps[i] if i < len(signed_fps) else b""
            got_fp = uploaded[i] if i < len(uploaded) else b""
            ok, err = fingerprint.matches(ref_fp, got_fp)
            marked = hit.per_segment[i] if i < len(hit.per_segment) else False
            segments.append(V.SegmentResult(i, ok and bool(ref_fp) and bool(got_fp), err, marked))

        all_match = bool(segments) and all(s.matched for s in segments)
        all_marked = bool(segments) and all(s.watermarked for s in segments)
        expired = db.now() > int(row["expires_at"])
        revoked = row["revoked_at"] is not None

        name = V.decide(
            watermark_present=True,
            ref_known=True,
            signature_valid=sig_ok and root_ok,
            all_segments_match=all_match,
            all_segments_watermarked=all_marked,
            expired=expired,
            key_revoked=revoked,
            seen_in_live_scan=seen_in_live_scan,
        )

        notes: list[str] = []
        if not sig_ok:
            notes.append("signature_invalid")
        if not root_ok:
            notes.append("fingerprint_root_mismatch")
        if revoked:
            notes.append("device_key_revoked")
        if expired:
            notes.append("clip_expired")
        if seen_in_live_scan:
            notes.append("signed_clip_inside_live_audio")

        result = V.ProvenanceResult(
            verdict=name,
            sender_name=row["display_name"],
            recorded_at=int(row["issued_at"]),
            expires_at=int(row["expires_at"]),
            context=row["context"],
            session_id=row["id"],
            segments=segments,
            notes=notes,
            watermark_confidence=round(hit.confidence, 3),
            watermark_engine=hit.engine,
        )
        # Several sessions can share a 16-bit ref; keep the most favourable
        # match, which is the one whose fingerprints actually line up.
        order = {V.VERIFIED: 0, V.REPLAYED: 1, V.EXPIRED: 2, V.TAMPERED: 3, V.UNVERIFIED: 4}
        if best is None or order[result.verdict] < order[best.verdict]:
            best = result
        if result.verdict == V.VERIFIED:
            break

    return best  # type: ignore[return-value]


# --------------------------------------------------------------------------
# detection
# --------------------------------------------------------------------------
def run_detection(x: np.ndarray, client_transcript: str | None = None):
    score = registry.detector.score(x)

    tr = registry.transcriber.transcribe(x)
    if not tr.available or not tr.text:
        if client_transcript:
            tr = registry.Transcript(
                text=client_transcript,
                language="auto",
                engine="browser-web-speech",
                available=True,
            )
    phrases: PhraseResult = analyse(tr.text or "")
    risk = fuse(score.score, phrases)
    return risk, score, tr, phrases


# --------------------------------------------------------------------------
# the whole pipeline for one file
# --------------------------------------------------------------------------
def verify_audio(
    raw: bytes,
    *,
    client_transcript: str | None = None,
    mode: str = "file",
    seen_in_live_scan: bool = False,
) -> dict:
    started = time.perf_counter()
    x = audio_io.load_audio(raw, max_seconds=config.MAX_VERIFY_SECONDS)
    duration = len(x) / config.SAMPLE_RATE

    prov = check_provenance(x, seen_in_live_scan=seen_in_live_scan)

    risk = detection = transcript = phrases = None
    if not prov.is_verified:
        risk, detection, transcript, phrases = run_detection(x, client_transcript)

    latency_ms = int((time.perf_counter() - started) * 1000)
    db.log_verification(
        session_id=prov.session_id,
        mode=mode,
        verdict=prov.verdict,
        ai_score=detection.score if detection else None,
        phrase_hits=len(phrases.hits) if phrases else 0,
        latency_ms=latency_ms,
    )

    out: dict = {
        "verdict": prov.verdict,
        "colour": guidance.colour_for(prov.verdict, risk.level if risk else None),
        "duration_s": round(duration, 2),
        "latency_ms": latency_ms,
        "provenance": {
            "sender_name": prov.sender_name,
            "recorded_at": prov.recorded_at,
            "expires_at": prov.expires_at,
            "context": prov.context,
            "session_id": prov.session_id,
            "notes": prov.notes,
            "segments": [s.as_dict() for s in prov.segments],
            "watermark": {
                "confidence": prov.watermark_confidence,
                "engine": prov.watermark_engine,
            },
        },
        "engines": registry.status(),
    }
    out.update(guidance.for_result(prov.verdict, risk.level if risk else None))

    if risk and detection and transcript and phrases:
        out["risk"] = {
            "level": risk.level,
            "reason": risk.reason,
            "ai_level": risk.ai_level,
            "ai_score": risk.ai_score,
            "phrase_score": risk.phrase_score,
            "phrase_groups": risk.phrase_groups,
        }
        out["detection"] = {
            "engine": detection.engine,
            "calibrated": detection.calibrated,
            "per_chunk": detection.per_chunk,
            "features": detection.features,
        }
        out["transcript"] = {
            "text": transcript.text,
            "language": transcript.language,
            "engine": transcript.engine,
            "available": transcript.available,
        }
        out["phrases"] = [
            {
                "phrase": h.phrase,
                "group": h.group,
                "lang": h.lang,
                "start": h.start,
                "end": h.end,
            }
            for h in phrases.hits
        ]
    return out
