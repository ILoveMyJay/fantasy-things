---
name: nanobanana-image-gen
description: >-
  使用 Google Vertex AI 原生生图与多模态编辑模型（Nano Banana 系列：gemini-3.1-flash-image / gemini-3-pro-image / gemini-3.1-flash-lite-image）
  进行高质量图片生成与编辑。原生支持 Google Cloud 赠金抵扣（免除 AI Studio 预付款限制）。当用户请求生成图片、画图、插画设计、修改现有图片、角色/产品一致性生图或提及 Nano Banana 时激活此 Skill。
---

# Nano Banana Image Generator (Vertex AI 版) — AI 图像生成与编辑系统

## 📖 概述

本 Skill 基于 Google Cloud **Vertex AI** 原生多模态图像生成与编辑能力（社区代号 **Nano Banana** 系列）。
支持纯文字生图（Text-to-Image）、结合参考图编辑修改（Image-to-Image）以及多图角色与风格一致性生成。

> [!NOTE]
> **原生赠金支持**：本实现走 Google Cloud Vertex AI 专属企业级 API，调用费用直接从 Google Cloud 项目的**赠金余额（Credits）**中自动扣除，彻底避开 Google AI Studio 强制要求信用卡预付费（Prepay）充值的限制。

---

## 🎯 支持的模型矩阵与路由策略

| 模型名称 | 社区别名 | 定位与特点 | 适用场景 |
| :--- | :--- | :--- | :--- |
| **`gemini-3.1-flash-image`** | **Nano Banana 2** *(主力推荐)* | 速度快、成像细节丰富、构图精准，平衡性最佳 | **默认首选**。通用插画、设计素材、科普图、摄影、背景等绝大部分日常生图需求 |
| **`gemini-3-pro-image`** | **Nano Banana Pro** | 超强推理能力、复杂空间与多主体理解、高保真文字渲染 | 复杂海报设计、含精确文本/排版的图像、多角色交互场景、精细商业修图 |
| **`gemini-3.1-flash-lite-image`** | **Nano Banana Lite** | 极低延迟、超快响应、资源消耗低 | 快速草图探索、Prompt 构思验证、大批量快速原型预览 |
| **`gemini-2.5-flash-image`** | **Nano Banana 1** | 经典款多模态图像模型，稳定性好 | 兼容旧版提示词与轻量生成任务 |

---

## 🔑 凭据与认证配置

脚本内置了智能凭据探测机制，按照以下优先级自动加载 Google Cloud 服务账号凭证：

1. **命令行参数**：通过 `-k /path/to/service-account.json` 指定。
2. **环境变量**：读取 `VERTEX_CREDENTIALS` 或 `GOOGLE_APPLICATION_CREDENTIALS`。
3. **自动扫描**：
   * 自动探测 `~/Downloads/*.json` 中从 GCP 控制台下载的服务账号私钥文件（如 `steady-voltage-*-*.json`）。
   * 自动探测当前工作目录或 Skill 目录下的 `credentials.json`。

认证成功后，脚本将自动基于 JWT 算法换取 Bearer Token，并在内存中进行 1 小时安全缓存。

---

## 🚀 快速使用方法

### 方式 1：使用内置 Python CLI 脚本（推荐）

在终端中直接运行配套脚本：

```bash
# 1. 默认使用主力推荐模型 (Nano Banana 2 / Flash)
python scripts/generate.py "一只戴着护目镜在丛林探险的小松鼠，吉卜力动画风格，高分辨率" -o output.png

# 2. 指定长宽比 (支持 1:1, 16:9, 9:16, 4:3, 3:4)
python scripts/generate.py "宏伟壮观的赛博朋克都市夜景，霓虹倒影，电影质感" -a 16:9 -o cyberpunk_wallpaper.png

# 3. 使用 Pro 模型生成复杂构图/文字
python scripts/generate.py "复古咖啡馆海报，正中央写有霓虹发光文字 'NIGHT COFFEE'，复古赛博朋克风" -m pro -o poster.png

# 4. 使用 Lite 模型快速生成草图
python scripts/generate.py "极简线条小猫图标" -m lite -o icon.png

# 5. 图生图 / 参考图编辑（换背景、修改细节、风格转换）
python scripts/generate.py "保持图片中的小猫外貌不变，将其背景更换为巴黎铁塔下的黄昏街景" -r input_cat.png -o cat_in_paris.png

# 6. 显式指定密钥与项目 (可选)
python scripts/generate.py "金色阳光洒在麦田上" -k ~/Downloads/my-gcp-key.json -p my-project-id -o wheat.png
```

---

### 方式 2：Python 模块化调用

可以直接导入 `generate_image` 函数：

```python
from scripts.generate import generate_image

# 纯文生图
output_file = generate_image(
    prompt="一幅唯美的水彩风格江南水乡小镇，细雨朦胧",
    output_path="water_town.png",
    model="gemini-3.1-flash-image",
    aspect_ratio="16:9",
)
print("生成完成:", output_file)

# 图生图（风格迁移 / 编辑）
edited_file = generate_image(
    prompt="将这张照片转为复古漫画线稿风格",
    reference_images=["photo.png"],
    output_path="manga_style.png",
)
```

---

## 🎨 核心工作流程规范

### 1. 需求分析与模型选择
* 评估用户的生图需求：
  * **常规需求/设计素材** ➔ 选用 `gemini-3.1-flash-image`（默认）
  * **海报文字/高难度构图/多物体关系** ➔ 选用 `gemini-3-pro-image`
  * **多方案快速探索** ➔ 选用 `gemini-3.1-flash-lite-image`

### 2. 提示词（Prompt）工程规范
Nano Banana 对自然语言与艺术风格有很深的理解，编写 Prompt 时遵循：
* **主体（Subject）**：明确主体、特征、动作、材质（如 *a golden retriever puppy wearing a red raincoat*）。
* **环境与光影（Environment & Lighting）**：环境背景、时间、光线氛围（如 *rainy city street, warm neon lights reflection, cinematic soft lighting*）。
* **艺术风格（Style & Medium）**：画风、媒介类型（如 *watercolor illustration, 3D clay render, studio product photo, retro anime*）。
* **构图与视角（Composition & Shot）**：特写、俯视、广角、极简白底等（如 *macro close-up shot, shallow depth of field, centered composition*）。

### 3. 多图一致性与连续编辑
* **角色/物体一致性**：在第二轮或后续生成中，将第一张生成的图片作为输入传给 `-r / --ref`，提示词中明确强调 `Keep the subject in the reference image identical, only change...`。
* **背景替换/局部修改**：提供原图 + 自然语言指令（例如：“将背景的白天改为雪夜，并在角色头上添加一顶圣诞帽”）。

---

## ⚠️ 常见问题与处理 (Troubleshooting)

1. **找不到凭证文件 (FileNotFoundError)**：
   * 确保你已在 Google Cloud 控制台下载了服务账号密钥 JSON，并将其放置在 `~/Downloads/`、当前项目根目录或通过环境变量 `GOOGLE_APPLICATION_CREDENTIALS` 导出。
2. **提示 API 未启用**：
   * 在 Google Cloud 控制台的「API 和服务」中确认已启用 **Vertex AI API** (`aiplatform.googleapis.com`)。
3. **提示权限不足 (Permission Denied)**：
   * 确保服务账号在 IAM 中已拥有 `Vertex AI User` 或 `Editor` 角色。
4. **生成的不是图片而是纯文本回答**：
   * 检查 Prompt 是否过长或偏离生图意图。确保 Prompt 表达出明确的视觉描述指令。
