#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
语音生成封装工具
================
基于 edge-tts 生成旁白，自动转 wav 格式供 hyperframes 使用。

用法：
  python generate_vo.py --text "旁白文案" --out narration
  python generate_vo.py --file script.txt --out narration --voice zh-CN-XiaoxiaoNeural
  python generate_vo.py --text "Hello" --out hello --voice en-US-AnaNeural --lang en

参数：
  --text    旁白文案（与 --file 二选一）
  --file    从文本文件读取文案
  --out     输出文件名前缀（默认 narration）
  --voice   音色（默认 zh-CN-XiaoxiaoNeural）
  --rate    语速（默认 -4%）
  --pitch   音调（默认 +2Hz）
  --lang    语言 zh/en（默认 zh，影响默认音色）

输出：
  {out}.mp3  — edge-tts 原始输出
  {out}.wav  — 44100Hz 单声道（hyperframes 要求）
  {out}.txt  — 实际使用的文案
"""

import argparse
import os
import sys
import subprocess
import shutil


# edge-tts runner 路径（根据实际安装位置修改）
EDGE_TTS_RUNNER = r"E:\aicode\antigravity\lingokids-2d\.agents\skills\edge-tts\scripts\edge_tts_runner.py"

# 系统 Python 路径
PYTHON = sys.executable


def check_dependencies():
    """检查 edge-tts 和 ffmpeg 是否可用"""
    # 检查 edge-tts runner
    if not os.path.exists(EDGE_TTS_RUNNER):
        print(f"错误：找不到 edge-tts runner：{EDGE_TTS_RUNNER}", file=sys.stderr)
        print("请修改脚本中的 EDGE_TTS_RUNNER 路径", file=sys.stderr)
        sys.exit(1)

    # 检查 ffmpeg
    if not shutil.which("ffmpeg"):
        print("错误：找不到 ffmpeg，请确保 ffmpeg 在 PATH 中", file=sys.stderr)
        sys.exit(1)


def generate_mp3(text, voice, rate, pitch, out_mp3):
    """调用 edge-tts 生成 mp3"""
    cmd = [
        PYTHON, EDGE_TTS_RUNNER,
        "--text", text,
        "--voice", voice,
        "--rate", rate,
        "--pitch", pitch,
        "--out", out_mp3,
    ]
    print(f"生成语音：{voice} rate={rate} pitch={pitch}")
    print(f"文案长度：{len(text)} 字")

    result = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8")
    if result.returncode != 0:
        print(f"edge-tts 错误：{result.stderr}", file=sys.stderr)
        sys.exit(1)

    # 解析输出获取实际路径
    print(result.stdout.strip())
    return out_mp3


def convert_to_wav(mp3_path, wav_path):
    """将 mp3 转为 44100Hz 单声道 wav（hyperframes 要求）"""
    cmd = [
        "ffmpeg", "-y",
        "-i", mp3_path,
        "-ar", "44100",
        "-ac", "1",
        wav_path,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"ffmpeg 转码错误：{result.stderr}", file=sys.stderr)
        sys.exit(1)
    return wav_path


def get_audio_duration(wav_path):
    """获取音频时长（秒）"""
    cmd = [
        "ffprobe", "-v", "quiet",
        "-show_entries", "format=duration",
        "-of", "csv=p=0",
        wav_path,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    try:
        return float(result.stdout.strip())
    except ValueError:
        return 0.0


def main():
    parser = argparse.ArgumentParser(description="语音生成封装工具")
    parser.add_argument("--text", help="旁白文案")
    parser.add_argument("--file", help="从文本文件读取文案")
    parser.add_argument("--out", default="narration", help="输出文件名前缀")
    parser.add_argument("--voice", default=None, help="音色")
    parser.add_argument("--rate", default="-4%", help="语速")
    parser.add_argument("--pitch", default="+2Hz", help="音调")
    parser.add_argument("--lang", default="zh", choices=["zh", "en"], help="语言")
    args = parser.parse_args()

    # 获取文案
    if args.text:
        text = args.text
    elif args.file:
        with open(args.file, "r", encoding="utf-8") as f:
            text = f.read().strip()
    else:
        print("错误：必须提供 --text 或 --file", file=sys.stderr)
        sys.exit(1)

    # 默认音色
    voice = args.voice
    if voice is None:
        voice = "zh-CN-XiaoxiaoNeural" if args.lang == "zh" else "en-US-AnaNeural"

    check_dependencies()

    # 输出路径
    out_dir = os.path.dirname(os.path.abspath(args.out))
    if out_dir and not os.path.exists(out_dir):
        os.makedirs(out_dir, exist_ok=True)

    out_mp3 = args.out + ".mp3"
    out_wav = args.out + ".wav"
    out_txt = args.out + ".txt"

    # 保存文案
    with open(out_txt, "w", encoding="utf-8") as f:
        f.write(text)

    # 生成 mp3
    generate_mp3(text, voice, args.rate, args.pitch, out_mp3)

    # 转 wav
    convert_to_wav(out_mp3, out_wav)

    # 获取时长
    duration = get_audio_duration(out_wav)

    print(f"\n{'='*50}")
    print(f"完成！")
    print(f"  MP3: {out_mp3}")
    print(f"  WAV: {out_wav} (44100Hz 单声道)")
    print(f"  文案: {out_txt}")
    print(f"  时长: {duration:.2f} 秒")
    print(f"  字数: {len(text)} 字")
    print(f"  语速: {len(text)/duration:.1f} 字/秒" if duration > 0 else "")
    print(f"{'='*50}")


if __name__ == "__main__":
    main()
