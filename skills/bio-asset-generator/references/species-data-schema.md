# Species 数据结构参考

本文档供 Agent 在生成物种数据文件时参考，确保输出的 TypeScript 代码完全符合项目类型定义。

---

## 类型定义来源

所有类型定义位于 [`src/types/index.ts`](../../../src/types/index.ts)。

---

## Species 接口完整字段说明

```typescript
interface Species {
  id: string;                    // 物种唯一 ID，小写英文，多词用连字符
                                 // 例：'dragonfly', 'house-fly', 'praying-mantis'

  categoryId: CategoryId;        // 分类 ID：'insects' | 'land' | 'ocean' | 'birds'

  nameZh: string;                // 中文名称：蜻蜓
  nameEn: string;                // 英文名称：Dragonfly
  scientificName?: string;       // 学名（可选）：Anisoptera
  pinyin?: string;               // 拼音（可选）：qīng tíng

  nicknameZh: string;            // 中文昵称/绰号：空中的捕猎高手
  nicknameEn: string;            // 英文昵称/绰号：The Aerial Hunter

  heroImage: string;             // 主图路径：/images/dragonfly/hero.jpg
  coverImage: string;            // 列表卡片封面路径：/images/dragonfly/cover.jpg

  basicInfo: {
    length: { zh: string; en: string };      // 体长：3 - 8 cm
    habitat: { zh: string; en: string };     // 栖息地：池塘、湖泊、溪流
    food: { zh: string; en: string };        // 食物：蚊子、苍蝇等小型飞行昆虫
    lifespan?: { zh: string; en: string };   // 寿命（可选）
    speed?: { zh: string; en: string };      // 速度（可选）
  };

  overviewZh: string;            // 中文概述（2-3 句话）
  overviewEn: string;            // 英文概述（2-3 句话）

  bodyParts: BodyPart[];         // 身体部位列表（8-12 个为宜）

  soundEffect?: string;          // 音效类别（可选）
  quizQuestions?: QuizQuestion[]; // 测验题目（可选，建议 3 题）
}
```

---

## BodyPart 接口字段说明

```typescript
interface BodyPart {
  id: string;                    // 部位 ID，小写英文，多词用连字符
                                 // 例：'compound-eyes', 'pollen-basket'

  number: number;                // 序号（1-based），决定显示顺序和图片文件名
                                 // 例：1 → part-1-compound-eyes.jpg

  nameZh: string;                // 中文名称：复眼
  nameEn: string;                // 英文名称：Compound Eyes

  pinyin?: string;               // 拼音：fù yǎn
  phoneticEn?: string;           // 英文音标：/ˈkɒmpaʊnd aɪz/

  descZh: string;                // 中文描述（1-2 句，适合 5-12 岁儿童）
                                 // 例：由成千上万个小眼组成，视野广阔，能快速发现猎物。

  descEn: string;                // 英文描述（1-2 句，适合英语启蒙）
                                 // 例：Made up of thousands of tiny eyes, giving a wide field of view.

  macroImage: string;            // 微距特写图片路径
                                 // 格式：/images/{species_id}/part-{number}-{part_id}.jpg

  hotspot: {
    x: number;                   // 主图上的水平位置（百分比 0-100，左→右）
    y: number;                   // 主图上的垂直位置（百分比 0-100，上→下）
    labelPosition?: string;      // 标签显示位置
                                 // 可选值：'top' | 'bottom' | 'left' | 'right'
                                 //       | 'top-left' | 'top-right'
                                 //       | 'bottom-left' | 'bottom-right'
    lineStartX?: number;         // 引线起点 X 微调（可选）
    lineStartY?: number;         // 引线起点 Y 微调（可选）
  };

  funFactZh?: string;            // 趣味冷知识（中文）
  funFactEn?: string;            // 趣味冷知识（英文）
}
```

---

## Hotspot 坐标估算指南

Hotspot 坐标基于主图（Hero Image）上各部位的相对位置。

### 估算方法

