# 06 — 构建详情段

基于 `templates/detail-segment.html` 修改。详情段用 stacked-beats 单文件架构，硬切切换镜头。

## 架构选择

**用 stacked-beats（单文件），不用子合成+Shader：**
- 导航段+详情段是硬切拼接，不需要转场
- 单文件零加载延迟，每个镜头瞬间切换
- 构建简单，一个 HTML 文件搞定

## 核心结构

```html
<div data-composition-id="detail" data-width="1920" data-height="1080"
     data-start="0" data-duration="TOTAL"
     style="position:relative;width:1920px;height:1080px;">

  <!-- Beat 1：登场 -->
  <div class="beat" id="b01" style="opacity:1;">
    <!-- 标题 + 主图 + 数据 -->
  </div>

  <!-- Beat 2：图鉴 -->
  <div class="beat" id="b02">
    <!-- 编号圆点 + 图片 -->
  </div>

  <!-- 更多 beat... -->

  <!-- 旁白音频 -->
  <audio id="narration" src="narration.wav"
         data-start="0" data-duration="AUDIO_LEN"
         data-track-index="0" data-volume="1"></audio>

  <!-- SFX -->
  <audio src="sfx/chime.mp3" data-start="2.0" data-duration="1.0"
         data-track-index="10" data-volume="0.3"></audio>
</div>
```

## 关键 CSS

```css
.beat {
  position: absolute; inset: 0;
  width: 1920px; height: 1080px;
  display: flex; align-items: center; justify-content: center;
  opacity: 0; overflow: hidden;
}
/* 第一个 beat 初始可见 */
#b01 { opacity: 1; }
```

## GSAP 时间线

```javascript
window.__timelines = window.__timelines || {};
const tl = gsap.timeline({ paused: true });

var beats = [
  { id: "#b01", at: 0, dur: 6.0 },
  { id: "#b02", at: 6.0, dur: 6.0 },
  { id: "#b03", at: 12.0, dur: 7.0 },
  // ...
];
beats.forEach(function (b, i) {
  var el = document.querySelector(b.id);
  if (i !== 0) tl.set(el, { opacity: 1 }, b.at);
  gsap.set(el, { scale: 1.012 });  // 轻微缩放脉冲
  tl.to(el, { scale: 1, duration: 0.25, ease: "power2.out" }, b.at);
  if (i !== beats.length - 1) tl.set(el, { opacity: 0 }, b.at + b.dur);
});

// 每个 beat 内部的动画写在下面
// Beat 1: 标题入场
tl.fromTo("#b01 .title", { y: 40, opacity: 0 }, { y: 0, opacity: 1, duration: 0.6 }, 0.3);
// ...

window.__timelines["detail"] = tl;
```

## 标准镜头实现

### 镜头 1：登场

```html
<div class="beat" id="b01">
  <img class="hero" src="capture/assets/hero.jpg" />
  <div class="title">非洲象</div>
  <div class="subtitle">Loxodonta africana</div>
  <div class="stats">
    <div class="stat"><span class="num">3.2-4</span>米肩高</div>
    <div class="stat"><span class="num">4-7</span>吨体重</div>
  </div>
</div>
```

动画：背景图 Ken Burns 缓慢缩放，标题从下方滑入，数据数字从 0 滚动。

### 镜头 2：图鉴（编号圆点依次点亮）

```html
<div class="beat" id="b02">
  <div class="grid">
    <div class="item" data-idx="1"><div class="dot">1</div><img src="part-1.jpg" /></div>
    <div class="item" data-idx="2"><div class="dot">2</div><img src="part-2.jpg" /></div>
    <!-- ... -->
  </div>
</div>
```

```javascript
// 圆点依次脉冲点亮
for (let i = 0; i < 10; i++) {
  tl.fromTo(`#b02 .dot:nth-child(${i+1})`,
    { scale: 0, opacity: 0 },
    { scale: 1, opacity: 1, duration: 0.3, ease: "back.out(2)" },
    6.0 + i * 0.4);
}
```

### 镜头 3：深潜（微距特写 + 扫描线）

```html
<div class="beat" id="b03">
  <img class="macro" src="part-1-trunk.jpg" />
  <div class="scan-line"></div>
  <div class="caption">灵巧多能象鼻 · 超 4 万块肌肉</div>
</div>
```

动画：扫描线从上到下移动，图片缓慢放大。

### 镜头 4：轮播（卡片快速切换）

```javascript
// 每张卡片显示 1.2s，左右滑入滑出
const items = ["tusk", "skin", "foot", "leg"];
items.forEach((item, i) => {
  const t = 18.0 + i * 1.2;
  tl.fromTo(`#b04 .card-${item}`,
    { x: 200, opacity: 0 },
    { x: 0, opacity: 1, duration: 0.3 }, t);
  tl.to(`#b04 .card-${item}`,
    { x: -200, opacity: 0, duration: 0.3 }, t + 0.9);
});
```

### 镜头 5：CTA（结尾召唤）

```html
<div class="beat" id="b05">
  <div class="cta-title">开始探索</div>
  <div class="progress-bar"><div class="fill"></div></div>
  <button class="cta-btn">进入图鉴</button>
</div>
```

动画：进度条 0→100%，按钮脉冲缩放。

## 字幕

如果需要字幕，在每个 beat 中添加字幕容器，用 GSAP 按旁白时间显示/隐藏。

```html
<div class="captions">
  <span class="cap" data-start="0.5" data-end="3.0">非洲象是陆地上最大的哺乳动物</span>
  <span class="cap" data-start="3.0" data-end="6.0">它们拥有超过四万块肌肉构成的象鼻</span>
</div>
```

```css
.captions {
  position: absolute; bottom: 60px; left: 0; right: 0;
  text-align: center;
}
.cap {
  display: none;
  font-size: 32px; color: #fff;
  text-shadow: 0 2px 8px rgba(0,0,0,0.5);
}
```

```javascript
// 按时间显示字幕
document.querySelectorAll(".cap").forEach(cap => {
  const s = parseFloat(cap.dataset.start);
  const e = parseFloat(cap.dataset.end);
  tl.set(cap, { display: "inline" }, s);
  tl.set(cap, { display: "none" }, e);
});
```

## 注意事项

- **beat 容器必须 `position: absolute`**，写 `position: relative` 会覆盖导致镜头消失
- **GSAP 必须用 x/y/scale**，不能用 left/top（linter 报错且卡顿）
- **CSS 中不能写 `transform: scale(0)`** 与 GSAP scale 冲突
- **字幕容器不能用 `transform: translateX(-50%)`**，GSAP y 动画会覆盖整个 transform，改用 `left:0;right:0;text-align:center`
- 每个 beat 至少有一个视觉运动（缩放、滑动、脉冲），不能是完全静态的图片
- 标题字体 ≥ 80px，正文字体 ≥ 20px
- `window.__timelines["detail"] = tl` 必须与 `data-composition-id` 一致
