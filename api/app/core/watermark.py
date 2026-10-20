"""Audio watermark: embeds a 16-bit `ref` pointer into a clip, segment by segment.

This is the FALLBACK engine.  If `audioseal` is installed, engines/registry.py
swaps in AudioSeal instead and this file is unused - the interface is identical.

Method: differential sub-band patchwork in the STFT log-magnitude domain.
Each of 24 bits (16-bit ref + CRC-8) owns an 8-bin region in 800-3800 Hz, split
into an A half and a B half.  Embedding multiplies A by exp(+alpha) and B by
exp(-alpha) (or the reverse for a 0 bit), so the bit lives in the *ratio* of two
neighbouring sub-band energies.

Why this shape:
  * ratios of adjacent sub-bands survive Opus/MP3 far better than fine spectral
    structure, and are immune to volume changes and channel colouring;
  * the pattern does not depend on the frame index, so a detector does not need
    to know where the clip was cut - any time offset still decodes;
  * silent frames are skipped, so we never add audible noise to silence.

IMPORTANT (honesty): the watermark only carries a *pointer*.  It is not a
trust signal.  Trust comes from the Ed25519 signature over the fingerprints.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
from scipy.ndimage import uniform_filter1d
from scipy.signal import istft, stft

from .. import config

N_FFT = 1024
HOP = 512
PAYLOAD_BITS = 16
CRC_BITS = 8
TOTAL_BITS = PAYLOAD_BITS + CRC_BITS
BINS_PER_BIT = 8              # 4 bins "A" + 4 bins "B"  (~125 Hz per bit)
FIRST_BIN = 51                # ~800 Hz at 16 kHz / 1024-point FFT
WHITEN_WIDTH = 33             # ~515 Hz: wider than one bit region, so it keeps the signal
TRIM = 0.10                   # trimmed mean: ignore the loudest 10% of frames per tail

# Thresholds, measured with eval/run_eval.py (see README "Measured behaviour").
# Marked audio scores ~4.6-7.2 mean|t| even after Opus; unmarked speech ~1.1.
CONFIDENCE_FLOOR = 2.5        # whole clip: mean |t| needed to call a mark "present"
SEGMENT_CONFIDENCE_FLOOR = 1.4  # one 2 s segment has fewer frames, so a lower bar
REF_MATCH_FLOOR = 0.80        # soft correlation with a candidate ref, in [-1, 1]
SEGMENT_MATCH_FLOOR = 0.55


def crc8(value: int, nbits: int = PAYLOAD_BITS) -> int:
    """CRC-8 (poly 0x07) over the payload bits, MSB first."""
    crc = 0
    for i in range(nbits - 1, -1, -1):
        bit = (value >> i) & 1
        top = (crc >> 7) & 1
        crc = ((crc << 1) & 0xFF)
        if top ^ bit:
            crc ^= 0x07
    return crc & 0xFF


def _bits_for(ref: int) -> np.ndarray:
    ref &= 0xFFFF
    word = (ref << CRC_BITS) | crc8(ref)
    return np.array([(word >> (TOTAL_BITS - 1 - i)) & 1 for i in range(TOTAL_BITS)], dtype=np.int8)


def _ref_from_bits(bits: np.ndarray) -> int | None:
    word = 0
    for b in bits:
        word = (word << 1) | int(b)
    ref = (word >> CRC_BITS) & 0xFFFF
    if crc8(ref) != (word & 0xFF):
        return None
    return ref


def _regions() -> list[tuple[slice, slice]]:
    out = []
    for i in range(TOTAL_BITS):
        start = FIRST_BIN + i * BINS_PER_BIT
        half = BINS_PER_BIT // 2
        out.append((slice(start, start + half), slice(start + half, start + BINS_PER_BIT)))
    return out


_REGIONS = _regions()
_BAND = slice(FIRST_BIN, FIRST_BIN + TOTAL_BITS * BINS_PER_BIT)


def _analyse(x: np.ndarray):
    _, _, Z = stft(
        x, fs=config.SAMPLE_RATE, window="hann", nperseg=N_FFT, noverlap=N_FFT - HOP,
        boundary="zeros", padded=True,
    )
    return Z


def _gate(mag: np.ndarray) -> np.ndarray:
    """Boolean mask of frames loud enough to carry (or hold) a mark."""
    band_power = (mag[_BAND, :] ** 2).sum(axis=0)
    if band_power.size == 0:
        return np.zeros(0, dtype=bool)
    thresh = max(band_power.max() * 1e-3, 1e-10)
    return band_power > thresh


def embed(x: np.ndarray, ref: int, alpha: float | None = None) -> np.ndarray:
    """Return a copy of `x` carrying `ref`.  Length is preserved."""
    alpha = config.WM_ALPHA if alpha is None else alpha
    x = np.asarray(x, dtype=np.float32)
    if len(x) < N_FFT:
        return x.copy()
    Z = _analyse(x)
    mag = np.abs(Z)
    gated = _gate(mag)
    if not gated.any():
        return x.copy()

    bits = _bits_for(ref)
    gain = np.ones_like(mag)
    for bit, (a, b) in zip(bits, _REGIONS):
        s = 1.0 if bit else -1.0
        gain[a, gated] *= float(np.exp(+alpha * s))
        gain[b, gated] *= float(np.exp(-alpha * s))

    _, y = istft(
        Z * gain, fs=config.SAMPLE_RATE, window="hann", nperseg=N_FFT,
        noverlap=N_FFT - HOP, boundary=True,
    )
    y = np.asarray(y, dtype=np.float32)[: len(x)]
    if len(y) < len(x):
        y = np.pad(y, (0, len(x) - len(y)))
    peak = float(np.max(np.abs(y))) if y.size else 0.0
    if peak > 0.999:
        y = y * (0.999 / peak)
    return y.astype(np.float32)


@dataclass
class WatermarkHit:
    present: bool
    ref: int | None
    confidence: float                 # mean |t| across bits; ~1.1 unmarked, >4 marked
    per_segment: list[bool] = field(default_factory=list)
    engine: str = "spread-spectrum-fallback-v1"
    match: float = 0.0                # soft correlation with the chosen ref, [-1, 1]


def _bit_stats(x: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Per-bit t-like statistic and the hard-decoded bits for one chunk of audio.

    The statistic is a trimmed-mean t value: strong harmonics in the low bands
    otherwise dominate the variance and flatten the bits that live there.
    """
    if len(x) < N_FFT:
        return np.zeros(TOTAL_BITS), np.zeros(TOTAL_BITS, dtype=np.int8)
    mag = np.abs(_analyse(np.asarray(x, dtype=np.float32)))
    gated = _gate(mag)
    if gated.sum() < 4:
        return np.zeros(TOTAL_BITS), np.zeros(TOTAL_BITS, dtype=np.int8)

    logmag = np.log(mag[:, gated] + 1e-9)
    envelope = uniform_filter1d(logmag, size=WHITEN_WIDTH, axis=0, mode="nearest")
    white = logmag - envelope

    stats = np.zeros(TOTAL_BITS)
    for i, (a, b) in enumerate(_REGIONS):
        d = white[a, :].mean(axis=0) - white[b, :].mean(axis=0)
        if d.size >= 10:
            k = max(1, int(TRIM * d.size))
            d = np.sort(d)[k:-k]
        sd = float(d.std(ddof=1)) if d.size > 1 else 0.0
        stats[i] = float(d.mean()) / (sd / np.sqrt(max(d.size, 1)) + 1e-9)
    return stats, (stats > 0).astype(np.int8)


