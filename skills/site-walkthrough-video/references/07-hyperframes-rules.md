# 07 — HyperFrames 构建规则与避坑

构建 HTML/CSS/GSAP 合成视频时必须遵守的规则，违反会导致渲染失败或视觉 bug。

## 必须遵守的规则

### 1. 根容器必须有 data-* 属性

```html
<div data-composition-id="main"
     data-width="1920" data-height="1080"
     data-start="0" data-duration="TOTAL"
     style="position:relative;width:1920px;height:1080px;">
```

`data-composition-id` 必须与 `window.__timelines["main"]` 的 key 一致。

### 2. beat 容器必须 position: absolute

```css
.beat {
  position: absolute;  /* 必须 */
  inset: 0;
  width: 1920px; height: 1080px;
  opacity: 0; overflow: hidden;
}
```

**禁止**在 `#beatN` 中写 `position: relative`，会覆盖 `.beat` 的 absolute 导致镜头消失。

### 3. GSAP 必须用 transform 属性

**正确：**
```javascript
tl.to(el, { x: 100, y: 50, scale: 1.2, duration: 0.5 });
```

**错误：**
```javascript
tl.to(el, { left: 100, top: 50, duration: 0.5 });  // linter 报错，渲染卡顿
```

### 4. 时间线必须挂到 window.__timelines

```javascript
window.__timelines = window.__timelines || {};
const tl = gsap.timeline({ paused: true });
// ... 写动画 ...
window.__timelines["main"] = tl;  // 必须，key 匹配 data-composition-id
```

### 5. 音频用 data-* 属性

```html
<audio src="narration.wav"
       data-start="0"
       data-duration="31.3"
       data-track-index="0"
       data-volume="1"></audio>
```

不同音频用不同的 `data-track-index`（0=旁白，10+=SFX）。

### 6. 所有 tween 必须在 tl 上

**正确：**
```javascript
tl.to(el, { opacity: 1, duration: 0.5 }, 1.0);
```

**错误：**
```javascript
gsap.to(el, { opacity: 1, duration: 0.5 });  // 独立 tween，不受时间线控制
```

### 7. 禁止 Math.random() 和 repeat: -1

- 用固定值或 seeded PRNG 代替 Math.random（保证渲染确定性）
- 用精确计算的 repeat 次数代替 `repeat: -1`（基于 beat 时长计算）

## 常见 bug 与修复

| 症状 | 原因 | 修复 |
|------|------|------|
| 镜头空白/消失 | `#beatN { position: relative }` 覆盖了 absolute | 删除 position: relative |
| 动画卡顿 | 用了 left/top 而非 x/y | 改用 transform |
| 字幕位置错乱 | 字幕容器用了 `transform: translateX(-50%)` | 改用 `left:0;right:0;text-align:center` |
| 元素不出现 | CSS 写了 `transform: scale(0)` 与 GSAP 冲突 | 用 GSAP fromTo 设置初始 scale |
| 音频不播放 | data-duration 为 0 或未设置 | 填写正确的音频时长 |
| 渲染黑屏 | data-composition-id 与 __timelines key 不匹配 | 确保两者一致 |
| 滚动闪烁 | 每帧位移 > 20px 或用了加速缓动 | 降至 ≤14px/帧，用 ease: "none" |

## Lint 命令

```bash
npx hyperframes lint project-dir/
```

必须 0 errors 0 warnings 才能渲染。

## 常用命令

```bash
# 初始化项目
npx hyperframes init --example blank

# 检查版本
npx hyperframes --version

# 渲染
npx hyperframes render project-dir/ --output output.mp4

# 抽帧验证
npx hyperframes snapshot project-dir/ --frames 10

# 查看可用组件
npx hyperframes catalog --type block
```

## 字体处理

- Google Fonts 用基础名称：`"Inter"` 而非 `"Inter Variable"`
- 品牌字体用 `@font-face` 引用本地 woff2：
```css
@font-face {
  font-family: "BrandSans";
  src: url("capture/assets/fonts/BrandSans.woff2") format("woff2");
}
```
- hyperframes capture 会自动下载网站字体到 `capture/assets/fonts/`

## 图片路径

- 路径相对于**项目根目录**，不是相对于 HTML 文件
- 正确：`capture/assets/hero.jpg`
- 错误：`../capture/assets/hero.jpg`（在 compositions/ 子目录中时尤其容易错）
