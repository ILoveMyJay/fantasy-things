#!/usr/bin/env python3
"""
Nano Banana Image Generator (Google Gemini 3.x / Vertex AI Image Models)
使用 Google Cloud Vertex AI 接口，原生支持 GCP 赠金抵扣，无需预付款充值。

支持模型：
- gemini-3.1-flash-image (Nano Banana 2 - 默认推荐)
- gemini-3-pro-image (Nano Banana Pro - 复杂构图与文字排版)
- gemini-3.1-flash-lite-image (Nano Banana Lite - 超快速草图预览)
- gemini-2.5-flash-image (经典稳定款)
"""

import os
import sys
import json
import time
import base64
import mimetypes
import argparse
from pathlib import Path
import urllib.request
import urllib.parse
import urllib.error

MODELS = {
    "flash": "gemini-3.1-flash-image",
    "pro": "gemini-3-pro-image",
    "lite": "gemini-3.1-flash-lite-image",
    "banana2": "gemini-3.1-flash-image",
    "nanobanana": "gemini-3.1-flash-image",
    "nanobanana-pro": "gemini-3-pro-image",
    "nanobanana-lite": "gemini-3.1-flash-lite-image",
    "2.5": "gemini-2.5-flash-image",
    "gemini-2.5-flash-image": "gemini-2.5-flash-image",
    "gemini-3.1-flash-image": "gemini-3.1-flash-image",
    "gemini-3-pro-image": "gemini-3-pro-image",
    "gemini-3.1-flash-lite-image": "gemini-3.1-flash-lite-image",
}

_TOKEN_CACHE = {"token": None, "expires_at": 0, "key_file": None}

