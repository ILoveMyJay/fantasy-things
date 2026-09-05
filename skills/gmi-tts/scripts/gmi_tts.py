#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
gmi_tts.py — 调用 GMI Cloud minimax-tts-speech-2.8-hd 合成语音

用法:
    # 完整合成(提交 + 轮询 + 下载)
    python gmi_tts.py --text "你好" --voice_id English_expressive_narrator --emotion happy

    # 只提交,返回 request_id
    python gmi_tts.py --text "你好" --no-wait

    # 续查 + 下载
    python gmi_tts.py --poll <request_id>

    # 列任务
    python gmi_tts.py --list

    # 模型信息(诊断)
    python gmi_tts.py --info

环境变量:
    GMI_API_KEY  必需,缺则 exit 2

输出:
    落到 D:\\ai-outputs\\audio\\YYYYMMDD-HHMMSS-<voice_id>.<format>
    stdout 打 JSON: {"request_id","local_path","url","duration_ms","status"}
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path
from typing import Any, Optional
from urllib import request as urlreq, error as urlerr, parse as urlparse

BASE_URL = "https://console.gmicloud.ai"
MODEL_ID = "minimax-tts-speech-2.8-hd"
OUTPUT_DIR = Path(r"D:\ai-outputs\audio")

DEFAULTS = {
    "voice_id": "English_expressive_narrator",
    "speed": "1",
    "vol": "1",
    "pitch": "0",
    "emotion": "auto",
    "language_boost": "auto",
    "format": "mp3",
    "audio_sample_rate": "32000",
    "bitrate": "128000",
    "channel": "2",
    "vm_pitch": 0,
    "intensity": 0,
    "timbre": 0,
    "sound_effects": "",
}


def _auth_headers() -> dict[str, str]:
    key = os.environ.get("GMI_API_KEY", "").strip()
    if not key:
        print(
            "ERROR: 环境变量 GMI_API_KEY 未设置。\n"
            "请在 PowerShell 里跑:\n"
            '  setx GMI_API_KEY "你的key" /M\n'
            "然后重开 WorkBuddy 窗口。",
            file=sys.stderr,
        )
        sys.exit(2)
    return {
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    }


def _http(method: str, path: str, body: Optional[dict] = None, retries: int = 5) -> dict:
    import ssl
    url = BASE_URL + path
    data = json.dumps(body).encode("utf-8") if body is not None else None
    ctx = ssl.create_default_context()
    for attempt in range(retries):
        req = urlreq.Request(url, data=data, method=method, headers=_auth_headers())
        try:
            with urlreq.urlopen(req, context=ctx, timeout=35) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urlerr.HTTPError as e:
            raw = e.read().decode("utf-8", errors="replace")
            print(f"HTTP {e.code} {e.reason}: {raw}", file=sys.stderr)
            if e.code in (401, 403):
                print(
                    "  → Key 失效或无权限。请去 https://console.gmicloud.ai 重新签发。",
                    file=sys.stderr,
                )
                sys.exit(3)
            if e.code in (429, 500, 502, 503, 504) and attempt < retries - 1:
                wait_sec = 8 * (attempt + 1)
                print(f"  [重试提示] 服务端暂时繁忙 (HTTP {e.code})，等待 {wait_sec} 秒后自动重试 (第 {attempt + 1}/{retries} 次)...", file=sys.stderr)
                time.sleep(wait_sec)
                continue
            sys.exit(3)
        except (urlerr.URLError, TimeoutError, ConnectionResetError) as e:
            if attempt < retries - 1:
                time.sleep(2)
                continue
            print(f"网络错误: {e}", file=sys.stderr)
            sys.exit(4)
    sys.exit(4)


def submit(text: str, **overrides) -> str:
    """提交合成,返回 request_id。"""
    if not text or not text.strip():
        print("ERROR: text 不能为空", file=sys.stderr)
        sys.exit(5)
    if len(text) > 5000:
        print(
            f"WARNING: text 长度 {len(text)} 字符,超过单次 5000 字符上限。\n"
            "请截断后重试,或拆成多段。",
            file=sys.stderr,
        )
        sys.exit(5)

    payload = {**DEFAULTS, **overrides, "text": text}
    body = {"model": MODEL_ID, "payload": payload}
    resp = _http("POST", "/api/v1/ie/requestqueue/apikey/requests", body=body)
    rid = resp.get("request_id")
    if not rid:
        print(f"ERROR: 提交失败,响应: {json.dumps(resp, ensure_ascii=False)}", file=sys.stderr)
        sys.exit(6)
    return rid


def poll(request_id: str, timeout_s: int = 300, interval_s: int = 2) -> dict:
    """轮询直到 success/failed 或超时,返回完整响应。"""
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        resp = _http("GET", f"/api/v1/ie/requestqueue/apikey/requests/{request_id}")
        status = resp.get("status")
        if status == "success":
            return resp
        if status == "failed":
            print(
                f"ERROR: 任务失败\n{json.dumps(resp, ensure_ascii=False, indent=2)}",
                file=sys.stderr,
            )
            sys.exit(7)
        if status == "cancelled":
            print(f"ERROR: 任务被取消 ({request_id})", file=sys.stderr)
            sys.exit(7)
        time.sleep(interval_s)
    print(
        f"ERROR: 轮询超时 (>{timeout_s}s)。request_id={request_id} 留作续查:\n"
        f'  python gmi_tts.py --poll {request_id}',
        file=sys.stderr,
    )
    sys.exit(8)