def score_ref(stats: np.ndarray, ref: int) -> float:
    """Soft correlation in [-1, 1] between a statistic vector and one candidate ref.

    Hard per-bit decoding plus a CRC is too brittle: Opus reliably flips the one
    or two bits that sit under a strong harmonic, which fails the CRC even though
    the overall pattern still correlates at +0.99.  Weighting each bit by its own
    confidence recovers the ref with a wide margin - random refs peak near 0.6.
    """
    expected = np.where(_bits_for(ref) > 0, 1.0, -1.0)
    denom = float(np.sum(np.abs(stats))) + 1e-9
    return float(np.sum(stats * expected) / denom)


def _confidence(stats: np.ndarray) -> float:
    return float(np.mean(np.abs(stats)))


def detect(x: np.ndarray, candidate_refs: list[int] | None = None) -> WatermarkHit:
    """Recover the ref from a clip, and report which 2 s segments carry it.

    `candidate_refs` are the refs we have actually issued.  When they are
    supplied we soft-match against them (robust); otherwise we fall back to hard
    decoding with the CRC, which is what eval/ and any standalone use needs.
    """
    from .audio_io import iter_segments

    whole_stats, whole_bits = _bit_stats(x)
    confidence = _confidence(whole_stats)
    match = 0.0

    if candidate_refs:
        scored = [(score_ref(whole_stats, r), r) for r in set(candidate_refs)]
        match, ref = max(scored, key=lambda t: t[0])
        if match < REF_MATCH_FLOOR:
            ref = None
    else:
        ref = _ref_from_bits(whole_bits)
        if ref is not None:
            match = score_ref(whole_stats, ref)

    present = ref is not None and confidence >= CONFIDENCE_FLOOR
    if not present:
        ref = None

    per_segment: list[bool] = []
    if ref is not None:
        for _, seg in iter_segments(x):
            s, _ = _bit_stats(seg)
            per_segment.append(
                _confidence(s) >= SEGMENT_CONFIDENCE_FLOOR
                and score_ref(s, ref) >= SEGMENT_MATCH_FLOOR
            )
    else:
        per_segment = [False for _ in iter_segments(x)]

    return WatermarkHit(
        present=present,
        ref=ref,
        confidence=round(confidence, 3),
        per_segment=per_segment,
        match=round(match, 3),
    )
