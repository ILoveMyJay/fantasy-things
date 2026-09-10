# Fantasy Skills Collection

专为 **Google Antigravity** 与 **Gemini Agent** / **Workbuddy** 打造的生产级自定义技能（Skills）全家桶仓库，融合多模态图像生成、科普资产管线与超自然拟真语音合成（TTS）能力。

---

## 📦 收录技能总览

| 技能名称 | 目录路径 | 核心能力与适用场景 |
| :--- | :--- | :--- |
| **`nanobanana-image-gen`** | [`skills/nanobanana-image-gen`](./skills/nanobanana-image-gen/) | 基于 Google Gemini 3.x 原生多模态图像生成模型（Nano Banana 系列）。支持高品质文生图、参考图编辑（图生图）、多图连续角色与风格一致性保持，附带开箱即用的 CLI 脚本。 |
| **`bio-asset-generator`** | [`skills/bio-asset-generator`](./skills/bio-asset-generator/) | 专为儿童生物科普教育项目打造的全流程素材方案。涵盖物种研究、解剖学特征库、提示词模板、多角度视觉一致性锁定机制及结构化物种科普数据定义。 |
| **`edge-tts`** | [`skills/edge-tts`](./skills/edge-tts/) | 基于微软 Edge Azure 神经网络大模型的高保真文本转语音。**零 API Key、零费用、零限流、秒级生成**，提供 400+ 多国语言极拟真音色，完美支持 Windows 10/11 跨平台。 |
| **`gmi-tts`** | [`skills/gmi-tts`](./skills/gmi-tts/) | 基于 MiniMax / 海螺星野大模型的高品质情感语音合成。具备高表现力拟真语感，适合角色扮演、故事演播与高保真交互配音。 |
| **`site-walkthrough-video`** | [`skills/site-walkthrough-video`](./skills/site-walkthrough-video/) | 网站用户旅程导览视频制作全流程。从首页开始模拟真实用户的滚动、点击、导航行为，最终进入目标页面展示内容。含完整长图拼接脚本、可复用 HTML 模板、edge-tts 语音封装，输出 1920×1080 MP4。 |
| **`wechat-pay`** | [`skills/wechat-pay`](./skills/wechat-pay/) | 微信支付 Native 扫码支付完整接入方案。**零 npm 依赖**，纯 Web Crypto API 实现 RSA-SHA256 签名与 AES-256-GCM 解密，完美适配 Cloudflare Workers/Pages Functions 运行时。含工具库、下单/查单/回调三个接口模板、数据库 DDL 及完整知识文档。 |

---

## 🚀 安装与集成方法

### 方式 1：项目级引入（推荐，随项目代码库一同版本管理）

将需要的技能复制到具体项目的 `.agents/skills/` 目录：

```bash
# 进入你的项目根目录
mkdir -p .agents/skills

# 复制对应技能（以 nanobanana-image-gen 和 edge-tts 为例）
cp -r /path/to/fantasy-skills/skills/nanobanana-image-gen .agents/skills/
cp -r /path/to/fantasy-skills/skills/edge-tts .agents/skills/
```

### 方式 2：全局引入（所有工作区通用）

将技能复制到全局 Antigravity / Gemini 配置目录：

- **Windows**: `%USERPROFILE%\.gemini\config\skills\`
- **macOS / Linux**: `~/.gemini/config/skills/`

```powershell
# PowerShell 示例（Windows）：
Copy-Item -Recurse -Force "skills\nanobanana-image-gen" "$HOME\.gemini\config\skills\"
Copy-Item -Recurse -Force "skills\edge-tts" "$HOME\.gemini\config\skills\"
Copy-Item -Recurse -Force "skills\bio-asset-generator" "$HOME\.gemini\config\skills\"
Copy-Item -Recurse -Force "skills\gmi-tts" "$HOME\.gemini\config\skills\"
```

---

## 🛠️ 各技能核心说明与快速上手

### 1. 图像生成技能 (`nanobanana-image-gen`)
- **环境要求**: Python 3.10+, `google-genai`, `pillow`
- **环境变量**: `GEMINI_API_KEY`
- **示例命令**:
  ```bash
  python skills/nanobanana-image-gen/scripts/generate.py "一只戴着护目镜在丛林探险的小松鼠，吉卜力动画风格" -o squirrel.png
  ```

### 2. 微软语音合成 (`edge-tts`)
- **环境要求**: Python 3.8+, `edge-tts`
- **特点**: 免配置 API Key，开箱即用
- **示例命令**:
  ```bash
  python skills/edge-tts/scripts/edge_tts_runner.py --text "你好，这是微软神经网络语音合成示范！" --voice zh-CN-YunxiNeural -o greeting.mp3
  ```

### 3. GMI 情感语音合成 (`gmi-tts`)
- **环境要求**: Python 3.8+
- **配置**: 需配置 GMI / MiniMax 相关凭证
- **文档**: 详见 [`skills/gmi-tts/SKILL.md`](./skills/gmi-tts/SKILL.md)

### 4. 生物科普素材生成器 (`bio-asset-generator`)
- **规范与资源**:
  - `references/species-data-schema.md`: 物种结构化 JSON 规范
  - `references/prompt-templates.md`: 5 阶段分级提示词模板
  - `references/consistency-lock.md`: 角色与艺术风格锁定指南
  - `resources/anatomy-database.md`: 昆虫/动物解剖对照库

---


### 5. 网站导览视频制作 (\site-walkthrough-video\)
- **环境要求**: Node.js (hyperframes), Python 3.10+ (numpy, Pillow), ffmpeg, edge-tts
- **核心能力**: 7 步工作流（捕获→设计→分镜→语音→构建→渲染→验证），标准导航交互模式（下滚→上滚居中→光标→点击涟漪），多段截图精确拼接
- **可复用模板**: \	emplates/nav-segment.html\（导航段）、\	emplates/detail-segment.html\（详情段）
- **工具脚本**: \scripts/stitch_fullpage.py\（numpy 行匹配拼接）、\scripts/generate_vo.py\（edge-tts 封装）
- **文档**: 详见 [\skills/site-walkthrough-video/SKILL.md\](./skills/site-walkthrough-video/SKILL.md)

## 📂 仓库目录结构

```text
fantasy-skills/
├── .gitignore                         # 统一 Git 忽略规则
├── README.md                          # 仓库综合使用指引
└── skills/                            # 技能集合目录
    ├── bio-asset-generator/           # 生物科普素材生成管线
    ├── edge-tts/                      # 微软高保真 Edge TTS
    ├── gmi-tts/                       # GMI 情感语音合成
    ├── nanobanana-image-gen/          # Gemini 多模态生图与编辑
    ├── site-walkthrough-video/        # 网站用户旅程导览视频制作
    └── wechat-pay/                    # 微信支付 Native 扫码接入
        ├── SKILL.md                   # 激活条件 + 6步工作流
        ├── references/
        │   ├── wxpay-concepts.md      # 核心知识：密钥体系、单号、流程
        │   └── wxpay-api-guide.md     # API参数、错误码、算法实现
        └── templates/
            ├── _wxpay.ts              # Web Crypto API 工具库
            ├── create.ts              # 下单接口
            ├── query.ts               # 查单接口 + grantMembership
            ├── notify.ts              # 回调通知处理
            └── orders.sql             # 数据库订单表 DDL
```

---

## 📄 License

MIT / Private Repository - All rights reserved.
