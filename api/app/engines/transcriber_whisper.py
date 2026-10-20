"""Transcription for the scam-phrase check (PRD F4).

Two paths, same phrase rules behind them:

  faster-whisper (this file)   when requirements-ml.txt is installed
  browser Web Speech API       otherwise - the phone does the ASR and sends
                               text over the WebSocket / with the upload

The API response always names the engine that produced the transcript, so the
UI can say "transcription on device" instead of silently showing nothing.
"""
from __future__ import annotations

import os

import numpy as np

from .base import Transcript

MODEL_SIZE = os.environ.get("SUARASAH_WHISPER_SIZE", "small")


class WhisperTranscriber:
    def __init__(self) -> None:
        from faster_whisper import WhisperModel

        device = os.environ.get("SUARASAH_WHISPER_DEVICE", "auto")
        compute = os.environ.get("SUARASAH_WHISPER_COMPUTE", "int8")
        self.model = WhisperModel(MODEL_SIZE, device=device, compute_type=compute)
        self.name = "faster-whisper-" + MODEL_SIZE

    def transcribe(self, x: np.ndarray) -> Transcript:
        segments, info = self.model.transcribe(
            np.asarray(x, dtype=np.float32),
            language=None,  # BM / EN auto-detect; keeps code-switched speech intact
            vad_filter=True,
            beam_size=1,
            condition_on_previous_text=False,
        )
        text = " ".join(s.text.strip() for s in segments).strip()
        lang = getattr(info, "language", None) or "unknown"
        return Transcript(text=text, language=lang, engine=self.name)


class NullTranscriber:
    """No server-side ASR available. The browser supplies the transcript instead."""

    name = "browser-web-speech"

    def transcribe(self, x: np.ndarray) -> Transcript:
        return Transcript(text="", language="unknown", engine=self.name, available=False)
