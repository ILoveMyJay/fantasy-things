---
name: nanobanana-image-gen
description: >-
  使用 Google Gemini 原生生图与多模态编辑模型（Nano Banana 系列：gemini-3.1-flash-image / gemini-3-pro-image / gemini-3.1-flash-lite-image）
  进行高质量图片生成与编辑。当用户请求生成图片、画图、插画设计、修改现有图片、角色/产品一致性生图或提及 Nano Banana 时激活此 Skill。
---

# Nano Banana Image Generator — AI 图像生成与编辑系统

## 📖 概述

本 Skill 基于 Google Gemini 原生多模态图像生成与编辑能力（社区代号 **Nano Banana** 系列）。支持纯文字生图（Text-to-Image）、结合参考图编辑修改（Image-to-Image）以及多图角色与风格一致性生成。

---

## 🎯 支持的模型矩阵与路由策略

| 模型名称 | 社区别名 | 定位与特点 | 适用场景 |
| :--- | :--- | :--- | :--- |
| **`gemini-3.1-flash-image`** | **Nano Banana 2** *(主力推荐)* | 速度快、成像细节丰富、构图精准，平衡性最佳 | **默认首选**。通用插画、设计素材、科普图、摄影、背景等绝大部分日常生图需求 |
| **`gemini-3-pro-image`** | **Nano Banana Pro** | 超强推理能力、复杂空间与多主体理解、高保真文字渲染 | 复杂海报设计、含精确文本/排版的图像、多角色交互场景、精细商业修图 |
| **`gemini-3.1-flash-lite-image`** | **Nano Banana Lite** | 极低延迟、超快响应、资源消耗低 | 快速草图探索、Prompt 构思验证、大批量快速原型预览 |

---

## 🚀 快速使用方法

### 方式 1：使用内置 Python CLI 脚本（推荐）

在终端中直接运行配套脚本：

```bash
# 1. 默认使用主力推荐模型 (Nano Banana 2 / Flash)
python .agents/skills/nanobanana-image-gen/scripts/generate.py "一只戴着护目镜在丛林探险的小松鼠，吉卜力动画风格，高分辨率" -o output.png

# 2. 使用 Pro 模型生成复杂构图/文字
python .agents/skills/nanobanana-image-gen/scripts/generate.py "复古咖啡馆海报，正中央写有霓虹发光文字 'NIGHT COFFEE'，复古赛博朋克风" -m pro -o poster.png

# 3. 使用 Lite 模型快速生成草图
python .agents/skills/nanobanana-image-gen/scripts/generate.py "极简线条小猫图标" -m lite -o icon.png

# 4. 图生图 / 参考图编辑（换背景、修改细节）
python .agents/skills/nanobanana-image-gen/scripts/generate.py "保持图片中的猫咪外貌不变，将其背景更换为巴黎铁塔下的黄昏街景" -r input_cat.png -o cat_in_paris.png
```

---

### 方式 2：Python SDK 原生代码调用

```python
from google import genai
from PIL import Image

client = genai.Client(api_key="YOUR_GEMINI_API_KEY")

# 1. 纯文生图 (Text-to-Image)
response = client.models.generate_content(
    model="gemini-3.1-flash-image",
    contents="一只可爱的水彩小熊猫在竹林中，色彩鲜艳，高清晰度",
)

# 2. 图生图 / 编辑 (Image-to-Image)
# ref_img = Image.open("reference.png")
# response = client.models.generate_content(
#     model="gemini-3.1-flash-image",
#     contents=[ref_img, "将图片转为黑白素描线稿风格"]
# )

# 保存生成的图片
if response.candidates:
    for part in response.candidates[0].content.parts:
        if hasattr(part, "inline_data") and part.inline_data:
            with open("result.png", "wb") as f:
                f.write(part.inline_data.data)
            print("图片已保存至 result.png")
            break
```

---

## 🎨 核心工作流程规范

### 1. 需求分析与模型选择
* 评估用户的生图需求：
  * **常规需求/设计素材** ➔ 选用 `gemini-3.1-flash-image`
  * **海报文字/高难度构图/多物体关系** ➔ 选用 `gemini-3-pro-image`
  * **多方案快速探索** ➔ 选用 `gemini-3.1-flash-lite-image`

### 2. 提示词（Prompt）工程规范
Nano Banana 对自然语言与艺术风格有很深的理解，编写 Prompt 时遵循：
* **主体（Subject）**：明确主体、特征、动作、材质（如 *a golden retriever puppy wearing a red raincoat*）。
* **环境与光影（Environment & Lighting）**：环境背景、时间、光线氛围（如 *rainy city street, warm neon lights reflection, cinematic soft lighting*）。
* **艺术风格（Style & Medium）**：画风、媒介类型（如 *watercolor illustration, 3D clay render, studio product photo, retro anime*）。
* **构图与视角（Composition & Shot）**：特写、俯视、广角、极简白底等（如 *macro close-up shot, shallow depth of field, centered composition*）。

### 3. 多图一致性与连续编辑
* **角色/物体一致性**：在第二轮或后续生成中，将第一张生成的图片作为输入传给模型，提示词中明确强调 `Keep the subject in the reference image identical, only change...`。
* **背景替换/局部修改**：提供原图 + 自然语言指令（例如：“将背景的白天改为雪夜，并在角色头上添加一顶圣诞帽”）。

---

## ⚠️ 常见问题与处理 (Troubleshooting)

1. **API 密钥配置**：
   * 优先从环境变量 `GEMINI_API_KEY` 读取，也可以在调用时传入 `--api-key` 参数。
2. **生成的不是图片而是纯文本回答**：
   * 检查 Prompt 是否过长或偏离生图意图。确保 Prompt 表达出明确的视觉描述指令。
3. **安全过滤拦截**：
   * 如果返回内容为空，通常触发了安全敏感词过滤，请微调 Prompt 去除潜在敏感词汇后重试。
