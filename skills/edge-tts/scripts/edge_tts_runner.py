#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Edge Neural TTS Runner
=======================
High-fidelity text-to-speech runner leveraging Microsoft Edge Neural TTS.
Zero API Key, Zero Cost, No Rate Limits.

Can be executed as a standalone CLI tool or imported as a Python module.
Outputs generated audio to D:\\ai-outputs\\audio\\ or a custom specified path.
"""

import sys
import os
import argparse
import asyncio
import json
import datetime
from pathlib import Path

# Optional: ensure utf-8 stdout on Windows
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

DEFAULT_OUTPUT_DIR = Path("D:/ai-outputs/audio")
DEFAULT_CHINESE_VOICE = "zh-CN-XiaoxiaoNeural"
DEFAULT_ENGLISH_VOICE = "en-US-AnaNeural"

def check_dependencies():
    """Verify that edge-tts is installed."""
    try:
        import edge_tts
        return True
    except ImportError:
        return False

async def synthesize_async(
    text: str,
    voice: str = DEFAULT_CHINESE_VOICE,
    rate: str = "-4%",
    pitch: str = "+2Hz",
    volume: str = "+0%",
    out_path: str = None
) -> dict:
    """
    Synthesizes speech asynchronously using edge-tts.
    
    Returns a dict with audio metadata.
    """
    if not check_dependencies():
        raise RuntimeError(
            "The 'edge-tts' package is not installed. Please run: pip install edge-tts"
        )
    
    import edge_tts

    # Determine output path
    if out_path:
        target_path = Path(out_path).resolve()
    else:
        DEFAULT_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
        timestamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
        voice_short = voice.split("-")[-1].replace("Neural", "")
        target_path = DEFAULT_OUTPUT_DIR / f"{timestamp}-{voice_short}.mp3"

    target_path.parent.mkdir(parents=True, exist_ok=True)

    # Clean text
    clean_text = text.strip()
    if not clean_text:
        raise ValueError("Text to synthesize cannot be empty.")

    # Edge-TTS Communicate
    communicate = edge_tts.Communicate(
        text=clean_text,
        voice=voice,
        rate=rate,
        pitch=pitch,
        volume=volume
    )
    
    await communicate.save(str(target_path))

    if not target_path.exists() or target_path.stat().st_size == 0:
        raise IOError(f"Failed to generate audio file at {target_path}")

    return {
        "status": "success",
        "voice": voice,
        "rate": rate,
        "pitch": pitch,
        "volume": volume,
        "local_path": str(target_path),
        "size_bytes": target_path.stat().st_size,
        "text_length": len(clean_text)
    }

def synthesize(
    text: str,
    voice: str = DEFAULT_CHINESE_VOICE,
    rate: str = "-4%",
    pitch: str = "+2Hz",
    volume: str = "+0%",
    out_path: str = None
) -> dict:
    """Synchronous wrapper for synthesize_async."""
    return asyncio.run(synthesize_async(
        text=text,
        voice=voice,
        rate=rate,
        pitch=pitch,
        volume=volume,
        out_path=out_path
    ))

async def list_voices_async(locale_filter: str = None):
    """List available voices, optionally filtered by locale or prefix."""
    if not check_dependencies():
        raise RuntimeError("The 'edge-tts' package is not installed. Run: pip install edge-tts")
    import edge_tts
    voices = await edge_tts.list_voices()
    if locale_filter:
        lf = locale_filter.lower()
        voices = [v for v in voices if lf in v.get("Locale", "").lower() or lf in v.get("ShortName", "").lower()]
    return voices

def main():
    parser = argparse.ArgumentParser(
        description="Edge Neural TTS runner - High fidelity text to speech with zero API key."
    )
    parser.add_argument("--text", "-t", type=str, help="Text to convert to speech")
    parser.add_argument("--file", "-f", type=str, help="Text file to read and convert")
    parser.add_argument("--voice", "-v", type=str, default=DEFAULT_CHINESE_VOICE,
                        help=f"Voice ShortName (default: {DEFAULT_CHINESE_VOICE})")
    parser.add_argument("--rate", "-r", type=str, default="-4%",
                        help="Speech rate adjustment, e.g., '+0%%', '-4%%', '+10%%'")
    parser.add_argument("--pitch", "-p", type=str, default="+2Hz",
                        help="Voice pitch adjustment, e.g., '+0Hz', '+2Hz', '-3Hz'")
    parser.add_argument("--volume", type=str, default="+0%",
                        help="Voice volume adjustment, e.g., '+0%%', '+10%%'")
    parser.add_argument("--out", "-o", type=str, default=None,
                        help="Output mp3 file path (default: D:\\ai-outputs\\audio\\<timestamp>-<voice>.mp3)")
    parser.add_argument("--list-voices", action="store_true",
                        help="List available voices and exit")
    parser.add_argument("--locale", type=str, default=None,
                        help="Filter locale for --list-voices, e.g., zh-CN or en-US")
    parser.add_argument("--json", action="store_true", default=True,
                        help="Output results in JSON format")

    args = parser.parse_args()

    if not check_dependencies():
        res = {
            "status": "error",
            "message": "edge-tts is not installed. Run 'pip install edge-tts' to install."
        }
        print(json.dumps(res, ensure_ascii=False, indent=2))
        sys.exit(1)

    if args.list_voices:
        voices = asyncio.run(list_voices_async(args.locale))
        simple_list = [
            {
                "ShortName": v.get("ShortName"),
                "Gender": v.get("Gender"),
                "Locale": v.get("Locale"),
                "FriendlyName": v.get("FriendlyName")
            }
            for v in voices
        ]
        print(json.dumps(simple_list, ensure_ascii=False, indent=2))
        return

    text = args.text
    if not text and args.file:
        file_path = Path(args.file)
        if not file_path.exists():
            res = {"status": "error", "message": f"Input file not found: {args.file}"}
            print(json.dumps(res, ensure_ascii=False, indent=2))
            sys.exit(1)
        text = file_path.read_text(encoding="utf-8")

    if not text:
        parser.print_help()
        sys.exit(1)

    try:
        result = synthesize(
            text=text,
            voice=args.voice,
            rate=args.rate,
            pitch=args.pitch,
            volume=args.volume,
            out_path=args.out
        )
        print(json.dumps(result, ensure_ascii=False, indent=2))
    except Exception as e:
        res = {"status": "error", "message": str(e)}
        print(json.dumps(res, ensure_ascii=False, indent=2))
        sys.exit(1)

if __name__ == "__main__":
    main()