1. **假设主图展示生物的典型侧面/45°视角**
2. **将图片想象为 100×100 的网格**
3. **根据部位在身体上的位置估算 (x, y) 坐标**

### 典型昆虫侧视图坐标参考

```
(0,0) ─────────────────────────── (100,0)
│                                        │
│         触角 (45,15)                    │
│       复眼 (50,25)                      │
│      口器 (48,30)     翅痣 (80,30)      │
│           胸部 (50,38)                  │
│     足 (48,50)  翅膀 (70,42)           │
│                                        │
│           腹部 (50,65)                  │
│                                        │
│        腹部末端 (50,90)                 │
│                                        │
(0,100) ────────────────────────── (100,100)
```

### labelPosition 选择原则

- **避免标签与其他部位重叠**
- **避免标签超出图片边界**
- 头部区域部位：优先 `top`, `top-left`, `top-right`
- 身体中央部位：优先 `left`, `right`
- 底部区域部位：优先 `bottom`, `bottom-left`, `bottom-right`

---

## QuizQuestion 接口字段说明

```typescript
interface QuizQuestion {
  id: string;                    // 题目 ID：q1, q2, q3

  type: 'identify_part'          // 看图识别部位
      | 'listen_find'            // 听英文找部位
      | 'macro_guess';           // 看微距图猜部位

  promptZh: string;              // 中文题目
  promptEn: string;              // 英文题目

  targetPartId: string;          // 正确答案的部位 ID

  options: {
    partId: string;              // 选项对应的部位 ID
    textZh: string;              // 选项中文文本
    textEn: string;              // 选项英文文本
    image?: string;              // 选项图片（可选）
  }[];

  explanationZh: string;         // 答对后的中文解释
  explanationEn: string;         // 答对后的英文解释
}
```

### 出题策略

1. **题目组合**：建议 3 题，使用不同题型（1 × identify_part + 1 × listen_find + 1 × macro_guess 或 listen_find）
2. **难度递进**：第 1 题简单（最明显的部位），第 2 题中等，第 3 题较难
3. **选项数量**：3-4 个选项
4. **干扰项**：选择与正确答案在视觉或概念上容易混淆的部位
5. **解释内容**：简短有趣，包含一个知识点

---

## 文件命名和导出规范

### 数据文件命名

```
src/data/species/{species_id}.ts
```

- 文件名 = species_id
- 导出常量名 = 物种英文名大写，空格用下划线
- 例：
  - `dragonfly.ts` → `export const DRAGONFLY: Species = { ... }`
  - `house-fly.ts` → `export const HOUSE_FLY: Species = { ... }`
  - `praying-mantis.ts` → `export const PRAYING_MANTIS: Species = { ... }`

### 索引文件更新

编辑 `src/data/species/index.ts`：

```typescript
// 1. 添加 import
import { HOUSE_FLY } from './house-fly';

// 2. 添加到 ALL_SPECIES
export const ALL_SPECIES: Species[] = [
  DRAGONFLY,
  BUTTERFLY,
  BEE,
  HOUSE_FLY,      // ← 新增
  // ...
];

// 3. 添加到对应 category
export const SPECIES_BY_CATEGORY: Record<CategoryId, Species[]> = {
  insects: [DRAGONFLY, BUTTERFLY, BEE, HOUSE_FLY],  // ← 新增
  // ...
};
```

---

## 图片路径规范

所有图片存放在 `public/images/{species_id}/` 目录下。

```
public/images/{species_id}/
├── hero.jpg                         # 主图（3:2 横向）
├── cover.jpg                        # 封面（1:1 正方形）
├── part-1-{part_id}.jpg             # 部位 1 特写（3:2 横向）
├── part-2-{part_id}.jpg             # 部位 2 特写
├── ...
└── part-N-{part_id}.jpg             # 部位 N 特写
```

**路径规则**：
- 数据文件中使用相对于 `public/` 的路径：`/images/dragonfly/hero.jpg`
- 图片格式统一使用 `.jpg`
- 文件名中的 `{part_id}` 与 `BodyPart.id` 一致
