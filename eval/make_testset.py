"""Build the week-1 test set (PRD Section 11).

    cd api && .venv/Scripts/python ../eval/run_eval.py --help
    cd api && .venv/Scripts/python ../eval/make_testset.py scripts
    cd api && .venv/Scripts/python ../eval/make_testset.py conditions

Subcommands
-----------
scripts     Write eval/data/recording-scripts.md: the lines each team member
            reads, half scam-style and half normal, in BM, English and
            code-switched. Record these as WAV into eval/data/real/.
conditions  Take everything in data/real/ and data/fake/ and render the four
            channel conditions the PRD asks for, into data/conditions/.
check       Report what the dataset currently contains.

Consent rule, not negotiable: clone ONLY team members' own voices, only with
their explicit consent, and keep the clones inside this repo's data/ directory
(which is gitignored).
"""
from __future__ import annotations

import argparse
import pathlib
import sys

import numpy as np
import soundfile as sf

HERE = pathlib.Path(__file__).resolve().parent
DATA = HERE / "data"
SR = 16_000

SCAM_LINES = [
    ("bm", "Mak, ini anak. Telefon saya rosak, ini nombor baru."),
    ("bm", "Saya kena kemalangan, sekarang kat hospital. Tolong hantar duit cepat."),
    ("bm", "Tolong transfer RM2000 ke akaun baru ini, sekarang juga."),
    ("bm", "Jangan bagitau ayah dulu ya, ini rahsia antara kita."),
    ("bm", "Saya dari pihak bank. Akaun encik terlibat pengubahan wang haram."),
    ("bm", "Encik kena bayar denda LHDN sebelum pukul lima petang hari ini."),
    ("bm", "Jangan letak telefon, saya akan sambungkan kepada pegawai polis."),
    ("bm", "Scan QR code ni untuk buat pembayaran, cepat sikit."),
    ("en", "Mum, it's me. I lost my phone, this is my new number."),
    ("en", "I need you to transfer the deposit right now, it is urgent."),
    ("en", "This is the bank's fraud department, your account is involved."),
    ("en", "Please stay on the line and do not tell anyone about this."),
    ("mixed", "Mak, I kena accident, tolong bank in duit sekarang please."),
    ("mixed", "Boss, the supplier tukar account number, transfer to this new one."),
]

NORMAL_LINES = [
    ("bm", "Apa khabar? Jumpa esok di rumah mak ya."),
    ("bm", "Saya dah sampai rumah, selamat malam."),
    ("bm", "Boleh tolong belikan roti dalam perjalanan balik?"),
    ("bm", "Cuaca hari ini panas betul, ingat bawa air."),
    ("bm", "Nanti petang kita pergi pasar malam, okay?"),
    ("en", "The meeting moved to Thursday morning, see you then."),
    ("en", "I finished the report, I will send it tonight."),
    ("en", "Thanks for helping out yesterday, it meant a lot."),
    ("mixed", "Nanti I call you back, sekarang tengah drive."),
    ("mixed", "Dinner at the usual place, around seven okay?"),
]

CONDITIONS: dict[str, tuple[str, str, int]] = {
    # name -> (soundfile format, subtype, sample rate to write at)
    "clean": ("WAV", "PCM_16", SR),
    "whatsapp_opus": ("OGG", "OPUS", SR),
    "mp3_128k": ("MP3", "MPEG_LAYER_III", SR),
    "phone_8k_gsm": ("WAV", "GSM610", 8_000),
}


