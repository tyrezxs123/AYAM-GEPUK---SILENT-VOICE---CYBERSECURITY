"""Engine interfaces.  Every engine reports its own name and whether it is calibrated,
and the API passes that straight through to the UI - so we can never accidentally
present a placeholder as an evaluated model in front of judges."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol

import numpy as np


@dataclass
class DetectionScore:
    score: float                 # 0..1, higher = more likely synthetic
    engine: str
    calibrated: bool             # False => no EER measured for this engine yet
    per_chunk: list[float] = field(default_factory=list)
    features: dict[str, float] = field(default_factory=dict)


class VoiceDetector(Protocol):
    name: str
    calibrated: bool

    def score(self, x: np.ndarray) -> DetectionScore: ...


@dataclass
class Transcript:
    text: str
    language: str
    engine: str
    available: bool = True


class Transcriber(Protocol):
    name: str

    def transcribe(self, x: np.ndarray) -> Transcript: ...
