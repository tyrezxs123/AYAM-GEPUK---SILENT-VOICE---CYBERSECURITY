"""Measure every claim in PRD Section 11 against a running SuaraSah API.

    cd api && .venv/Scripts/python ../eval/run_eval.py

What it does, end to end, through the real HTTP API (not by importing the
internals - so the number you report is the number a judge would get):

  1. signs clips, pushes them through WhatsApp-style re-encoding, and checks
     they still come back VERIFIED
  2. checks that unsigned audio is NEVER returned as VERIFIED
  3. splices one 2 s segment into signed clips and checks for TAMPERED
  4. replays signed clips into the Live Scan path and checks for REPLAYED
  5. computes the AI-voice EER, if you have a real/ and fake/ dataset
  6. measures scam-phrase recall on BM/EN scripts
  7. times the file-verify path

With no dataset it falls back to synthetic speech so the harness runs on day
one; the report says loudly which mode produced the numbers.
"""
from __future__ import annotations

import argparse
import io
import json
import pathlib
import statistics
import sys
import time
from dataclasses import dataclass, field

import httpx
import numpy as np
import soundfile as sf

SR = 16_000
SEGMENT = 2.0
HERE = pathlib.Path(__file__).resolve().parent

# Reuse the backend's own canonical payload builder, so the eval signs exactly
# what a real device would sign rather than a second implementation of it.
sys.path.insert(0, str(HERE.parent / "api"))


# --------------------------------------------------------------------------
# audio helpers
# --------------------------------------------------------------------------
def synth_speech(seconds: float = 8.0, seed: int = 1) -> np.ndarray:
    """Harmonic stack + 4 Hz syllable envelope + fricative bursts."""
    r = np.random.default_rng(seed)
    n = int(seconds * SR)
    t = np.arange(n) / SR
    f0 = 120 + 40 * np.sin(2 * np.pi * 0.7 * t) + 8 * r.normal(size=n).cumsum() / np.sqrt(n)
    phase = 2 * np.pi * np.cumsum(f0) / SR
    x = sum((1.0 / k) * np.sin(k * phase) for k in range(1, 12))
    env = 0.5 * (1 + np.sin(2 * np.pi * 4.0 * t)) ** 2 * (r.random(n) * 0.3 + 0.85)
    x = x * env + r.normal(size=n) * (env > 1.2) * 0.25 + 0.002 * r.normal(size=n)
    return (0.6 * x / np.max(np.abs(x))).astype(np.float32)


