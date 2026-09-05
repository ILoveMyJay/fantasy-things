---
name: bio-asset-generator
description: >-
  为 LingoKids 2D 项目生成完整的生物科普图片资产包。当用户请求生成某个物种的科普素材、图片资产、
  或说"帮我生成 XX 的科普素材/图片/数据"时激活此 Skill。自动完成物种研究、数据结构生成、
  一致性图片提示词生成、图片生成和项目集成的全流程。
---

# Bio Asset Generator — 生物科普资产批量生成

## 概述

本 Skill 用于为 LingoKids 2D 项目生成完整的"儿童生物科普 + 英语启蒙"素材包。
输入一个物种名称，输出一套可直接接入前端的结构化数字资产。

**输出包含：**
- 1 张 Hero Image（主图）
- 1 张 Cover Image（列表封面）
- N 张 Body Part Macro Images（部位微距特写）
- 1 个 TypeScript 数据文件（遵循 `Species` 类型定义）
- 自动集成到项目的 `index.ts` 导出中

## 核心原则

1. **同一个体**：一种生物的所有图片必须看起来来自同一个个体标本
2. **图文分离**：AI 只生成图片，文字由网页前端渲染
3. **三层 Prompt**：Style + Identity + Shot，保证全套素材风格统一
4. **用户确认**：每个关键步骤都需要用户审核后再继续

---

## 完整工作流程

### Phase 1: 物种研究 (Research)

**目标**：收集该物种的全部结构化知识。

**步骤：**

1. 阅读 [anatomy-database.md](./resources/anatomy-database.md) 查看该物种是否已在知识库中
2. 如果知识库中没有，使用 `search_web` 搜索：
   - `"{species_name}" anatomy body parts for children education`
   - `"{species_name}" 身体结构 科普`
3. 确定该物种的 **身体部位列表**（8-12 个部位为宜）：
   - 从通用结构中选取适用的部位
   - 添加该物种的特殊/标志性结构
   - 优先选择视觉上有特色、容易拍出好看特写的部位
4. 为每个部位收集：
   - 中文名称 + 英文名称
   - 拼音 + 英文音标
   - 中文科普描述（1-2 句，适合 5-12 岁儿童）
   - 英文科普描述（1-2 句，适合英语启蒙）
   - 趣味冷知识（中英文各 1 条）
5. 收集基本信息：学名、体长、栖息地、食物、寿命、速度等
6. 编写物种概述（中英文，2-3 句话）

**输出**：向用户展示研究结果摘要（通过 Artifact），等待确认。

### Phase 2: 数据结构生成 (Data Modeling)

**目标**：生成符合项目类型定义的 TypeScript 数据文件。

**步骤：**

1. 阅读 [species-data-schema.md](./references/species-data-schema.md) 了解数据结构规范
2. 确定物种的 `categoryId`（insects / land / ocean / birds）
3. 生成物种 ID：小写英文，多词用连字符（如 `house-fly`, `praying-mantis`）
4. 预分配图片路径：
   - Hero: `/images/{species_id}/hero.jpg`
   - Cover: `/images/{species_id}/cover.jpg`
   - Parts: `/images/{species_id}/part-{n}-{part_id}.jpg`
5. 为每个部位预估 hotspot 坐标（x, y 百分比，0-100）
   - 基于生物的典型姿态和各部位在整体中的相对位置
   - 稍后生成主图后可能需要微调
6. 生成 3 道 QuizQuestion（题型组合：identify_part + listen_find）
7. 将数据文件写入 `src/data/species/{species_id}.ts`

**参考现有数据文件格式**：
- [dragonfly.ts](../../src/data/species/dragonfly.ts) — 完整示例（10 个部位）
- [bee.ts](../../src/data/species/bee.ts) — 简化示例（3 个部位）

**注意**：此阶段图片路径使用本地路径（`/images/...`），图片尚未生成。

### Phase 3: 提示词生成 (Prompt Engineering)

**目标**：为每张图片生成带有一致性锁定的 Prompt。

**步骤：**

1. 阅读 [prompt-templates.md](./references/prompt-templates.md) 加载 Prompt 模板
2. 阅读 [consistency-lock.md](./references/consistency-lock.md) 加载一致性规范

3. **定义 Species Identity（物种身份描述）**：
   - 这是该物种的"视觉 DNA"，在所有 Prompt 中复用
   - 详细描述：体色、花纹、比例、眼睛颜色、表面纹理等
   - 参考 [identity-styles.md](./resources/identity-styles.md)
   - 示例：
     ```
     SPECIES IDENTITY - Dragonfly:
     A blue-green darner dragonfly with iridescent emerald thorax,
     large turquoise compound eyes covering most of the head,
     four transparent wings with dark fine venation,
     slender segmented blue-green abdomen with black banding,
     six spiny legs, short bristle-like antennae.
     Body length approximately 7cm.
     ```

4. **生成 Hero Image Prompt**：
   - 使用 BIO_EDU_MACRO_V1 风格前缀
   - 加入 Species Identity
   - 描述完整自然姿态
   - 长宽比：3:2

5. **生成 Cover Image Prompt**：
   - 基于 Hero Image 的简化版
   - 长宽比：1:1
   - 更紧凑的构图

6. **为每个部位生成 Macro Prompt**：
   - 使用 BIO_EDU_MACRO_V1 风格前缀
   - 加入 Species Identity
   - 加入该部位的具体描述和拍摄角度
   - 在末尾附加 Consistency Lock 标准文本
   - 长宽比：3:2