def write_scripts() -> None:
    DATA.mkdir(parents=True, exist_ok=True)
    lines = [
        "# SuaraSah recording scripts",
        "",
        "Each team member records every line below as a separate WAV file into",
        "`eval/data/real/`, named `<person>-<nn>.wav` (for example `aiman-03.wav`).",
        "Record in a normal room, phone held normally, 16 kHz mono or better.",
        "",
        "Then clone the SAME lines in the SAME voices with 2-3 open-source",
        "voice-cloning tools and save them to `eval/data/fake/` with matching names.",
        "",
        "**Consent:** clone only your own team members' voices, with their explicit",
        "agreement, and keep every clip inside `eval/data/` (gitignored). Note which",
        "cloning tool produced each file and its licence terms - the PRD lists this",
        "as an open question.",
        "",
        f"## Scam-style lines ({len(SCAM_LINES)})",
        "",
    ]
    for i, (lang, text) in enumerate(SCAM_LINES, start=1):
        lines.append(f"{i:2d}. `[{lang}]` {text}")
    lines += ["", f"## Normal lines ({len(NORMAL_LINES)})", ""]
    for i, (lang, text) in enumerate(NORMAL_LINES, start=len(SCAM_LINES) + 1):
        lines.append(f"{i:2d}. `[{lang}]` {text}")
    lines += [
        "",
        "## Why both halves matter",
        "",
        "Scam lines measure recall: does the phrase check catch a real script?",
        "Normal lines measure false alarms: if the app shouts at an ordinary call,",
        "nobody will keep it installed. Report both numbers in the slides.",
        "",
    ]
    out = DATA / "recording-scripts.md"
    out.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"Wrote {out} ({len(SCAM_LINES)} scam + {len(NORMAL_LINES)} normal lines)")
    for sub in ("real", "fake"):
        (DATA / sub).mkdir(parents=True, exist_ok=True)
        print(f"Ready: {DATA / sub}")


def load(path: pathlib.Path) -> np.ndarray:
    x, sr = sf.read(path, dtype="float32", always_2d=False)
    if x.ndim == 2:
        x = x.mean(axis=1)
    if sr != SR:
        from math import gcd

        from scipy.signal import resample_poly

        g = gcd(int(sr), SR)
        x = resample_poly(x, SR // g, sr // g)
    return np.asarray(x, dtype=np.float32)


def render_conditions() -> None:
    sources = []
    for sub in ("real", "fake"):
        sources += [(sub, p) for p in sorted((DATA / sub).glob("*.wav"))]
    if not sources:
        print("No clips found. Record into eval/data/real/ first (see `scripts`).")
        return

    written = 0
    for name, (fmt, subtype, rate) in CONDITIONS.items():
        for sub, path in sources:
            x = load(path)
            if rate != SR:
                from math import gcd

                from scipy.signal import resample_poly

                g = gcd(SR, rate)
                x = resample_poly(x, rate // g, SR // g).astype(np.float32)
            out_dir = DATA / "conditions" / name / sub
            out_dir.mkdir(parents=True, exist_ok=True)
            suffix = {"WAV": ".wav", "OGG": ".ogg", "MP3": ".mp3"}[fmt]
            sf.write(out_dir / (path.stem + suffix), x, rate, format=fmt, subtype=subtype)
            written += 1
    print(f"Wrote {written} files across {len(CONDITIONS)} conditions into {DATA / 'conditions'}")
    print("\nStill to record by hand (a loudspeaker and a room cannot be simulated):")
    print("  speakerphone: play each clip on a phone's loudspeaker and record it")
    print("  with a second device, into eval/data/conditions/speakerphone/.")


def check() -> None:
    print(f"Dataset root: {DATA}")
    for sub in ("real", "fake"):
        files = sorted((DATA / sub).glob("*.wav")) if (DATA / sub).exists() else []
        print(f"  {sub:6s} {len(files):4d} clips")
    cond_root = DATA / "conditions"
    if cond_root.exists():
        for cond in sorted(p for p in cond_root.iterdir() if p.is_dir()):
            n = sum(1 for _ in cond.rglob("*") if _.is_file())
            print(f"  conditions/{cond.name:16s} {n:4d} files")
    scripts = DATA / "recording-scripts.md"
    print(f"  scripts: {'present' if scripts.exists() else 'not generated yet'}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("command", choices=["scripts", "conditions", "check"])
    args = parser.parse_args()

    {"scripts": write_scripts, "conditions": render_conditions, "check": check}[args.command]()
    return 0


if __name__ == "__main__":
    sys.exit(main())
