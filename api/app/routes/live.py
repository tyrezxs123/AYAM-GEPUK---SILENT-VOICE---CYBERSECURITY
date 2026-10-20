"""Live Scan over WebSocket (PRD F5): WS /live.

Protocol
--------
client -> server
    binary frames            little-endian int16 PCM, 16 kHz mono (1 s per frame)
    {"type":"hello","lang":"ms"}
    {"type":"transcript","text":"...","final":true}      browser Web Speech API
    {"type":"stop"}

server -> client
    {"type":"ready","engines":{...},"server_asr":bool}
    {"type":"update", ...}      every ~2 s, see _update_payload
    {"type":"error","detail":"..."}

Timing (PRD Section 8): 4 s sliding window, scored every 2 s, smoothed over the
last 4 windows, and the card only turns red after 2 consecutive High windows so
one odd window cannot panic the user.
"""
from __future__ import annotations

import asyncio
import contextlib
import json
import time

import numpy as np
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from .. import config, db
from ..core import audio_io, guidance
from ..core import verdict as V
from ..core.phrases import LivePhraseWindow
from ..core.risk import fuse, level_for
from ..engines import registry

router = APIRouter(tags=["live"])

WINDOW = int(config.LIVE_WINDOW_SECONDS * config.SAMPLE_RATE)
FIRST_VERDICT_AFTER = int(2.5 * config.SAMPLE_RATE)
MAX_BUFFER = int(12 * config.SAMPLE_RATE)


class LiveSession:
    def __init__(self) -> None:
        self.buffer = np.zeros(0, dtype=np.float32)
        self.scores: list[float] = []
        self.consecutive_high = 0
        self.phrases = LivePhraseWindow()
        self.window_index = 0
        self.started = time.monotonic()
        self.last_scored = 0.0
        self.replayed = False
        self.replay_session_id: str | None = None
        self.total_samples = 0

    def add_pcm(self, raw: bytes) -> None:
        x = audio_io.pcm16_to_float(raw)
        self.total_samples += len(x)
        self.buffer = np.concatenate([self.buffer, x])[-MAX_BUFFER:]

    def ready_to_score(self) -> bool:
        if len(self.buffer) < FIRST_VERDICT_AFTER:
            return False
        if self.window_index == 0:
            return True
        return (time.monotonic() - self.last_scored) >= config.LIVE_SCORE_EVERY_SECONDS

    def window(self) -> np.ndarray:
        return self.buffer[-WINDOW:]

    def smoothed(self, score: float) -> float:
        self.scores.append(score)
        self.scores = self.scores[-config.LIVE_SMOOTH_WINDOWS :]
        return float(np.mean(self.scores))


def _score_window(x: np.ndarray, check_replay: bool):
    """Runs in a worker thread: detector + optional watermark + optional ASR."""
    det = registry.detector.score(x)
    wm = registry.watermarker.detect(x) if check_replay else None
    text = ""
    if getattr(registry.transcriber, "name", "") != "browser-web-speech":
        tr = registry.transcriber.transcribe(x)
        text = tr.text or ""
    return det, wm, text


def _update_payload(
    sess: LiveSession, det, smoothed: float, phrase_result, latency_ms: int
) -> dict:
    risk = fuse(smoothed, phrase_result)
    level = risk.level
    if level == "high":
        sess.consecutive_high += 1
    else:
        sess.consecutive_high = 0

    alert = sess.consecutive_high >= config.LIVE_RED_AFTER_CONSECUTIVE_HIGH
    verdict_name = V.REPLAYED if sess.replayed else V.UNVERIFIED
    # Hold the card at orange until the red rule is satisfied, so a single odd
    # window never shows as red (PRD Section 8).
    shown = "high" if alert else ("medium" if level == "high" else level)

    payload = {
        "type": "update",
        "window": sess.window_index,
        "elapsed_s": round(time.monotonic() - sess.started, 1),
        "verdict": verdict_name,
        "level": shown,
        "alert": alert,
        "colour": "red" if alert else guidance.colour_for(verdict_name, shown),
        "risk": {
            "level": shown,
            "reason": risk.reason,
            "ai_level": level_for(smoothed),
            "ai_score": round(smoothed, 3),
            "phrase_score": phrase_result.score,
            "phrase_groups": phrase_result.groups,
        },
        "detection": {
            "engine": det.engine,
            "calibrated": det.calibrated,
            "window_score": det.score,
        },
        "phrases": [
            {"phrase": h.phrase, "group": h.group, "lang": h.lang}
            for h in phrase_result.hits[-12:]
        ],
        "replayed": sess.replayed,
        "replay_session_id": sess.replay_session_id,
        "latency_ms": latency_ms,
    }
    payload.update(guidance.for_result(verdict_name, shown))
    return payload


@router.websocket("/live")
async def live(ws: WebSocket) -> None:
    await ws.accept()
    sess = LiveSession()
    await ws.send_text(
        json.dumps(
            {
                "type": "ready",
                "engines": registry.status(),
                "server_asr": getattr(registry.transcriber, "name", "") != "browser-web-speech",
                "score_every_s": config.LIVE_SCORE_EVERY_SECONDS,
                "window_s": config.LIVE_WINDOW_SECONDS,
            }
        )
    )

    try:
        while True:
            msg = await ws.receive()
            if msg.get("type") == "websocket.disconnect":
                break

            if (raw := msg.get("bytes")) is not None:
                sess.add_pcm(raw)
            elif (text := msg.get("text")) is not None:
                try:
                    data = json.loads(text)
                except json.JSONDecodeError:
                    continue
                kind = data.get("type")
                if kind == "stop":
                    break
                if kind == "transcript" and data.get("text"):
                    sess.phrases.add_transcript(str(data["text"]))

            if not sess.ready_to_score():
                continue

            t0 = time.perf_counter()
            window = sess.window()
            det, wm, server_text = await asyncio.to_thread(_score_window, window, True)
            if server_text:
                sess.phrases.add_transcript(server_text)

            # A signed clip appearing inside live microphone audio means someone
            # is replaying a recording into the call.
            if wm is not None and wm.present and wm.ref is not None:
                row = db.one(
                    "SELECT id FROM voice_sessions WHERE wm_ref = ? AND signature IS NOT NULL"
                    " ORDER BY signed_at DESC LIMIT 1",
                    (wm.ref,),
                )
                if row:
                    sess.replayed = True
                    sess.replay_session_id = row["id"]

            smoothed = sess.smoothed(det.score)
            phrase_result = sess.phrases.current()
            latency = int((time.perf_counter() - t0) * 1000)
            payload = _update_payload(sess, det, smoothed, phrase_result, latency)

            sess.window_index += 1
            sess.last_scored = time.monotonic()
            await ws.send_text(json.dumps(payload))

            if sess.window_index == 1 or payload["alert"] or sess.replayed:
                db.log_verification(
                    session_id=sess.replay_session_id,
                    mode="live",
                    verdict=payload["verdict"] if not payload["alert"] else "HIGH_RISK",
                    ai_score=round(smoothed, 3),
                    phrase_hits=len(phrase_result.hits),
                    latency_ms=latency,
                )
    except WebSocketDisconnect:
        pass
    except Exception as exc:  # noqa: BLE001 - never leave the phone hanging
        with contextlib.suppress(Exception):
            await ws.send_text(json.dumps({"type": "error", "detail": str(exc)}))
    finally:
        with contextlib.suppress(Exception):
            await ws.close()
