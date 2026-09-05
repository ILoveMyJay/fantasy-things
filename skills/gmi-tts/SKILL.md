---
name: gmi-tts
version: "1.0.0"
description: 调用 GMI Cloud 平台 minimax-tts-speech-2.8-hd 模型把文字转成语音。当用户说"用 GMI 读这段文字"、"TTS 转一下"、"语音合成"、"把这段话转成音频"、"用 XX 音色读"、"Zero-shot 声音克隆"等意图时使用。每次都需用户显式触发，绝不自动跑。所需 API Key 从环境变量 GMI_API_KEY 读取，不在对话中索要。
license: MIT
agent_created: true
metadata:
  author: stillfantasy / 小W
display_name: "GMI TTS"
display_name_en: "GMI TTS"
description_zh: "调 GMI Cloud minimax-tts-speech-2.8-hd 把文字转语音,支持 13 种情绪、5 种声效、Zero-shot 声音克隆,音频落到 D:\\ai-outputs\\audio\\。"
description_en: "Text-to-speech via GMI Cloud minimax-tts-speech-2.8-hd. 13 emotions, 5 sound effects, zero-shot voice cloning. Audio lands in D:\\ai-outputs\\audio\\."
visibility: "public"
---

# GMI TTS — minimax-tts-speech-2.8-hd

把文字转语音,落盘到本地 + 返回 storage URL。

## 安全边界

- API Key 只从环境变量 `GMI_API_KEY` 读取,**绝不**向用户索要明文 Key、cookie 或登录信息。
- 唯一 base URL: `https://console.gmicloud.ai`。不向其它域名发请求。
- 默认输出目录 `D:\ai-outputs\audio\`,**只写**这个目录,绝不写到 C 盘、Desktop、Downloads、Documents。
- 每次调用前**必须**让用户**显式确认**触发(给一段文字,或者明确说"开始合成")。不主动扫上下文里的文本悄悄跑。
- 单次 `text` 字段上限 5000 字符,超出时**先问**用户怎么截断,不擅自切。

## 核心工作流

1. 确认 `GMI_API_KEY` 环境变量存在,缺失时引导用户去 GMI Cloud 控制台重新签发。
2. 解析用户给出的文字和参数(情绪/音色/速度/声效等);缺省按文档默认填。
3. 调 `POST /api/v1/ie/requestqueue/apikey/requests` 提交任务,拿到 `request_id`。
4. 轮询 `GET /api/v1/ie/requestqueue/apikey/requests/{request_id}`,默认 2 秒一次,最多 90 秒。
5. `status=success` 时下载 `outcome.media_urls[0].url` 到 `D:\ai-outputs\audio\YYYYMMDD-HHMMSS-<voice_id>.<format>`。
6. 把本地路径和 storage URL 一起回给用户。

## 默认参数(全部对齐官方文档)

| 字段 | 默认 | 备注 |
|---|---|---|
| voice_id | `English_expressive_narrator` | 用户可指定其它 voice_id;支持 Zero-shot 克隆(后续扩展) |
| speed | 1 | 0.5–2, step 0.1 |
| vol | 1 | 0–10, step 0.1 |
| pitch | 0 | -12–12 整数 |
| emotion | `auto` | 也可指定 calm/happy/sad/angry/fearful/disgusted/surprised |
| language_boost | `auto` | |
| format | `mp3` | `mp3`/`flac` |
| audio_sample_rate | `32000` | 8000/16000/22050/24000/32000/44100 |
| bitrate | `128000` | mp3 专用: 32000/64000/128000/256000 |
| channel | `2` | 1=mono 2=stereo |
| vm_pitch | 0 | -100–100 整数 |
| intensity | 0 | -100–100 整数 |
| timbre | 0 | -100–100 整数 |
| sound_effects | `""` | `""`/`spacious_echo`/`auditorium_echo`/`lofi_telephone`/`robotic` |

## 调用方式(给主 agent 用)

```bash
# 走包装脚本(推荐)
python "$SKILL_DIR/scripts/gmi_tts.py" \
  --text "你好,这是测试语音。" \
  --voice_id "English_expressive_narrator" \
  --emotion "auto" \
  --sound_effects ""

# 或纯 Python 函数(在 skill 内部被复用)
from gmi_tts import synthesize
result = synthesize(text="...", voice_id="...", emotion="auto")
# result = {"local_path": "D:\\...", "url": "https://storage.googleapis.com/...",
#           "duration_ms": ..., "request_id": "..."}
```

## 错误处理

| 现象 | 处理 |
|---|---|
| 401/403 | Key 失效,提醒用户去 GMI Cloud 控制台重新签发,**不要重试** |
| 429 | 限流,5s/15s/30s 退避重试 3 次 |
| `status=failed` | 把 `outcome` 完整 dump 给用户,问要不要换音色/缩短文本重试 |
| 轮询超时(>90s) | 给用户 `request_id`,提示稍后用 `gmi_tts.py --poll <request_id>` 续查 |
| 网络错误 | 默认重试 2 次,再失败就停 |

完整 API 文档参考 [references/api.md](references/api.md)。

## 价格提示

按音频长度计费,**$0.10 per 1k 字符**。每次提交前给用户一句"这次大约消耗 X 元"的估算。