def _extract_media_url(outcome: Optional[dict]) -> Optional[str]:
    if not outcome:
        return None
    if outcome.get("audio_url"):
        return outcome["audio_url"]
    media_urls = outcome.get("media_urls") or []
    if media_urls and isinstance(media_urls, list) and isinstance(media_urls[0], dict) and media_urls[0].get("url"):
        return media_urls[0]["url"]
    return None


def download_to(media_url: str, voice_id: str, fmt: str) -> Path:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    ts = time.strftime("%Y%m%d-%H%M%S")
    safe_voice = "".join(c if c.isalnum() or c in "-_" else "_" for c in voice_id)[:40]
    out_path = OUTPUT_DIR / f"{ts}-{safe_voice}.{fmt}"
    req = urlreq.Request(media_url, headers={"User-Agent": "gmi-tts/1.0"})
    with urlreq.urlopen(req, timeout=120) as resp, open(out_path, "wb") as f:
        while True:
            chunk = resp.read(64 * 1024)
            if not chunk:
                break
            f.write(chunk)
    return out_path


def synthesize(text: str, **overrides) -> dict[str, Any]:
    """高层封装: 提交 → 轮询 → 下载 → 返回结果 dict。"""
    fmt = overrides.get("format", DEFAULTS["format"])
    voice_id = overrides.get("voice_id", DEFAULTS["voice_id"])
    rid = submit(text, **overrides)
    final = poll(rid)
    url = _extract_media_url(final.get("outcome"))
    if not url:
        print(
            f"ERROR: success 但未找到音频 URL\n{json.dumps(final, ensure_ascii=False, indent=2)}",
            file=sys.stderr,
        )
        sys.exit(9)
    local = download_to(url, voice_id, fmt)
    return {
        "request_id": rid,
        "local_path": str(local),
        "url": url,
        "status": "success",
        "voice_id": voice_id,
    }


# ---------- CLI ----------

def main() -> None:
    p = argparse.ArgumentParser(description="GMI TTS — minimax-tts-speech-2.8-hd")
    p.add_argument("--text", help="要合成的文本")
    p.add_argument("--no-wait", action="store_true", help="只提交,不轮询不下载")
    p.add_argument("--poll", metavar="REQUEST_ID", help="续查 + 下载")
    p.add_argument("--list", action="store_true", help="列本模型任务")
    p.add_argument("--info", action="store_true", help="打印模型信息")

    # 可调参数
    p.add_argument("--voice_id", default=DEFAULTS["voice_id"])
    p.add_argument("--speed", default=DEFAULTS["speed"])
    p.add_argument("--vol", default=DEFAULTS["vol"])
    p.add_argument("--pitch", default=DEFAULTS["pitch"], type=int)
    p.add_argument("--emotion", default=DEFAULTS["emotion"])
    p.add_argument("--language_boost", default=DEFAULTS["language_boost"])
    p.add_argument("--format", default=DEFAULTS["format"])
    p.add_argument("--audio_sample_rate", default=DEFAULTS["audio_sample_rate"])
    p.add_argument("--bitrate", default=DEFAULTS["bitrate"])
    p.add_argument("--channel", default=DEFAULTS["channel"])
    p.add_argument("--vm_pitch", type=int, default=DEFAULTS["vm_pitch"])
    p.add_argument("--intensity", type=int, default=DEFAULTS["intensity"])
    p.add_argument("--timbre", type=int, default=DEFAULTS["timbre"])
    p.add_argument("--sound_effects", default=DEFAULTS["sound_effects"])

    args = p.parse_args()

    if args.info:
        out = _http("GET", f"/api/v1/ie/requestqueue/apikey/models/{MODEL_ID}")
        print(json.dumps(out, ensure_ascii=False, indent=2))
        return

    if args.list:
        out = _http("GET", f"/api/v1/ie/requestqueue/apikey/requests?model_id={MODEL_ID}")
        print(json.dumps(out, ensure_ascii=False, indent=2))
        return

    if args.poll:
        final = poll(args.poll)
        url = _extract_media_url(final.get("outcome"))
        if not url:
            print(json.dumps(final, ensure_ascii=False, indent=2))
            return
        local = download_to(url, args.voice_id, args.format)
        print(
            json.dumps(
                {
                    "request_id": args.poll,
                    "local_path": str(local),
                    "url": url,
                    "status": "success",
                },
                ensure_ascii=False,
            )
        )
        return

    if not args.text:
        p.print_help(sys.stderr)
        sys.exit(1)

    overrides = {
        "voice_id": args.voice_id,
        "speed": args.speed,
        "vol": args.vol,
        "pitch": str(args.pitch),
        "emotion": args.emotion,
        "language_boost": args.language_boost,
        "format": args.format,
        "audio_sample_rate": args.audio_sample_rate,
        "bitrate": args.bitrate,
        "channel": args.channel,
        "vm_pitch": args.vm_pitch,
        "intensity": args.intensity,
        "timbre": args.timbre,
        "sound_effects": args.sound_effects,
    }

    if args.no_wait:
        rid = submit(args.text, **overrides)
        print(json.dumps({"request_id": rid, "status": "submitted"}, ensure_ascii=False))
        return

    # 价格估算
    cost = len(args.text) * 0.10 / 1000
    print(f"  字符 {len(args.text)} → 估算 ${cost:.4f}", file=sys.stderr)
    print(f"  voice={overrides['voice_id']} emotion={overrides['emotion']}", file=sys.stderr)

    result = synthesize(args.text, **overrides)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