7. **将所有 Prompt 整理成 Artifact** 供用户审核

**关键规则**：
- 所有 Prompt 中不得包含任何文字/标签/水印指令
- 不得要求生成包含人类元素的图片
- 所有 Prompt 使用英文编写（AI 图片生成模型的英文理解更好）

**输出**：展示所有 Prompt 的 Artifact，等待用户确认或修改。

### Phase 4: 图片生成 (Image Generation)

**目标**：依次生成所有图片，确保视觉一致性。

**前置条件**：用户已确认所有 Prompt。

**步骤：**

1. **生成 Hero Image**（主图）：
   - 调用 `generate_image`
   - `Prompt`: Hero Image Prompt
   - `AspectRatio`: "3:2"
   - `ImageName`: `{species_id}_hero`
   - 展示给用户确认
   - 如不满意，可调整 Prompt 重新生成

2. **生成 Cover Image**（封面）：
   - 调用 `generate_image`
   - `Prompt`: Cover Image Prompt
   - `AspectRatio`: "1:1"
   - `ImageName`: `{species_id}_cover`
   - `ImagePaths`: [Hero Image 的路径]
   - 展示给用户确认

3. **依次生成每个部位的 Macro Image**：
   - 对每个部位调用 `generate_image`
   - `Prompt`: 该部位的 Macro Prompt
   - `AspectRatio`: "3:2"
   - `ImageName`: `{species_id}_part_{n}_{part_id}`
   - `ImagePaths`: [Hero Image 的路径]（作为一致性参考）
   - 每张图生成后展示给用户
   - 如果用户对某张不满意，重新生成该张

4. **将所有图片复制到项目目录**：
   - 将 Artifact 目录中的图片复制到 `public/images/{species_id}/`
   - 重命名为标准格式：`hero.jpg`, `cover.jpg`, `part-{n}-{part_id}.jpg`

**一致性保障机制**：
- 每张部位图都通过 `ImagePaths` 参数传入主图作为参考
- Prompt 中包含完整的 Species Identity 描述
- Prompt 末尾附加 Consistency Lock 文本
- 用户可视化审核每张图的一致性

### Phase 5: 资产集成 (Integration)

**目标**：将生成的资产集成到 LingoKids 2D 项目中。

**步骤：**

1. **确认图片文件**：
   - 验证 `public/images/{species_id}/` 目录下所有图片已就位
   - 文件列表应包含：hero.jpg, cover.jpg, part-1-xxx.jpg ... part-N-xxx.jpg

2. **更新物种索引文件**：
   - 编辑 `src/data/species/index.ts`
   - 添加 import 语句
   - 将新物种加入 `ALL_SPECIES` 数组
   - 将新物种加入对应 category 的 `SPECIES_BY_CATEGORY`

3. **验证构建**：
   - 运行 `npx tsc --noEmit` 检查类型正确性
   - 运行 `npm run build` 确认项目可构建

4. **输出完成摘要**：
   - 新增的文件列表
   - 物种信息概要
   - 建议用户启动 `npm run dev` 查看效果

---

## 用户交互规范

在以下时机**必须暂停并等待用户反馈**：

| 阶段 | 暂停点 | 等待内容 |
|------|--------|----------|
| Phase 1 | 研究完成后 | 确认部位列表和知识内容 |
| Phase 3 | Prompt 生成后 | 确认所有 Prompt 或要求修改 |
| Phase 4 | 主图生成后 | 确认主图质量和风格 |
| Phase 4 | 每张部位图后 | 确认一致性（可批量确认） |

**用户修改请求处理**：
- 如果用户要求修改 Prompt → 修改后重新展示等待确认
- 如果用户要求重新生成某张图 → 使用原 Prompt 或修改后的 Prompt 重新生成
- 如果用户要求增减部位 → 返回 Phase 2 修改数据结构

---

## 错误处理

- **图片生成失败**：记录错误，尝试简化 Prompt 后重试 1 次
- **搜索无结果**：使用内置知识库中的信息，标记需要用户补充
- **类型检查失败**：检查数据文件与 `Species` 类型的差异，自动修复
- **图片一致性差**：提示用户，询问是否接受或重新生成

---

## 文件命名规范

```
src/data/species/{species_id}.ts          # 数据文件
public/images/{species_id}/
├── hero.jpg                               # 主图
├── cover.jpg                              # 封面
├── part-1-{part_id}.jpg                   # 部位 1
├── part-2-{part_id}.jpg                   # 部位 2
├── ...
└── part-N-{part_id}.jpg                   # 部位 N
```

其中 `{species_id}` 为小写英文，多词用连字符。例如：
- `dragonfly`, `butterfly`, `honey-bee`, `house-fly`, `praying-mantis`

---

## 参考文件

- [Prompt 模板库](./references/prompt-templates.md) — 图片生成 Prompt 的标准模板
- [数据结构参考](./references/species-data-schema.md) — Species 类型定义和字段说明
- [一致性锁定规范](./references/consistency-lock.md) — 视觉一致性保障机制
- [解剖结构知识库](./resources/anatomy-database.md) — 各物种的部位知识
- [风格规范](./resources/identity-styles.md) — BIO_EDU_MACRO_V1 风格定义
- [蜻蜓生成范例](./examples/dragonfly-example.md) — 完整的端到端流程示例
