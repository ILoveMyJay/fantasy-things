---
name: douyin-video-scraper
description: >-
  抖音博主视频内容采集与结构化成文工具链。当用户需要批量采集某个抖音博主的视频、拿到完整逐字稿、
  提取画面里的公式/表格/程序输出等关键信息、整理成一篇篇可入库知识库的文章时使用。
  覆盖「抖音号 → sec_uid → 作品列表 → 下载视频 → 批量 ASR → 关键画面 → 结构化文章 → 入库 ima」全链路。
  触发词：采集抖音博主、抖音视频逐字稿、抖音内容整理、抖音视频转文章、抓取抖音作品列表、
  douyin scraper、抖音选题素材。核心原则是不逆向签名，用真实 Chrome 拦截页面自身的接口响应。
---

# 抖音视频采集与结构化成文

把任意抖音博主的全部视频，变成「逐字稿 + 关键画面文字还原 + 结构化文章」，可直接入库 ima 知识库做选题素材。

## 一、先读铁律（决定这条路能不能走通）

**核心原则：不要逆向抖音签名（`a_bogus` / `X-Bogus` / `verifyFp`）。让真实 Chrome 自己发合法请求，你只负责拦截响应。**

抖音 Web 端所有数据接口都带动态签名和风控。直接 `curl` / `fetch` / WebFetch 一律失败（网络错误、403、空响应）。但当主页在真实 Chrome 里正常打开时，页面会带着合法签名请求作品列表接口——在旁边监听网络响应就能拿到干净的结构化 JSON。

**必须具备 4 项能力，缺一不可：**

| 能力 | 用途 | 没有会怎样 |
|---|---|---|
| 浏览器自动化（Playwright + 真 Chrome） | 打开主页、拦截接口响应 | 拿不到作品列表，只能看到标题 |
| Shell + ffmpeg | 下载 mp4、抽 mp3、抽帧 | 拿不到音频和画面 |
| ASR 转写（内置工具 / Whisper / 云 API） | 音频转文字 | 只有平台摘要，没有逐字稿 |
| 图像理解（vision） | 读关键帧里的公式、表格 | 画面信息全部丢失 |

> 如果目标 agent 只有「联网搜索 + 网页抓取」，**做不到**。豆包那种「给分享页就能出全文」更可能依赖字节内部内容通路，不是普通网页抓取能复现的（实测分享页是空壳）。

## 二、路由：先确定要走哪一步

| 任务 | 读这些文件 |
|---|---|
| 首次跑通一条短视频链路 | `references/pipeline.md` |
| 批量采集 + 转写 + 成文 | `references/pipeline.md` + `references/article-template.md` |
| 遇到报错、下载到 0KB、转写解析不出内容 | `references/pitfalls.md` |
| ASR 专有名词错了要校正 | `references/asr-corrections.md` |
| 要按周合并短评 / 设计成文粒度 | `references/article-template.md` |

**不要一次读完所有 reference**，按任务取用。

## 三、五步链路总览

```text
抖音号
  → ① resolve_user.js        拿 sec_uid
  → ② fetch_posts.js         拦截接口，抓全部作品列表 → posts.json
  → ③ download_media.js      抓到即下载 mp4 + 抽 mp3 + 抽帧 → manifest.json + all/
  → ④ make_groups.py + ASR   拼接音频批量转写 → split_transcript.py 切回逐字稿
  → ⑤ 关键画面 + 成文         关键词定位密抽帧 + vision 读图 → Markdown 文章
  → ⑥ cleanup.py             入库后删除本地音视频，释放空间
```

### Step 1 · 抖音号 → sec_uid

```bash
node scripts/resolve_user.js <抖音号>
# 例：node scripts/resolve_user.js Bruce_Gold
# 输出 sec_uid，用于拼 https://www.douyin.com/user/<sec_uid>
```

### Step 2 · 抓作品列表（最关键）

```bash
npm install playwright-core   # 首次
node scripts/fetch_posts.js <sec_uid> [输出文件]
# 例：node scripts/fetch_posts.js MS4wLjABAAAA... posts.json
```

