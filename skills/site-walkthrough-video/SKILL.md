---
name: site-walkthrough-video
description: >-
  制作网站用户旅程导览视频——从首页开始模拟真实用户的滚动、点击、导航行为，最终进入目标页面展示内容。
  适用于任何网站（产品站、内容站、电商、作品集等），输出横版 1920×1080 MP4，含旁白和字幕。
  依赖 website-to-video（基础工作流）、hyperframes（渲染框架）、edge-tts（语音）、browser-use-automation（SPA 导航）。
---

# Site Walkthrough Video — 网站用户旅程导览视频

将一个网站的"用户操作旅程"制作成视频：首页 → 滚动浏览 → 点击进入分类 → 再滚动 → 点击进入详情 → 展示内容。
视频中包含模拟鼠标光标、滚动动画、点击涟漪，以及目标页面的动态内容展示。

## 何时使用

- 用户说"帮我给这个网站做个导览视频/展示视频"
- 需要展示"从首页一步步点进去"的操作流程
- 网站是 SPA（React/Vue 等），直接截图拿不到子路由内容
- 需要模拟真实用户的滚动和点击行为

## 不适用

- 纯产品发布视频（无用户操作旅程）→ 用 `website-to-video`
- 纯动态图形/Logo 动画 → 用 `hyperframes` 的 motion-graphics 工作流
- 已有录屏素材需要剪辑 → 用 `byted-mediakit-editing`

## 依赖 Skills（必须先加载）

| Skill | 用途 |
|-------|------|
| `website-to-video` | 7 步基础工作流（捕获→设计→分镜→语音→构建→验证） |
| `hyperframes` | HTML/CSS/GSAP 合成视频渲染框架 |
| `edge-tts` | 本地语音合成（零成本，微软 Edge 神经网络） |
| `browser-use-automation` | 浏览器自动化，导航 SPA、截取页面 |

## 工作流总览（7 步）

```
① 捕获  →  ② 设计  →  ③ 分镜  →  ④ 语音  →  ⑤ 构建  →  ⑥ 渲染  →  ⑦ 验证
  │          │          │          │          │          │          │
  browser-   提取品牌   导航段+    edge-tts   模板改     两段渲染   lint+抽帧
  use 导航   色/字体    详情段     生成旁白   HTML/GSAP  ffmpeg     ffprobe
  截图拼接              标准镜头                         拼接
```

### ① 捕获（references/01-capture.md）
- 用 browser-use 实际导航 SPA，点击到目标页面，获取正确 URL 和内容
- 下载页面中的高清图片素材
- 对需要滚动展示的页面，分段截图 + `scripts/stitch_fullpage.py` 精确拼接为完整长图

### ② 设计（references/02-design.md）
- 从网站提取品牌色（主色/辅助色/背景色）、字体、组件风格
- 记录到 DESIGN.md，供构建阶段使用

### ③ 分镜（references/03-storyboard.md）
- **导航段**：标准交互模式——页面加载 → 向下滚动浏览 → 向上滚动将目标卡片居中 → 光标移入 → 点击涟漪 → 页面切换
- **详情段**：从标准镜头库选择（登场→图鉴/要点→深潜→轮播→CTA）
- 规划每段时长，导航段通常 10-20s，详情段通常 25-40s

### ④ 语音（references/04-vo.md）
- 用 `scripts/generate_vo.py` 生成旁白（默认 zh-CN-XiaoxiaoNeural）
- 文案精简到目标时长（中文约 4-5 字/秒）
- ffmpeg 转 44100Hz 单声道 wav

### ⑤ 构建（references/05-build-nav.md + 06-build-detail.md）
- 基于 `templates/nav-segment.html` 修改导航段
- 基于 `templates/detail-segment.html` 修改详情段
- 遵循 `references/07-hyperframes-rules.md` 的构建规则和避坑清单
- `npx hyperframes lint` 必须 0 错误

### ⑥ 渲染与拼接（references/08-stitch.md）
- 分别渲染导航段和详情段为 mp4
- ffmpeg concat demuxer 无损拼接
- 总时长 = 导航段 + 详情段

### ⑦ 验证（references/09-validate.md）
- `npx hyperframes snapshot` 抽帧检查关键画面
- ffprobe 验证时长/分辨率/编码
- 检查滚动是否流畅（每帧位移 ≤ 14px）、拼接处是否自然

## 标准交互模式（导航段核心）

每次点击都遵循以下步骤，这是本 skill 的核心沉淀：

```
1. 页面加载（淡入）
2. 右下角出现"↓ 向下滚动浏览"提示
3. 页面匀速向下滚动（线性缓动，~430px/s，每帧 ≤14px）
4. 到达底部后停留 0.5-1s
5. 提示变为"↑ 向上滚动定位"
6. 页面向上滚动，将目标卡片移至屏幕正中央
7. 提示消失
8. 鼠标光标从屏幕角落平滑移动到卡片中心
9. 轻微 hover 调整
10. 点击涟漪（橙色扩散圆）+ 点击音效
11. 页面淡出，切换到下一页
```

## 关键参数速查

| 参数 | 值 | 说明 |
|------|-----|------|
| 分辨率 | 1920×1080 | 横版 |
| 帧率 | 30fps | hyperframes 默认 |
| 滚动速度 | ≤ 430px/s | 每帧 ≤14px，超过会闪烁 |
| 滚动缓动 | `ease: "none"` | 线性，模拟真实滚轮 |
| 点击涟漪 | scale 0→8, 0.6s, power2.out | 暖橙 #F4A261 |
| 语音音色 | zh-CN-XiaoxiaoNeural | rate -4%, pitch +2Hz |
| beat 架构 | stacked-beats 单文件 | 硬切，不用子合成/Shader |
| 拼接方式 | ffmpeg concat demuxer | `-c copy` 无损 |

## 文件结构

```
site-walkthrough-video/
├── SKILL.md                  ← 本文件
├── references/               ← 9 个步骤详解文档
│   ├── 01-capture.md
│   ├── 02-design.md
│   ├── 03-storyboard.md
│   ├── 04-vo.md
│   ├── 05-build-nav.md
│   ├── 06-build-detail.md
│   ├── 07-hyperframes-rules.md
│   ├── 08-stitch.md
│   └── 09-validate.md
├── templates/                ← 可复用 HTML 模板
│   ├── nav-segment.html      ← 导航段模板（滚动+光标+点击）
│   ├── detail-segment.html   ← 详情段模板（5 镜头 stacked-beats）
│   └── concat.txt            ← ffmpeg 拼接列表示例
├── scripts/                  ← 工具脚本
│   ├── stitch_fullpage.py    ← 多段截图精确拼接（numpy 行匹配）
│   └── generate_vo.py        ← edge-tts 语音生成封装
└── assets/                   ← 静态资源
    ├── cursor.svg            ← 鼠标光标 SVG
    └── sfx-manifest.json     ← 音效清单
```

## 快速开始

1. 读取 `references/01-capture.md`，用 browser-use 导航网站并截取素材
2. 读取 `references/03-storyboard.md`，规划分镜和时长
3. 复制 `templates/nav-segment.html` 和 `templates/detail-segment.html` 到项目目录
4. 按 `references/05-build-nav.md` 和 `06-build-detail.md` 修改模板
5. 用 `scripts/generate_vo.py` 生成旁白
6. `npx hyperframes lint` → `npx hyperframes render` 渲染两段
7. 按 `references/08-stitch.md` 拼接，按 `09-validate.md` 验证
