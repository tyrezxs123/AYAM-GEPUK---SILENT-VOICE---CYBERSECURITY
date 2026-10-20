"""Device key registration (PRD F1 step 1, POST /keys and /keys/{id}/revoke).

There is deliberately no password and no session token here. The device's
Ed25519 signature over the session payload *is* the authentication: a request
that cannot produce that signature cannot create a signed clip. Swapping in
Supabase Google / phone-OTP sign-in (PRD Section 6) only adds an identity check
on top of this; it does not change the signing path.
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from .. import config, db, ratelimit

router = APIRouter(tags=["keys"])


class RegisterKey(BaseModel):
    display_name: str = Field(min_length=1, max_length=60)
    public_key: str = Field(min_length=64, max_length=64)  # Ed25519, hex
    label: str | None = Field(default=None, max_length=60)
    user_id: str | None = None  # returning device: keep the same user row


class RegisteredKey(BaseModel):
    user_id: str
    device_key_id: str
    display_name: str


@router.post("/keys", response_model=RegisteredKey)
def register_key(body: RegisterKey, request: Request) -> RegisteredKey:
    ratelimit.check(request, "keys", config.RATE_LIMIT_SESSIONS)
    try:
        raw = bytes.fromhex(body.public_key)
    except ValueError as exc:
        raise HTTPException(400, "public_key must be hex") from exc
    if len(raw) != 32:
        raise HTTPException(400, "Ed25519 public key must be 32 bytes")

    existing = db.one(
        "SELECT k.id, k.user_id FROM device_keys k WHERE k.public_key = ? AND k.revoked_at IS NULL",
        (body.public_key,),
    )
    if existing:
        user_id = existing["user_id"]
        db.upsert_user(body.display_name, user_id)
        return RegisteredKey(
            user_id=user_id, device_key_id=existing["id"], display_name=body.display_name
        )

    user_id = db.upsert_user(body.display_name, body.user_id)
    key_id = db.register_key(user_id, body.public_key, body.label)
    return RegisteredKey(user_id=user_id, device_key_id=key_id, display_name=body.display_name)


@router.post("/keys/{key_id}/revoke")
def revoke_key(key_id: str, request: Request) -> dict:
    """Revoking is the MVP answer to a lost or stolen phone (PRD threat model).
    Clips already signed by that key stop being VERIFIED from this moment on."""
    ratelimit.check(request, "keys", config.RATE_LIMIT_SESSIONS)
    row = db.one("SELECT id, revoked_at FROM device_keys WHERE id = ?", (key_id,))
    if not row:
        raise HTTPException(404, "Unknown device key")
    if row["revoked_at"] is None:
        db.run("UPDATE device_keys SET revoked_at = ? WHERE id = ?", (db.now(), key_id))
    return {"device_key_id": key_id, "revoked": True}
