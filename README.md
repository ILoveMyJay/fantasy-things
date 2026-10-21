# Fantasy Things Collection

专为 **Google Antigravity**、**Gemini Agent** / **Workbuddy** 与 **AI 自动化创作** 打造的生产级武器库。聚合高质量 Antigravity 自定义技能（Skills）与实用 Chrome 浏览器扩展（Chrome Extensions），覆盖多模态图像/视频生成、母版原图下载、角色一致性、科普资产管线与超自然拟真语音合成（TTS）能力。

---

## 🧩 收录 Chrome 浏览器扩展总览

| 扩展名称 | 目录路径 | 核心能力与适用场景 |
| :--- | :--- | :--- |
| **`FlowStudioPro`** | [`chrome-extensions/FlowStudioPro`](./chrome-extensions/FlowStudioPro/) | **Google Flow (Imagen 3 / Veo 2) 批量创作侧边栏扩展**。支持批量生图/视频、全自动制片厂、长剧本智能分镜、6 槽位角色一致性系统、单项目集中批处理（100 任务/项目）、母版原图自动下载与 `preview/` 缩略图分流。已全功能永久解锁并原生简体中文汉化。 |

---

## 📦 收录技能（Skills）总览

| 技能名称 | 目录路径 | 核心能力与适用场景 |
| :--- | :--- | :--- |
| **`nanobanana-image-gen`** | [`skills/nanobanana-image-gen`](./skills/nanobanana-image-gen/) | 基于 Google Gemini 3.x 原生多模态图像生成模型（Nano Banana 系列）。支持高品质文生图、参考图编辑（图生图）、多图连续角色与风格一致性保持，附带开箱即用的 CLI 脚本。 |
| **`bio-asset-generator`** | [`skills/bio-asset-generator`](./skills/bio-asset-generator/) | 专为儿童生物科普教育项目打造的全流程素材方案。涵盖物种研究、解剖学特征库、提示词模板、多角度视觉一致性锁定机制及结构化物种科普数据定义。 |
| **`edge-tts`** | [`skills/edge-tts`](./skills/edge-tts/) | 基于微软 Edge Azure 神经网络大模型的高保真文本转语音。**零 API Key、零费用、零限流、秒级生成**，提供 400+ 多国语言极拟真音色，完美支持 Windows 10/11 跨平台。 |
| **`site-walkthrough-video`** | [`skills/site-walkthrough-video`](./skills/site-walkthrough-video/) | 网站用户旅程导览视频制作全流程。从首页开始模拟真实用户的滚动、点击、导航行为，最终进入目标页面展示内容。含完整长图拼接脚本、可复用 HTML 模板、edge-tts 语音封装，输出 1920×1080 MP4。 |
| **`wechat-pay`** | [`skills/wechat-pay`](./skills/wechat-pay/) | 微信支付 Native 扫码支付完整接入方案。**零 npm 依赖**，纯 Web Crypto API 实现 RSA-SHA256 签名与 AES-256-GCM 解密，完美适配 Cloudflare Workers/Pages Functions 运行时。含工具库、下单/查单/回调三个接口模板、数据库 DDL 及完整知识文档。 |
| **`a-share-news-radar`** | [`skills/a-share-news-radar`](./skills/a-share-news-radar/) | A 股新闻投资方向雷达。**两阶段**：盘前预期扫描（08:00）+ 盘后确认跟踪（16:00），走 `事件 → 影响链 → 板块主题 → 候选股票池` 链路。核心是**证据分级**：S/A/B/C 四级来源绑定六种证据标签，情绪映射类概念股在打分上永远到不了高置信度。含确定性事件打分、报告字段校验器（`lint_report.py`）、SQLite 决策快照与 T+N 命中率回看、7 个历史回归用例。**数据零 token**：腾讯取快照/日K/分时/分钟K，新浪取四档资金与大单净量，**巨潮资讯取公告原文 PDF**（「公告确认」标签的唯一合法来源）。附 `doctor.py` 环境自检，换机器先跑一遍就知道哪些通道可用。 |

---

## 🚀 安装与集成方法

### 方式 1：项目级引入（推荐，随项目代码库一同版本管理）

将需要的技能复制到具体项目的 `.agents/skills/` 目录：

```bash
# 进入你的项目根目录
mkdir -p .agents/skills

# 复制对应技能（以 nanobanana-image-gen 和 edge-tts 为例）
cp -r /path/to/fantasy-things/skills/nanobanana-image-gen .agents/skills/
cp -r /path/to/fantasy-things/skills/edge-tts .agents/skills/

# A 股雷达
cp -r /path/to/fantasy-things/skills/a-share-news-radar .agents/skills/
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
Copy-Item -Recurse -Force "skills\site-walkthrough-video" "$HOME\.gemini\config\skills\"
Copy-Item -Recurse -Force "skills\wechat-pay" "$HOME\.gemini\config\skills\"
Copy-Item -Recurse -Force "skills\a-share-news-radar" "$HOME\.gemini\config\skills\"
```

