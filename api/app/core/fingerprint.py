"""Perceptual fingerprints for 2 s audio segments.

Why not SHA-256 of the samples?  Because WhatsApp re-encodes every voice note to
Opus, which changes every byte.  A plain hash would make every legitimately
forwarded clip look TAMPERED.  So we use a Haitsma-Kalker style robust hash:

  * 33 log-spaced bands across 300-3400 Hz (the band that survives phone codecs)
  * per frame, per band: sign of the *second* difference of band energy
    (difference across bands, then across time)

The double difference cancels any constant gain and any slowly-varying channel
colouring, so the hash is stable under +/-6 dB level changes, resampling and
lossy compression, while still changing completely if the speech content is
replaced.  Comparison is by bit error rate (BER) with a small alignment search.
"""
from __future__ import annotations

import numpy as np

from .. import config

N_FFT = 1024          # 64 ms at 16 kHz
HOP = 256             # 16 ms -> 125 frames per 2 s segment
N_BANDS = 33          # -> 32 bits per frame row
BAND_LOW_HZ = 300.0
BAND_HIGH_HZ = 3400.0
MAX_ALIGN_FRAMES = 6  # +/- 96 ms of drift tolerated when matching

_window = np.hanning(N_FFT).astype(np.float32)


def _band_edges(sr: int) -> np.ndarray:
    edges = np.geomspace(BAND_LOW_HZ, BAND_HIGH_HZ, N_BANDS + 1)
    return np.floor(edges / sr * N_FFT).astype(int)


_EDGES = _band_edges(config.SAMPLE_RATE)


def _band_energies(x: np.ndarray) -> np.ndarray:
    """(frames, N_BANDS) power per log-spaced band."""
    if len(x) < N_FFT:
        x = np.pad(x, (0, N_FFT - len(x)))
    n_frames = 1 + (len(x) - N_FFT) // HOP
    idx = np.arange(N_FFT)[None, :] + HOP * np.arange(n_frames)[:, None]
    frames = x[idx] * _window
    spec = np.abs(np.fft.rfft(frames, axis=1)) ** 2
    out = np.empty((n_frames, N_BANDS), dtype=np.float64)
    for b in range(N_BANDS):
        lo, hi = _EDGES[b], max(_EDGES[b] + 1, _EDGES[b + 1])
        out[:, b] = spec[:, lo:hi].sum(axis=1)
    return out


def fingerprint_segment(x: np.ndarray) -> bytes:
    """2 s of audio -> packed robust-hash bits."""
    e = _band_energies(np.asarray(x, dtype=np.float32))
    if e.shape[0] < 2:
        return b""
    d_band = e[:, :-1] - e[:, 1:]              # (frames, 32)
    d_time = d_band[1:, :] - d_band[:-1, :]    # (frames-1, 32)
    bits = (d_time > 0).astype(np.uint8)
    return np.packbits(bits, axis=None).tobytes()


def fingerprint_all(x: np.ndarray) -> list[bytes]:
    from .audio_io import iter_segments

    return [fingerprint_segment(seg) for _, seg in iter_segments(x)]


def _unpack(fp: bytes, n_bits: int | None = None) -> np.ndarray:
    bits = np.unpackbits(np.frombuffer(fp, dtype=np.uint8))
    return bits if n_bits is None else bits[:n_bits]


def ber(a: bytes, b: bytes) -> float:
    """Bit error rate between two segment fingerprints, with alignment search.

    Returns 1.0 when the two cannot be compared at all.
    """
    if not a or not b:
        return 1.0
    ba = _unpack(a).reshape(-1, 32)
    bb = _unpack(b).reshape(-1, 32)
    best = 1.0
    for shift in range(-MAX_ALIGN_FRAMES, MAX_ALIGN_FRAMES + 1):
        if shift >= 0:
            x, y = ba[shift:], bb[: len(bb) - shift if shift else None]
        else:
            x, y = ba[: len(ba) + shift], bb[-shift:]
        n = min(len(x), len(y))
        if n < 8:
            continue
        err = float(np.mean(x[:n] != y[:n]))
        best = min(best, err)
    return best


def matches(a: bytes, b: bytes) -> tuple[bool, float]:
    e = ber(a, b)
    return (e <= config.FINGERPRINT_MATCH_BER, e)


def root_hash(fingerprints: list[bytes]) -> str:
    """SHA-256 over all segment fingerprints - this is what the device signs."""
    import hashlib

    h = hashlib.sha256()
    h.update(len(fingerprints).to_bytes(4, "big"))
    for i, fp in enumerate(fingerprints):
        h.update(i.to_bytes(4, "big"))
        h.update(len(fp).to_bytes(4, "big"))
        h.update(fp)
    return h.hexdigest()
