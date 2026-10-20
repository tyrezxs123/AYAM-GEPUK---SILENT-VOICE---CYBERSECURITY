"""End-to-end tests for the four verdicts, plus the WhatsApp re-encode path.

    cd api && .venv/Scripts/python -m pytest tests -q

These use a throwaway SQLite file and a PyNaCl signing key standing in for the
browser's non-extractable WebCrypto key: the bytes signed are identical.
"""
from __future__ import annotations

import io
import os
import tempfile

import numpy as np
import pytest
import soundfile as sf

os.environ["SUARASAH_DB"] = os.path.join(tempfile.gettempdir(), "suarasah-test.db")
os.environ["SUARASAH_RL_DISABLE"] = "1"  # the suite signs far more clips than a human would
for _leftover in (os.environ["SUARASAH_DB"], os.environ["SUARASAH_DB"] + "-wal"):
    if os.path.exists(_leftover):
        os.remove(_leftover)

from fastapi.testclient import TestClient  # noqa: E402
from nacl.signing import SigningKey  # noqa: E402

from app import config  # noqa: E402
from app.core import crypto  # noqa: E402
from app.main import app  # noqa: E402

SR = config.SAMPLE_RATE
client = TestClient(app)


# --------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------
def speechish(seconds: float = 6.0, seed: int = 1) -> np.ndarray:
    """Synthetic voiced audio: harmonic stack with a 4 Hz syllable envelope and
    fricative noise bursts. Enough structure to exercise the DSP honestly."""
    r = np.random.default_rng(seed)
    n = int(seconds * SR)
    t = np.arange(n) / SR
    f0 = 120 + 40 * np.sin(2 * np.pi * 0.7 * t) + 8 * r.normal(size=n).cumsum() / np.sqrt(n)
    phase = 2 * np.pi * np.cumsum(f0) / SR
    x = sum((1.0 / k) * np.sin(k * phase) for k in range(1, 12))
    env = 0.5 * (1 + np.sin(2 * np.pi * 4.0 * t)) ** 2 * (r.random(n) * 0.3 + 0.85)
    x = x * env + r.normal(size=n) * (env > 1.2) * 0.25 + 0.002 * r.normal(size=n)
    return (0.6 * x / np.max(np.abs(x))).astype(np.float32)


def to_wav(x: np.ndarray) -> bytes:
    b = io.BytesIO()
    sf.write(b, x, SR, format="WAV", subtype="PCM_16")
    return b.getvalue()


def from_bytes(raw: bytes) -> np.ndarray:
    y, sr = sf.read(io.BytesIO(raw), dtype="float32")
    if y.ndim == 2:
        y = y.mean(axis=1)
    assert sr == SR
    return y.astype(np.float32)


def reencode(x: np.ndarray, fmt: str = "OGG", subtype: str = "OPUS") -> bytes:
    """Stand-in for a WhatsApp voice note: Opus at the same sample rate."""
    b = io.BytesIO()
    sf.write(b, x, SR, format=fmt, subtype=subtype)
    return b.getvalue()


def register_device(name: str) -> tuple[SigningKey, str]:
    sk = SigningKey.generate()
    pub = bytes(sk.verify_key).hex()
    r = client.post("/keys", json={"display_name": name, "public_key": pub, "label": "pytest"})
    assert r.status_code == 200, r.text
    return sk, r.json()["device_key_id"]


def sign_clip(sk: SigningKey, key_id: str, x: np.ndarray, context: str = "", expiry: int | None = None):
    body = {"device_key_id": key_id, "context": context}
    if expiry is not None:
        body["expiry_seconds"] = expiry
    r = client.post("/sessions", json=body)
    assert r.status_code == 200, r.text
    sess = r.json()

    r = client.post(
        f"/sessions/{sess['session_id']}/prepare",
        files={"audio": ("clip.wav", to_wav(x), "audio/wav")},
    )
    assert r.status_code == 200, r.text
    prep = r.json()

    # The device rebuilds the payload itself and refuses to sign anything else.
    expected = crypto.signing_payload(
        session_id=sess["session_id"],
        nonce_hex=sess["nonce"],
        issued_at=sess["issued_at"],
        expires_at=sess["expires_at"],
        context=context,
        fingerprint_root=prep["fingerprint_root"],
    )
    assert bytes.fromhex(prep["payload_hex"]) == expected

    signature = sk.sign(expected).signature.hex()
    r = client.post(f"/sessions/{sess['session_id']}/sign", data={"signature": signature})
    assert r.status_code == 200, r.text
    return sess, prep, r.content


def verify(raw: bytes, *, source: str = "file", transcript: str | None = None) -> dict:
    data = {"source": source}
    if transcript is not None:
        data["transcript"] = transcript
    r = client.post("/verify", files={"audio": ("x.wav", raw, "audio/wav")}, data=data)
    assert r.status_code == 200, r.text
    return r.json()


