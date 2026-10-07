# Flow Studio Pro (NextGen v2.1.0) — 项目状态与全景上下文交接文档

> 本文档由 Antigravity 自动维护，用于跨工作区与跨对话无缝转移上下文。在当前项目发起新对话时，Agent 读取本文档即可 100% 继承上一轮对话的全部认知与工作成果。

---

## 1. 项目定位与核心演进
- **项目定位**：基于 Chrome MV3 扩展的 Google Flow (`flow.google.com`) 电影级 AI 制片工作站。
- **最新版本**：**v2.1.0 (NextGen)**
- **核心升级维度**：
  从早期单纯的“提示词批量提交点击器”全面跃迁为“深度融合 Google Flow 原生资产体系（Characters / Scenes / Ingredients）与 Veo 3.1 工业化制片流程”的一体化影视工作室。

---

## 2. 核心技术改造与新特性清单 (v2.1.0)

### ① 双锚点一致性控制台：CCR (角色) + SCR (场景)
- **通用资产管理中枢**：新增 `sidepanel/asset-manager.js`，彻底合并了旧版本重复率极高的角色引用脚本，移除了冗余孤立的 `custom-char-refs-p2i.js`。
- **CCR 6 槽角色控制台**：支持 1 个 MCR 主角槽 + 5 个 SC1~SC5 配角槽（图片、提示词、个性化名称标签如 `@Hero`）。
- **SCR 4 槽场景控制台**：全新引入 4 个核心场景槽位（SCN1~SCN4），锁定关键环境的空间构景、材质色调与全局光影。
- **资产包导出与导入**：支持将角色与场景资产一键导出为标准 JSON 资产包（`FlowStudio_Assets_*.json`），随时跨项目复用。

### ② 深度对齐 Google Flow 原生 `@mention` 体系
- 升级 `core/gemini.js`：在 AI 智能拆解剧本或输出分镜时，不再把代号替换为笼统的 "The main character"，而是规范输出带有 `@` 前缀的资产标签（如 `@Hero`、`@CyberBar` 或 `@MCR`、`@SCN1`）。
- 保证生成的 Prompt 能够直接激活 Google Flow 画板底层的原生注意力特征绑定通道，极大提升了多镜头之间的面部与场景一致性。

### ③ 生产力神器：Markdown 表格与 CSV 分镜一键智能导入
- 新增 `core/table-importer.js`：原生解析来自 Notion、飞书、ChatGPT、Excel 的分镜表格。
- 智能表头匹配：自动识别【镜头号、角色、场景、景别、提示词/画面描述、运镜】，并按 Google Flow 最佳实践（`@角色, @场景, 景别, 动作画面, Camera 运镜`）自动重构为专业 Prompt。
- 在剧本输入区顶部集成「📊 导入表格」交互模态框，解析完成后自动流转至步骤二（镜头编排）。

### ④ 安全加固与死代码彻底清退
- 全面清退不安全的 `innerHTML` 拼接隐患，引入 `escapeHtml` 转义。
- 彻底剔除原作者遗留的 Google Apps Script 激活码网络请求（`AKfycbyBR...`）与已失效的 LemonSqueezy 逻辑，所有 Pro 权限在本地干净常驻生效。

---

## 3. Chrome 扩展安装与加载路径
- **扩展所在目录**：当前根目录（即包含 `manifest.json` 的目录）
- **加载步骤**：
  1. 打开 Chrome 访问 `chrome://extensions/`；
  2. 打开右上角「开发者模式」；
  3. 点击「加载已解压的扩展程序」，选中本扩展目录；
  4. 打开 `flow.google.com` 即可启动侧边栏制片工作站。

---

## 4. 源码结构索引
- `manifest.json`：MV3 清单配置 (v2.1.0)
- `background/background.js`：Service Worker (CDP 鼠标轨迹模拟、真实点击、下载流控)
- `core/page-bridge.js`：MAIN world 桥接，直接与 Slate/ProseMirror 编辑器上下文通信
- `core/flow-automation.js`：DOM 自动化与提交重试核心
- `core/table-importer.js`：Markdown / CSV 表格解析与提示词组装器
- `core/gemini.js`：AI 分镜大脑引擎与 @mention 标签生成器
- `core/music-prompts.js`：9 种音乐流派视觉风格模板
- `sidepanel/asset-manager.js`：CCR 角色与 SCR 场景统一资产管理器
- `sidepanel/sidepanel.html`：工作台主 UI 结构（三大模式 + 三阶段步进器 + 双锚点控制台 + 表格导入模态框）
- `sidepanel/sidepanel.js`：侧边栏控制器业务逻辑与事件编排
- `sidepanel/sidepanel.css`：现代化影视工作台 Glassmorphism 样式与明暗主题
