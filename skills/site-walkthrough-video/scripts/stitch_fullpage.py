#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
完整页面长图拼接工具
====================
将多段视口截图精确拼接为一张完整页面长图。
使用 numpy 逐行匹配找到接缝，自动处理粘性导航栏。

用法：
  python stitch_fullpage.py --input seg1.png seg2.png seg3.png --output full.png
  python stitch_fullpage.py --input seg1.png seg2.png --output full.png --overlap 200

参数：
  --input    输入截图路径列表（按从上到下的顺序）
  --output   输出长图路径
  --overlap  预期重叠区域高度（默认 150px，用于缩小搜索范围）
  --nav-h    粘性导航栏高度（默认 0，自动检测；如果已知可指定）
"""

import argparse
import sys
import os
import numpy as np
from PIL import Image


def find_best_match(top_img, bottom_img, expected_overlap=150, nav_height=0):
    """
    在两张图的重叠区域中找到最佳拼接行。
    返回 (top_cut_row, bottom_start_row, match_diff)
    """
    top_arr = np.array(top_img.convert("RGB"), dtype=np.float32)
    bottom_arr = np.array(bottom_img.convert("RGB"), dtype=np.float32)

    top_h, top_w = top_arr.shape[:2]
    bottom_h, bottom_w = bottom_arr.shape[:2]

    # 搜索范围：top 的底部 overlap 区域 vs bottom 的顶部 overlap 区域
    search_top = max(0, top_h - expected_overlap - 100)
    search_bottom = min(expected_overlap + 100, bottom_h)

    best_diff = float("inf")
    best_top_row = top_h - 1
    best_bottom_row = 0

    # 模板高度（用于匹配的行数）
    template_h = min(80, top_h - search_top, search_bottom)

    for top_row in range(search_top, top_h - template_h):
        # 跳过粘性导航栏区域（如果指定了）
        if nav_height > 0 and top_row < nav_height + 20:
            continue

        template = top_arr[top_row:top_row + template_h]

        for bottom_row in range(0, search_bottom - template_h):
            if nav_height > 0 and bottom_row < nav_height:
                continue

            candidate = bottom_arr[bottom_row:bottom_row + template_h]
            diff = np.mean(np.abs(template - candidate))

            if diff < best_diff:
                best_diff = diff
                best_top_row = top_row
                best_bottom_row = bottom_row

    return best_top_row, best_bottom_row, best_diff


def stitch_images(image_paths, output_path, expected_overlap=150, nav_height=0):
    """
    拼接多张截图为完整长图。
    """
    if len(image_paths) < 2:
        print("错误：至少需要 2 张截图", file=sys.stderr)
        sys.exit(1)

    print(f"加载 {len(image_paths)} 张截图...")
    images = [Image.open(p).convert("RGB") for p in image_paths]

    # 验证宽度一致
    widths = [img.width for img in images]
    if len(set(widths)) > 1:
        print(f"警告：截图宽度不一致 {widths}，将使用第一张的宽度", file=sys.stderr)
        target_w = widths[0]
        images = [img.resize((target_w, int(img.height * target_w / img.width))) for img in images]

    # 逐对拼接
    result = images[0]
    total_height = result.height

    for i in range(1, len(images)):
        print(f"拼接第 {i+1}/{len(images)} 张...")
        top_cut, bottom_start, diff = find_best_match(
            result, images[i], expected_overlap, nav_height
        )

        print(f"  匹配点：top_row={top_cut}, bottom_start={bottom_start}, diff={diff:.2f}")

        if diff > 10:
            print(f"  警告：匹配度较低 (diff={diff:.1f})，接缝可能不完美", file=sys.stderr)

        # 裁剪：top 保留到 top_cut，bottom 从 bottom_start 开始
        top_part = result.crop((0, 0, result.width, top_cut))
        bottom_part = images[i].crop((0, bottom_start, images[i].width, images[i].height))

        # 垂直拼接
        new_h = top_part.height + bottom_part.height
        combined = Image.new("RGB", (result.width, new_h))
        combined.paste(top_part, (0, 0))
        combined.paste(bottom_part, (0, top_part.height))

        result = combined
        total_height = new_h
        print(f"  当前总高度：{new_h}px")

    result.save(output_path, "PNG")
    print(f"\n完成！输出：{output_path}")
    print(f"尺寸：{result.width} × {result.height}")
    print(f"文件大小：{os.path.getsize(output_path) / 1024 / 1024:.2f} MB")


def main():
    parser = argparse.ArgumentParser(description="完整页面长图拼接工具")
    parser.add_argument("--input", nargs="+", required=True, help="输入截图路径（从上到下）")
    parser.add_argument("--output", required=True, help="输出长图路径")
    parser.add_argument("--overlap", type=int, default=150, help="预期重叠区域高度（默认 150）")
    parser.add_argument("--nav-h", type=int, default=0, help="粘性导航栏高度（默认 0 自动检测）")
    args = parser.parse_args()

    # 验证输入文件存在
    for p in args.input:
        if not os.path.exists(p):
            print(f"错误：文件不存在 {p}", file=sys.stderr)
            sys.exit(1)

    stitch_images(args.input, args.output, args.overlap, args.nav_h)


if __name__ == "__main__":
    main()