# --------------------------------------------------------------------------
# tests
# --------------------------------------------------------------------------
def test_health_reports_engines():
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    assert body["engines"]["detector"]["engine"]
    assert body["phrase_rules"] > 90


def test_signed_clip_verifies():
    sk, kid = register_device("Ayah")
    _, prep, signed = sign_clip(sk, kid, speechish(seed=3), context="For Mak only")
    assert prep["segment_count"] == 3
    out = verify(signed)
    assert out["verdict"] == "VERIFIED"
    assert out["provenance"]["sender_name"] == "Ayah"
    assert out["provenance"]["context"] == "For Mak only"
    assert out["colour"] == "green"
    # detection must not run on verified audio
    assert "risk" not in out


def test_signed_clip_survives_whatsapp_reencode():
    sk, kid = register_device("Ayah Opus")
    _, _, signed = sign_clip(sk, kid, speechish(seed=11))
    out = verify(reencode(from_bytes(signed)))
    assert out["verdict"] == "VERIFIED", out["provenance"]


def test_unsigned_audio_is_unverified_never_verified():
    out = verify(to_wav(speechish(seed=61)))
    assert out["verdict"] == "UNVERIFIED"
    assert out["risk"]["level"] in {"low", "medium", "high"}
    # the headline must never claim the voice is real
    assert out["headline_key"].startswith("unverified")


def test_spliced_clip_is_tampered_and_names_the_segment():
    sk, kid = register_device("Ayah Splice")
    _, _, signed = sign_clip(sk, kid, speechish(seed=3))
    y = from_bytes(signed)
    seg = int(config.SEGMENT_SECONDS * SR)
    attacker = speechish(seed=77)
    y[seg : 2 * seg] = attacker[:seg]

    out = verify(to_wav(y))
    assert out["verdict"] == "TAMPERED"
    failed = [s["seq_no"] for s in out["provenance"]["segments"] if not s["matched"]]
    assert failed == [1]


def test_signed_clip_played_into_live_scan_is_replayed():
    sk, kid = register_device("Ayah Replay")
    _, _, signed = sign_clip(sk, kid, speechish(seed=42))
    out = verify(signed, source="live")
    assert out["verdict"] == "REPLAYED"
    assert "signed_clip_inside_live_audio" in out["provenance"]["notes"]


def test_expired_clip_is_expired(monkeypatch):
    sk, kid = register_device("Ayah Expiry")
    sess, _, signed = sign_clip(sk, kid, speechish(seed=5), expiry=300)
    assert verify(signed)["verdict"] == "VERIFIED"

    # Travel past expires_at. We cannot simply edit the row: expires_at is part
    # of the signed payload, so changing it in the database invalidates the
    # signature instead - which is the property the next test asserts.
    from app import db

    monkeypatch.setattr(db, "now", lambda: int(sess["expires_at"]) + 60)
    out = verify(signed)
    assert out["verdict"] == "EXPIRED"
    assert "clip_expired" in out["provenance"]["notes"]


def test_expiry_cannot_be_extended_in_the_database():
    """Moving expires_at breaks the signature, so a stale clip can never be
    quietly revived by touching the backend."""
    sk, kid = register_device("Ayah Immutable")
    _, _, signed = sign_clip(sk, kid, speechish(seed=5), expiry=300)
    from app import db

    db.run(
        "UPDATE voice_sessions SET expires_at = expires_at + 99999 WHERE device_key_id = ?",
        (kid,),
    )
    out = verify(signed)
    assert out["verdict"] == "TAMPERED"
    assert "signature_invalid" in out["provenance"]["notes"]


def test_revoked_device_key_loses_verified():
    sk, kid = register_device("Ayah Revoked")
    _, _, signed = sign_clip(sk, kid, speechish(seed=9))
    assert verify(signed)["verdict"] == "VERIFIED"
    assert client.post(f"/keys/{kid}/revoke").status_code == 200
    assert verify(signed)["verdict"] == "TAMPERED"


def test_wrong_signature_is_rejected_at_signing_time():
    sk, kid = register_device("Ayah Forge")
    other = SigningKey.generate()
    r = client.post("/sessions", json={"device_key_id": kid, "context": ""})
    sess = r.json()
    r = client.post(
        f"/sessions/{sess['session_id']}/prepare",
        files={"audio": ("c.wav", to_wav(speechish(seed=2)), "audio/wav")},
    )
    payload = bytes.fromhex(r.json()["payload_hex"])
    bad = other.sign(payload).signature.hex()
    r = client.post(f"/sessions/{sess['session_id']}/sign", data={"signature": bad})
    assert r.status_code == 400


