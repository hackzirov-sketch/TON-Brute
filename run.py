from __future__ import annotations

import json
import os
import signal
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

import requests


BASE_DIR = Path(__file__).resolve().parent
SETTINGS_PATH = BASE_DIR / "settings.json"
BRIDGE_PATH = BASE_DIR / "dist" / "auto-bridge.js"


def load_settings() -> dict[str, Any]:
    if not SETTINGS_PATH.exists():
        return {"bot_token": "", "user_id": "", "notify_enabled": False}
    try:
        data = json.loads(SETTINGS_PATH.read_text("utf-8"))
        return data if isinstance(data, dict) else {}
    except (json.JSONDecodeError, OSError):
        return {}


def save_settings(data: dict[str, Any]) -> None:
    SETTINGS_PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2), "utf-8")


def send_telegram(token: str, chat_id: str, text: str) -> bool:
    try:
        r = requests.post(
            f"https://api.telegram.org/bot{token}/sendMessage",
            json={
                "chat_id": chat_id,
                "text": text,
                "parse_mode": "HTML",
                "disable_web_page_preview": True,
            },
            timeout=15,
        )
        return r.ok
    except requests.RequestException:
        return False


def fmt_funded(mnemonic: str, wallets: list[dict], index: int) -> str:
    parts = ["<b>💰 Balansli hamyon topildi</b>\n"]
    for w in wallets:
        bal = w.get("balanceTon", "0") or "0"
        parts.append(
            f"<b>{w['version']}</b> \u2014 {bal} TON\n"
            f"<code>{w['nonBounceable']}</code>\n"
            f"<code>{w['bounceable']}</code>\n"
        )
    parts.append(f"<i>#scan_{index} #TONfinder</i>")
    return "\n".join(parts)


def fmt_stats(stats: dict) -> str:
    runtime = time.time() - stats["start_ts"]
    hours = runtime / 3600
    rate = stats["total"] / hours if hours else 0
    lines = [
        "<b>📊 Statistika</b>\n",
        f"Tekshirilgan: {stats['total']:,}",
        f"Balanslilar: {stats['funded']:,}",
        f"Jami TON: {stats['total_ton']:.6f}",
        f"Tezlik: {rate:.0f}/soat",
        f"Ish vaqti: {runtime / 3600:.1f} soat",
    ]
    return "\n".join(lines)


