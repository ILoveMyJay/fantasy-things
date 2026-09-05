# GMI TTS — API 完整参考

源文档来自 GMI Cloud 控制台 minimax-tts-speech-2.8-hd 页面。本文件供 skill 内部查阅,不直接展示给用户。

## 端点

| 操作 | Method | Path |
|---|---|---|
| 提交合成任务 | POST | `/api/v1/ie/requestqueue/apikey/requests` |
| 查询任务状态 | GET | `/api/v1/ie/requestqueue/apikey/requests/{request_id}` |
| 列任务 | GET | `/api/v1/ie/requestqueue/apikey/requests?model_id=minimax-tts-speech-2.8-hd` |
| 模型信息 | GET | `/api/v1/ie/requestqueue/apikey/models/minimax-tts-speech-2.8-hd` |
| 列模型 | GET | `/api/v1/apikey/models` |

Base URL: `https://console.gmicloud.ai`

## 鉴权

所有请求携带 header:
```
Authorization: Bearer $GMI_API_KEY
```

## 提交示例

```json
{
  "model": "minimax-tts-speech-2.8-hd",
  "payload": {
    "text": "Let's convert text to speech.",
    "voice_id": "English_expressive_narrator",
    "speed": "1",
    "vol": "1",
    "pitch": "0",
    "emotion": "auto",
    "language_boost": "auto",
    "format": "mp3",
    "audio_sample_rate": "32000",
    "bitrate": "128000",
    "channel": "2",
    "vm_pitch": 0,
    "intensity": 0,
    "timbre": 0,
    "sound_effects": "spacious_echo"
  }
}
```

## 状态值

`queued` / `processing` / `success` / `failed` / `cancelled`

## 成功响应(查询)

```json
{
  "request_id": "...",
  "model": "minimax-tts-speech-2.8-hd",
  "status": "success",
  "outcome": {
    "media_urls": [{"id": "0", "url": "https://storage.googleapis.com/...mp3"}],
    "voice_id": ""
  }
}
```

## 注意

- 文档里有个 typo: `Minimax` 应为 `MiniMax`,skill 内部统一用 `minimax-tts-speech-2.8-hd` 作 model id。
- 部分 curl 示例里的 base URL 写成了 `https://api.example.com`,这是占位符,**实际必须用** `https://console.gmicloud.ai`。
- Pricing: **$0.10 / 1k 字符**(音频长度计费,但官方文档按字符估算)。
