"""Ed25519 verification and the canonical signing payload.

The server NEVER sees a private key.  It builds the exact bytes that must be
signed, the device signs them, and the server verifies with the registered
public key.

The payload is length-prefixed and domain-separated so two different sets of
fields can never produce the same bytes.  The web client rebuilds these bytes
locally and refuses to sign if they differ from what the server sent - that way
the backend cannot trick a device into signing something else.
"""
from __future__ import annotations

import hashlib

from nacl.exceptions import BadSignatureError
from nacl.signing import VerifyKey

DOMAIN = b"SuaraSah/v1/voice-session"


def _field(b: bytes) -> bytes:
    return len(b).to_bytes(4, "big") + b


def signing_payload(
    *,
    session_id: str,
    nonce_hex: str,
    issued_at: int,
    expires_at: int,
    context: str,
    fingerprint_root: str,
) -> bytes:
    return b"".join(
        [
            _field(DOMAIN),
            _field(session_id.encode()),
            _field(bytes.fromhex(nonce_hex)),
            _field(str(int(issued_at)).encode()),
            _field(str(int(expires_at)).encode()),
            _field((context or "").encode()),
            _field(bytes.fromhex(fingerprint_root)),
        ]
    )


def verify(public_key_hex: str, payload: bytes, signature_hex: str) -> bool:
    try:
        key = VerifyKey(bytes.fromhex(public_key_hex))
        key.verify(payload, bytes.fromhex(signature_hex))
        return True
    except (BadSignatureError, ValueError, TypeError):
        return False


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()
