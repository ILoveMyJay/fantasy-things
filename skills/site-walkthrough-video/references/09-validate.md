# 09 — 验证清单

渲染完成后必须通过以下验证才能交付。

## 1. Lint 检查

```bash
npx hyperframes lint project-dir/
```

必须 **0 errors, 0 warnings**。

## 2. 抽帧验证

```bash
npx hyperframes snapshot project-dir/ --frames 10
```

生成联系表（contact sheet），用 Read 打开检查：

- [ ] 每个 beat 都有内容，没有空白帧
- [ ] 文字清晰可读，没有被裁剪
- [ ] 图片正确加载，没有破图
- [ ] 滚动过程中页面内容连续，没有跳跃
- [ ] 目标卡片在点击前确实居中于屏幕
- [ ] 光标位置正确，指向点击目标
- [ ] 拼接处（导航段→详情段）自然过渡

## 3. 提取关键帧检查

```bash
# 提取底部停留时刻的帧，验证是否滚到底
ffmpeg -y -ss 9.5 -i nav-segment.mp4 -frames:v 1 check-bottom.png

# 提取点击时刻的帧，验证光标和涟漪
ffmpeg -y -ss 12.5 -i nav-segment.mp4 -frames:v 1 check-click.png
```

用 Read 打开检查。

## 4. ffprobe 验证

```bash
ffprobe -v quiet \
  -show_entries format=duration,size \
  -show_entries stream=codec_name,width,height,r_frame_rate \
  -of default=noprint_wrappers=1 output.mp4
```

检查：
- [ ] 时长 = 导航段 + 详情段（误差 < 0.1s）
- [ ] 分辨率 1920×1080
- [ ] 视频编码 H.264
- [ ] 音频编码 AAC
- [ ] 帧率 30fps

## 5. 滚动流畅度检查

计算滚动速度：

```
滚动距离(px) ÷ 滚动时长(s) = px/s
px/s ÷ 30 = 每帧位移(px)
```

- [ ] 每帧位移 ≤ 14px（超过会闪烁）
- [ ] 下滚用 `ease: "none"`（线性）
- [ ] 上滚可以用 `ease: "power1.inOut"`

## 6. 音频检查

- [ ] 旁白音量适中，没有爆音
- [ ] SFX（点击音、whoosh）在正确时刻触发
- [ ] 导航段和详情段的音频拼接处没有爆音
- [ ] 视频结尾有 0.5-1s 的静音收尾

## 7. 完整播放检查

用播放器完整播放一遍，检查：
- [ ] 没有黑屏、卡顿、跳帧
- [ ] 所有文字在安全区域内（不被裁剪）
- [ ] 颜色与品牌一致
- [ ] 总时长符合预期

## 验证不通过时

| 问题 | 排查方向 |
|------|----------|
| 空白帧 | beat 的 position 是否为 absolute；opacity 时序是否正确 |
| 图片不显示 | 路径是否相对于项目根目录；文件是否存在 |
| 滚动闪烁 | 每帧位移是否 >14px；是否用了线性缓动 |
| 拼接处黑帧 | 前一段末尾是否有内容；concat.txt 路径是否正确 |
| 音频不同步 | 两段音频采样率是否一致；是否需要重新编码拼接 |
| 文字太小 | 标题 ≥80px，正文 ≥20px |

## 交付前最终检查

- [ ] 视频文件存在且非空（> 1MB）
- [ ] 文件名有意义（如 `african-elephant-full-journey.mp4`）
- [ ] 放在项目目录中，用户可直接找到
- [ ] 用 present_files 交付给用户
