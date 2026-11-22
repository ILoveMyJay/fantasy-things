# 五步链路逐条说明

## Step 1 · 抖音号 → sec_uid

```
https://www.iesdouyin.com/web/api/v2/user/info/?unique_id=<抖音号>
```

返回 JSON 的 `sec_uid` 就是用户主页 ID，用来拼 `https://www.douyin.com/user/<sec_uid>`。

实测样例：
- `jianghushuo` → `MS4wLjABAAAAxaSHyjKQyfWHKjIS1mYbpxxEQZpT8ogl_eyks2M_Twc`
- `Bruce_Gold` → `MS4wLjABAAAAHwe0CgM38CCjWMNxHSvkydtX5zlrG38YoPTtrvkX7bRzlN2xJje0cqecaY-1jSay`

## Step 2 · 抓作品列表（最关键）

用持久化 Chrome 上下文（`channel: 'chrome'`），监听页面自身的 `/aweme/v1/web/aweme/post/` 请求，把 `aweme_list` 里的每条按 `aweme_id` 收进 Map 去重。滚动到底直到连续几次无新增。

遇到首屏登录墙：加 `--headful` 手动登录一次，登录态存进 `.udd`，之后可无头运行。

从每条 `aweme` 里能拿到：

| 字段 | 含义 |
|---|---|
| `aweme_id` | 视频 ID，拼 `https://www.douyin.com/video/<id>` |
| `desc` / `item_title` | 发布文案 / 平台生成的标签标题 |
| `create_time` | 发布时间戳（秒） |
| `duration` | 时长（毫秒） |
| `statistics` | 赞、藏、评论数 |
| `chapter_abstract` | 平台自带 AI 摘要（**不是逐字稿**） |
| `chapter_list` | 平台自带章节 + 时间戳 |
| `video.play_addr.url_list[0]` | 带签名的 mp4 直链（**会过期**） |

> 平台 AI 摘要 vs 完整逐字稿：`chapter_abstract` / `chapter_list` 是抖音平台自带摘要/章节，不是完整口播。对某些博主 `desc` 本身较长接近口播稿，但多数财经/知识博主 `desc` 只是标签，真正内容必须靠自建 ASR。

**增量更新**：把新抓的 `aweme_id` 和已有 manifest 的 id 集合对比，只处理新增。注意把**所有历史批次**的 id 都并进去做 known 集合，否则会把上一轮增量误判为新的。

## Step 3 · 下载 + 抽音频

**直链签名有时效，必须抓到就立刻下载。** 不能先存 URL 以后再下（踩过坑：下载到 0KB / ffmpeg 报 `Invalid data found when processing input`）。所以 `download_media.js` 把「拦截列表」和「下载」放在同一流程，列表拿到后立即逐条下载。

抽音频用 16kHz 单声道（ASR 标准输入）：
```bash
ffmpeg -y -i video.mp4 -vn -ac 1 -ar 16000 video.mp3
```

每条即时写回 manifest.json，防止中途中断丢数据。0 秒 / 异常时长的视频会下载失败，在后续 make_groups 里过滤掉。

## Step 4 · 批量转写 + 切分

**批量而非逐条**：`make_groups.py` 把多条 mp3 拼接成若干组（默认每组 ≤55 分钟），一次 ASR 转写，再按时间偏移切回。

```bash
python scripts/make_groups.py manifest.json           # -> groups/*.mp3 + groups.json
# 对每组 gN.mp3 调 agent 的 ASR 工具，结果存文件（保留时间戳行）
python scripts/split_transcript.py asr_g1.txt 1        # -> all_txt/01_日期.txt ...
```

切分逻辑：用正则匹配 `[0:11.250,0:16.425,0] 文字` 的时间戳行，按每条视频在组内的 `start`/`end` 偏移筛选片段。

> ASR 结果可能是**双层 JSON 转义**（外层 `content` 套内层 JSON 字符串，里面有 `text`）。`split_transcript.py` 的 `load()` 会自动尝试解两次。若解析出 0 个片段，优先怀疑这个。

ASR 底层模型由所用 agent 决定（内置工具/Whisper/云 API），本 skill 不绑定具体模型。专有名词错词见 `asr-corrections.md`。

## Step 5 · 关键画面 + 成文

**均匀抽帧效果很差**——全是人脸或硬字幕。有效做法是关键词驱动：

1. 从逐字稿里找关键词：`公式 / 算法 / 计算 / 这张表 / 读数 / 宽广度 / TRIN / 基差 / 份额变化`；
2. 在命中时间点前后密抽（约每 1.5 秒一帧）：
   ```bash
   ffmpeg -y -ss <秒> -i video.mp4 -frames:v 1 -vf scale=1080:-1 -q:v 3 frame.jpg
   ```
3. 用 vision 读图，把表格/公式/命令行输出**转成 Markdown 文字**，截图只作证据留存，不入库。

实测抓到的高价值画面：自编程序输出的 `TRIN额 0.570 / TRIN量 0.693 / 涨1293跌4148`、Excel 交易记录表、份额变化柱状图、情绪指标图表。这些是纯文字稿完全没有的信息。

成文按 `article-template.md` 的结构：长视频独立成篇，短评按自然周合并成「盘前日志」。

## Step 6 · 清理

全部文章入库 ima 后，用 `cleanup.py` 删除本地 mp4/mp3/图片，只留文章、逐字稿、元数据、脚本。视频体积大（几十条可达数 GB），及时清理释放空间。默认 dry-run，确认后 `--apply`。

## ima 入库链路（可选）

若目标是把文章入库 ima 知识库：

1. `create_media` 拿 `media_id` 和预签名上传 URL；
2. `curl -X PUT` 上传 Markdown 到 COS：
   ```bash
   curl -s -X PUT "<预签名URL>" -H "Content-Type: text/markdown" --data-binary "@article.md"
   ```
3. `add_knowledge` 添加到知识库/文件夹；
4. `get_knowledge_list` 验证 `total_size`。

注意 `get_knowledge_list` 的 `limit` 上限是 50。
