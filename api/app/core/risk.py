"""Risk fusion - PRD Section 8.

Hard rule from the PRD: the UI never says "human" or "real".  The lowest thing
we can ever say about unsigned audio is "low risk, but sender not verified".
"""
from __future__ import annotations

from dataclasses import dataclass

from .. import config
from .phrases import PhraseResult


def level_for(score: float) -> str:
    if score >= config.RISK_HIGH_AT:
        return "high"
    if score >= config.RISK_MEDIUM_AT:
        return "medium"
    return "low"


@dataclass
class RiskResult:
    level: str                  # low | medium | high
    reason: str                 # machine-readable reason key, mapped to BM/EN in the UI
    ai_level: str
    ai_score: float
    phrase_score: float
    phrase_groups: dict[str, int]


def fuse(ai_score: float, phrases: PhraseResult) -> RiskResult:
    ai_level = level_for(ai_score)
    money, urgency = phrases.has_money, phrases.has_urgency
    secrecy = phrases.has_secrecy

    if ai_level == "high":
        level, reason = "high", "likely_ai_voice"
    elif ai_level == "medium" and (money or urgency or secrecy):
        level, reason = "high", "suspicious_voice_and_scam_pattern"
    elif (money and urgency) or (secrecy and money):
        level, reason = "medium", "scam_pattern_call_back"
    elif money or urgency or secrecy:
        level, reason = "medium", "scam_words_present"
    elif ai_level == "medium":
        level, reason = "medium", "voice_uncertain"
    else:
        level, reason = "low", "low_risk_not_verified"

    return RiskResult(
        level=level,
        reason=reason,
        ai_level=ai_level,
        ai_score=round(float(ai_score), 3),
        phrase_score=phrases.score,
        phrase_groups=phrases.groups,
    )