def test_scam_phrases_raise_the_risk_level():
    low = verify(to_wav(speechish(seed=62)), transcript="Hello, apa khabar? Jumpa esok ya.")
    high = verify(
        to_wav(speechish(seed=62)),
        transcript=(
            "Mak, ini anak. Saya kena tahan polis, tolong transfer RM2000 ke akaun baru "
            "sekarang juga. Jangan bagitau ayah."
        ),
    )
    assert high["risk"]["phrase_score"] > low["risk"]["phrase_score"]
    groups = set(high["risk"]["phrase_groups"])
    assert {"urgency", "money", "secrecy", "authority"} <= groups
    assert high["risk"]["level"] in {"medium", "high"}
    assert "call_back_saved_number" in high["step_keys"]


def test_scam_report_hashes_the_number():
    r = client.post("/reports", json={"phone_number": "012-345 6789", "category": "voice_clone"})
    assert r.status_code == 200
    assert r.json()["reports_for_this_number"] >= 1
    rows = __import__("app.db", fromlist=["q"]).q("SELECT phone_number_hash FROM scam_reports")
    assert all("6789" not in row["phone_number_hash"] for row in rows)


@pytest.mark.parametrize(
    "fmt,subtype",
    [
        ("OGG", "OPUS"),            # WhatsApp voice notes
        ("OGG", "VORBIS"),
        ("MP3", "MPEG_LAYER_III"),
        ("WAV", "GSM610"),          # plain phone recordings: non-seekable in libsndfile
        ("WAV", "ULAW"),            # VoIP capture
        ("FLAC", "PCM_16"),
    ],
)
def test_verify_accepts_common_upload_formats(fmt, subtype):
    out = verify(reencode(speechish(seed=71), fmt, subtype))
    assert out["verdict"] == "UNVERIFIED"


def test_signed_clip_survives_8k_phone_codec():
    """GSM 6.10 at 8 kHz is about the worst channel a voice note travels."""
    sk, kid = register_device("Ayah Phone")
    _, _, signed = sign_clip(sk, kid, speechish(seed=11))
    out = verify(reencode(from_bytes(signed), "WAV", "GSM610"))
    assert out["verdict"] == "VERIFIED", out["provenance"]


# --------------------------------------------------------------------------
# Live Scan (WebSocket)
# --------------------------------------------------------------------------
def pcm_frames(x: np.ndarray, seconds: float = 1.0):
    """Split audio into the 1 s little-endian int16 frames the browser sends."""
    step = int(seconds * SR)
    for i in range(0, len(x) - step + 1, step):
        yield (np.clip(x[i : i + step], -1, 1) * 32767).astype("<i2").tobytes()


def test_live_scan_returns_a_verdict_and_flags_scam_phrases():
    with client.websocket_connect("/live") as ws:
        ready = ws.receive_json()
        assert ready["type"] == "ready"
        assert ready["window_s"] == config.LIVE_WINDOW_SECONDS

        ws.send_json(
            {
                "type": "transcript",
                "text": "Tolong transfer RM5000 ke akaun baru sekarang juga, jangan bagitau sesiapa.",
                "final": True,
            }
        )
        for frame in pcm_frames(speechish(5.0, seed=21)):
            ws.send_bytes(frame)

        update = ws.receive_json()
        assert update["type"] == "update"
        assert update["verdict"] == "UNVERIFIED"
        assert update["level"] in {"low", "medium", "high"}
        groups = set(update["risk"]["phrase_groups"])
        assert {"money", "urgency", "secrecy"} <= groups
        assert "call_back_saved_number" in update["step_keys"]
        ws.send_json({"type": "stop"})


def test_live_scan_flags_a_signed_clip_played_into_the_call_as_replayed():
    """The replay demo: a real signed voice note held up to the microphone."""
    sk, kid = register_device("Ayah Live Replay")
    _, _, signed = sign_clip(sk, kid, speechish(8.0, seed=31))
    y = from_bytes(signed)

    with client.websocket_connect("/live") as ws:
        assert ws.receive_json()["type"] == "ready"
        for frame in pcm_frames(y[: 6 * SR]):
            ws.send_bytes(frame)
        update = ws.receive_json()
        assert update["replayed"] is True
        assert update["verdict"] == "REPLAYED"
        assert update["replay_session_id"]
        ws.send_json({"type": "stop"})


def test_live_scan_stays_quiet_on_an_ordinary_conversation():
    with client.websocket_connect("/live") as ws:
        assert ws.receive_json()["type"] == "ready"
        ws.send_json({"type": "transcript", "text": "Apa khabar, jumpa esok ya.", "final": True})
        for frame in pcm_frames(speechish(4.0, seed=41)):
            ws.send_bytes(frame)
        update = ws.receive_json()
        # One window can never turn the card red: that needs 2 consecutive High.
        assert update["alert"] is False
        assert update["replayed"] is False
        ws.send_json({"type": "stop"})