def find_credentials(explicit_path=None) -> str:
    """自动查找服务账号 JSON 凭证文件路径"""
    if explicit_path and os.path.exists(explicit_path):
        return str(Path(explicit_path).resolve())

    # 1. 检查环境变量
    for env_key in ["VERTEX_CREDENTIALS", "GOOGLE_APPLICATION_CREDENTIALS"]:
        env_val = os.environ.get(env_key)
        if env_val and os.path.exists(env_val):
            return str(Path(env_val).resolve())

    # 2. 检查 Skill 本地及当前执行目录
    skill_dir = Path(__file__).resolve().parent.parent
    for local_cand in [
        skill_dir / "credentials.json",
        Path.cwd() / "credentials.json",
        Path.cwd() / "service_account.json",
    ]:
        if local_cand.exists():
            return str(local_cand)

    # 3. 自动扫描 ~/Downloads 目录中下载的 GCP 密钥 JSON
    downloads_dir = Path.home() / "Downloads"
    if downloads_dir.exists():
        candidates = sorted(
            downloads_dir.glob("*.json"),
            key=lambda p: p.stat().st_mtime,
            reverse=True,
        )
        for cand in candidates:
            try:
                with open(cand, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    if data.get("type") == "service_account" and "private_key" in data:
                        return str(cand.resolve())
            except Exception:
                continue

    return None

def get_access_token(key_path: str) -> str:
    """使用服务账号私钥换取 Google Cloud OAuth2 Bearer Access Token"""
    now = int(time.time())
    if _TOKEN_CACHE["token"] and _TOKEN_CACHE["key_file"] == key_path and _TOKEN_CACHE["expires_at"] > now + 60:
        return _TOKEN_CACHE["token"]

    with open(key_path, "r", encoding="utf-8") as f:
        key_data = json.load(f)

    try:
        from cryptography.hazmat.primitives import hashes, serialization
        from cryptography.hazmat.primitives.asymmetric import padding
    except ImportError:
        raise ImportError("缺少 cryptography 依赖库，请运行: pip install cryptography")

    header = {"alg": "RS256", "typ": "JWT"}
    payload = {
        "iss": key_data["client_email"],
        "sub": key_data["client_email"],
        "aud": "https://oauth2.googleapis.com/token",
        "iat": now,
        "exp": now + 3600,
        "scope": "https://www.googleapis.com/auth/cloud-platform",
    }

    def b64url(d):
        if isinstance(d, bytes):
            raw = d
        elif isinstance(d, str):
            raw = d.encode("utf-8")
        else:
            raw = json.dumps(d).encode("utf-8")
        return base64.urlsafe_b64encode(raw).decode("utf-8").rstrip("=")

    signing_input = f"{b64url(header)}.{b64url(payload)}".encode("utf-8")
    private_key = serialization.load_pem_private_key(
        key_data["private_key"].encode("utf-8"),
        password=None,
    )
    sig = private_key.sign(signing_input, padding.PKCS1v15(), hashes.SHA256())
    jwt = f"{signing_input.decode()}.{b64url(sig)}"

    req_data = urllib.parse.urlencode({
        "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
        "assertion": jwt,
    }).encode("utf-8")

    req = urllib.request.Request("https://oauth2.googleapis.com/token", data=req_data)
    with urllib.request.urlopen(req) as resp:
        res = json.loads(resp.read().decode())
        token = res["access_token"]
        _TOKEN_CACHE["token"] = token
        _TOKEN_CACHE["expires_at"] = now + int(res.get("expires_in", 3600))
        _TOKEN_CACHE["key_file"] = key_path
        return token

def generate_image(
    prompt: str,
    output_path: str = "output.png",
    model: str = "gemini-3.1-flash-image",
    reference_images: list = None,
    key_path: str = None,
    project_id: str = None,
    location: str = "global",
    aspect_ratio: str = None,
) -> str:
    """使用 Vertex AI 端点生成或编辑图片"""
    cred_file = find_credentials(key_path)
    if not cred_file:
        raise FileNotFoundError(
            "未找到 Google Cloud 服务账号凭证 JSON 文件！\n"
            "请通过以下任一方式配置：\n"
            "  1. 命令行参数: --key /path/to/service-account.json\n"
            "  2. 设置环境变量: export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json\n"
            "  3. 将导出的服务账号 json 密钥放入 ~/Downloads/ 或当前目录 credentials.json"
        )

    with open(cred_file, "r", encoding="utf-8") as f:
        cred_data = json.load(f)

    target_project = project_id or os.environ.get("GOOGLE_CLOUD_PROJECT") or cred_data.get("project_id")
    if not target_project:
        raise ValueError("凭证中未包含 project_id，请通过 --project 或环境变量 GOOGLE_CLOUD_PROJECT 指定。")

    token = get_access_token(cred_file)
    model_name = MODELS.get(model.lower(), model)

    parts = []
    # 若提供参考图片（图生图 / 风格参考 / 图像编辑）
    if reference_images:
        for img_p in reference_images:
            p = Path(img_p)
            if not p.exists():
                raise FileNotFoundError(f"参考图未找到: {img_p}")
            mime_type, _ = mimetypes.guess_type(str(p))
            if not mime_type:
                mime_type = "image/png"
            with open(p, "rb") as f:
                img_b64 = base64.b64encode(f.read()).decode("utf-8")
            parts.append({
                "inlineData": {
                    "mimeType": mime_type,
                    "data": img_b64,
                }
            })

    parts.append({"text": prompt})

    generation_config = {
        "responseModalities": ["TEXT", "IMAGE"],
    }
    if aspect_ratio:
        generation_config["imageConfig"] = {"aspectRatio": aspect_ratio}

    endpoint = f"https://aiplatform.googleapis.com/v1/projects/{target_project}/locations/{location}/publishers/google/models/{model_name}:generateContent"

    body = json.dumps({
        "contents": [{
            "role": "user",
            "parts": parts,
        }],
        "generationConfig": generation_config,
    }).encode("utf-8")

    req = urllib.request.Request(endpoint, data=body, headers={
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    })

    print(f"[*] 使用 GCP 项目: {target_project} (Location: {location})")
    print(f"[*] 凭据来源: {cred_file}")
    print(f"[*] 正在调用 Vertex AI 图像模型 [{model_name}]...")

    try:
        with urllib.request.urlopen(req) as resp:
            res = json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        err_msg = e.read().decode()
        raise RuntimeError(f"Vertex AI API 错误 ({e.code}): {err_msg}")

    candidates = res.get("candidates", [])
    if not candidates:
        raise RuntimeError(f"API 响应中未返回候选内容: {res}")

    out_p = Path(output_path).resolve()
    out_p.parent.mkdir(parents=True, exist_ok=True)

    saved = False
    resp_parts = candidates[0].get("content", {}).get("parts", [])
    for p in resp_parts:
        if "text" in p and p["text"].strip():
            print(f"[*] 模型说明: {p['text'].strip()}")
        if "inlineData" in p:
            img_bytes = base64.b64decode(p["inlineData"]["data"])
            with open(out_p, "wb") as f:
                f.write(img_bytes)
            print(f"[✓] 图片生成成功，已保存至: {out_p} ({len(img_bytes) / 1024:.1f} KB)")
            saved = True

    if not saved:
        raise RuntimeError("API 响应中未包含图像二进制数据，请检查 Prompt 是否被文本问答截获。")

    return str(out_p)

def main():
    parser = argparse.ArgumentParser(description="Nano Banana (Gemini 3 Vertex AI) 图像生成工具")
    parser.add_argument("prompt", help="图像生成的提示词或编辑指令")
    parser.add_argument("-o", "--output", default="output.png", help="输出图片保存路径 (默认: output.png)")
    parser.add_argument("-m", "--model", default="flash", choices=list(MODELS.keys()), help="模型变体 (默认: flash / gemini-3.1-flash-image)")
    parser.add_argument("-r", "--ref", nargs="*", default=None, help="参考图路径 (支持多张，用于图生图、角色一致性或风格迁移)")
    parser.add_argument("-a", "--aspect-ratio", default=None, choices=["1:1", "16:9", "9:16", "4:3", "3:4"], help="图片长宽比")
    parser.add_argument("-k", "--key", default=None, help="Google Cloud 服务账号 JSON 凭据路径 (默认自动扫描)")
    parser.add_argument("-p", "--project", default=None, help="Google Cloud 项目 ID (默认从凭证 JSON 中读取)")
    parser.add_argument("-l", "--location", default="global", help="Vertex AI 区域 (默认: global)")

    args = parser.parse_args()

    try:
        generate_image(
            prompt=args.prompt,
            output_path=args.output,
            model=args.model,
            reference_images=args.ref,
            key_path=args.key,
            project_id=args.project,
            location=args.location,
            aspect_ratio=args.aspect_ratio,
        )
    except Exception as e:
        print(f"[!] 错误: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
