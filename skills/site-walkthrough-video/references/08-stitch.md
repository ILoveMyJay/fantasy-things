# 08 — 多段视频拼接

导航段和详情段分别渲染为 mp4 后，用 ffmpeg concat demuxer 无损拼接。

## 拼接步骤

### 1. 创建 concat 列表文件

```txt
# concat.txt
file 'nav-segment.mp4'
file 'detail-segment.mp4'
```

路径相对于 concat.txt 所在目录，或用绝对路径。

### 2. 执行拼接

```bash
ffmpeg -y -f concat -safe 0 -i concat.txt -c copy output.mp4
```

- `-c copy`：无损复制，不重新编码，速度快
- `-safe 0`：允许绝对路径

### 3. 验证输出

```bash
ffprobe -v quiet -show_entries format=duration,size \
  -show_entries stream=codec_name,width,height \
  -of default=noprint_wrappers=1 output.mp4
```

## 常见问题

### Non-monotonic DTS 警告

```
Non-monotonic DTS in output stream 0:1
```

这是 concat 拼接时的常见警告（exit code 1），**通常不影响播放**。文件已正常生成，用 ffprobe 验证时长即可。

如果音视频不同步，改用重新编码方式拼接：

```bash
ffmpeg -i nav-segment.mp4 -i detail-segment.mp4 \
  -filter_complex "[0:v][0:a][1:v][1:a]concat=n=2:v=1:a=1[v][a]" \
  -map "[v]" -map "[a]" output.mp4
```

### 两段视频参数不一致

concat demuxer 要求两段视频的编码参数一致（分辨率、帧率、编码格式）。如果不一致：

```bash
# 统一转码后再拼接
ffmpeg -i nav-segment.mp4 -s 1920x1080 -r 30 -c:v libx264 -c:a aac nav-normalized.mp4
ffmpeg -i detail-segment.mp4 -s 1920x1080 -r 30 -c:v libx264 -c:a aac detail-normalized.mp4
```

hyperframes render 默认输出 1920×1080 30fps H.264+AAC，通常一致。

### 拼接处黑帧

如果拼接处有短暂黑帧，检查前一段的最后一帧和后一段的第一帧是否都是有效画面。导航段末尾应该是推镜到目标主图，与详情段开场自然衔接。

## 多段拼接（3+ 段）

```txt
# concat.txt
file 'segment-1.mp4'
file 'segment-2.mp4'
file 'segment-3.mp4'
```

命令相同，concat demuxer 自动处理任意数量的片段。

## 提取片段验证

```bash
# 提取拼接处前后各 2 秒
ffmpeg -ss 17 -t 4 -i output.mp4 -c copy seam-check.mp4
```

用播放器检查拼接处是否流畅。
