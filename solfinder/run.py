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
SCANNER_PATH = BASE_DIR / "dist" / "scanner.js"


def load_settings() -> dict[str, Any]:
    if not SETTINGS_PATH.exists():
        return {"bot_token": "", "user_id": "", "notify_enabled": False}
    try:
        data = json.loads(SETTINGS_PATH.read_text("utf-8"))
        return data if isinstance(data, dict) else {}
    except (json.JSONDecodeError, OSError):
        return {}


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


def fmt_funded(address: str, secret_key: str, sol: str, index: int) -> str:
    lines = [
        "<b>💰 Balansli SOL hamyon topildi</b>\n",
        f"<b>Address:</b> <code>{address}</code>",
        f"<b>Balans:</b> {sol} SOL",
        f"<b>Private Key (hex):</b> <code>{secret_key}</code>",
        "",
        f"<i>#scan_{index} #SOLfinder</i>",
    ]
    return "\n".join(lines)


def fmt_stats(stats: dict) -> str:
    runtime = time.time() - stats["start_ts"]
    hours = runtime / 3600
    rate = stats["total"] / hours if hours else 0
    lines = [
        "<b>📊 Statistika (SOL)</b>\n",
        f"Tekshirilgan: {stats['total']:,}",
        f"Balanslilar: {stats['funded']:,}",
        f"Jami SOL: {stats['total_sol']:.9f}",
        f"Tezlik: {rate:.0f}/soat",
        f"Ish vaqti: {runtime / 3600:.1f} soat",
    ]
    return "\n".join(lines)


def main() -> None:
    print("=== SOLfinder Scanner Service ===")
    print()

    settings = load_settings()
    token = os.environ.get("SOLFINDER_BOT_TOKEN", "") or settings.get("bot_token", "")
    token = token.strip()
    user_id = os.environ.get("SOLFINDER_USER_ID", "") or settings.get("user_id", "")
    user_id = user_id.strip()
    notify_str = os.environ.get("SOLFINDER_NOTIFY_ENABLED", "")
    notify_enabled = notify_str.lower() in ("1", "true", "yes") if notify_str else settings.get("notify_enabled", False)
    sol_rpc = os.environ.get("SOLANA_RPC_URL", "") or settings.get("solana_rpc_url", "https://api.mainnet-beta.solana.com")
    stats_interval = int(os.environ.get("SOLFINDER_STATS_INTERVAL", "0")) or int(settings.get("stats_interval", 1000))

    if not token or not user_id:
        print("  [WARN] Bot token yoki User ID sozlanmagan.")
        print("  Telegram xabarlari yuborilmaydi.")
    if notify_enabled:
        print("  [ON] Telegram bildirishnoma yoqilgan")
    else:
        print("  [OFF] Telegram bildirishnoma o'chirilgan")

    print(f"  [RPC] {sol_rpc}")

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
            "total_sol": 0.0,
            "start_ts": time.time(),
            "last_stats_idx": 0,
        }

        env = os.environ.copy()
        env["SOLANA_RPC_URL"] = sol_rpc

        print(f"[START] SOL skaner ishga tushmoqda ...")
        print()

        scanner = subprocess.Popen(
            ["node", str(SCANNER_PATH)],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            cwd=BASE_DIR,
            env=env,
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

                if msg_type == "result":
                    stats["total"] += 1
                    sol = float(data["wallet"]["balanceSol"])
                    if sol > 0:
                        stats["funded"] += 1
                        stats["total_sol"] += sol

                        if notify_enabled and token and user_id:
                            msg = fmt_funded(
                                data["address"],
                                data["secretKey"],
                                data["wallet"]["balanceSol"],
                                data["index"],
                            )
                            ok = send_telegram(token, user_id, msg)
                            print(f"  [TG] Xabar yuborildi" if ok else "  [TG] Xabar yuborilmadi")

                        print(f"  [FUND] #{data['index']} Balans topildi! {sol} SOL | {data['address']}")

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

                elif msg_type == "error":
                    print(f"  [WARN] Skaner xatosi: {data.get('message', '')}")

                elif msg_type == "fatal":
                    print(f"  [FATAL] {data.get('message', '')}")

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

    print("[EXIT] SOLfinder to'xtatildi")


if __name__ == "__main__":
    main()
