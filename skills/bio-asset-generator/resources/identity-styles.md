# BIO_EDU_MACRO_V1 — 风格规范定义

本文档定义了 LingoKids 2D 项目图片资产的统一视觉风格标准。
所有生成的图片必须遵循此风格规范。

---

## 核心风格标识

**风格名称**：`BIO_EDU_MACRO_V1`
**设计理念**：高品质儿童科学图鉴 × 自然摄影

---

## 风格特征清单

### 1. 摄影类型
- **主图**：科学微距摄影 (Scientific macro photography)
- **部位特写**：极致微距摄影 (Extreme macro photography)
- **环境图**：自然纪实摄影 (Natural documentary photography)

### 2. 光线要求
- **主光源**：自然柔光 (Natural soft lighting)
- **补光**：环境光反射补光，避免强烈直射光
- **禁止**：闪光灯直射效果、过度 HDR、人工布光痕迹
- **目标感觉**：清晨或傍晚的温暖自然光

### 3. 背景规范

| 图片类型 | 背景要求 | 示例 |
|----------|----------|------|
| Hero Image | 干净自然背景，浅景深虚化 | 草地/花丛/水面的柔和虚化 |
| Cover Image | 纯净简洁背景 | 浅色中性色/白色/淡绿色 |
| Body Part Macro | 极浅景深，主体外全部虚化 | 仅对焦部位清晰，其余柔和 |

### 4. 色彩和色调
- **色彩饱和度**：中等偏高（鲜活但不夸张）
- **色温**：温暖偏暖（约 5500-6500K 的感觉）
- **对比度**：中等（清晰但不刺眼）
- **禁止**：过度滤镜、故意褪色、冷色调、暗调

### 5. 清晰度和细节
- **主体**：极高清晰度，可见微观纹理
- **细节要求**：
  - 昆虫：可见翅脉、复眼小面、体毛、节肢关节
  - 哺乳动物：可见毛发纹理、皮肤褶皱、爪垫纹理
  - 海洋生物：可见鳞片、鳍条、皮肤纹理
  - 鸟类：可见羽毛细节、喙纹理、爪鳞
- **景深**：浅景深 (Shallow depth of field)，主体锐利，背景柔化

### 6. 构图原则
- **主图**：生物完整展示，占画面 60-70%
- **部位特写**：目标部位占画面 70-80%
- **安全空间**：四周留有适当边距
- **视线引导**：生物朝向画面中心或黄金分割点
- **禁止**：截断重要身体部分（除非是刻意的部位特写）

### 7. 姿态和表现
- **自然**：生物应处于自然姿态，不做作
- **静态优先**：避免高速运动模糊
- **适合教学**：姿态应能清晰展示身体结构
- **推荐主图姿态**：
  - 昆虫：侧面 45° 或正侧面，停在叶片/花朵上
  - 哺乳动物：侧面或 3/4 视角，站立或行走
  - 海洋生物：侧面或 3/4 视角，游泳姿态
  - 鸟类：侧面或展翅，栖息或飞行

---

## 儿童友好安全标准

### 必须遵守

- ✅ 生物展示自然、健康、完整
- ✅ 色彩明亮温暖，让孩子感到亲切
- ✅ 画面干净整洁，没有杂乱元素
- ✅ 背景安全友好，无威胁感

### 严格禁止

- ❌ 捕食场景（生物正在捕食或被捕食）
- ❌ 受伤、死亡、标本化的生物
- ❌ 血腥、恐怖或令人不适的画面
- ❌ 人类元素（手指、工具等）
- ❌ 任何文字、标签、水印、LOGO
- ❌ 过于微观令人不适的画面（如寄生虫特写）
- ❌ 有攻击性/威胁性的姿态（张大嘴咬人等）

---

## 各生物类别的风格微调

### 昆虫类 (Insects)

```
附加风格关键词：
- extreme macro photography
- visible wing venation details
- compound eye facets visible
- iridescent body surface
- natural perching pose
- leaf or flower as substrate
```

- 强调微距的极致细节感
- 翅膀要能看到翅脉
- 复眼要能感受到小面结构
- 体表的金属光泽和虹彩需要体现

### 陆地动物 (Land Animals)

```
附加风格关键词：
- wildlife portrait photography
- fur texture detail
- muscle definition
- natural habitat background
- golden hour lighting
- eye contact or profile view
```

- 强调皮毛的质感和层次
- 展示肌肉线条和体型力量感
- 背景使用该动物的自然栖息地
- 光线更倾向于金色暖调

### 海洋生物 (Ocean Creatures)

```
附加风格关键词：
- underwater photography
- natural ocean lighting
- water caustics on skin
- clear blue water background
- streamlined body showcase
- scale and fin detail
```

- 水下光线的折射效果
- 体表的水光感
- 鳞片和鳍的细节
- 蓝色调的水下环境

### 鸟类 (Birds)

```
附加风格关键词：
- bird portrait photography
- feather detail and texture
- plumage color accuracy
- perched or in-flight pose
- sky or branch background
- beak and claw detail
```

- 羽毛的层次感和色彩准确性
- 喙和爪的质感细节
- 明亮的天空或树枝背景

---

## Prompt 中的风格前缀标准格式

每个 Prompt 都应以以下风格前缀开头：

```
[BIO_EDU_MACRO_V1] Scientific macro photography, realistic biological texture,
natural soft lighting, clean educational composition, premium children's science
textbook quality, high-resolution, scientifically accurate, child-friendly,
no text, no labels, no watermarks, no human elements.
```

然后根据生物类别追加对应的附加风格关键词。

---

## 图片尺寸和长宽比

| 图片类型 | 长宽比 | 用途 |
|----------|--------|------|
| Hero Image | 3:2 | 物种详情页主图 |
| Cover Image | 1:1 | 物种列表卡片 |
| Body Part Macro | 3:2 | 部位特写弹窗 |

---

## 版本历史

| 版本 | 日期 | 变更说明 |
|------|------|----------|
| V1.0 | 2024-01 | 初始版本，基于 ChatGPT 讨论方案 |
