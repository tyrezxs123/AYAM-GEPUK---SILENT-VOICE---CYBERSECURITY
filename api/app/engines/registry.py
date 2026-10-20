"""Pick the best available engine at import time, and report which one we picked.

The point of this file: the product runs today on the fallbacks, and switching to
the real models is `pip install -r requirements-ml.txt` plus a restart. No other
file in the codebase knows which engine is live.
"""
from __future__ import annotations

import logging

import numpy as np

from ..core import watermark as wm_fallback
from ..core.watermark import WatermarkHit
from .base import DetectionScore, Transcript
from .detector_heuristic import HeuristicDetector
from .transcriber_whisper import NullTranscriber

log = logging.getLogger("suarasah.engines")

__all__ = [
    "detector",
    "transcriber",
    "watermarker",
    "status",
    "DetectionScore",
    "Transcript",
    "WatermarkHit",
]


class FallbackWatermark:
    """Thin object wrapper so the registry can treat both engines the same way."""

    name = "spread-spectrum-fallback-v1"

    def embed(self, x: np.ndarray, ref: int, alpha: float | None = None) -> np.ndarray:
        return wm_fallback.embed(x, ref, alpha)

    def detect(self, x: np.ndarray, candidate_refs: list[int] | None = None) -> WatermarkHit:
        return wm_fallback.detect(x, candidate_refs)


def _load_detector():
    try:
        from .detector_hf import HFDetector

        engine = HFDetector()
        log.info("AI-voice detector: %s", engine.name)
        return engine
    except Exception as exc:  # noqa: BLE001 - any failure must degrade, never crash
        log.warning("Heuristic AI-voice detector in use (%s)", type(exc).__name__)
        return HeuristicDetector()


def _load_transcriber():
    try:
        from .transcriber_whisper import WhisperTranscriber

        engine = WhisperTranscriber()
        log.info("Transcriber: %s", engine.name)
        return engine
    except Exception as exc:  # noqa: BLE001
        log.warning("No server-side ASR (%s); browser Web Speech API in use", type(exc).__name__)
        return NullTranscriber()


def _load_watermarker():
    try:
        from .watermark_audioseal import AudioSealWatermark

        engine = AudioSealWatermark()
        log.info("Watermark: %s", engine.name)
        return engine
    except Exception as exc:  # noqa: BLE001
        log.warning("Spread-spectrum watermark in use (%s)", type(exc).__name__)
        return FallbackWatermark()


detector = _load_detector()
transcriber = _load_transcriber()
watermarker = _load_watermarker()


def status() -> dict[str, object]:
    return {
        "detector": {
            "engine": getattr(detector, "name", "unknown"),
            "calibrated": bool(getattr(detector, "calibrated", False)),
        },
        "watermark": {"engine": getattr(watermarker, "name", "unknown")},
        "transcriber": {
            "engine": getattr(transcriber, "name", "unknown"),
            "server_side": not isinstance(transcriber, NullTranscriber),
        },
    }
