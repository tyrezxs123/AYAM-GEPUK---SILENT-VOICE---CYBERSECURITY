"""Tests for CORS security configuration and origin policy enforcement."""
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_cors_allows_localhost():
    res = client.get("/health", headers={"Origin": "http://localhost:3000"})
    assert res.status_code == 200
    assert res.headers.get("access-control-allow-origin") == "http://localhost:3000"


def test_cors_allows_127_0_0_1():
    res = client.get("/health", headers={"Origin": "http://127.0.0.1:3000"})
    assert res.status_code == 200
    assert res.headers.get("access-control-allow-origin") == "http://127.0.0.1:3000"


def test_cors_allows_private_lan_ip_for_phone_demos():
    # 192.168.x.x
    res = client.get("/health", headers={"Origin": "http://192.168.1.105:3000"})
    assert res.status_code == 200
    assert res.headers.get("access-control-allow-origin") == "http://192.168.1.105:3000"

    # 10.x.x.x
    res2 = client.get("/health", headers={"Origin": "https://10.0.2.15:3000"})
    assert res2.status_code == 200
    assert res2.headers.get("access-control-allow-origin") == "https://10.0.2.15:3000"

    # 172.16-31.x.x
    res3 = client.get("/health", headers={"Origin": "http://172.20.10.3:8000"})
    assert res3.status_code == 200
    assert res3.headers.get("access-control-allow-origin") == "http://172.20.10.3:8000"


def test_cors_blocks_external_and_malicious_origins():
    # Public domain attacking the developer's machine
    res = client.get("/health", headers={"Origin": "https://evil-hacker.com"})
    assert res.status_code == 200
    assert "access-control-allow-origin" not in res.headers

    # Campus domain outside private IP space
    res2 = client.get("/health", headers={"Origin": "http://campus-portal.edu"})
    assert res2.status_code == 200
    assert "access-control-allow-origin" not in res2.headers
