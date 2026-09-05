# 蜻蜓 (Dragonfly) — 完整生成流程范例

本文档以蜻蜓为例，展示 Bio Asset Generator 从头到尾的完整生成流程。
Agent 在执行生成任务时可参考此范例。

---

## Phase 1: 研究结果

### 基本信息

| 项目 | 中文 | 英文 |
|------|------|------|
| 名称 | 蜻蜓 | Dragonfly |
| 学名 | Anisoptera | Anisoptera |
| 拼音 | qīng tíng | — |
| 昵称 | 空中的捕猎高手 | The Aerial Hunter |
| 分类 | 昆虫 (insects) | Insect |
| 体长 | 3 - 8 cm | 3 - 8 cm |
| 栖息地 | 池塘、湖泊、溪流 | Ponds, lakes, streams |
| 食物 | 蚊子、苍蝇等小型飞行昆虫 | Mosquitoes, flies and other small flying insects |
| 寿命 | 成虫约 1-2 个月 | Adults ~1-2 months |
| 速度 | 最高可达 50 km/h | Up to 50 km/h |

### 确定的部位列表（10 个）

| # | ID | 中文 | 英文 | 特色 |
|---|----|----|------|------|
| 1 | compound-eyes | 复眼 | Compound Eyes | 占据头部大部分，近 360° 视野 |
| 2 | antennae | 触角 | Antennae | 短小细弱，不同于其他昆虫 |
| 3 | wings | 翅膀 | Wings | 两对透明翅膀，可独立拍打 |
| 4 | pterostigma | 翅痣 | Pterostigma | 翅膀前缘特有的深色斑块 |
| 5 | mouthparts | 口器 | Mouthparts | 咀嚼式，可空中进食 |
| 6 | thorax | 胸部 | Thorax | 充满飞行肌肉 |
| 7 | legs | 足 | Legs | 有刺毛，组成"捕猎篮" |
| 8 | abdomen | 腹部 | Abdomen | 细长多节，如方向舵 |
| 9 | abdominal-tip | 腹部末端 | Abdominal Tip | 交配和产卵用 |
| 10 | ocelli | 单眼 | Ocelli | 三只，感知光线强弱 |

---

## Phase 2: 数据结构（TypeScript）

生成文件：`src/data/species/dragonfly.ts`

```typescript
import { Species } from '../../types';

export const DRAGONFLY: Species = {
  id: 'dragonfly',
  categoryId: 'insects',
  nameZh: '蜻蜓',
  nameEn: 'Dragonfly',
  scientificName: 'Anisoptera',
  pinyin: 'qīng tíng',
  nicknameZh: '空中的捕猎高手',
  nicknameEn: 'The Aerial Hunter',
  heroImage: '/images/dragonfly/hero.jpg',
  coverImage: '/images/dragonfly/cover.jpg',
  basicInfo: {
    length: { zh: '3 - 8 cm', en: '3 - 8 cm' },
    habitat: { zh: '池塘、湖泊、溪流', en: 'Ponds, lakes, streams' },
    food: { zh: '蚊子、苍蝇等小型飞行昆虫', en: 'Mosquitoes, flies and other small flying insects' },
    lifespan: { zh: '成虫约 1-2 个月 (幼虫在水中生活数年)', en: 'Adults ~1-2 months (Nymphs live in water for years)' },
    speed: { zh: '最高可达 50 km/h', en: 'Up to 50 km/h' }
  },
  overviewZh: '蜻蜓是地球上最敏捷的空中猎手之一，拥有3亿年的进化历史。它们不仅能高速向前飞行，还能在空中悬停、倒退甚至翻滚。',
  overviewEn: 'Dragonflies are among the most agile aerial hunters on Earth with a 300-million-year evolutionary history. They can hover, fly backwards, and even do flips in the air.',
  bodyParts: [
    {
      id: 'compound-eyes',
      number: 1,
      nameZh: '复眼',
      nameEn: 'Compound Eyes',
      pinyin: 'fù yǎn',
      phoneticEn: '/ˈkɒmpaʊnd aɪz/',
      descZh: '由成千上万个小眼组成，视野广阔，能快速发现猎物。',
      descEn: 'Made up of thousands of tiny eyes, giving a wide field of view and helping detect prey quickly.',
      macroImage: '/images/dragonfly/part-1-compound-eyes.jpg',
      hotspot: { x: 53, y: 25, labelPosition: 'top-right' },
      funFactZh: '蜻蜓的复眼几乎占据了整个头部，几乎拥有 360 度的全景视野！',
      funFactEn: 'A dragonfly\'s compound eyes cover almost its whole head, giving nearly 360-degree vision!'
    },
    // ... 其余 9 个部位 ...
  ],
  quizQuestions: [
    // ... 3 道测验题 ...
  ]
};
```

