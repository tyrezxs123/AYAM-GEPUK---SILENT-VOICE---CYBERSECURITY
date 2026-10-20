"""Scam-phrase matcher over a BM/EN/code-switched transcript."""
from __future__ import annotations

import re
import time
from dataclasses import dataclass, field

from .. import config
from .phrase_list import GROUP_WEIGHTS, NORMALISE, PHRASES


@dataclass
class PhraseHit:
    phrase: str
    group: str
    lang: str
    start: int          # character offset in the normalised transcript
    end: int
    at: float = 0.0     # wall-clock seconds, used by the live scanner


@dataclass
class PhraseResult:
    score: float
    hits: list[PhraseHit] = field(default_factory=list)
    groups: dict[str, int] = field(default_factory=dict)
    transcript: str = ""

    @property
    def has_money(self) -> bool:
        return self.groups.get("money", 0) > 0

    @property
    def has_urgency(self) -> bool:
        return self.groups.get("urgency", 0) > 0

    @property
    def has_secrecy(self) -> bool:
        return self.groups.get("secrecy", 0) > 0


def normalise(text: str) -> str:
    t = " " + text.lower().strip() + " "
    t = re.sub(r"[^\w\s]", " ", t, flags=re.UNICODE)
    t = re.sub(r"\s+", " ", t)
    for a, b in NORMALISE:
        t = t.replace(a, b)
    return t


_COMPILED: list[tuple[re.Pattern[str], str, str, str]] = []
for _group, _items in PHRASES.items():
    for _phrase, _lang in _items:
        _pat = re.compile(r"(?<!\w)" + re.escape(_phrase) + r"(?!\w)")
        _COMPILED.append((_pat, _phrase, _group, _lang))


def analyse(text: str, now: float | None = None) -> PhraseResult:
    now = time.time() if now is None else now
    norm = normalise(text)
    hits: list[PhraseHit] = []
    groups: dict[str, int] = {}
    for pat, phrase, group, lang in _COMPILED:
        for m in pat.finditer(norm):
            hits.append(PhraseHit(phrase, group, lang, m.start(), m.end(), now))
            groups[group] = groups.get(group, 0) + 1

    # Weighted hits, with diminishing returns inside a group so one repeated
    # word cannot drive the score on its own.
    score = 0.0
    for group, n in groups.items():
        w = GROUP_WEIGHTS.get(group, 0.5)
        score += w * (1.0 + 0.35 * (n - 1)) if n else 0.0
    # Distinct groups matter more than raw count: that is the scam *pattern*.
    score *= 1.0 + 0.25 * max(0, len(groups) - 1)
    score = min(1.0, score / 4.0)

    hits.sort(key=lambda h: h.start)
    return PhraseResult(score=round(score, 3), hits=hits, groups=groups, transcript=norm)


class LivePhraseWindow:
    """Rolling phrase score over the last N seconds of a live call."""

    def __init__(self, memory_seconds: float | None = None) -> None:
        self.memory = memory_seconds or config.LIVE_PHRASE_MEMORY_SECONDS
        self._hits: list[PhraseHit] = []
        self._text: list[tuple[float, str]] = []

    def add_transcript(self, text: str, now: float | None = None) -> PhraseResult:
        now = time.time() if now is None else now
        res = analyse(text, now)
        self._hits.extend(res.hits)
        if text.strip():
            self._text.append((now, text.strip()))
        return self.current(now)

    def current(self, now: float | None = None) -> PhraseResult:
        now = time.time() if now is None else now
        self._hits = [h for h in self._hits if now - h.at <= self.memory]
        self._text = [(t, s) for (t, s) in self._text if now - t <= self.memory]
        groups: dict[str, int] = {}
        for h in self._hits:
            groups[h.group] = groups.get(h.group, 0) + 1
        score = 0.0
        for group, n in groups.items():
            w = GROUP_WEIGHTS.get(group, 0.5)
            score += w * (1.0 + 0.35 * (n - 1))
        score *= 1.0 + 0.25 * max(0, len(groups) - 1)
        return PhraseResult(
            score=round(min(1.0, score / 4.0), 3),
            hits=list(self._hits),
            groups=groups,
            transcript=" ".join(s for _, s in self._text),
        )
