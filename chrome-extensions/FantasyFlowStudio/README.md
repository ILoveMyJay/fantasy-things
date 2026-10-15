# FantasyFlowStudio ✨
> **专为 Google Flow (flow.google.com) 打造的下一代电影级 AI 制片工作台**  
> 剧本分镜切分 · 角色一致性双锚点绑定 · 批量生图闭环渲染 · 一键图生视频流水线

---

## 🌟 核心价值与功能亮点

1. **专注极致的批量生产力**：
   - **批量生图闭环**：输入剧本或多行提示词，全自动逐张提交至 Google Flow 画板，实时轮询渲染完成并自动下载归档。
   - **一键生视频 (Veo)**：分镜图片渲染完成后，直接一键将分镜图作为首帧 (Start Frame)，附加电影级运镜动力学提示词，批量渲染生成高清视频片段。
2. **双锚点角色一致性体系 (Dual-Anchor Consistency)**：
   - **视觉锚点**：一键生成 4 面定妆转视图（前/侧/3/4/背），通过 Flow 素材选择器挂载为参考底图。
   - **语义锚点**：自动提炼主角 (MCR) 与配角 (SC1~SC3) 的核心视觉 DNA（服装纹理、发型发色、标志性道具），注入分镜提示词。
3. **彻底解决 Flow 角色重命名痛点**：
   - 解决 Google Flow 默认「未命名的角色」无法自动正名的问题，内置原生属性穿透与磁贴菜单重命名，一键将角色正名为「艾伦」。
4. **双重注入防超时架构**：
   - 采用 MAIN World (Slate Fiber 树级注入) 与 ISOLATED World (原生 DOM 事件回退) 双重降级，确保 100% 注入成功，彻底告别「提示词注入超时」与「韩语残留报错」。

---

## 📂 项目结构

```text
FantasyFlowStudio/
├── manifest.json              # Chrome Manifest V3 配置
├── background/
│   └── service-worker.js      # 侧边栏唤起、动态注入自愈、自动下载归档
├── core/
│   ├── selectors.js           # Google Flow 多语言 (中/英/韩) DOM 选择器
│   ├── bridge.js              # MAIN World：Slate.js Fiber 树与富文本底层桥接
│   ├── automation.js          # ISOLATED World：DOM 操作、输入降级、角色命名与弹窗
│   └── flow-pipeline.js       # 批量生图与一键生视频核心调度流水线
├── sidepanel/
│   ├── sidepanel.html         # 电影级暗色制片厂 UI (4步向导 + 自由生图 + 设置)
│   ├── sidepanel.css          # 毛玻璃视觉、流体响应式、设计变量
│   ├── storage.js             # chrome.storage.local 持久化与断点管理
│   ├── gemini.js              # Gemini 剧本解析、角色提炼、分镜切分与 Veo 运镜生成
│   └── app.js                 # 状态机控制器、交互事件与实时画廊
└── icons/                     # 16px / 48px / 128px 高清标准图标
```

---

## 🚀 安装与使用指南

### 第一步：在 Chrome 中加载扩展
1. 打开 Chrome 浏览器，访问 `chrome://extensions/`。
2. 在右上角开启 **「开发者模式 (Developer mode)」**。
3. 点击左上角 **「加载已解压的扩展程序 (Load unpacked)」**。
4. 选择目录：`E:\aicode\antigravity\fantasy-things\chrome-extensions\FantasyFlowStudio`。

### 第二步：配置 AI 模型 (支持第三方 OpenAI 协议与 Gemini)
1. 点击浏览器右上角扩展栏中的 **FantasyFlowStudio** 图标（或点击侧边栏图标）。
2. 在打开的侧边栏中切换到 **「⚙️ 设置」** 选项卡。
3. 选择您常用的提供商或快速预设：
   - **DeepSeek 官方**：预设 `https://api.deepseek.com/v1`，模型 `deepseek-chat`（极快且极具性价比，推荐）
   - **硅基流动 (SiliconFlow)**：预设 `https://api.siliconflow.cn/v1`，模型 `deepseek-ai/DeepSeek-V3`
   - **OpenAI 官方**：预设 `https://api.openai.com/v1`，模型 `gpt-4o`
   - **Google Gemini 官方**：支持最新推荐的 `gemini-3.8-flash`（已废弃旧版 `gemini-2.5-flash`）
   - **OpenRouter / 本地 Ollama / 任意自建 API 代理**
4. 输入对应的 API Key，点击 **「⚡ 测试模型连接」** 确认连通无误后，点击 **保存设置**。

### 第三步：全流程电影制作体验
1. 在浏览器中打开并进入任一 **[Google Flow](https://flow.google.com)** 项目画板。
2. **步骤 1：剧本与角色**：
   - 粘贴故事剧本（或点击「加载示例：新东京侦探艾伦」）。
   - 点击 **「✨ AI 解析角色视觉 DNA」**，AI 将提炼出主角及关键配角视觉描述。
   - 点击 **「⚡ 一键全自动建库：渲染定妆图 + 随机间隔更名」**，插件将**全自动**逐个提交角色定妆图，并在模拟真人的随机延时后自动完成 Flow 角色改名正名！
   - 点击 **「下一步：编排分镜头清单 ➔」**。
3. **步骤 2：编排分镜清单**：
   - 选择期望镜头数（例如 4 镜头），点击 **「🎬 自动切分电影分镜」**。
   - AI 将生成每个分镜的中文景别动作描述、Google Flow 生图英文提示词以及 Veo 运镜动力学提示词。
   - 点击 **「下一步：前往批量生图闭环」**。
4. **步骤 3：批量生图闭环**：
   - 点击 **「🚀 开始批量生图」**。
   - 插件将自动轮询提交每一个分镜，画廊中将实时展示渲染好的图片，并自动下载保存。
   - 全部完成后，出现醒目的 **【进入一键生视频流水线 ➔】** 按钮。
5. **步骤 4：一键图生视频 (Veo)**：
   - 点击 **「🎥 开始批量图生视频渲染」**。
   - 插件将分镜图作为首帧挂载，并注入专属运镜描述，全自动渲染并下载完整的电影分镜视频片段！
