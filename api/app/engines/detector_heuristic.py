"""Fallback AI-voice detector: transparent DSP heuristics.

READ THIS BEFORE QUOTING ANY NUMBER FROM IT.
This is NOT a trained deepfake detector and it has NO measured EER.  It exists so
the whole product works end to end on a laptop with no GPU and no model download.
It reports `calibrated: False`, which the UI renders as "screening only".
Install `requirements-ml.txt` to switch to the XLS-R + AASIST model.

The features are chosen because they are the artefacts that current vocoders and
TTS systems most often leave behind, and each is individually explainable:

  f0_jitter        synthetic prosody is smoother than a real larynx
  mod_4_8hz        natural speech modulates at a 3-8 Hz syllable rate
  noise_floor_var  real rooms have a restless noise floor; synthesis often does not
  hf_ratio         many vocoders under-produce energy above 6 kHz
  flatness_var     real speech alternates sharply between voiced and fricative
"""
from __future__ import annotations

import numpy as np

from .. import config
from .base import DetectionScore

N_FFT = 512
HOP = 160  # 10 ms


def _frames(x: np.ndarray) -> np.ndarray:
    if len(x) < N_FFT:
        x = np.pad(x, (0, N_FFT - len(x)))
    n = 1 + (len(x) - N_FFT) // HOP
    idx = np.arange(N_FFT)[None, :] + HOP * np.arange(n)[:, None]
    return x[idx] * np.hanning(N_FFT)


def _f0_track(frames: np.ndarray, sr: int) -> np.ndarray:
    """Crude autocorrelation pitch track over 70-350 Hz; NaN where unvoiced."""
    lo, hi = int(sr / 350), int(sr / 70)
    out = np.full(len(frames), np.nan)
    for i, fr in enumerate(frames):
        fr = fr - fr.mean()
        energy = float(np.dot(fr, fr))
        if energy < 1e-7:
            continue
        ac = np.correlate(fr, fr, mode="full")[len(fr) - 1 :]
        seg = ac[lo:hi]
        if seg.size == 0:
            continue
        k = int(np.argmax(seg))
        if seg[k] / (ac[0] + 1e-12) > 0.3:
            out[i] = sr / float(lo + k)
    return out


def _features(x: np.ndarray, sr: int) -> dict[str, float]:
    frames = _frames(x)
    spec = np.abs(np.fft.rfft(frames, axis=1)) + 1e-10
    power = spec**2
    freqs = np.fft.rfftfreq(N_FFT, 1 / sr)
    total = power.sum(axis=1) + 1e-12

    # 1. energy above 6 kHz
    hf = power[:, freqs >= 6000].sum(axis=1) / total
    energy_db = 10 * np.log10(total)
    loud = energy_db > (np.percentile(energy_db, 95) - 35)
    hf_ratio = float(np.mean(hf[loud])) if loud.any() else 0.0

    # 2. spectral flatness variability
    gm = np.exp(np.mean(np.log(power), axis=1))
    am = np.mean(power, axis=1) + 1e-12
    flat = gm / am
    flatness_var = float(np.std(flat[loud])) if loud.any() else 0.0

    # 3. F0 jitter
    f0 = _f0_track(frames, sr)
    voiced = ~np.isnan(f0)
    if voiced.sum() > 10:
        seq = f0[voiced]
        d = np.abs(np.diff(seq)) / (seq[:-1] + 1e-9)
        f0_jitter = float(np.median(d))
    else:
        f0_jitter = 0.0

    # 4. modulation spectrum 4-8 Hz share of the envelope
    env = np.sqrt(total)
    env = env - env.mean()
    if len(env) > 64:
        fr = 1.0 / (HOP / sr)
        E = np.abs(np.fft.rfft(env * np.hanning(len(env))))
        mf = np.fft.rfftfreq(len(env), 1 / fr)
        band = E[(mf >= 3) & (mf <= 8)].sum()
        ref = E[(mf > 0.5) & (mf <= 20)].sum() + 1e-12
        mod_share = float(band / ref)
    else:
        mod_share = 0.5

    # 5. noise-floor restlessness in the quietest 20% of frames
    quiet = energy_db <= np.percentile(energy_db, 20)
    noise_floor_var = float(np.std(energy_db[quiet])) if quiet.sum() > 5 else 0.0

    return {
        "hf_ratio": round(hf_ratio, 5),
        "flatness_var": round(flatness_var, 5),
        "f0_jitter": round(f0_jitter, 5),
        "mod_share_3_8hz": round(mod_share, 4),
        "noise_floor_var_db": round(noise_floor_var, 3),
    }


def _squash(z: float) -> float:
    return float(1.0 / (1.0 + np.exp(-z)))


def _score_from(f: dict[str, float]) -> float:
    """Hand-set, UNVALIDATED weights.  Each term is 0 when the feature looks natural
    and positive when it looks synthetic."""
    z = -0.6
    z += 1.8 * max(0.0, 0.020 - f["f0_jitter"]) / 0.020          # too-smooth pitch
    z += 1.2 * max(0.0, 0.45 - f["mod_share_3_8hz"]) / 0.45      # weak syllable rhythm
    z += 1.1 * max(0.0, 3.0 - f["noise_floor_var_db"]) / 3.0     # dead-clean silence
    z += 0.8 * max(0.0, 0.004 - f["hf_ratio"]) / 0.004           # missing high band
    z += 0.6 * max(0.0, 0.015 - f["flatness_var"]) / 0.015       # flat articulation
    return _squash(z)


class HeuristicDetector:
    name = "heuristic-dsp-v0 (screening only, no measured EER)"
    calibrated = False

    def score(self, x: np.ndarray) -> DetectionScore:
        x = np.asarray(x, dtype=np.float32)
        if len(x) < config.SAMPLE_RATE // 2:
            return DetectionScore(0.0, self.name, False, [], {})

        chunk = int(2.0 * config.SAMPLE_RATE)
        per_chunk: list[float] = []
        for i in range(0, max(1, len(x) - chunk + 1), chunk):
            seg = x[i : i + chunk]
            if len(seg) < config.SAMPLE_RATE // 2:
                break
            per_chunk.append(round(_score_from(_features(seg, config.SAMPLE_RATE)), 3))

        feats = _features(x, config.SAMPLE_RATE)
        overall = _score_from(feats)
        if per_chunk:
            # Bias towards the worst sustained stretch rather than the mean.
            overall = 0.5 * overall + 0.5 * float(np.percentile(per_chunk, 75))
        return DetectionScore(round(overall, 3), self.name, False, per_chunk, feats)