def load_wav(path: pathlib.Path) -> np.ndarray:
    x, sr = sf.read(path, dtype="float32", always_2d=False)
    if x.ndim == 2:
        x = x.mean(axis=1)
    if sr != SR:
        from scipy.signal import resample_poly
        from math import gcd

        g = gcd(sr, SR)
        x = resample_poly(x, SR // g, sr // g)
    return np.asarray(x, dtype=np.float32)


def to_bytes(x: np.ndarray, fmt: str = "WAV", subtype: str = "PCM_16") -> bytes:
    b = io.BytesIO()
    sf.write(b, x, SR, format=fmt, subtype=subtype)
    return b.getvalue()


def from_bytes(raw: bytes) -> np.ndarray:
    x, sr = sf.read(io.BytesIO(raw), dtype="float32", always_2d=False)
    if x.ndim == 2:
        x = x.mean(axis=1)
    return np.asarray(x, dtype=np.float32)


CONDITIONS: dict[str, callable] = {
    "clean": lambda x: to_bytes(x),
    # WhatsApp voice notes are Opus; this is the condition the PRD calls the top risk.
    "whatsapp_opus": lambda x: to_bytes(x, "OGG", "OPUS"),
    "mp3_128k": lambda x: to_bytes(x, "MP3", "MPEG_LAYER_III"),
    "phone_8k_gsm": lambda x: to_bytes(x, "WAV", "GSM610"),
    "volume_plus_6db": lambda x: to_bytes(np.clip(x * 2.0, -1, 1)),
    "volume_minus_6db": lambda x: to_bytes(x * 0.5),
    "noise_minus_40db": lambda x: to_bytes(
        x + 0.01 * np.random.default_rng(3).normal(size=len(x)).astype(np.float32)
    ),
}


# --------------------------------------------------------------------------
# API client
# --------------------------------------------------------------------------
class Api:
    def __init__(self, base: str) -> None:
        self.base = base.rstrip("/")
        self.http = httpx.Client(timeout=120.0)

    def health(self) -> dict:
        return self.http.get(f"{self.base}/health").raise_for_status().json()

    def register(self, name: str, public_key_hex: str) -> str:
        r = self.http.post(
            f"{self.base}/keys",
            json={"display_name": name, "public_key": public_key_hex, "label": "eval"},
        )
        r.raise_for_status()
        return r.json()["device_key_id"]

    def sign(self, signer, key_id: str, x: np.ndarray, context: str = "") -> bytes:
        from app.core import crypto  # type: ignore

        r = self.http.post(
            f"{self.base}/sessions", json={"device_key_id": key_id, "context": context}
        )
        r.raise_for_status()
        sess = r.json()

        r = self.http.post(
            f"{self.base}/sessions/{sess['session_id']}/prepare",
            files={"audio": ("clip.wav", to_bytes(x), "audio/wav")},
        )
        r.raise_for_status()
        prep = r.json()

        payload = crypto.signing_payload(
            session_id=sess["session_id"],
            nonce_hex=sess["nonce"],
            issued_at=sess["issued_at"],
            expires_at=sess["expires_at"],
            context=context,
            fingerprint_root=prep["fingerprint_root"],
        )
        assert bytes.fromhex(prep["payload_hex"]) == payload, "payload mismatch"

        r = self.http.post(
            f"{self.base}/sessions/{sess['session_id']}/sign",
            data={"signature": signer.sign(payload).signature.hex()},
        )
        r.raise_for_status()
        return r.content

    def verify(self, raw: bytes, source: str = "file", transcript: str | None = None) -> dict:
        data = {"source": source}
        if transcript:
            data["transcript"] = transcript
        r = self.http.post(
            f"{self.base}/verify", files={"audio": ("x.wav", raw, "audio/wav")}, data=data
        )
        r.raise_for_status()
        return r.json()


# --------------------------------------------------------------------------
# metrics
# --------------------------------------------------------------------------
@dataclass
class Metric:
    name: str
    target: str
    value: str
    passed: bool | None = None
    detail: str = ""


@dataclass
class Report:
    synthetic: bool
    engines: dict
    metrics: list[Metric] = field(default_factory=list)
    per_condition: dict[str, str] = field(default_factory=dict)
    latencies_ms: list[int] = field(default_factory=list)

    def add(self, metric: Metric) -> None:
        self.metrics.append(metric)
        flag = "" if metric.passed is None else ("PASS" if metric.passed else "FAIL")
        print(f"  {metric.name:46s} {metric.value:>12s}  {flag}")


def eer(scores_real: list[float], scores_fake: list[float]) -> float:
    """Equal error rate from raw scores. Higher score should mean 'more fake'."""
    if not scores_real or not scores_fake:
        return float("nan")
    thresholds = sorted(set(scores_real + scores_fake))
    best = 1.0
    for th in thresholds:
        far = sum(1 for s in scores_real if s >= th) / len(scores_real)   # real called fake
        frr = sum(1 for s in scores_fake if s < th) / len(scores_fake)    # fake called real
        best = min(best, max(far, frr) if abs(far - frr) > 0.02 else (far + frr) / 2)
    return best


SCAM_SCRIPTS = [
    ("Mak, ini anak. Tolong transfer RM2000 ke akaun baru sekarang juga.", {"money", "urgency"}),
    # "pengubahan wang haram" is an accusation, not a request for money:
    # it belongs to the authority group, so that is what we expect here.
    ("Saya dari pihak bank. Akaun anda terlibat pengubahan wang haram.", {"authority"}),
    ("Jangan bagitau sesiapa, ini rahsia antara kita sahaja.", {"secrecy"}),
    ("Encik kena bayar denda LHDN sebelum pukul 5 petang hari ini.", {"authority", "money", "urgency"}),
    ("This is urgent, please bank in the deposit immediately.", {"urgency", "money"}),
    ("Saya kena tahan polis, tolong hantar duit cepat.", {"authority", "money", "urgency"}),
    ("Jangan letak telefon, stay on the line sampai selesai.", {"secrecy"}),
    ("Ayah masuk hospital, kemalangan. Perlu duit deposit sekarang.", {"urgency", "money"}),
    ("Scan QR ni untuk buat payment link, cepat sikit.", {"money", "urgency"}),
    ("Your account is involved in money laundering, this is an investigation.", {"authority"}),
]

SAFE_SCRIPTS = [
    "Apa khabar? Jumpa esok di rumah mak ya.",
    "Saya dah sampai rumah, selamat malam.",
    "Boleh tolong belikan roti dalam perjalanan balik?",
    "The meeting is moved to Thursday morning, see you then.",
]


def run(api: Api, out_dir: pathlib.Path, data_dir: pathlib.Path, n_clips: int) -> Report:
    from nacl.signing import SigningKey  # type: ignore

    health = api.health()
    real_dir, fake_dir = data_dir / "real", data_dir / "fake"
    real_files = sorted(real_dir.glob("*.wav")) if real_dir.exists() else []
    fake_files = sorted(fake_dir.glob("*.wav")) if fake_dir.exists() else []
    synthetic = not real_files

    report = Report(synthetic=synthetic, engines=health["engines"])
    print(f"\nDataset: {'SYNTHETIC (no recordings found)' if synthetic else f'{len(real_files)} real / {len(fake_files)} fake clips'}")
    print(f"Watermark: {health['engines']['watermark']['engine']}")
    print(f"Detector:  {health['engines']['detector']['engine']}\n")

    if synthetic:
        clips = [synth_speech(8.0, seed=100 + i) for i in range(n_clips)]
    else:
        clips = [load_wav(p) for p in real_files[:n_clips]]

    sk = SigningKey.generate()
    key_id = api.register("Eval Ayah", bytes(sk.verify_key).hex())

    # --- 1. signed clips through each channel condition --------------------
    print("1. Signed clips through channel conditions")
    signed = [api.sign(sk, key_id, x) for x in clips]
    per_condition_pass: dict[str, list[bool]] = {c: [] for c in CONDITIONS}
    for blob in signed:
        y = from_bytes(blob)
        for name, encode in CONDITIONS.items():
            t0 = time.perf_counter()
            out = api.verify(encode(y))
            report.latencies_ms.append(int((time.perf_counter() - t0) * 1000))
            per_condition_pass[name].append(out["verdict"] == "VERIFIED")

    for name, results in per_condition_pass.items():
        rate = 100.0 * sum(results) / max(1, len(results))
        report.per_condition[name] = f"{rate:.0f}%"
        print(f"  {name:46s} {rate:>11.0f}%")

    whatsapp = per_condition_pass["whatsapp_opus"]
    rate = 100.0 * sum(whatsapp) / max(1, len(whatsapp))
    report.add(
        Metric(
            "Signed clip VERIFIED after WhatsApp re-encode",
            ">= 95%",
            f"{rate:.0f}%",
            rate >= 95.0,
        )
    )

    # --- 2. false acceptance ----------------------------------------------
    print("\n2. Unsigned audio must never be VERIFIED")
    unsigned = (
        [synth_speech(6.0, seed=900 + i) for i in range(n_clips)]
        if synthetic
        else [load_wav(p) for p in (fake_files or real_files)[:n_clips]]
    )
    false_accepts = 0
    for x in unsigned:
        for encode in (CONDITIONS["clean"], CONDITIONS["whatsapp_opus"]):
            if api.verify(encode(x))["verdict"] == "VERIFIED":
                false_accepts += 1
    checked = len(unsigned) * 2
    report.add(
        Metric(
            "Unsigned audio wrongly shown VERIFIED",
            "0%",
            f"{100.0 * false_accepts / max(1, checked):.1f}%",
            false_accepts == 0,
            f"{false_accepts}/{checked}",
        )
    )

    # --- 3. splice detection ----------------------------------------------
    print("\n3. Spliced clips must be TAMPERED")
    attacker = synth_speech(8.0, seed=777) if synthetic else load_wav(real_files[-1])
    seg = int(SEGMENT * SR)
    caught = total = 0
    for blob in signed:
        y = from_bytes(blob)
        n_seg = max(1, len(y) // seg)
        for which in range(min(3, n_seg)):
            spliced = y.copy()
            spliced[which * seg : (which + 1) * seg] = attacker[:seg]
            for encode in (CONDITIONS["clean"], CONDITIONS["whatsapp_opus"]):
                out = api.verify(encode(spliced))
                total += 1
                if out["verdict"] == "TAMPERED":
                    caught += 1
    rate = 100.0 * caught / max(1, total)
    report.add(Metric("Spliced clips caught as TAMPERED", ">= 90%", f"{rate:.0f}%", rate >= 90.0, f"{caught}/{total}"))

    # --- 4. replay detection ----------------------------------------------
    print("\n4. Signed clips replayed into Live Scan must be REPLAYED")
    caught = 0
    for blob in signed:
        y = from_bytes(blob)
        for encode in (CONDITIONS["clean"], CONDITIONS["phone_8k_gsm"]):
            if api.verify(encode(y), source="live")["verdict"] == "REPLAYED":
                caught += 1
    total = len(signed) * 2
    rate = 100.0 * caught / max(1, total)
    report.add(Metric("Replayed signed clips caught in Live Scan", ">= 90%", f"{rate:.0f}%", rate >= 90.0, f"{caught}/{total}"))

    # --- 5. AI-voice EER ---------------------------------------------------
    print("\n5. AI-voice detector")
    if real_files and fake_files:
        for cond in ("clean", "whatsapp_opus", "phone_8k_gsm"):
            encode = CONDITIONS[cond]
            real_scores = [api.verify(encode(load_wav(p)))["risk"]["ai_score"] for p in real_files]
            fake_scores = [api.verify(encode(load_wav(p)))["risk"]["ai_score"] for p in fake_files]
            value = eer(real_scores, fake_scores)
            report.add(Metric(f"AI-voice EER ({cond})", "report only", f"{100 * value:.1f}%", None))
    else:
        report.add(
            Metric(
                "AI-voice EER",
                "report only",
                "no dataset",
                None,
                "Record real/ and clone it into fake/ - see eval/README.md",
            )
        )

    # --- 6. scam-phrase recall --------------------------------------------
    print("\n6. Scam-phrase rules")
    base = CONDITIONS["clean"](clips[0])
    hits = 0
    for text, expected in SCAM_SCRIPTS:
        out = api.verify(base, transcript=text)
        groups = set(out.get("risk", {}).get("phrase_groups", {}))
        if expected <= groups:
            hits += 1
    rate = 100.0 * hits / len(SCAM_SCRIPTS)
    report.add(Metric("Scam-phrase recall on BM/EN scripts", ">= 80%", f"{rate:.0f}%", rate >= 80.0, f"{hits}/{len(SCAM_SCRIPTS)}"))

    false_alarms = sum(
        1 for text in SAFE_SCRIPTS if api.verify(base, transcript=text).get("risk", {}).get("level") == "high"
    )
    report.add(
        Metric("Everyday sentences flagged High risk", "0", str(false_alarms), false_alarms == 0)
    )

    # --- 7. latency --------------------------------------------------------
    print("\n7. Latency")
    p50 = statistics.median(report.latencies_ms)
    p95 = sorted(report.latencies_ms)[int(0.95 * (len(report.latencies_ms) - 1))]
    report.add(Metric("File verify latency (median)", "<= 5000 ms", f"{p50:.0f} ms", p50 <= 5000))
    report.add(Metric("File verify latency (p95)", "<= 5000 ms", f"{p95:.0f} ms", p95 <= 5000))

    write_report(report, out_dir)
    return report


def write_report(report: Report, out_dir: pathlib.Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    lines = [
        "# SuaraSah evaluation",
        "",
        f"Generated {time.strftime('%Y-%m-%d %H:%M')} · "
        f"dataset: **{'synthetic' if report.synthetic else 'team recordings'}**",
        "",
    ]
    if report.synthetic:
        lines += [
            "> These numbers come from **synthetic speech**, not human voices. They show the",
            "> provenance pipeline behaves correctly; they are NOT evidence about real Malay",
            "> speech or about real voice clones. Record the team dataset before quoting any",
            "> of this in a pitch.",
            "",
        ]
    lines += [
        "## Engines",
        "",
        f"- Watermark: `{report.engines['watermark']['engine']}`",
        f"- AI-voice: `{report.engines['detector']['engine']}`"
        + ("" if report.engines["detector"]["calibrated"] else " **(screening only, uncalibrated)**"),
        f"- Transcription: `{report.engines['transcriber']['engine']}`",
        "",
        "## Metrics",
        "",
        "| Metric | Target | Result | |",
        "| --- | --- | --- | --- |",
    ]
    for m in report.metrics:
        flag = "" if m.passed is None else ("PASS" if m.passed else "**FAIL**")
        detail = f" <br><sub>{m.detail}</sub>" if m.detail else ""
        lines.append(f"| {m.name}{detail} | {m.target} | {m.value} | {flag} |")

    lines += ["", "## Signed clip verified, by channel condition", "", "| Condition | VERIFIED |", "| --- | --- |"]
    for name, value in report.per_condition.items():
        lines.append(f"| {name} | {value} |")

    (out_dir / "report.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    (out_dir / "report.json").write_text(
        json.dumps(
            {
                "synthetic": report.synthetic,
                "engines": report.engines,
                "metrics": [vars(m) for m in report.metrics],
                "per_condition": report.per_condition,
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"\nWrote {out_dir / 'report.md'}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--api", default="http://localhost:8000")
    parser.add_argument("--data", default=str(HERE / "data"))
    parser.add_argument("--out", default=str(HERE / "out"))
    parser.add_argument("--clips", type=int, default=5)
    args = parser.parse_args()

    api = Api(args.api)
    try:
        api.health()
    except Exception as exc:  # noqa: BLE001
        print(f"Cannot reach the API at {args.api}: {exc}")
        print("Start it with:  cd api && .venv/Scripts/python -m uvicorn app.main:app --port 8000")
        return 1

    report = run(api, pathlib.Path(args.out), pathlib.Path(args.data), args.clips)
    failed = [m for m in report.metrics if m.passed is False]
    print(f"\n{len(report.metrics) - len(failed)} passed, {len(failed)} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
