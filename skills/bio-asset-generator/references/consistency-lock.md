# 一致性锁定规范 (Consistency Lock Guidelines)

这个文件详细说明如何保证同一物种的所有图片（主图、缩略图、各部位特写）在视觉上保持绝对一致，避免 AI 生成时出现"同一个物种，不同个体"的情况。

## 1. 什么是 Species Identity（物种身份）

**定义**：为每个物种创建一个"视觉 DNA"描述 (Identity Description)。这个描述必须足够精确，作为常量在所有该物种的 Prompt 中重复使用。

**如何编写 Identity Description**：
描述必须涵盖决定该个体视觉特征的所有核心要素（颜色、纹理、特殊标记、比例）。

**不同类别生物的 Identity 要素**：
- **昆虫 (Insects)**：体色 (body color)、花纹 (patterns)、翅膀颜色/透明度 (wing color/opacity)、眼睛颜色 (eye color)、身体比例 (body proportions)。
  - *示例*：`metallic green carapace with three black spots, transparent wings with brown tips, large bright green eyes`
- **哺乳动物 (Mammals)**：毛色 (fur color)、斑纹/条纹 (spots/stripes)、体型 (body shape)、面部特征 (facial features)。
  - *示例*：`sandy brown fur with distinct black rosettes, white underbelly, robust build, thick tail`
- **海洋生物 (Marine Life)**：体色 (body color)、鳞片/皮肤 (scale/skin texture)、体型 (body shape)、鳍的形状 (fin shape/color)。
  - *示例*：`silvery blue scales with a dark blue dorsal ridge, sleek torpedo-shaped body, sickle-shaped dorsal fin`
- **鸟类 (Birds)**：羽色 (plumage color distribution)、喙形 (beak shape/color)、体型 (body shape)、特征性标记 (distinctive markings)。
  - *示例*：`emerald green back, crimson red breast, long curved black beak, white ring around the neck`

## 2. Consistency Lock 机制

**为什么需要一致性锁定**：
AI 每次生成都是独立的。如果没有明确的约束，AI 可能会在生成"眼睛特写"时创造一只红眼蜻蜓，而在"翅膀特写"时创造一只蓝眼蜻蜓。

**锁定文本的标准格式**：
```text
Consistency Lock: This macro shot MUST strictly match the exact {identity_description} of the same individual {species_name} shown in the reference image. Maintain identical colors, patterns, textures, and structural proportions.
```

**如何在 Prompt 中正确放置**：
Consistency Lock 必须放在 Prompt 的**最末尾**。这是 AI 注意力最强的区域之一，能够有效强化约束。

## 3. 图片生成顺序策略

**为什么必须先生成主图（Hero Image）**：
主图确立了该个体的整体设计和最终视觉基准。部位特写必须基于主图衍生。

**如何将主图作为参考传入后续生成（`ImagePaths` 参数）**：
在使用 `generate_image` 工具生成部位特写时，**必须**将成功生成并选定的 Hero Image 的绝对路径作为 `ImagePaths` 参数传入。这为 AI 提供了最强的一致性参考。

**生成顺序的最佳实践**：
1. 编写精确的 `Identity Description`。
2. 使用 Hero Image 模板生成多张候选主图。
3. 选定最好的一张主图，保存。
4. 使用部位特写模板，插入 Consistency Lock。
5. 调用 `generate_image`，传入部位 Prompt，**并提供主图路径作为 `ImagePaths`**。

## 4. 常见一致性破坏原因和预防

- **颜色漂移 (Color Drift)**：
  - *原因*：未在 Identity 中具体指定颜色，或灯光描述改变了固有色。
  - *预防*：Identity 中使用具体的颜色词（如 `emerald green` 而不是 `green`）。保持不同 Prompt 间的灯光风格一致。
- **体型比例变化 (Proportion Shifts)**：
  - *原因*：视角变化导致 AI 误判比例。
  - *预防*：在局部特写中，如果包含周边结构，需强调比例（例如 `short thick legs relative to body`）。
- **花纹/标记消失 (Missing Markings)**：
  - *原因*：局部特写放大了无花纹区域，或者 AI 忽略了复杂的斑纹。
  - *预防*：在 Part Details 中明确指出该部位应该有什么花纹。
- **背景风格不统一 (Inconsistent Backgrounds)**：
  - *原因*：未统一 Setting 描述。
  - *预防*：所有图片严格使用 `BIO_EDU_MACRO_V1` 统一的前缀风格规范和背景设定。

## 5. Quality Check Checklist

生成部位图后，在确认保存前，必须对照主图检查以下视觉一致性要素：

- [ ] **颜色匹配**：特写部位的固有色是否与主图中该部位的颜色完全一致？
- [ ] **材质匹配**：质感（如毛发粗细、甲壳反光度、鳞片大小）是否在主图和特写间保持一致？
- [ ] **图案连续**：主图上该部位的花纹、斑点，在特写中是否出现且形状相似？
- [ ] **结构比例**：特写展示的解剖结构特征（如眼睛的形状、翅膀的脉络走向）是否符合主图的暗示？
- [ ] **光影风格**：是否维持了统一的科普教育微距摄影风格（柔和光线、干净背景）？