用持久化 Chrome 上下文（`channel: 'chrome'`），监听 `/aweme/v1/web/aweme/post/` 响应，滚动到底加载全部，按 `aweme_id` 去重。**增量更新**：把新抓的 `aweme_id` 和已有清单对比，只处理新增的。

### Step 3 · 下载 + 抽音频（直链签名有时效）

```bash
node scripts/download_media.js <sec_uid> posts.json [输出目录]
```

**必须抓到就立刻下载**，不能先存 URL 以后再下（会过期，下载到 0KB / ffmpeg 报 `Invalid data found`）。

```bash
ffmpeg -y -i video.mp4 -vn -ac 1 -ar 16000 video.mp3   # ASR 标准输入
```

### Step 4 · 批量转写 + 切分

```bash
python scripts/make_groups.py manifest.json           # 拼接成组，每组 ≤55 分钟 → groups.json
# 对每组 gN.mp3 调用 agent 的 ASR 工具，把带时间戳的转写结果存文件
python scripts/split_transcript.py groups.json <转写结果文件> 组号 [manifest.json]
```

批量技巧：不要一条一条调 ASR。多条 mp3 拼成大文件一次转写，再按时间偏移切回去。切分时用正则匹配 `[0:11.250,0:16.425,0] 文字`。

### Step 5 · 关键画面 + 成文

均匀抽帧效果很差（全是人脸/硬字幕）。有效做法是**关键词驱动**：从逐字稿找 `公式/算法/计算/这张表/读数/TRIN/基差` 等词 → 在命中时间点前后密抽（约每 1.5 秒一帧）→ 用 vision 把表格/公式**转成 Markdown 文字**，截图只作证据留存。成文结构见 `references/article-template.md`。

### Step 6 · 清理

```bash
python scripts/cleanup.py [工作目录]   # 入库后删 mp4/mp3/jpg，默认先 dry-run
python scripts/cleanup.py [工作目录] --apply   # 确认后真正删除
```

## 四、走不通的路（别重复踩）

| 尝试 | 结果 |
|---|---|
| WebFetch 直接抓 douyin.com | 网络错误 / 服务器出小差 |
| `iesdouyin.com/share/video/<id>` 分享页 | HTTP 200 但是空壳，无字幕无文字 |
| `/web/api/v2/aweme/iteminfo/` | 空响应 |
| `/aweme/detail/` | 403 `Blocked by ArgusSecurityPlugin Uifid Not Found` |
| 抖音搜索页 | 登录弹窗「登录即可搜索更多」 |
| 先存视频 URL、之后统一下载 | 签名过期，下载到 0KB |

## 五、脚本速查

| 脚本 | 用途 |
|---|---|
| `scripts/resolve_user.js` | 抖音号 → sec_uid（走 iesdouyin 公开接口） |
| `scripts/fetch_posts.js` | Playwright 拦接口抓作品列表，按 id 去重 |
| `scripts/download_media.js` | 抓到即下载 mp4 + 抽 mp3 + 抽关键帧，写 manifest |
| `scripts/make_groups.py` | 拼接音频分组，生成时间偏移表 |
| `scripts/split_transcript.py` | 按偏移把批量转写切回单条逐字稿（兼容双层 JSON） |
| `scripts/cleanup.py` | 入库后清理本地媒体，默认 dry-run |

## 六、合规提醒

- 只采集**公开可见**内容，不绕过登录墙、付费墙或权限校验；
- 控制请求频率（滚动间隔 2 秒以上），不对平台造成压力；
- 用于个人选题研究和二次创作，逐字稿引用时标明来源；
- 涉及对同行的点名批评，对外发布时改中性表述，规避名誉风险。

## 七、资源索引

| 文件 | 内容 |
|---|---|
| `references/pipeline.md` | 五步链路逐条说明、字段表、批量转写与切分细节 |
| `references/pitfalls.md` | 实测踩坑全记录：直链过期、双层 JSON、0 秒视频、风控 |
| `references/asr-corrections.md` | 专有名词错词校正表（阿姆氏/TRIN/Anthropic 等） |
| `references/article-template.md` | 长文独立 + 短评按周合并的成文结构与选题建议模板 |
