"""What the user should actually DO (PRD F6).

The API returns keys, not sentences. The web app maps each key to BM and English,
so the decision logic lives in exactly one place and both languages stay in sync.
"""
from __future__ import annotations

from . import verdict as V

# verdict -> (headline key, next-step keys)
_BY_VERDICT: dict[str, tuple[str, list[str]]] = {
    V.VERIFIED: ("verified", ["verified_still_check_money", "save_trusted_sender"]),
    V.TAMPERED: ("tampered", ["do_not_act", "call_back_saved_number", "report_number"]),
    V.REPLAYED: ("replayed", ["old_recording_reused", "call_back_saved_number", "ask_safe_word"]),
    V.EXPIRED: ("expired", ["ask_sender_resend", "call_back_saved_number"]),
}

_BY_RISK: dict[str, tuple[str, list[str]]] = {
    "high": ("unverified_high", ["hang_up_now", "call_back_saved_number", "ask_safe_word"]),
    "medium": ("unverified_medium", ["call_back_saved_number", "ask_safe_word", "never_transfer_on_call"]),
    "low": ("unverified_low", ["no_proof_of_sender", "call_back_if_money"]),
}


def for_result(verdict_name: str, risk_level: str | None) -> dict[str, object]:
    if verdict_name in _BY_VERDICT:
        headline, steps = _BY_VERDICT[verdict_name]
    else:
        headline, steps = _BY_RISK.get(risk_level or "low", _BY_RISK["low"])
    return {"headline_key": headline, "step_keys": steps}


def colour_for(verdict_name: str, risk_level: str | None) -> str:
    """green | red | orange | grey - never the only signal, always paired with
    an icon and words in the UI (accessibility requirement, PRD Section 10)."""
    if verdict_name == V.VERIFIED:
        return "green"
    if verdict_name == V.TAMPERED:
        return "red"
    if verdict_name in (V.REPLAYED, V.EXPIRED):
        return "orange"
    if risk_level == "high":
        return "red"
    if risk_level == "medium":
        return "orange"
    return "grey"
