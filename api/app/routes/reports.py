"""Scam-number reports (PRD stretch S3): POST /reports.

Numbers are hashed before storage, never stored in the clear - the table only
ever answers "how many people reported this number", which is all the feature
needs. Pair it with the PDRM Semak Mule link in the UI.
"""
from __future__ import annotations

import hashlib
import os
import re

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field

from .. import config, db, ratelimit

router = APIRouter(tags=["reports"])

# A per-deployment pepper, so a stolen table cannot be brute-forced back into
# a list of phone numbers (the number space is tiny without it).
PEPPER = os.environ.get("SUARASAH_REPORT_PEPPER", "suarasah-dev-pepper")

CATEGORIES = {"voice_clone", "fake_authority", "money_request", "other"}


def hash_number(number: str) -> str:
    digits = re.sub(r"\D", "", number)
    if digits.startswith("0"):
        digits = "60" + digits[1:]
    return hashlib.sha256((PEPPER + digits).encode()).hexdigest()


class Report(BaseModel):
    phone_number: str = Field(min_length=6, max_length=24)
    category: str = "other"


@router.post("/reports")
def submit(body: Report, request: Request) -> dict:
    ratelimit.check(request, "reports", config.RATE_LIMIT_VERIFY)
    category = body.category if body.category in CATEGORIES else "other"
    h = hash_number(body.phone_number)
    db.run(
        "INSERT INTO scam_reports (id, phone_number_hash, category, created_at) VALUES (?,?,?,?)",
        (db.new_id(), h, category, db.now()),
    )
    row = db.one("SELECT COUNT(*) n FROM scam_reports WHERE phone_number_hash = ?", (h,))
    return {"ok": True, "reports_for_this_number": row["n"] if row else 1}


@router.get("/reports/lookup")
def lookup(number: str, request: Request) -> dict:
    ratelimit.check(request, "reports", config.RATE_LIMIT_VERIFY)
    h = hash_number(number)
    row = db.one("SELECT COUNT(*) n FROM scam_reports WHERE phone_number_hash = ?", (h,))
    return {"reports": row["n"] if row else 0}
