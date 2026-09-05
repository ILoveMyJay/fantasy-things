---
name: edge-tts
description: >-
  基于微软 Edge 神经网络语音大模型的高保真文本转语音（TTS）。零 API Key、零费用、零限流，
  秒级生成媲美真人的高品质音频。当用户需要将文本转语音、合成朗读音频、为少儿科普/绘本/课件配音、
  或提及 Edge TTS / 微软语音合成时激活此 Skill。跨平台完美支持 Windows 10 与 Windows 11。
---

# Edge Neural TTS — 高保真文本转语音技能

## 1. 概述与核心优势

本 Skill 封装了基于微软 Edge 神经网络（Azure Neural Voice）技术的文字转语音解决方案。专为各类项目（如儿童少儿科普绘本、多语言教育、课件伴读、视频旁白）提供开箱即用、无感知成本、广播级的语音合成能力。

### 🌟 核心特性
- 🔑 **零 API Key / 零商业授权门槛**：直接使用 Microsoft Edge 云端高保真神经网络通道，无需申请云服务 Token。
- 💸 **零成本 / 无计费困扰**：无需按字符数扣费或按月订阅。
- ⚡ **零并发限流 / 极速响应**：不会出现类似第三方平台的 `503 UPSTREAM_CAPACITY_EXCEEDED` 限流或排队问题，典型短句生成耗时在 0.5 ~ 1.5 秒。
- 🎙️ **真人级生动语感**：支持真实呼吸感、句子顿挫、语调升降，远超普通离线合成引擎。
- 🖥️ **Windows 10 / Windows 11 双系统完美支持**：纯 Python WebSocket 协议直连，不依赖特定 Windows SDK，两代操作系统体验完全一致。

---

## 2. 目录结构

```text
edge-tts/
├── workbuddy.json               # Skill 规范元数据
├── SKILL.md                     # 本说明文档与工作流指引
├── scripts/
│   └── edge_tts_runner.py       # 跨平台 CLI 执行器与 Python 模块库
└── references/
    └── voices.md                # 微软精选 400+ 音色速查与调优手册
```

---

## 3. 环境准备（跨系统通用）

本技能支持所有安装了 Python 3.8 及以上版本的系统（包括 **Windows 10**、**Windows 11**、macOS、Linux）。

```bash
# 唯一依赖安装
pip install edge-tts
```

> **系统兼容性说明**：
> - **Windows 10** 与 **Windows 11** 均内置了网络 WebSocket 基础栈。
> - `edge-tts` 是基于标准 Python 异步网络库直接与微软全球 CDN 节点通信，**不需要在系统上特殊配置管理员权限，也不强制要求安装特定版本的 Edge 浏览器**。

---

## 4. 快速使用

### 4.1 命令行方式 (CLI)

```bash
# 1. 基础中文合成（默认：晓晓大姐姐音色，语速 -4%，音调 +2Hz）
python scripts/edge_tts_runner.py --text "非洲象是陆地上体型最大的哺乳动物。"

# 2. 指定输出路径与英文绘本音色 (Ana)
python scripts/edge_tts_runner.py \
  --text "The African elephant is the largest living land mammal." \
  --voice "en-US-AnaNeural" \
  --rate "-4%" \
  --pitch "+2Hz" \
  --out "D:/ai-outputs/audio/elephant_intro_en.mp3"

# 3. 从外部文本文件读取长文合成
python scripts/edge_tts_runner.py \
  --file "D:/ai-outputs/story.txt" \
  --voice "zh-CN-XiaoxiaoNeural" \
  --out "D:/ai-outputs/audio/story.mp3"

# 4. 查询可用音色列表
python scripts/edge_tts_runner.py --list-voices --locale zh-CN
```

CLI 执行成功后，标准输出将返回易于解析的 JSON 数据：
```json
{
  "status": "success",
  "voice": "zh-CN-XiaoxiaoNeural",
  "rate": "-4%",
  "pitch": "+2Hz",
  "volume": "+0%",
  "local_path": "D:\\ai-outputs\\audio\\20260904-210914-Xiaoxiao.mp3",
  "size_bytes": 19008,
  "text_length": 13
}
```

### 4.2 Python 代码调用

可以直接将 `edge_tts_runner.py` 作为模块引入到任何项目脚本中：

```python
from scripts.edge_tts_runner import synthesize, synthesize_async

# 同步调用
result = synthesize(
    text="你好呀，今天我们一起来认识大自然的奇妙生物吧！",
    voice="zh-CN-XiaoxiaoNeural",
    rate="-4%",
    pitch="+2Hz",
    out_path="output.mp3"
)
print(f"生成的音频位于: {result['local_path']}")

# 异步并发调用（支持批量秒级生成）
import asyncio

async def batch_generate():
    tasks = [
        synthesize_async("第一段文字", voice="zh-CN-XiaoxiaoNeural", out_path="1.mp3"),
        synthesize_async("第二段文字", voice="zh-CN-XiaoxiaoNeural", out_path="2.mp3"),
    ]
    results = await asyncio.gather(*tasks)
    print(f"全部完成，共生成 {len(results)} 个文件")

asyncio.run(batch_generate())
```

---

## 5. 精选音色搭配建议

完整音色库详见 [voices.md](./references/voices.md)。以下为典型场景的最佳实践：

| 场景 | 语言 | 推荐音色 | 建议参数 | 听觉感受与定位 |
|---|---|---|---|---|
| **少儿科普/双语启蒙** | 中文 | **`zh-CN-XiaoxiaoNeural`** | `rate: -4%`, `pitch: +2Hz` | 温暖故事大姐姐，语气亲切活泼、咬字清晰，少儿首选 |
| **少儿英语/磨耳朵跟读（黄金语速）** | 英文 | **`en-US-AnaNeural`** | `rate: -10%`, `pitch: +2Hz` | 甜美生动少儿绘本大姐姐，长难词清晰，字词留白适宜，少儿跟读首选 |
| **日常对话/现代英语** | 英文 | **`en-US-JennyNeural`** | `rate: +0%`, `pitch: +0Hz` | 自然纯正美音，现代流畅，适合日常交流 |
| **青少儿探险/好奇问答** | 中文 | **`zh-CN-YunxiNeural`** | `rate: +0%`, `pitch: +0Hz` | 阳光开朗少年音，充满求知欲与探索活力 |
| **严肃科普/地理纪录片** | 中文 | **`zh-CN-YunjianNeural`** | `rate: -3%`, `pitch: -2Hz` | 醇厚稳重男声，极具质感的大型自然纪录片播音腔 |

---

## 6. 开发者与批量生成最佳实践

1. **真实数据源对齐（杜绝硬编码）**：
   - 在开发双语或科普项目时，严禁手工维护文本字典。应先编写数据导出脚本（如从 TypeScript 类型文件提取 JSON），再由 TTS 批量脚本统一读取合成，杜绝因手工录入造成的英文错位或翻译疏漏。
2. **标点符号停顿优化**：
   - 适当在长句中增加中文逗号 `，` 或英文逗号 `,`，Edge 神经网络会自动插入极其自然的换气微停顿（约 200~300ms）。
3. **高并发控制**：
   - 批量合成大量音频（如 100+ 条）时，建议使用 `asyncio.Semaphore(5)` 维持 5 路并发，既能最大化网络带宽（每分钟生成数十条），又可防止本地系统连接池耗尽。
