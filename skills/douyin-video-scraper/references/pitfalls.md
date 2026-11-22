# 实测踩坑全记录

按「现象 → 原因 → 处理」记录，都是真实踩过的。

## 采集层

### WebFetch 直接抓 douyin.com 失败
- **现象**：网络错误 / 服务器出小差。
- **原因**：抖音 Web 接口带动态签名（a_bogus / X-Bogus / verifyFp）+ 风控。
- **处理**：改用 Playwright + 真 Chrome，拦截页面自身发出的接口响应。

### 分享页是空壳
- **现象**：`iesdouyin.com/share/video/<id>` HTTP 200，但没有 `videoInfoRes`、没有 desc、没有字幕。
- **原因**：豆包说的「公开分享页自带完整文字」在当前环境不可复现，更可能依赖字节内部内容通路。
- **处理**：放弃分享页，走浏览器拦截 + 自建 ASR。

### `/web/api/v2/aweme/iteminfo/` 空响应
- **处理**：放弃该接口。

### `/aweme/detail/` 403 风控
- **现象**：`Blocked by ArgusSecurityPlugin Uifid Not Found`。
- **处理**：改用浏览器页面自然请求 `/aweme/v1/web/aweme/post/`。

### 搜索页登录墙
- **现象**：「登录即可搜索更多精彩视频」。
- **处理**：不依赖搜索页，用 sec_uid 直接访问用户主页。首屏有登录墙时 `--headful` 手动登录一次。

### 视频直链过期（最常踩）
- **现象**：先存 URL 再下载，得到 0KB 文件；ffmpeg 报 `Error opening input: Invalid data found when processing input`。
- **原因**：`play_addr.url_list[0]` 签名有时效。
- **处理**：拦截到列表后当场立刻下载（`download_media.js` 的设计），不要存 URL 以后再下。

## 转写层

### 0 秒异常视频
- **现象**：某条视频 duration=0，下载/抽帧失败，ffmpeg 报 `Output file does not contain any stream`。
- **处理**：`make_groups.py` 里过滤 `dur > 2` 的条目。

### ASR 输出过大被存成文件
- **现象**：每组转写结果 50KB+，被 agent 平台持久化到 tool-results 目录，而不是直接返回。
- **处理**：读取持久化文件路径，交给 `split_transcript.py` 处理。

### 双层 JSON 转义导致解析出 0 片段
- **现象**：`split_transcript.py` 初次解析出 0 个片段。
- **原因**：结果文件头部是 `{"content":"{\"type\":\"audio_transcribe_tool_result\", ... }"}`，外层 content 里套内层 JSON 字符串。
- **处理**：`load()` 连续 `json.loads` 两次。

### groups.json 覆盖数误判
- **现象**：打印脚本只显示了部分字段，误以为只覆盖 16 条，实际是 54 条。
- **处理**：核对时打印每个 group 的 items 明细，别只看汇总数字。

### 增量脚本 known 集合不全
- **现象**：第二轮增量把上一轮的 9 条又当成新视频重复下载。
- **原因**：known 只读了首批 manifest，没合并第一轮增量。
- **处理**：known 集合 = **所有历史批次** id 的并集，输出用新的 manifest 文件名避免覆盖。

## 本地 whisper 路线受阻
- **环境**：RTX 2060 4GB、Python 3.14。
- **判断**：`ctranslate2` / `torch` 对 Python 3.14 支持不完整。
- **处理**：优先用 agent 内置 ASR 工具，不绑定本地模型。

## 画面层

### 均匀抽帧全是人脸/硬字幕
- **处理**：关键词驱动密抽（见 pipeline Step 5），从逐字稿定位时间点，别按固定间隔抽。

## 清理层

### 内联 Python 反斜杠转义报错
- **现象**：shell 内联 `dp.replace('\','/')` 报 `SyntaxError: unterminated string literal`。
- **处理**：写成 .py 脚本文件再执行，别用 shell 内联长 Python。

### 扫描数与实际删除数不一致
- **现象**：扫描到 338 个媒体文件 / 3.55 GB，实际删除 238 个 / 2.02 GB。
- **原因**：删除规则排除了 node_modules，且两轮统计口径不同。
- **处理**：删除后重新扫描一次确认残留为 0，以二次扫描为准。
