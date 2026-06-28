from __future__ import annotations

import subprocess

from app import create_app


def csrf_client():
    app = create_app(testing=True)
    client = app.test_client()
    client.get("/")
    with client.session_transaction() as flask_session:
        token = flask_session["csrf_token"]
    return client, {"X-CSRF-Token": token}


def test_page_has_strict_security_headers():
    client, _headers = csrf_client()
    response = client.get("/")

    assert response.status_code == 200
    assert response.headers["Cache-Control"].startswith("no-store")
    assert response.headers["X-Frame-Options"] == "DENY"
    assert "frame-ancestors 'none'" in response.headers["Content-Security-Policy"]


def test_recovery_requires_csrf():
    app = create_app(testing=True)
    response = app.test_client().post(
        "/api/recover",
        json={"mnemonic": "one two", "network": "mainnet", "offline": True},
    )
    assert response.status_code == 403


def test_invalid_phrase_is_rejected_without_echoing_it():
    client, headers = csrf_client()
    phrase = "one two three four five six seven eight nine ten eleven twelve"
    response = client.post(
        "/api/recover",
        json={"mnemonic": phrase, "network": "mainnet", "offline": True},
        headers=headers,
    )

    assert response.status_code == 400
    assert phrase not in response.get_data(as_text=True)


def test_ephemeral_valid_phrase_derives_three_wallets_offline():
    generated = subprocess.run(
        [
            "node",
            "--input-type=module",
            "-e",
            "import {mnemonicNew} from '@ton/crypto'; process.stdout.write((await mnemonicNew(24)).join(' '));",
        ],
        capture_output=True,
        text=True,
        check=True,
    ).stdout

    client, headers = csrf_client()
    response = client.post(
        "/api/recover",
        json={"mnemonic": generated, "network": "mainnet", "offline": True},
        headers=headers,
    )
    payload = response.get_json()

    assert response.status_code == 200
    assert [wallet["version"] for wallet in payload["wallets"]] == ["V3R2", "V4R2", "V5R1"]
    assert all(wallet["nonBounceable"].startswith("UQ") for wallet in payload["wallets"])
    assert generated not in response.get_data(as_text=True)
