# 01 — 捕获网站内容

## 核心问题：SPA 子路由

大多数现代网站是 React/Vue SPA，直接 `hyperframes capture https://site.com/?category=xxx` 会拿到首页，因为 JS 还没渲染就截图了。

**必须用 browser-use 实际点击导航：**

```python
import seed_browser_use as bu
import time

bu.navigate("https://site.com/")
bu.wait_for_load(timeout=15)
time.sleep(2)

# 点击分类卡片
bu.find("分类名称").first  # 找到 ref
bu.click(ref)
time.sleep(1.5)  # 等待 SPA 渲染

# 获取当前 URL（用于后续参考）
print(bu.page_info()["url"])

# 获取页面文本内容
print(bu.get_page_text()[:2000])
```

## 下载页面图片素材

```python
# 方法1：从页面 HTML 中提取图片 URL
imgs = bu.read_all("img", fields=["src", "alt"], limit=50)
for img in imgs:
    print(img["src"])

# 方法2：已知图片 URL 模式时直接 curl 下载
# 例如 https://site.com/images/species/hero.jpg
```

用 curl 下载到项目的 `capture/assets/` 目录。

## 完整页面长图拼接

需要滚动展示的页面（如列表页），视口截图只能看到一屏。必须分段截图后拼接。

### 步骤

1. **获取页面总高度**
```python
scroll_h = bu.js("return document.documentElement.scrollHeight")
viewport_h = bu.js("return window.innerHeight")
```

2. **分段截图**，每段之间留重叠区域（至少 100px）：
```python
import shutil, os
out_dir = "project/capture/assets"
segments = []
for y in range(0, scroll_h, viewport_h - 150):  # 150px 重叠
    bu.js(f"window.scrollTo(0, {y})")
    time.sleep(0.8)
    f = bu.screenshot(tag=f"seg{y}")
    path = os.path.join(out_dir, f"seg-{y}.png")
    shutil.copy(f.path, path)
    segments.append(path)
bu.js("window.scrollTo(0, 0)")
```

3. **用 `scripts/stitch_fullpage.py` 精确拼接**：
```bash
python scripts/stitch_fullpage.py \
  --input project/capture/assets/seg-0.png project/capture/assets/seg-750.png project/capture/assets/seg-1056.png \
  --output project/capture/assets/full-page.png
```

脚本用 numpy 逐行匹配找到接缝，自动处理粘性导航栏，接缝误差通常 < 1。

### 注意事项

- 截图前 `time.sleep(0.8)` 确保页面渲染完成和滚动停止
- 粘性导航栏会覆盖每段截图的顶部，拼接脚本会自动处理
- 如果页面有懒加载图片，滚动到对应位置后多等一会
- 拼接后用 Read 检查接缝处是否有断裂

## 产出文件

```
project/
└── capture/
    ├── assets/
    │   ├── home-page.png       # 首页截图
    │   ├── category-full.png   # 分类页完整长图（拼接后）
    │   ├── hero.jpg            # 详情页主图
    │   ├── detail-1.jpg        # 详情页其他素材
    │   └── fonts/              # 品牌字体（woff2）
    └── screenshots/            # hyperframes capture 的原始截图
```
