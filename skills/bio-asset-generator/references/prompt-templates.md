# Prompt 模板库 (Prompt Templates)

这个文件包含用于 AI 图片生成的 Prompt 模板。Agent 在生成图片时会读取这些模板并填入物种特定信息。

## 1. BIO_EDU_MACRO_V1 风格规范
所有图片共用的公共 Style 前缀：
```
Style: Scientific macro photography, realistic biological texture,
natural soft lighting, clean educational composition,
premium children's science textbook quality,
high-resolution, scientifically accurate, child-friendly,
no text, no labels, no watermarks, no human elements,
clean background (white/light neutral or natural habitat),
sharp focus on subject, shallow depth of field for macro shots.
```

## 2. Hero Image（主图）Prompt 模板
- **用途**：完整展示生物全身
- **要求**：自然姿态，科学准确
- **构图**：3:2 横向构图 (Aspect Ratio: 3:2)

```
[BIO_EDU_MACRO_V1 Style Prefix]
Subject: Full body shot of a {species_name}.
Identity: {identity_description}.
Pose/Action: {pose_description}, natural and scientifically accurate posture.
Setting: Clean background, well-lit to show all body parts clearly.
```

## 3. Cover Image（封面缩略图）Prompt 模板
- **用途**：适合卡片展示的正方形构图
- **要求**：简洁背景，突出主体
- **构图**：正方形构图 (Aspect Ratio: 1:1)

```
[BIO_EDU_MACRO_V1 Style Prefix]
Subject: Centered portrait or full body of a {species_name}.
Identity: {identity_description}.
Pose/Action: Facing slightly towards the camera, engaging but natural.
Setting: Very clean, uncluttered background, strong contrast to make the subject pop.
```

## 4. Body Part Macro（部位特写）Prompt 模板
- **用途**：展示生物的特定解剖结构
- **要求**：微距摄影风格，必须包含 Consistency Lock
- **构图**：根据部位决定，通常 1:1 或 3:2

```
[BIO_EDU_MACRO_V1 Style Prefix]
Subject: Extreme macro close-up of the {part_name} of a {species_name}.
Identity: {identity_description}.
Part Details: {part_description}.
Camera Angle: {camera_angle}.
Setting: Clean background, studio lighting emphasizing texture and structure.
[Consistency Lock]
```

## 5. Consistency Lock 标准文本
放在每张部位图 Prompt 末尾的锁定文本，确保生成的部位与主图属于同一个体。
```
Consistency Lock: This macro shot MUST strictly match the exact {identity_description} of the same individual {species_name} shown in the reference image. Maintain identical colors, patterns, textures, and structural proportions.
```

## 6. 不同生物类别的 Prompt 差异化指导

- **昆虫 (Insects)**：
  - **强调**：极高倍微距 (extreme macro)、复眼结构 (compound eye structure)、翅脉细节 (wing venation details)、甲壳光泽 (exoskeleton iridescence)、细毛 (microscopic hairs)。
- **陆地动物 (Terrestrial Animals)**：
  - **强调**：皮毛质感 (fur texture/individual hairs)、肌肉线条 (muscle definition)、爪子细节 (claw details)、眼睛反射 (eye reflections)。
- **海洋生物 (Marine Life)**：
  - **强调**：水下柔和光线 (underwater volumetric lighting)、鳞片/皮肤质感 (scale/skin texture)、鳍的半透明度 (fin translucency)、鳃部结构 (gill structure)。
- **鸟类 (Birds)**：
  - **强调**：羽毛分层纹理 (layered feather textures)、虹彩反光 (iridescent plumage)、喙的质感 (beak keratin texture)、爪鳞 (scale patterns on feet)。

## 7. 完整 Prompt 示例：蜻蜓 (Dragonfly)

**物种身份 (Identity Description)**:
`blue and green thorax, iridescent transparent wings with black veins, metallic blue abdomen, large dark red compound eyes`

**Hero Image Prompt**:
```text
Style: Scientific macro photography, realistic biological texture, natural soft lighting, clean educational composition, premium children's science textbook quality, high-resolution, scientifically accurate, child-friendly, no text, no labels, no watermarks, no human elements, clean background (white/light neutral or natural habitat), sharp focus on subject, shallow depth of field for macro shots.
Subject: Full body shot of a dragonfly.
Identity: blue and green thorax, iridescent transparent wings with black veins, metallic blue abdomen, large dark red compound eyes.
Pose/Action: Resting on a thin green stem, wings fully spread, natural and scientifically accurate posture.
Setting: Clean background, well-lit to show all body parts clearly.
```

**Body Part Macro: 复眼 (Compound Eyes) Prompt**:
```text
Style: Scientific macro photography, realistic biological texture, natural soft lighting, clean educational composition, premium children's science textbook quality, high-resolution, scientifically accurate, child-friendly, no text, no labels, no watermarks, no human elements, clean background (white/light neutral or natural habitat), sharp focus on subject, shallow depth of field for macro shots.
Subject: Extreme macro close-up of the compound eyes of a dragonfly.
Identity: blue and green thorax, iridescent transparent wings with black veins, metallic blue abdomen, large dark red compound eyes.
Part Details: extreme detail of the hexagonal ommatidia pattern, dark red color with subtle light reflections, covering most of the head.
Camera Angle: Frontal face close-up.
Setting: Clean background, studio lighting emphasizing texture and structure.
Consistency Lock: This macro shot MUST strictly match the exact blue and green thorax, iridescent transparent wings with black veins, metallic blue abdomen, large dark red compound eyes of the same individual dragonfly shown in the reference image. Maintain identical colors, patterns, textures, and structural proportions.
```

**Body Part Macro: 翅膀 (Wings) Prompt**:
```text
Style: Scientific macro photography, realistic biological texture, natural soft lighting, clean educational composition, premium children's science textbook quality, high-resolution, scientifically accurate, child-friendly, no text, no labels, no watermarks, no human elements, clean background (white/light neutral or natural habitat), sharp focus on subject, shallow depth of field for macro shots.
Subject: Extreme macro close-up of the wings of a dragonfly.
Identity: blue and green thorax, iridescent transparent wings with black veins, metallic blue abdomen, large dark red compound eyes.
Part Details: delicate transparent membrane, intricate network of black veins, subtle iridescent rainbow reflections under light.
Camera Angle: Top-down view focused on one pair of wings.
Setting: Clean background, studio lighting emphasizing texture and structure.
Consistency Lock: This macro shot MUST strictly match the exact blue and green thorax, iridescent transparent wings with black veins, metallic blue abdomen, large dark red compound eyes of the same individual dragonfly shown in the reference image. Maintain identical colors, patterns, textures, and structural proportions.
```
