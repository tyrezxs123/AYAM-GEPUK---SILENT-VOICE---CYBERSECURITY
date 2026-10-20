"""Storage.  SQLite today, Supabase/Postgres later.

The schema is exactly the one in PRD Section 9, so moving to Supabase is a
matter of pointing a psycopg connection at the same DDL.  No table holds audio.
"""
from __future__ import annotations

import json
import sqlite3
import threading
import time
import uuid
from typing import Any

from . import config

_lock = threading.Lock()
_conn: sqlite3.Connection | None = None

DDL = """
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  display_name  TEXT NOT NULL,
  phone_verified INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS device_keys (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id),
  public_key  TEXT NOT NULL,          -- Ed25519, hex
  label       TEXT,
  created_at  INTEGER NOT NULL,
  revoked_at  INTEGER
);

CREATE TABLE IF NOT EXISTS voice_sessions (
  id               TEXT PRIMARY KEY,  -- session_id
  user_id          TEXT REFERENCES users(id),
  device_key_id    TEXT REFERENCES device_keys(id),
  wm_ref           INTEGER NOT NULL,
  nonce            TEXT NOT NULL,
  issued_at        INTEGER NOT NULL,
  expires_at       INTEGER NOT NULL,
  context          TEXT,
  fingerprint_root TEXT,
  signature        TEXT,
  duration_s       REAL,
  signed_at        INTEGER
);
CREATE INDEX IF NOT EXISTS idx_voice_sessions_wm_ref ON voice_sessions(wm_ref);

CREATE TABLE IF NOT EXISTS segment_fingerprints (
  session_id  TEXT NOT NULL REFERENCES voice_sessions(id),
  seq_no      INTEGER NOT NULL,
  fingerprint BLOB NOT NULL,
  PRIMARY KEY (session_id, seq_no)
);

CREATE TABLE IF NOT EXISTS verification_logs (
  id          TEXT PRIMARY KEY,
  session_id  TEXT,
  mode        TEXT NOT NULL,         -- file | live | bot
  verdict     TEXT NOT NULL,
  ai_score    REAL,
  phrase_hits INTEGER,
  latency_ms  INTEGER,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS scam_reports (
  id                TEXT PRIMARY KEY,
  phone_number_hash TEXT NOT NULL,
  category          TEXT,
  created_at        INTEGER NOT NULL
);
"""


def connect() -> sqlite3.Connection:
    global _conn
    with _lock:
        if _conn is None:
            _conn = sqlite3.connect(config.DB_PATH, check_same_thread=False)
            _conn.row_factory = sqlite3.Row
            _conn.execute("PRAGMA journal_mode=WAL")
            _conn.executescript(DDL)
            _conn.commit()
        return _conn


def now() -> int:
    return int(time.time())


def new_id() -> str:
    return uuid.uuid4().hex


def q(sql: str, params: tuple = ()) -> list[sqlite3.Row]:
    cur = connect().execute(sql, params)
    rows = cur.fetchall()
    cur.close()
    return rows


def one(sql: str, params: tuple = ()) -> sqlite3.Row | None:
    rows = q(sql, params)
    return rows[0] if rows else None


def run(sql: str, params: tuple = ()) -> None:
    c = connect()
    with _lock:
        c.execute(sql, params)
        c.commit()


def runmany(sql: str, seq: list[tuple]) -> None:
    c = connect()
    with _lock:
        c.executemany(sql, seq)
        c.commit()


# --- domain helpers --------------------------------------------------------

def upsert_user(display_name: str, user_id: str | None = None) -> str:
    uid = user_id or new_id()
    existing = one("SELECT id FROM users WHERE id = ?", (uid,))
    if existing:
        run("UPDATE users SET display_name = ? WHERE id = ?", (display_name, uid))
    else:
        run(
            "INSERT INTO users (id, display_name, phone_verified, created_at) VALUES (?,?,?,?)",
            (uid, display_name, 0, now()),
        )
    return uid


def register_key(user_id: str, public_key_hex: str, label: str | None) -> str:
    existing = one(
        "SELECT id FROM device_keys WHERE public_key = ? AND revoked_at IS NULL",
        (public_key_hex,),
    )
    if existing:
        return existing["id"]
    kid = new_id()
    run(
        "INSERT INTO device_keys (id, user_id, public_key, label, created_at) VALUES (?,?,?,?,?)",
        (kid, user_id, public_key_hex, label, now()),
    )
    return kid


def log_verification(
    *, session_id: str | None, mode: str, verdict: str,
    ai_score: float | None, phrase_hits: int, latency_ms: int,
) -> None:
    run(
        "INSERT INTO verification_logs (id, session_id, mode, verdict, ai_score, phrase_hits,"
        " latency_ms, created_at) VALUES (?,?,?,?,?,?,?,?)",
        (new_id(), session_id, mode, verdict, ai_score, phrase_hits, latency_ms, now()),
    )


def metrics() -> dict[str, Any]:
    rows = q(
        "SELECT verdict, COUNT(*) n, AVG(latency_ms) ms FROM verification_logs GROUP BY verdict"
    )
    return {
        "by_verdict": {r["verdict"]: {"count": r["n"], "avg_latency_ms": round(r["ms"] or 0)} for r in rows},
        "total": sum(r["n"] for r in rows),
    }


def dumps(obj: Any) -> str:
    return json.dumps(obj, separators=(",", ":"))