### 方式 3：Chrome 浏览器扩展加载（以 FlowStudioPro 为例）

1. 打开 Google Chrome 浏览器，在地址栏输入并访问 `chrome://extensions/`；
2. 开启右上角的 **「开发者模式」** 开关；
3. 点击左上角 **「加载已解压的扩展程序」**；
4. 选择本仓库中的 `chrome-extensions/FlowStudioPro` 文件夹；
5. 访问 [Google Flow](https://flow.google.com)（或刷新页面），在右上角扩展栏点击 FlowStudio 图标启动侧边栏即可。

---

## 🛠️ 各模块核心说明与快速上手

### 1. Chrome 扩展：Google Flow 批量创作 (`FlowStudioPro`)
- **功能特性**:
  - **Prompt 批量运行**: 快速输入多行提示词，一键批量排队运行。
  - **单项目集中批处理**: 自动合并单项目上限（100 任务/项目），避免历史列表被碎项目刷屏。
  - **母版原图下载**: 自动拉取 100% Quality 无损原始分辨率母版大图。
  - **缩略图归档**: 压缩预览图自动存放至 `preview/` 子目录，条理清晰。
  - **角色一致性 (CCR)**: 永久解锁 1 个 MCR 主角槽 + 5 个 SC 配角槽及品牌角色库导入导出。
  - **剧本分镜模式**: 长剧本多算法切分，支持音乐 MV 歌词、小说与短视频切分。
- **文档**: 详见 [`chrome-extensions/FlowStudioPro/README.md`](./chrome-extensions/FlowStudioPro/README.md)

### 2. 图像生成技能 (`nanobanana-image-gen`)
- **环境要求**: Python 3.10+, `google-genai`, `pillow`
- **环境变量**: `GEMINI_API_KEY`
- **示例命令**:
  ```bash
  python skills/nanobanana-image-gen/scripts/generate.py "一只戴着护目镜在丛林探险的小松鼠，吉卜力动画风格" -o squirrel.png
  ```

### 3. 微软语音合成 (`edge-tts`)
- **环境要求**: Python 3.8+, `edge-tts`
- **特点**: 免配置 API Key，开箱即用
- **示例命令**:
  ```bash
  python skills/edge-tts/scripts/edge_tts_runner.py --text "你好，这是微软神经网络语音合成示范！" --voice zh-CN-YunxiNeural -o greeting.mp3
  ```

### 4. 生物科普素材生成器 (`bio-asset-generator`)
- **规范与资源**:
  - `references/species-data-schema.md`: 物种结构化 JSON 规范
  - `references/prompt-templates.md`: 5 阶段分级提示词模板
  - `references/consistency-lock.md`: 角色与艺术风格锁定指南
  - `resources/anatomy-database.md`: 昆虫/动物解剖对照库

### 5. 网站导览视频制作 (`site-walkthrough-video`)
- **环境要求**: Node.js (hyperframes), Python 3.10+ (numpy, Pillow), ffmpeg, edge-tts
- **核心能力**: 7 步工作流（捕获→设计→分镜→语音→构建→渲染→验证），标准导航交互模式（下滚→上滚居中→光标→点击涟漪），多段截图精确拼接
- **可复用模板**: `templates/nav-segment.html`（导航段）、`templates/detail-segment.html`（详情段）
- **工具脚本**: `scripts/stitch_fullpage.py`（numpy 行匹配拼接）、`scripts/generate_vo.py`（edge-tts 封装）
- **文档**: 详见 [`skills/site-walkthrough-video/SKILL.md`](./skills/site-walkthrough-video/SKILL.md)

### 6. 微信支付 Native 扫码接入 (`wechat-pay`)
- **特点**: 零 npm 依赖，纯 Web Crypto API 实现 RSA-SHA256 签名与 AES-256-GCM 解密，完美适配 Cloudflare Workers
- **文档**: 详见 [`skills/wechat-pay/SKILL.md`](./skills/wechat-pay/SKILL.md)

---

## 📂 仓库目录结构

```text
fantasy-things/
├── .gitignore                         # 统一 Git 忽略规则
├── README.md                          # 仓库综合使用指引
├── chrome-extensions/                 # 浏览器扩展集合目录
│   └── FlowStudioPro/                 # Google Flow 自动化批量创作扩展（汉化 & 原图下载 & 单项目批量）
└── skills/                            # 技能集合目录
    ├── bio-asset-generator/           # 生物科普素材生成管线
    ├── edge-tts/                      # 微软高保真 Edge TTS
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