def main() -> None:
    print("=== TONfinder Scanner Service ===")
    print()

    settings = load_settings()
    token = os.environ.get("TONFINDER_BOT_TOKEN", "") or settings.get("bot_token", "")
    token = token.strip()
    user_id = os.environ.get("TONFINDER_USER_ID", "") or settings.get("user_id", "")
    user_id = user_id.strip()
    notify_enabled_str = os.environ.get("TONFINDER_NOTIFY_ENABLED", "")
    if notify_enabled_str:
        notify_enabled = notify_enabled_str.lower() in ("1", "true", "yes")
    else:
        notify_enabled = settings.get("notify_enabled", False)
    api_key = os.environ.get("TONCENTER_API_KEY", "") or settings.get("toncenter_api_key", "") or settings.get("api_key", "")
    api_key = api_key.strip()
    stats_interval = int(os.environ.get("TONFINDER_STATS_INTERVAL", "0")) or int(settings.get("stats_interval", 1000))

    if not token or not user_id:
        print("  [WARN] Bot token yoki User ID sozlanmagan.")
        print("  Telegram xabarlari yuborilmaydi.")
    if notify_enabled:
        print("  [ON] Telegram bildirishnoma yoqilgan")
    else:
        print("  [OFF] Telegram bildirishnoma o'chirilgan")

    restart_delay = 3
    shutdown = False

    def handle_sig(_sig, _frame):
        nonlocal shutdown
        if shutdown:
            return
        shutdown = True
        print("\n[STOP] To'xtatilmoqda...")

    signal.signal(signal.SIGINT, handle_sig)
    signal.signal(signal.SIGTERM, handle_sig)

    while not shutdown:
        stats = {
            "total": 0,
            "funded": 0,
            "total_ton": 0.0,
            "start_ts": time.time(),
            "last_stats_idx": 0,
        }

        args = ["node", str(BRIDGE_PATH), "mainnet"]
        if api_key:
            args.append(api_key)
        else:
            args.append("")

        print(f"[START] Skaner ishga tushmoqda: {' '.join(args[:3])} ...")
        print()

        scanner = subprocess.Popen(
            args,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            cwd=BASE_DIR,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
        )

        try:
            for raw_line in scanner.stdout:
                if shutdown:
                    scanner.terminate()
                    break

                line = raw_line.strip()
                if not line:
                    continue

                try:
                    data = json.loads(line)
                except json.JSONDecodeError:
                    continue

                msg_type = data.get("type")

                if msg_type == "started":
                    api_k = 'ha' if data.get('apiKey') else 'yoq'
                    print(f"  [OK] Skaner boshlandi | network={data['network']} | api_key={api_k}")
                    if data.get("nonce"):
                        print(f"  [i] Nonce: {data['nonce']} (davom ettirilmoqda)")

                elif msg_type == "result":
                    stats["total"] += 1
                    if data.get("hasBalance"):
                        stats["funded"] += 1
                        for w in data.get("wallets", []):
                            try:
                                stats["total_ton"] += float(w.get("balanceTon", 0) or 0)
                            except (ValueError, TypeError):
                                pass

                        if notify_enabled and token and user_id:
                            msg = fmt_funded(
                                data.get("mnemonic", ""),
                                data.get("wallets", []),
                                data.get("index", 0),
                            )
                            ok = send_telegram(token, user_id, msg)
                            print(f"  [TG] Xabar yuborildi" if ok else "  [TG] Xabar yuborilmadi")

                        funded_wallets = [w for w in data.get("wallets", []) if has_balance(w)]
                        funded_ton = sum(
                            float(w.get("balanceTon", 0) or 0) for w in funded_wallets
                        )
                        print(f"  [FUND] #{data.get('index', 0)} Balans topildi! {funded_ton} TON | {data.get('mnemonic', '')[:40]}...")

                    if stats["total"] % 100 == 0:
                        elapsed = time.time() - stats["start_ts"]
                        rate = stats["total"] / (elapsed / 3600) if elapsed > 0 else 0
                        print(f"  [STAT] {stats['total']:,} tekshirildi | {stats['funded']} balansli | {rate:.0f}/soat")

                    if stats["total"] % stats_interval == 0 and stats["total"] > stats["last_stats_idx"]:
                        stats["last_stats_idx"] = stats["total"]
                        if notify_enabled and token and user_id:
                            msg = fmt_stats(stats)
                            ok = send_telegram(token, user_id, msg)
                            print(f"  [TG] Statistika yuborildi" if ok else "  [TG] Statistika yuborilmadi")

                elif msg_type == "progress":
                    if data.get("checked", 0) % 50 == 0:
                        print(f"  [i] Progress: {data['checked']} tekshirildi | {data.get('found', 0)} topildi | interval: {data.get('intervalMs', '?')}ms")

                elif msg_type == "error":
                    print(f"  [WARN] Skaner xatosi: {data.get('error', '')}")

                elif msg_type == "rate_limited":
                    print(f"  [RATE] Rate limit: backoff {data.get('backoffMs', '?')}ms")

                elif msg_type == "stopped":
                    print(f"  [STOP] Skaner to'xtadi: {data.get('reason', '')}")

                elif msg_type == "fatal":
                    print(f"  [FATAL] {data.get('error', '')}")

        except Exception as e:
            print(f"  [ERR] O'qish xatosi: {e}")
        finally:
            if scanner.poll() is None:
                scanner.terminate()
                try:
                    scanner.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    scanner.kill()
                    scanner.wait()

            stderr_out = scanner.stderr.read()
            if stderr_out:
                for line in stderr_out.strip().split("\n"):
                    line = line.strip()
                    if line:
                        print(f"  [STDERR] {line}")

        if not shutdown:
            print(f"  [RESTART] {restart_delay} soniyadan keyin qayta ishga tushadi...")
            time.sleep(restart_delay)

    print("[EXIT] TONfinder to'xtatildi")


def has_balance(wallet: dict) -> bool:
    try:
        bal = wallet.get("balanceTon", "0")
        return bal is not None and float(bal) > 0
    except (ValueError, TypeError):
        return False


if __name__ == "__main__":
    main()
