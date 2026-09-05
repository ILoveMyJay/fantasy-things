"""
Nano Banana Image Generator (Google Gemini 3.x Image Models)
Supports:
- gemini-3.1-flash-image (Nano Banana 2 - Recommended Default)
- gemini-3-pro-image (Nano Banana Pro - Complex scenes, composition & text)
- gemini-3.1-flash-lite-image (Nano Banana Lite - Ultra-fast preview)
"""

import os
import sys
import argparse
from pathlib import Path
from google import genai
from PIL import Image

DEFAULT_API_KEY = os.environ.get("GEMINI_API_KEY", "")

MODELS = {
    "flash": "gemini-3.1-flash-image",
    "pro": "gemini-3-pro-image",
    "lite": "gemini-3.1-flash-lite-image",
    "banana2": "gemini-3.1-flash-image",
    "nanobanana": "gemini-3.1-flash-image",
    "nanobanana-pro": "gemini-3-pro-image",
    "nanobanana-lite": "gemini-3.1-flash-lite-image",
}

def get_client(api_key=None):
    key = api_key or DEFAULT_API_KEY
    if not key:
        raise ValueError("API Key is required. Set GEMINI_API_KEY env var or pass --api_key.")
    return genai.Client(api_key=key)

def generate_image(
    prompt: str,
    output_path: str = "output.png",
    model: str = "gemini-3.1-flash-image",
    reference_images: list = None,
    api_key: str = None
) -> str:
    """
    Generate an image using Gemini Image models.
    """
    model_name = MODELS.get(model.lower(), model)
    client = get_client(api_key)
    
    contents = []
    
    # If reference images provided, load them
    if reference_images:
        for img_p in reference_images:
            p = Path(img_p)
            if not p.exists():
                raise FileNotFoundError(f"Reference image not found: {img_p}")
            img = Image.open(p)
            contents.append(img)
            
    contents.append(prompt)
    
    print(f"[*] Requesting image from [{model_name}]...")
    response = client.models.generate_content(
        model=model_name,
        contents=contents,
    )
    
    saved = False
    if response.candidates:
        for part in response.candidates[0].content.parts:
            if hasattr(part, "inline_data") and part.inline_data:
                out_p = Path(output_path).resolve()
                out_p.parent.mkdir(parents=True, exist_ok=True)
                with open(out_p, "wb") as f:
                    f.write(part.inline_data.data)
                print(f"[✓] Image successfully generated and saved to: {out_p}")
                saved = True
                return str(out_p)
                
    if not saved:
        text_msg = response.text if hasattr(response, 'text') else "No response text"
        raise RuntimeError(f"Failed to extract image from response. Output: {text_msg}")

def main():
    parser = argparse.ArgumentParser(description="Nano Banana (Gemini 3 Image) CLI Generator")
    parser.add_argument("prompt", help="Text prompt for image generation or editing")
    parser.add_argument("-o", "--output", default="output.png", help="Output file path (default: output.png)")
    parser.add_argument("-m", "--model", default="flash", choices=["flash", "pro", "lite", "gemini-3.1-flash-image", "gemini-3-pro-image", "gemini-3.1-flash-lite-image"], help="Model variant (default: flash)")
    parser.add_argument("-r", "--ref", nargs="*", default=None, help="Paths to reference images for editing or style guidance")
    parser.add_argument("--api-key", default=None, help="Gemini API Key override")
    
    args = parser.parse_args()
    
    try:
        generate_image(
            prompt=args.prompt,
            output_path=args.output,
            model=args.model,
            reference_images=args.ref,
            api_key=args.api_key
        )
    except Exception as e:
        print(f"[!] Error: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