---

## Phase 3: 提示词生成

### Species Identity（物种身份描述）

```
SPECIES IDENTITY - Dragonfly:
A blue-green darner dragonfly (Anisoptera) with an iridescent emerald-green
thorax marked with two pale lateral stripes, massive turquoise compound eyes
that cover most of the head and nearly touch at the top, four large transparent
wings with intricate dark brown venation and visible pterostigma (dark rectangular
patch near each wing tip), a long slender segmented abdomen with blue-green
coloring and fine black banding on each segment, six spiny legs positioned
forward under the thorax, and short bristle-like antennae barely visible
between the eyes. Body length approximately 7cm. Surface has a subtle
metallic iridescence.
```

### Hero Image Prompt

```
[BIO_EDU_MACRO_V1] Scientific macro photography, realistic biological texture,
natural soft lighting, clean educational composition, premium children's science
textbook quality, high-resolution, scientifically accurate, child-friendly,
no text, no labels, no watermarks, no human elements.
Extreme macro photography, visible wing venation details, compound eye facets
visible, iridescent body surface, natural perching pose, leaf as substrate.

SPECIES IDENTITY - Dragonfly:
A blue-green darner dragonfly with an iridescent emerald-green thorax marked
with two pale lateral stripes, massive turquoise compound eyes that cover most
of the head, four large transparent wings with intricate dark brown venation
and visible pterostigma, a long slender segmented abdomen with blue-green
coloring and fine black banding, six spiny legs, short bristle-like antennae.

SHOT: Full body portrait of this dragonfly perched naturally on a thin reed or
grass stem near water, viewed from a 45-degree side angle. All four wings are
spread open showing the complete venation pattern. The dragonfly is in sharp
focus against a softly blurred green and blue natural background suggesting
a pond environment. The lighting is warm and natural, highlighting the
iridescent quality of the thorax and the translucency of the wings.
```

**AspectRatio**: 3:2
**ImageName**: dragonfly_hero

### Cover Image Prompt

```
[BIO_EDU_MACRO_V1] Scientific macro photography, realistic biological texture,
natural soft lighting, clean educational composition, premium children's science
textbook quality, high-resolution, scientifically accurate, child-friendly,
no text, no labels, no watermarks, no human elements.

SPECIES IDENTITY - Dragonfly:
[Same identity description as above]

SHOT: Close-up portrait of this dragonfly, tightly framed showing head and
upper thorax prominently with wings partially visible. Square composition.
Clean, softly blurred natural green background. The massive compound eyes
are the visual focal point. Warm natural lighting.
```

**AspectRatio**: 1:1
**ImageName**: dragonfly_cover
**ImagePaths**: [hero image path]

### Body Part #1: 复眼 (Compound Eyes) Prompt

```
[BIO_EDU_MACRO_V1] Scientific macro photography, realistic biological texture,
natural soft lighting, clean educational composition, premium children's science
textbook quality, high-resolution, scientifically accurate, child-friendly,
no text, no labels, no watermarks, no human elements.
Extreme macro photography, compound eye facets visible, iridescent body surface.

SPECIES IDENTITY - Dragonfly:
[Same identity description as above]

SHOT: Extreme macro close-up of this dragonfly's compound eyes, photographed
from a frontal-slightly-above angle. The image should clearly show the
hexagonal facet structure (ommatidia) of the massive turquoise compound eyes.
The eyes should fill approximately 70% of the frame. The boundary where the
two eyes nearly meet at the top of the head should be visible. Shallow depth
of field with only the eye surface in sharp focus. The surrounding head
features (short antennae, mouthparts) are slightly visible but softly
out of focus.

CONSISTENCY LOCK:
This image belongs to the exact same individual specimen shown in the main image.
Preserve exactly: species identity, body color (emerald-green with pale stripes),
eye color (turquoise), body proportions, surface texture (metallic iridescence),
and all anatomical characteristics. This macro image must look like a zoomed-in
photograph of the same individual dragonfly.
```

