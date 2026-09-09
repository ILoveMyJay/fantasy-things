# 05 — 构建导航段

基于 `templates/nav-segment.html` 修改。导航段模拟真实用户的滚动和点击操作。

## 核心结构

```html
<div id="root" data-composition-id="nav" data-duration="TOTAL">
  <!-- 每个页面一个 beat -->
  <div id="beat1" class="beat">
    <div class="scroll-viewport">
      <img class="page-scroll" id="page1" src="capture/assets/home.png" />
    </div>
    <div class="cursor" id="cur1"><!-- SVG 光标 --></div>
    <div class="ripple" id="rip1"></div>
    <div class="scroll-indicator" id="scroll1">↓ 向下滚动浏览</div>
    <div class="step-badge">步骤 1/3 · 首页</div>
  </div>
  <!-- 更多页面... -->
</div>
```

## 关键 CSS

```css
.beat {
  position: absolute; inset: 0;
  width: 1920px; height: 1080px;
  overflow: hidden; opacity: 0;
}
.scroll-viewport {
  position: absolute; inset: 0;
  overflow: hidden;  /* 裁剪滚动的页面 */
}
.page-scroll {
  position: absolute; top: 0; left: 0;
  width: 1920px; height: auto;  /* 保持原始比例 */
  will-change: transform;
}
.cursor {
  position: absolute; z-index: 50;
  pointer-events: none;
}
.ripple {
  position: absolute;
  border-radius: 50%;
  border: 3px solid #F4A261;
  transform: translate(-50%, -50%) scale(0);
}
```

## GSAP 时间线（标准交互模式）

```javascript
const tl = gsap.timeline({ paused: true });

// 页面可见性
tl.set("#beat1", { opacity: 1 }, 0);
tl.set("#beat1", { opacity: 0 }, B1);

// 1. 滚动提示出现
tl.to("#scroll1", { opacity: 1, duration: 0.3 }, 0.2);

// 2. 匀速向下滚动（关键：ease: "none"）
tl.to("#page1", { y: -maxScroll, duration: scrollDownTime, ease: "none" }, 0.3);

// 3. 底部停留（不写 tween，自然等待）

// 4. 提示切换
tl.set("#scroll1", { innerHTML: '<span>↑</span> 向上滚动定位' }, pauseEnd);

// 5. 向上滚动，目标卡片居中
tl.to("#page1", { y: -targetY, duration: scrollUpTime, ease: "power1.inOut" }, pauseEnd + 0.1);

// 6. 提示消失
tl.to("#scroll1", { opacity: 0, duration: 0.3 }, scrollUpEnd);

// 7. 光标移入
tl.to("#cur1", { x: cardX - 18, y: cardY - 18, duration: 0.7, ease: "power2.inOut" }, scrollUpEnd);

// 8. Hover 微调
tl.to("#cur1", { x: cardX, y: cardY, duration: 0.3, ease: "sine.inOut" }, hoverStart);

// 9. 点击涟漪
tl.to("#rip1", { scale: 8, opacity: 0, duration: 0.6, ease: "power2.out" }, clickTime);

// 10. 页面淡出
tl.to("#beat1", { opacity: 0, duration: 0.4 }, fadeStart);
```

## 滚动距离计算

```
页面图片原始尺寸: W x H
放大到 1920 宽后高度: H_scaled = H * (1920 / W)
最大滚动距离: maxScroll = H_scaled - 1080

目标卡片在原始图片中的中心 Y: cardY_raw
放大后: cardY_scaled = cardY_raw * (1920 / W)
居中所需的页面偏移: targetY = 540 - cardY_scaled
（注意：targetY 通常为负值，因为卡片在页面中下部）
```

## 滚动速度控制

| 速度 | px/s | 每帧位移(30fps) | 观感 |
|------|------|-------------------|------|
| 很慢 | 200 | 6.7px | 悠闲浏览 |
| **推荐** | **400-450** | **13-15px** | **自然，无闪烁** |
| 较快 | 600 | 20px | 开始有闪烁感 |
| 很快 | 800+ | 27px+ | 明显闪烁 |

**必须用 `ease: "none"`（线性）**，power1.inOut 会在中间加速导致闪烁。

## 光标位置

光标 SVG 是 24×24，左上角对齐。要让光标尖端指向卡片中心 (cardX, cardY)：
- 初始位置：`x: cardX - 18, y: cardY - 18`（偏移让尖端接近中心）
- Hover 后：`x: cardX, y: cardY`（尖端正好在中心）

## 点击涟漪

```css
.ripple {
  position: absolute;
  left: cardX; top: cardY;
  width: 20px; height: 20px;
  border-radius: 50%;
  border: 3px solid #F4A261;
  transform: translate(-50%, -50%) scale(0);
}
```

```javascript
tl.to("#rip1", { scale: 8, opacity: 0, duration: 0.6, ease: "power2.out" }, clickTime);
```

## SFX

| 音效 | 触发时刻 | 音量 |
|------|----------|------|
| click.mp3 | 点击涟漪开始时 | 0.5 |
| whoosh-short.mp3 | 页面切换淡出时 | 0.3 |

## 注意事项

- **不要用卡片高亮边框**（黄色线框），纯靠光标+涟漪指示点击目标，更自然
- 滚动指示器（"↓ 向下滚动浏览"）帮助观众理解正在滚动
- 步骤徽章（"步骤 1/3 · 首页"）帮助观众理解当前位置
- 每个页面的 beat 必须 `position: absolute`，不能写 `position: relative`
- 页面图片用 `width: 1920px; height: auto`，不要写死高度
