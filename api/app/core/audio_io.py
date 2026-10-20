"""Decode arbitrary uploaded audio -> mono float32 @ 16 kHz.

soundfile (bundled libsndfile) covers WAV / FLAC / OGG-Vorbis / OGG-Opus / MP3.
M4A/AAC and anything exotic falls through to ffmpeg when it is on PATH.
"""
from __future__ import annotations

import io
import shutil
import subprocess
import wave

import numpy as np
from scipy.signal import resample_poly

from .. import config


class AudioDecodeError(Exception):
    pass


def _to_mono(x: np.ndarray) -> np.ndarray:
    if x.ndim == 2:
        x = x.mean(axis=1)
    return np.ascontiguousarray(x, dtype=np.float32)


def resample_to(x: np.ndarray, sr_in: int, sr_out: int = config.SAMPLE_RATE) -> np.ndarray:
    if sr_in == sr_out:
        return x.astype(np.float32, copy=False)
    from math import gcd

    g = gcd(int(sr_in), int(sr_out))
    return resample_poly(x, sr_out // g, sr_in // g).astype(np.float32)


def _decode_soundfile(raw: bytes) -> tuple[np.ndarray, int]:
    import soundfile as sf

    # sf.read(), not SoundFile.read(): some subtypes libsndfile supports are
    # non-seekable (GSM 6.10, which is what plain phone recordings often use),
    # and the SoundFile path refuses those with "frames must be specified".
    data, samplerate = sf.read(io.BytesIO(raw), dtype="float32", always_2d=True)
    return _to_mono(data), int(samplerate)


def _decode_ffmpeg(raw: bytes) -> tuple[np.ndarray, int]:
    exe = shutil.which("ffmpeg")
    if not exe:
        raise AudioDecodeError(
            "Could not decode this file. Install ffmpeg to support m4a/aac, "
            "or upload WAV / MP3 / OGG."
        )
    proc = subprocess.run(
        [exe, "-hide_banner", "-loglevel", "error", "-i", "pipe:0",
         "-ac", "1", "-ar", str(config.SAMPLE_RATE), "-f", "wav", "pipe:1"],
        input=raw, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=120,
    )
    if proc.returncode != 0 or not proc.stdout:
        raise AudioDecodeError("ffmpeg could not decode this audio file.")
    x, sr = _decode_soundfile(proc.stdout)
    return x, sr


def load_audio(raw: bytes, max_seconds: float | None = None) -> np.ndarray:
    """Bytes of any common audio file -> float32 mono @ 16 kHz, peak-normalised headroom kept."""
    if not raw:
        raise AudioDecodeError("Empty upload.")
    if len(raw) > config.MAX_UPLOAD_BYTES:
        raise AudioDecodeError("File is too large.")
    try:
        x, sr = _decode_soundfile(raw)
    except AudioDecodeError:
        raise
    except Exception:
        x, sr = _decode_ffmpeg(raw)

    if x.size == 0:
        raise AudioDecodeError("No audio samples found.")
    x = resample_to(x, sr)
    if max_seconds is not None:
        limit = int(max_seconds * config.SAMPLE_RATE)
        x = x[:limit]
    # Keep it finite and inside [-1, 1] without changing relative levels much.
    x = np.nan_to_num(x, nan=0.0, posinf=0.0, neginf=0.0)
    peak = float(np.max(np.abs(x))) if x.size else 0.0
    if peak > 1.0:
        x = x / peak
    return x.astype(np.float32)


def pcm16_to_float(buf: bytes) -> np.ndarray:
    """Little-endian int16 PCM (what the browser worklet sends) -> float32 in [-1, 1]."""
    if len(buf) % 2:
        buf = buf[:-1]
    return (np.frombuffer(buf, dtype="<i2").astype(np.float32) / 32768.0)


def write_wav(x: np.ndarray, sr: int = config.SAMPLE_RATE) -> bytes:
    """16-bit PCM WAV bytes - what we hand back as the signed clip."""
    x = np.clip(x, -1.0, 1.0)
    pcm = (x * 32767.0).astype("<i2").tobytes()
    out = io.BytesIO()
    with wave.open(out, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(pcm)
    return out.getvalue()


def segment_count(n_samples: int) -> int:
    seg = int(config.SEGMENT_SECONDS * config.SAMPLE_RATE)
    return max(1, n_samples // seg)


def iter_segments(x: np.ndarray):
    """Yield (index, samples) for whole 2 s segments; a trailing partial segment is dropped."""
    seg = int(config.SEGMENT_SECONDS * config.SAMPLE_RATE)
    n = len(x) // seg
    if n == 0:  # clip shorter than one segment: pad so short demos still work
        pad = np.zeros(seg, dtype=np.float32)
        pad[: len(x)] = x
        yield 0, pad
        return
    for i in range(n):
        yield i, x[i * seg : (i + 1) * seg]
