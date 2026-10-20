"""Real watermark engine: Meta AudioSeal (PRD Sections 6-7).

Only loaded when `audioseal` + torch are installed.  The interface mirrors
core/watermark.py exactly, including the 16-bit payload and the per-segment
presence list that the TAMPERED rule depends on, so nothing else changes.
"""
from __future__ import annotations

import numpy as np

from .. import config
from ..core.watermark import WatermarkHit

DETECT_THRESHOLD = 0.5


class AudioSealWatermark:
    name = "audioseal-16bits"

    def __init__(self) -> None:
        import torch
        from audioseal import AudioSeal

        self.torch = torch
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.generator = AudioSeal.load_generator("audioseal_wm_16bits").to(self.device)
        self.detector = AudioSeal.load_detector("audioseal_detector_16bits").to(self.device)

    # --- helpers ----------------------------------------------------------
    def _tensor(self, x: np.ndarray):
        arr = np.asarray(x, dtype=np.float32)
        return self.torch.from_numpy(arr)[None, None, :].to(self.device)

    def _message(self, ref: int):
        bits = [(ref >> (15 - i)) & 1 for i in range(16)]
        return self.torch.tensor(bits, dtype=self.torch.int32, device=self.device)[None, :]

    @staticmethod
    def _ref_from_bits(bits) -> int:
        ref = 0
        for b in list(bits)[:16]:
            ref = (ref << 1) | int(b)
        return ref

    # --- interface --------------------------------------------------------
    def embed(self, x: np.ndarray, ref: int, alpha: float | None = None) -> np.ndarray:
        wav = self._tensor(x)
        with self.torch.no_grad():
            residual = self.generator.get_watermark(
                wav, config.SAMPLE_RATE, message=self._message(ref & 0xFFFF)
            )
            out = wav + residual
        y = out.squeeze().detach().cpu().numpy().astype(np.float32)[: len(x)]
        peak = float(np.max(np.abs(y))) if y.size else 0.0
        if peak > 0.999:
            y = y * (0.999 / peak)
        return y

    def _detect_chunk(self, x: np.ndarray) -> tuple[float, int]:
        with self.torch.no_grad():
            prob, message = self.detector(self._tensor(x), config.SAMPLE_RATE)
        p = float(np.asarray(prob.detach().cpu()).mean())
        bits = (message[0] > 0.5).int().detach().cpu().tolist()
        return p, self._ref_from_bits(bits)

    def detect(self, x: np.ndarray, candidate_refs: list[int] | None = None) -> WatermarkHit:
        from ..core.audio_io import iter_segments

        prob, ref = self._detect_chunk(x)
        present = prob >= DETECT_THRESHOLD
        if present and candidate_refs and ref not in candidate_refs:
            # AudioSeal decodes 16 bits directly; a payload we never issued
            # is treated as no mark at all rather than as a tampered record.
            present = False
        per_segment: list[bool] = []
        for _, seg in iter_segments(x):
            p, r = self._detect_chunk(seg)
            per_segment.append(bool(p >= DETECT_THRESHOLD and r == ref))
        return WatermarkHit(
            present=present,
            ref=ref if present else None,
            confidence=round(prob, 3),
            per_segment=per_segment,
            engine=self.name,
        )