**AspectRatio**: 3:2
**ImageName**: dragonfly_part_1_compound_eyes
**ImagePaths**: [hero image path]

### Body Part #3: 翅膀 (Wings) Prompt

```
[BIO_EDU_MACRO_V1] Scientific macro photography, realistic biological texture,
natural soft lighting, clean educational composition, premium children's science
textbook quality, high-resolution, scientifically accurate, child-friendly,
no text, no labels, no watermarks, no human elements.
Extreme macro photography, visible wing venation details, iridescent body surface.

SPECIES IDENTITY - Dragonfly:
[Same identity description as above]

SHOT: Macro close-up of this dragonfly's wings, showing one pair of transparent
wings from a slightly above angle. The intricate dark brown venation pattern
must be clearly visible with fine detail. The wing membrane should appear
translucent, catching light to show subtle rainbow iridescence. The pterostigma
(dark rectangular patch near the wing tip) should be visible. The wing connects
to the emerald-green thorax which is partially visible and slightly out of
focus. Background is a soft, blurred natural green.

CONSISTENCY LOCK:
This image belongs to the exact same individual specimen shown in the main image.
Preserve exactly: species identity, wing venation pattern (dark brown, intricate),
wing transparency, pterostigma color and position, thorax color (emerald-green
with pale stripes), and all anatomical characteristics. This macro image must
look like a zoomed-in photograph of the same individual dragonfly.
```

**AspectRatio**: 3:2
**ImageName**: dragonfly_part_3_wings
**ImagePaths**: [hero image path]

---

## Phase 4: 图片生成

### 生成顺序

```
1. dragonfly_hero        → 主图（锚点，后续所有图的参考）
   ↓ 用户确认
2. dragonfly_cover       → 封面（ImagePaths = [hero])
3. dragonfly_part_1_compound_eyes  (ImagePaths = [hero])
4. dragonfly_part_2_antennae       (ImagePaths = [hero])
5. dragonfly_part_3_wings          (ImagePaths = [hero])
6. dragonfly_part_4_pterostigma    (ImagePaths = [hero])
7. dragonfly_part_5_mouthparts     (ImagePaths = [hero])
8. dragonfly_part_6_thorax         (ImagePaths = [hero])
9. dragonfly_part_7_legs           (ImagePaths = [hero])
10. dragonfly_part_8_abdomen       (ImagePaths = [hero])
11. dragonfly_part_9_abdominal_tip (ImagePaths = [hero])
12. dragonfly_part_10_ocelli       (ImagePaths = [hero])
```

### 生成后的文件复制

```bash
# 将 Artifact 中的图片复制到项目目录
mkdir -p public/images/dragonfly/
cp <artifact_dir>/dragonfly_hero.png public/images/dragonfly/hero.jpg
cp <artifact_dir>/dragonfly_cover.png public/images/dragonfly/cover.jpg
cp <artifact_dir>/dragonfly_part_1_compound_eyes.png public/images/dragonfly/part-1-compound-eyes.jpg
# ... 以此类推
```

---

## Phase 5: 集成

### 1. 更新 index.ts

```typescript
import { DRAGONFLY } from './dragonfly';

export const ALL_SPECIES: Species[] = [
  DRAGONFLY,
  // ...
];

export const SPECIES_BY_CATEGORY: Record<CategoryId, Species[]> = {
  insects: [DRAGONFLY],
  // ...
};
```

### 2. 验证

```bash
npx tsc --noEmit    # TypeScript 类型检查
npm run build        # 构建检查
npm run dev          # 启动开发服务器查看效果
```

### 3. 完成摘要

```
✅ 物种：蜻蜓 (Dragonfly)
✅ 数据文件：src/data/species/dragonfly.ts
✅ 图片资产：public/images/dragonfly/ (12 张)
   - hero.jpg (主图)
   - cover.jpg (封面)
   - part-1-compound-eyes.jpg ~ part-10-ocelli.jpg (10 张部位特写)
✅ 索引更新：src/data/species/index.ts
✅ 类型检查：通过
✅ 构建检查：通过
```
