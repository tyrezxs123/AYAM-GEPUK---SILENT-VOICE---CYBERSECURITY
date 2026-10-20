"""Verdict rules - PRD Section 7, first match wins.

One deliberate refinement of the PRD table, for safety:

  The PRD says "watermark found but signature invalid -> TAMPERED".  A watermark
  whose `ref` matches *no record at all* is not an invalid signature - we simply
  have no claim to check (it can also be a fallback-detector false positive).
  Calling that TAMPERED would scare a user about an innocent clip, so an unknown
  ref falls through to UNVERIFIED with a note.  A ref that *does* resolve to a
  record and then fails signature or fingerprint checks is TAMPERED, as written.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

VERIFIED = "VERIFIED"
TAMPERED = "TAMPERED"
REPLAYED = "REPLAYED"
EXPIRED = "EXPIRED"
UNVERIFIED = "UNVERIFIED"


@dataclass
class SegmentResult:
    seq_no: int
    matched: bool
    ber: float
    watermarked: bool

    def as_dict(self) -> dict[str, Any]:
        return {
            "seq_no": self.seq_no,
            "matched": self.matched,
            "ber": round(self.ber, 4),
            "watermarked": self.watermarked,
        }


@dataclass
class ProvenanceResult:
    verdict: str
    sender_name: str | None = None
    recorded_at: int | None = None
    expires_at: int | None = None
    context: str | None = None
    session_id: str | None = None
    segments: list[SegmentResult] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)
    watermark_confidence: float = 0.0
    watermark_engine: str = ""

    @property
    def is_verified(self) -> bool:
        return self.verdict == VERIFIED


def decide(
    *,
    watermark_present: bool,
    ref_known: bool,
    signature_valid: bool,
    all_segments_match: bool,
    all_segments_watermarked: bool,
    expired: bool,
    key_revoked: bool,
    seen_in_live_scan: bool,
) -> str:
    """Pure decision function - unit-testable, no I/O."""
    if not watermark_present or not ref_known:
        return UNVERIFIED
    if not signature_valid:
        return TAMPERED
    if seen_in_live_scan:
        # Live speech should never carry an old recording's mark.
        return REPLAYED
    if not all_segments_match or not all_segments_watermarked:
        return TAMPERED
    if expired:
        return EXPIRED
    if key_revoked:
        return TAMPERED
    return VERIFIED
