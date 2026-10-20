"""Curated BM / EN scam-phrase rules (PRD Section 8).

Four groups, each with a weight.  Phrases are matched case-insensitively on a
normalised transcript, with Malay spelling variants listed explicitly (people
and ASR both drop diacritics and shorten words).

This list is a *linguistic* rule set, not a model.  It is the part of the
pipeline that still works when the cloned voice is perfect.
"""
from __future__ import annotations

GROUP_WEIGHTS = {
    "urgency": 0.9,
    "money": 1.0,
    "secrecy": 1.1,
    "authority": 0.8,
}

# group -> list of (phrase, language tag)
PHRASES: dict[str, list[tuple[str, str]]] = {
    "urgency": [
        ("sekarang juga", "bm"), ("sekarang ni", "bm"), ("cepat sikit", "bm"),
        ("cepat cepat", "bm"), ("segera", "bm"), ("kecemasan", "bm"),
        ("darurat", "bm"), ("tolong saya", "bm"), ("masa tak banyak", "bm"),
        ("dalam 10 minit", "bm"), ("sebelum pukul", "bm"), ("jangan tunggu", "bm"),
        ("kena buat sekarang", "bm"), ("tak boleh tunggu", "bm"), ("last chance", "en"),
        ("right now", "en"), ("immediately", "en"), ("urgent", "en"),
        ("emergency", "en"), ("hurry", "en"), ("within the hour", "en"),
        ("before midnight", "en"), ("time is running out", "en"), ("act fast", "en"),
        ("accident", "en"), ("kemalangan", "bm"), ("masuk hospital", "bm"),
        ("kena tahan", "bm"), ("ditahan polis", "bm"), ("lock up", "en"),
    ],
    "money": [
        ("transfer", "en"), ("pindah duit", "bm"), ("hantar duit", "bm"),
        ("bank in", "en"), ("masuk duit", "bm"), ("akaun baru", "bm"),
        ("nombor akaun", "bm"), ("account number", "en"), ("duit deposit", "bm"),
        ("bayaran", "bm"), ("deposit", "en"), ("rm", "both"),
        ("ringgit", "both"), ("ribu", "bm"), ("juta", "bm"),
        ("duit segera", "bm"), ("pinjam duit", "bm"), ("tuan rumah", "bm"),
        ("touch n go", "en"), ("tng", "en"), ("duitnow", "en"),
        ("maybank2u", "en"), ("cimb clicks", "en"), ("fpx", "en"),
        ("crypto", "en"), ("usdt", "en"), ("bitcoin", "en"),
        ("top up", "en"), ("gift card", "en"), ("upah", "bm"),
        ("yuran", "bm"), ("cukai", "bm"), ("denda", "bm"),
        ("payment link", "en"), ("link bayaran", "bm"), ("scan qr", "en"),
    ],
    "secrecy": [
        ("jangan bagitau", "bm"), ("jangan beritahu", "bm"), ("jangan cakap", "bm"),
        ("rahsia", "bm"), ("antara kita", "bm"), ("jangan bagi tau sesiapa", "bm"),
        ("jangan bagitahu mak", "bm"), ("jangan bagitahu ayah", "bm"),
        ("jangan letak telefon", "bm"), ("jangan tutup telefon", "bm"),
        ("stay on the line", "en"), ("do not tell", "en"), ("dont tell anyone", "en"),
        ("keep this between us", "en"), ("confidential", "en"), ("secret", "en"),
        ("jangan report", "bm"), ("jangan pergi balai", "bm"),
        ("hapus mesej", "bm"), ("delete this message", "en"),
    ],
    "authority": [
        ("polis", "bm"), ("pdrm", "bm"), ("balai polis", "bm"),
        ("inspektor", "bm"), ("mahkamah", "bm"), ("peguam", "bm"),
        ("bank negara", "bm"), ("bnm", "en"), ("lhdn", "bm"),
        ("kastam", "bm"), ("imigresen", "bm"), ("jpj", "bm"),
        ("pejabat pos", "bm"), ("kementerian", "bm"), ("ejen bank", "bm"),
        ("pihak bank", "bm"), ("bank officer", "en"), ("police", "en"),
        ("court order", "en"), ("warrant", "en"), ("investigation", "en"),
        ("money laundering", "en"), ("pengubahan wang haram", "bm"),
        ("akaun anda digunakan", "bm"), ("your account is involved", "en"),
        ("macc", "en"), ("sprm", "bm"), ("hospital", "both"),
        ("doktor", "bm"), ("nurse", "en"),
    ],
}

# Spoken-form normalisations applied before matching.
NORMALISE = [
    ("tak ", "tidak "),
    ("x ", "tidak "),
    ("duit ", "duit "),
    ("rm.", "rm"),
    ("ringgit malaysia", "ringgit"),
]


def total_phrase_count() -> int:
    return sum(len(v) for v in PHRASES.values())
