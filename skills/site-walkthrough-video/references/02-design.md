# 02 — 品牌设计提取

从网站提取视觉规范，记录到 DESIGN.md，供构建阶段使用。

## 提取品牌色

从首页截图中用取色器提取关键颜色：

| 角色 | 说明 | 示例 |
|------|------|------|
| `--bg` | 页面背景色 | `#EFF6EE` |
| `--fg` | 主要文字色 | `#1B4332` |
| `--accent` | 强调色/CTA/高亮 | `#F4A261` |
| `--surface` | 卡片/面板背景 | `#FFFFFF` |
| `--primary` | 品牌主色 | `#2D6A4F` |
| `--secondary` | 辅助色 | `#52B788` |

**方法：** 用 Read 打开首页截图，观察导航栏、按钮、卡片、文字的颜色，记录 hex 值。

## 提取字体

1. 检查 `capture/assets/fonts/` 目录，hyperframes capture 会自动下载网站字体
2. 识别标题字体和正文字体
3. 如果是 Google Fonts（如 Fredoka、Nunito），直接在 CSS 中用 `@font-face` 引用本地 woff2 文件
4. 如果是系统字体，直接写 font-family stack

```css
@font-face {
  font-family: "BrandSans";
  src: url("capture/assets/fonts/BrandSans-Bold.woff2") format("woff2");
  font-weight: 700;
}
```

## 提取组件风格

观察网站的 UI 组件，记录：

- **卡片**：圆角大小、边框、阴影
- **按钮**：形状（圆角/方形）、颜色、hover 效果
- **标签/徽章**：形状、颜色
- **间距**：卡片间距、内边距
- **图标风格**：线性/填充/彩色

## DESIGN.md 模板

```markdown
# 品牌设计规范

## 颜色
- 背景: #EFF6EE
- 文字: #1B4332
- 主色: #2D6A4F
- 强调: #F4A261
- 辅助: #52B788
- 卡片: #FFFFFF

## 字体
- 标题: Fredoka, 700
- 正文: Nunito, 400/600

## 组件
- 卡片圆角: 20px
- 按钮圆角: 9999px (胶囊)
- 卡片间距: 24px
- 阴影: 0 4px 20px rgba(0,0,0,0.08)
```

## 注意事项

- 品牌色用于视频中的 UI 元素（按钮、标签、进度条），保持与原站一致
- 视频中的文字颜色必须与背景有足够对比度（WCAG AA）
- 如果网站是暗色主题，视频背景也用暗色，避免突兀
