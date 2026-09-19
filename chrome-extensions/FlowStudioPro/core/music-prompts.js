if(typeof console!=="undefined"){console.log=function(){};console.warn=function(){};console.error=function(){};}
// core/music-prompts.js
// ═══════════════════════════════════════════════════════════════
// FLOW FACTORY PRO — 음악 가사 분할 9종 장르 프롬프트 템플릿
// 원천: 플로우팩토리Pro_최종통합개발명세서_v1.4.md
// 변수: {script} {hook_variation_intensity} {apply_narrative_arc}
//       {character_reference} {special_instructions}
// 스타일 우선순위:
//   1순위 {character_reference} > 2순위 {special_instructions} > 3순위 장르 기본값
// v1.4 보완:
//   - MCR 유연성 (인물 외 꽃/동물/자연/사물/추상)
//   - 앵글 강제 규칙 (Eye level 단독 금지, 뒷모습+프로필+실루엣 60%+)
//   - 매크로 CU 필수 5회+
//   - 반복 훅 단계적 앵글 진행 시퀀스 (훅 변주 강도로 제어)
// ═══════════════════════════════════════════════════════════════

const MUSIC_GENRE_COMMON_RULES = `
[공통 기본 규칙]
- 괄호 ( ), [ ], { }, < > 안 내용 완전 제외
- 장르·편성 메타 줄 제외 (예: "R&B Guitar Piano Male singer")
- 시간(초) 단위 추정 금지 (AI는 음악을 듣지 못함)
- 가사 라인 1~2줄 = 1 Beat (기본) / 강조 키워드·짧은 훅은 5자 이하도 독립 Beat 허용
- 반복 훅 일관성 유지 + 변주 적용 (훅 변주 강도에 따라)
- 서사 일관성 유지 (Beat 간 시각적 연결, 주인공·공간·소품 맥락)

[Beat 길이 유연성]
- 기본: 가사 1~2줄 = 1 Beat
- 짧은 Beat 허용 조건 (다음 중 하나라도 해당 시 5자 이하도 독립 Beat 가능):
  ① 강조 키워드 (감정 폭발·클라이맥스 단어): "사랑해", "stay", "너만을"
  ② 시각적 임팩트 큰 단어: 꽃, 별, 눈물, 불꽃, 바람
  ③ 리릭 타이포그래피로 활용 가능한 단어
  ④ 반복 훅의 핵심 짧은 구절: "천년화", "oh oh oh", "라라라"
  ⑤ 시적 여백이 필요한 순간
  ⑥ 한 줄 내에서 뒷부분이 시각적으로 더 강렬할 때
- 유연성 활용 비율: 전체 Beat 중 "짧은 강조 Beat"는 10~20% 이내

[서사 일관성 필수 규칙]
각 Beat는 독립 이미지가 아니라 하나의 뮤직비디오 서사를 이루는 구성 요소.

서사 유형 자동 판별 — 가사 전체를 분석하여 다음 중 하나로 결정:
  ① 관계 서사: 만남 → 사랑 → 갈등 → 이별/재회 (사랑 노래)
  ② 성장 서사: 역경 → 극복 → 성장 → 선언 (자신감·응원)
  ③ 회상 서사: 현재 → 과거 플래시백 → 현재 (노스탤지어)
  ④ 내면 서사: 고독 → 깨달음 → 변화 (자아 성찰)
  ⑤ 판타지 서사: 일상 → 환상 → 초월 (상상·꿈)
  ⑥ 공간 서사: A장소 → 이동 → B장소 (여정)

서사 연결 원칙:
- 각 Beat는 앞뒤 Beat와 시각적으로 연결
- 같은 주인공·같은 공간·같은 소품의 맥락 유지
- 주인공의 감정 여정이 단계적으로 진행
- 무작위 이미지 나열 금지
- 잘못된 예: Beat1 카페 → Beat2 우주 → Beat3 바다 (맥락 없음)
- 올바른 예: Beat1 카페 창가 → Beat2 창밖 비 → Beat3 우산 쓰고 나가는 뒷모습

[훅 변주 강도 적용 가이드]
hook_variation_intensity 값에 따른 처리:
  "low" (약함): 훅 반복 시 거의 동일 유지, 조명만 미세 변화, 주인공·공간·구도 완전 고정
  "medium" (중간, 기본값): 훅 반복 시 조명·앵글 변화, 낮 → 황혼 → 밤 순환, 주인공 상태 변화
  "high" (강함): 훅 반복 시 구도·계절·인물 대폭 변주, 봄꽃 → 여름비 → 가을낙엽 → 겨울눈

[기승전결 적용 가이드]
apply_narrative_arc = true 일 때 — 가사 전체를 4단 구조로 매핑:
  起 (초반 25%): 세계관 소개, 주인공 등장, 상황 설정
    앵글: 뒷모습·실루엣 중심 (정체 감춤), 감정: 잔잔, 호기심, 시작
  承 (중반 25%): 감정 전개, 갈등 심화, 주제 발전
    앵글: 프로필·부분 클로즈업, 감정: 몰입, 긴장 고조
  轉 (후반 25%): 반전, 클라이맥스, 감정 정점
    앵글: 3/4 앵글 → 정면샷 폭발, 감정: 폭발, 정점
  結 (마지막 25%): 여운, 영원성, 마무리
    앵글: 다시 뒷모습·실루엣으로 회귀, 감정: 평온, 깨달음, 영원
`.trim();

const MUSIC_GENRE_STYLE_PRIORITY = `
[스타일 우선순위 4계층 — 필수]
1순위: "사용자 커스텀 캐릭터 레퍼런스" (명시적 MCR 지정)
   → {character_reference} 값이 있으면 해당 캐릭터·스타일로 모든 Beat 절대 우선
2순위: "사용자 특별 지시사항" (MCR 재정의 가능)
   → {special_instructions} 값이 있으면 해당 스타일·설정 반영
3순위: "가사 분석 자동 판별" (MCR 유형 결정)
   → 위 [MCR 유연성 규칙] 에 따라 가사에서 MCR 유형 추론
4순위: "장르 기본 스타일 + 스타일 프리셋" (MCR 유형에 따라 조건부 적용)
   → 환경 계층은 항상 적용 / 인물 계층은 비인물 MCR일 때 MCR에 제외
   (상세: 위 [🎨 스타일 프리셋과 MCR 유형의 충돌 방지 규칙] 참조)

※ 장르별 앵글 비율·매크로 CU·극단 풀샷 규칙은 어떤 경우에도 유지
`.trim();

const MUSIC_GENRE_OUTPUT_FORMAT = `
[출력 형식 — CRITICAL]
Return ONLY JSON. No markdown, no explanation, no other text. COMPACT format.
{
  "characters": [
    {"code": "MCR", "name": "주인공명", "description": "MCR(Type: detailed description) — Type은 Human/Flower/Animal/Nature/Object/Abstract 중 하나"}
  ],
  "scenes": [
    [1, "MCR", "첫가사앞부분14자이내"],
    [2, "", "배경만설명14자이내"],
    [3, "MCR,SC1", "다음Beat가사"]
  ]
}

scenes = array of arrays: [sceneNumber, characters, scriptStart]
- scriptStart: 각 Beat의 가사 첫 줄 또는 핵심 키워드에서 공백·구두점 제거한 14자 이내 압축 텍스트
- characters: "MCR", "MCR,SC1" 등 코드 조합, 또는 "" (BG 컷 — 인물/대상 없이 풍경만)
- 최대 6개 코드: MCR + SC1~SC5
- Output ALL scenes on ONE LINE inside the array, no line breaks inside.
- scenes.length = 결정한 총 Beat 수 (사용자에게 알림으로 표시됨)

description 예시 (MCR 유형별):
  - MCR(Human: Korean female, 21yo, slim, long wavy black hair, wearing traditional white hanbok with pale blue jeogori)
  - MCR(Flower: mystical thousand-year bloom, luminous white petals with pink tips, jade-green slender stem)
  - MCR(Animal: white butterfly, translucent wings with faint golden veins, graceful flight)
  - MCR(Nature: heavy downpour rain, cold atmosphere, glistening droplets on urban surfaces)
  - MCR(Object: vintage grand piano, polished black lacquer surface, brass pedals)
  - MCR(Abstract: passage of time, visualized as flowing sand clock and golden hourglass particles)
`.trim();

// ─────────────────────────────────────────────
// ★ v1.4 — MCR 유연성 규칙 (9장르 공통 필수)
// ─────────────────────────────────────────────
const MUSIC_MCR_FLEXIBILITY_RULES = `
[MCR 유연성 규칙 — 반드시 가사 분석 후 적용]

MCR(Main Character)은 인물에 한정되지 않음. 곡의 주제와 가사에 따라 꽃·동물·자연·사물·추상 개념도 MCR 가능.

▶ MCR 비인물 가능 예시:
  🌸 식물/꽃: "천년화"→꽃, "벚꽃 엔딩"→벚꽃잎, "장미"→장미
  🦋 동물: "나비야"→나비, "늑대와 춤을"→늑대
  🌊 자연: "비야 내려라"→비, "바람이 분다"→바람, "달빛"→달빛
  🏠 사물/공간: "Piano Man"→피아노, "그 집 앞"→집, "카페 무스타슈"→카페
  💭 추상: "시간이 흘러"→시계/모래시계, "그리움"→편지·사진, "자유"→새·구름

▶ MCR 자동 판별 순서 (우선순위):
  1순위 — 곡 제목이 구체적 대상이면 그 대상이 MCR (가장 강력)
  2순위 — 반복 훅의 핵심 명사가 MCR
  3순위 — 가사 전체 화자 시점:
    • 1인칭 서정 고백 → 인물 MCR (화자 자신)
    • 3인칭 관조 묘사 → 대상 MCR
    • 2인칭 호명("임이여") → 호명 대상은 보조 캐릭터, 화자가 MCR
  4순위 — 애매하면 인물 MCR로 폴백

▶ MCR 표기 (반드시 유형 prefix 포함):
  MCR(Human: ...)       — 인물
  MCR(Flower: ...)      — 꽃/식물
  MCR(Animal: ...)      — 동물
  MCR(Nature: ...)      — 자연 현상 (비/바람/달빛)
  MCR(Object: ...)      — 사물/공간
  MCR(Abstract: ...)    — 추상 개념

▶ MCR이 인물 vs 비인물일 때 앵글 처리 차이:
  인물 MCR → 아래 [앵글 강제 규칙] 엄격 적용 (뒷모습·프로필·실루엣 중심)
  비인물 MCR → 다음 앵글 적극 활용:
    • 매크로 CU (꽃잎·이파리·결·질감)
    • 버드아이뷰 (꽃밭 전경, 들판)
    • 로우앵글 (거대함·위엄)
    • 틸트/회전 샷 (동적 움직임)
    • 시간 흐름 샷 (계절·낮밤 변화)
  ※ 보조 인물(SC1~SC5)이 등장할 때는 보조 캐릭터에 대해 [앵글 강제 규칙] 적용

▶ MCR 혼합 유형 (인물 ↔ 대상 공존):
  가사가 "변신" 서사(예: 여인이 꽃으로)이면 Beat별로 MCR 교차:
    Beat 1~8: MCR_FLOWER (꽃 주인공)
    Beat 9~12: MCR_HUMAN (인물 주인공, 변신 시점)
    Beat 13~끝: MCR_FLOWER (다시 꽃으로)

▶ 잘못된 해석 예시 ("천년화" 곡):
  ❌ MCR = 한복 입은 여인 (여인만 촬영) → 곡의 주인공 "천년화" 누락
  ✅ MCR = 천년화 꽃 자체 / SC1 = 기다리는 여인 / SC2 = 떠난 임
     → MCR 컷은 꽃잎 매크로 CU·꽃밭 버드아이·바람에 흔들리는 꽃
     → SC1 컷만 인물 앵글 규칙 적용
`.trim();

// ─────────────────────────────────────────────
// ★ 스타일 프리셋 × MCR 유형 충돌 방지 규칙 (9장르 공통)
// ─────────────────────────────────────────────
const MUSIC_STYLE_PRESET_CONFLICT_PREVENTION = `
[🎨 스타일 프리셋과 MCR 유형의 충돌 방지 규칙]

사용자가 선택한 스타일 프리셋(예: 조선 역사드라마, 한국 전통 2D/3D)이
인물 묘사(갓·상투·한복·비녀 등)를 포함하는 경우, MCR 유형에 따라 조건부 적용.

▶ ① 스타일 프리셋 2계층 해석

모든 스타일 프리셋은 다음 2계층으로 분해하여 해석:

  [환경·공간 계층] — 항상 적용 (MCR 유형과 무관)
    • 시대 배경 (예: 조선시대, 미래, 1990년대)
    • 공간 (예: 사찰, 궁궐, 도시, 자연)
    • 건축·소품 (예: 단청, 기와, 한옥, 네온 간판)
    • 조명·색채 (예: 골든아워, 블루아워, 촛불, 네온)
    • 렌더링 미학 (예: 시네마틱 실사, 수묵화, Pixar 3D)
    • 색채 팔레트 (예: 오방색, 세피아, 딥블루+앰버)

  [인물 계층] — 조건부 적용 (MCR 유형에 따라)
    • 헤어스타일 (예: 갓, 상투, 쪽머리, 비녀)
    • 의상 (예: 한복, 도포, 저고리, 정장)
    • 장신구 (예: 노리개, 옥가락지, 족두리)
    • 성별/연령 특화 묘사 (예: "for male/female")

▶ ② MCR 유형별 인물 계층 적용 규칙

  ★ MCR이 인물(Human)일 때:
    - MCR + SC(보조 캐릭터) 모두에 인물 계층 적용
    - [앵글 강제 규칙] 엄격 적용 (뒷모습·프로필·실루엣 중심)

  ★ MCR이 비인물(Flower/Animal/Nature/Object/Abstract)일 때:
    - MCR 단독 Beat: 인물 계층 완전 제외
      → 예: 꽃 매크로 Beat 에 "한복·갓·비녀" 언급 금지
      → 환경 계층만 적용 (시대 분위기·조명·색채 유지)
    - SC(보조 인물) 등장 Beat: 인물 계층을 SC에만 적용
      → 예: "여인이 꽃을 바라봄" Beat → SC1에게만 한복·쪽머리·비녀 적용
      → MCR(꽃)은 여전히 인물 계층 미적용

▶ ③ 비인물 MCR Beat 프롬프트 작성 시 명시 필수

비인물 MCR 단독 Beat 의 sceneDesc/charProps 생성 시 다음 원칙 반영:
  [MCR 단독 장면 인물 묘사 제외]
  이 Beat의 주인공은 {Flower|Animal|Nature|Object|Abstract} 이며,
  인물 요소(헤어스타일·의상·장신구·성별 묘사)는 포함하지 않음.
  스타일 프리셋의 환경 계층(시대·공간·건축·조명·색채·미학)만 적용.

▶ ④ 스타일 우선순위 4계층 체계

  1순위: 사용자 커스텀 캐릭터 레퍼런스 (명시적 MCR 지정)
     → {character_reference} 가 있으면 해당 캐릭터·스타일 절대 우선
  2순위: 사용자 특별 지시사항 (MCR 재정의 가능)
     → {special_instructions} 가 있으면 해당 지시 반영
  3순위: 가사 분석 자동 판별 (MCR 유형 결정)
     → 위 [MCR 유연성 규칙] 로 가사에서 MCR 유형 추론
  4순위: 스타일 프리셋 (MCR 유형에 따라 조건부 적용)
     → 환경 계층 항상 / 인물 계층은 MCR 유형 기반 조건부

▶ ⑤ 충돌 예시 (반드시 회피)

  ❌ 잘못된 생성 (충돌):
     "cinematic photograph. Joseon. Sangtu topknot. Gat hat. Noble Hanbok.
      MCR(Flower: mystical white bloom...). Close-up of petals."
     → 한복 입은 꽃? 모순됨.

  ✅ 올바른 생성 (환경만 적용):
     "cinematic photograph. Joseon Dynasty atmosphere. Traditional temple
      eaves. Golden hour light. Authentic period setting.
      MCR(Flower: mystical white bloom with crimson tips, glowing on
      ancient stone altar)."
     → 인물 토큰(Sangtu·Hanbok) 제외, 시대·공간·조명만 유지

  ✅ 혼합 Beat (SC 등장 시):
     "cinematic photograph. Joseon. Golden hour.
      MCR(Flower: white bloom...). SC1(Korean female, 한복, 쪽머리, 비녀,
      kneeling before the flower)."
     → 꽃은 자연 그대로, SC1에게만 인물 계층 적용
`.trim();

// ─────────────────────────────────────────────
// ★ v1.4 — 앵글 강제 규칙 (인물 대상 컷에 적용)
// ─────────────────────────────────────────────
const MUSIC_ANGLE_ENFORCEMENT_RULES = `
[앵글 강제 규칙 — 인물 MCR 또는 보조 인물 캐릭터(SC)에 적용]

▶ "Eye level" 단독 사용 금지:
  모든 인물 앵글 표기 시 반드시 "각도+시점 2가지 이상" 명시
    ❌ 금지: "Close-up, Eye level"
    ✅ 올바른 표기:
      - "Back view, Eye level" (뒷모습 눈높이)
      - "Profile shot, Eye level" (프로필 눈높이)
      - "Three-quarter back, Eye level" (3/4 뒤)
      - "Silhouette against light, Eye level" (실루엣)
      - "Extreme close-up of hands/feet/back of neck, face not visible" (부분 매크로)

▶ 인물 단독 컷 앵글 분배 (MCR 또는 SC만 있는 Beat):
  - 뒷모습(Back view): target 최소 25%
  - 프로필/측면(Profile/Side): target 최소 20%
  - 3/4 뒤(Three-quarter back): target 최소 15%
  - 실루엣(Silhouette): target 최소 10%
  - 부분 신체 매크로(손·발·목선): target 최소 20%
  - 정면 응시(Front-facing direct gaze): 장르별 허용치 내 + 클라이맥스 1~2회에만
  ※ 뒷모습+프로필+실루엣 합이 전체 인물 컷의 60%+ 유지

▶ 인물 앵글 표현 가이드 (Gemini 프롬프트 문구):
  - 뒷모습: "Shot from behind, facing away", "Back turned to camera"
  - 프로필: "Profile shot, subject looking to the side"
  - 3/4 뒤: "Three-quarter angle from behind, slight head turn"
  - 실루엣: "Silhouette against light source, face obscured"
  - 부분 매크로: "Close-up of hands/feet/back of neck, face not visible"

▶ 정면 응시는 극적 순간에만 허용:
  - 훅 최종 클라이맥스 1~2회
  - 감정 폭발 정점 1회
  - 장르별 허용 비율 이내 엄수 (아래 [필수 앵글 비율] 섹션 참조)
  - 아낀 정면샷이 최고의 감동을 만든다
`.trim();

// ─────────────────────────────────────────────
// ★ v1.4 — 매크로 CU 필수 활용 (9장르 공통)
// ─────────────────────────────────────────────
const MUSIC_MACRO_CU_REQUIREMENT = `
[매크로 클로즈업 필수 활용 — 전체 Beat의 25% (최소 20%)]

▶ 전체 Beat 수의 25%를 매크로 CU로 배치 — 어떤 장르·대본 유형이든 필수 적용
  (예: 30 Beat → 7~8 매크로 CU, 60 Beat → 15 매크로 CU)
▶ 단일 대상 반복 금지 — 아래 5개 카테고리 중 3개 이상 조합 (카테고리 a~e):
  (a) Body-emotion (신체·감정): 단일 눈/동공/떨리는 입술/맺힌 눈물/꽉 쥔 주먹/이마 땀/목의 맥박/속눈썹 떨림
  (b) Micro-gesture (미세 제스처): 천·폰 움켜쥐는 손가락/초조한 톡톡/하얗게 질린 관절/침 삼킴/펜 끝 접촉/반지 회전
  (c) Object-symbol (오브젝트 상징): 가격표/동전 모서리/초침/반지/지폐 결/열쇠 이빨/버튼 누름/편지 봉인
  (d) Nature-detail (자연 디테일): 꽃잎 이슬/빗방울/잎맥/촛불 흔들림/수증기/눈송이/물결
  (e) Genre-specific (장르 특화): 악기 줄/기타 헤드/마이크 망/한복 자수/스피커 진동/ LP 홈/가사 책
▶ 매크로 CU 사용 시점: 감정 극대화·상징·갈등·깨달음·후회·그리움·회심의 순간·클라이맥스·핵심 상징
▶ 형식:
  - Body/Gesture 매크로: characters="MCR" 유지 + charProps에 전체 identity 토큰 + macro 묘사
  - Object/Nature/Genre 매크로: characters="" + charProps="Extreme macro close-up of {details}."
`.trim();

// ─────────────────────────────────────────────
// ★ v1.4 — 반복 훅 앵글 진행 시퀀스 (훅 변주 강도로 제어)
// ─────────────────────────────────────────────
const MUSIC_HOOK_REPEAT_SEQUENCE = `
[반복 훅 앵글 진행 시퀀스 — hook_variation_intensity 에 따라 다름]

같은 가사/훅이 여러 번 반복될 때, 앵글을 단계적으로 진행 → 관객이 점차 주인공에게 다가가는 느낌.
"정면은 마지막에 아껴라. 마지막 정면 응시가 노래 전체의 감동을 폭발시킨다."

▶ hook_variation_intensity = "low" (약함) — 반복 3회 축약:
  1차: 뒷모습/실루엣  →  2차: 프로필  →  3차(최종): 정면 클라이맥스
  조명만 미세 변화 (낮→황혼), 주인공·공간·구도 고정

▶ hook_variation_intensity = "medium" (중간, 기본값) — 반복 5회 축약:
  1차: 뒷모습  →  2차: 3/4 뒤  →  3차: 프로필  →  4차: 부분 매크로(손·목선)  →  5차(최종): 정면
  조명·앵글 변화, 낮→황혼→밤 순환, 주인공 상태 변화 (혼자→둘)

▶ hook_variation_intensity = "high" (강함) — 반복 10회 표준 시퀀스:
  1차: Bird's eye / Extreme wide (세계관 소개)
  2차: Full shot, silhouette from behind (정체 숨김)
  3차: Medium shot, three-quarter back (몸짓 드러냄)
  4차: Macro CU (hair·jewelry·accessory) (디테일)
  5차: Profile shot, side view (옆모습 첫 등장)
  6차: Over-the-shoulder back (관객 시점 이입)
  7차: Back view walking away (움직임·공간감)
  8차: Silhouette against light (극적 분위기)
  9차: Extreme CU of eyes only (긴장 고조)
  10차(최종): Front-facing direct gaze (폭발적 임팩트)
  구도·계절·인물 대폭 변주 (봄꽃→여름비→가을낙엽→겨울눈)

▶ 비인물 MCR의 훅 진행 (꽃·자연·사물):
  1차: 원경/버드아이  →  2차: 풀샷  →  3차: 미디엄+환경 상호작용
  →  4차: 매크로 CU (꽃잎/결/질감)  →  5차: 시간 흐름 (낮→밤)
  →  (high일 때) 계절 변화, 회전 샷, 클라이맥스 극단 CU
`.trim();

// ─────────────────────────────────────────────
// 9종 장르 프롬프트
// ─────────────────────────────────────────────

const MUSIC_GENRE_PROMPTS = {

// ════════ ① 시네마틱 발라드/팝 ════════
cinematic_ballad: `세련된 시네마틱 발라드/팝 뮤직비디오용 Visual Beat 분할을 수행합니다.

${MUSIC_GENRE_COMMON_RULES}

${MUSIC_MCR_FLEXIBILITY_RULES}

${MUSIC_STYLE_PRESET_CONFLICT_PREVENTION}

${MUSIC_ANGLE_ENFORCEMENT_RULES}

${MUSIC_MACRO_CU_REQUIREMENT}

${MUSIC_HOOK_REPEAT_SEQUENCE}

[장르 미학]
영화적 시선, 깊은 감정, 얇은 심도, 여백의 미, 관조적 시점

[필수 앵글 비율]
- 정면 응시샷: 최대 10%
- 매크로 클로즈업: 20~25%
- 극단 풀샷/버드아이뷰: 15~20%
- 프로필/측면: 15~20%
- 뒷모습/실루엣: 15~20%
- BG 컷: 25~30%

[매크로 클로즈업 대상]
- 신체: 눈물 방울, 속눈썹, 손끝, 입술, 쇄골, 머리카락 한 올, 지문
- 오브젝트: 편지지 위 잉크 번짐, 반지, 시계 초침, 찻잔 모락모락
- 자연: 꽃잎 이슬, 빗방울, 눈송이, 낙엽 한 장

[극단 풀샷/버드아이뷰 대상]
- 광활한 바다·산맥·사막·들판
- 도시 야경 오버뷰 (헬기 시점)
- 작은 인물과 거대한 자연/건축의 대비
- 드론 버드아이 (인물이 점처럼)

[시각 스타일]
- "shallow depth of field, f/1.2~f/2.0"
- "35mm anamorphic, film grain"
- "golden hour / blue hour / candlelight"
- "muted cinematic color grading"
- 감독 레퍼런스: Roger Deakins, Wong Kar-wai, Terrence Malick

[색채 팔레트]
무채색 + 골드 악센트 / 블루 + 앰버 / 세피아 + 크림슨

[훅 변주 전략]
- 훅 1차: 뒷모습 또는 실루엣 (정체 감춤)
- 훅 2차 변주: 프로필로 전환 (조금씩 드러냄)
- 훅 최종 클라이맥스: 정면샷 (임팩트 폭발)

${MUSIC_GENRE_STYLE_PRIORITY}

[사용자 설정]
훅 변주 강도: {hook_variation_intensity}
기승전결 적용: {apply_narrative_arc}

[사용자 커스텀 캐릭터 레퍼런스] (있을 경우 1순위 적용)
{character_reference}

[사용자 특별 지시사항] (있을 경우 2순위 적용)
{special_instructions}

[가사]
{script}

${MUSIC_GENRE_OUTPUT_FORMAT}`,

// ════════ ② 국악/전통/동양적 ════════
korean_traditional: `한국 국악/전통/동양적 뮤직비디오용 Visual Beat 분할을 수행합니다.

${MUSIC_GENRE_COMMON_RULES}

${MUSIC_MCR_FLEXIBILITY_RULES}

${MUSIC_STYLE_PRESET_CONFLICT_PREVENTION}

${MUSIC_ANGLE_ENFORCEMENT_RULES}

${MUSIC_MACRO_CU_REQUIREMENT}

${MUSIC_HOOK_REPEAT_SEQUENCE}

[장르 미학]
수묵화적 여백, 자연과 조화, 시공간 초월, 동양화 미학, 시적 정서

[필수 앵글 비율]
- 정면 응시샷: 최대 5% (거의 사용 안 함)
- 매크로 클로즈업: 20~25%
- 극단 풀샷/버드아이뷰: 20~25%
- 프로필/측면: 15~20%
- 뒷모습/실루엣: 20~25%
- BG 컷: 30~35%

[매크로 클로즈업 대상]
- 자연: 살구꽃 꽃잎, 대나무 이슬, 연꽃 수술, 단풍잎 잎맥
- 전통 소품: 한복 자수, 족두리 비녀, 부채 살, 먹과 벼루, 한지 결
- 건축: 단청 문양, 기와 결, 처마 끝, 풍경 종, 문살
- 신체: 버선발 끝, 한복 소매 속 손, 옥가락지 낀 손가락

[극단 풀샷/버드아이뷰 대상]
- 산사 전경 (무량수전, 부석사, 해인사)
- 안개 낀 산맥 파노라마
- 대나무 숲 상공 드론
- 강·바다·폭포 광활한 풍경
- 단풍 숲·설경 원경
- 작은 인물과 거대한 자연

[시각 스타일]
- "Ink wash painting aesthetic meets photorealism"
- "East Asian atmospheric perspective"
- "Traditional Korean palette: 오방색 + muted tones"
- "Silk scroll painting composition"
- 레퍼런스: 김홍도, 신윤복, Crouching Tiger Hidden Dragon, 왕가위

[색채 팔레트]
수묵 블랙 + 크림슨 악센트 / 청자빛 블루 + 골드 / 오방색 (청·적·황·백·흑)

[주요 모티프]
- 꽃잎 흩날림, 비 내림, 안개 흐름
- 한복 소매 바람
- 전통 건축 실루엣
- 달·별·구름

[훅 변주 전략]
- 훅 1차: 뒷모습 서 있는 인물, 먼 전통 건축
- 훅 2차 변주: 옆모습, 바람에 흔들리는 한복
- 훅 3차: 3/4 뒤 각도, 살짝 돌아보는 실루엣
- 훅 최종: 꽃잎 흩날리는 가운데 정면 응시

${MUSIC_GENRE_STYLE_PRIORITY}

[사용자 설정]
훅 변주 강도: {hook_variation_intensity}
기승전결 적용: {apply_narrative_arc}

[사용자 커스텀 캐릭터 레퍼런스] (있을 경우 1순위 적용)
{character_reference}

[사용자 특별 지시사항] (있을 경우 2순위 적용)
{special_instructions}

[가사]
{script}

${MUSIC_GENRE_OUTPUT_FORMAT}`,

// ════════ ③ 힙합/랩 ════════
hiphop_rap: `세련된 힙합/랩 뮤직비디오용 Visual Beat 분할을 수행합니다.

${MUSIC_GENRE_COMMON_RULES}

${MUSIC_MCR_FLEXIBILITY_RULES}

${MUSIC_STYLE_PRESET_CONFLICT_PREVENTION}

${MUSIC_ANGLE_ENFORCEMENT_RULES}

${MUSIC_MACRO_CU_REQUIREMENT}

${MUSIC_HOOK_REPEAT_SEQUENCE}

[장르 미학]
어반 자신감, 스트릿 에너지, 권위·위엄, 크루 소속감, 도시의 리듬감

[필수 앵글 비율]
- 정면 응시샷: 20~25% (힙합 특화 - 자신감 표현)
- 로우 앵글(올려찍기): 15% (권위·위엄)
- 매크로 클로즈업: 20~25%
- 극단 풀샷: 10~15%
- 크루 샷(단체): 10~15%
- 슬로우 모션: 15%
- BG 컷(어반 풍경): 20%

[힙합 특화 앵글 활용]
- 정면 응시: 선글라스·후드 쓴 채 카메라 직시 → 당당함
- 로우 앵글: 걸어오는 인물 아래서 위로 → 위엄
- 오버헤드: 원형 카메라 무빙처럼 서술
- 슬로우 모션: 느린 걸음, 머리 흔들기, 옷자락 바람

[매크로 클로즈업 대상]
- 패션: 금목걸이 체인, 반지, 시계, 스니커즈 로고, 선글라스 반사
- 신체: 타투, 굳게 쥔 주먹, 손바닥 구겨진 지폐, 입술·금니
- 어반 소품: 담배 연기, 위스키 얼음, 현금 다발, 마이크
- 소재: 가죽 재킷 질감, 청바지 낡은 결, 금속 광택

[극단 풀샷/공간 대상]
- 뒷골목, 공사장, 옥상, 언더패스, 지하주차장
- 도시 야경 스카이라인
- 네온 간판 거리
- 버려진 창고, 컨테이너 야드
- 농구 코트, 스트릿 농구장

[크루 샷(단체) 구성]
- 일직선으로 걸어오는 3~5인 크루
- 벽에 기댄 단체 포즈
- 차량 주변에 모인 그룹
- 옥상에서 내려다보는 단체

[시각 스타일]
- "Urban gritty cinematography, high contrast"
- "Neon and sodium vapor lighting"
- "Graffiti texture, street photography aesthetic"
- "Anamorphic widescreen, motion blur"
- 레퍼런스: Hype Williams, Director X, The Weeknd "Blinding Lights"

[색채 팔레트]
블랙 + 골드 / 네온 핑크·블루 / 채도 낮춘 어반 톤 / 빨강·노랑 포인트

[주요 모티프]
- 체인, 시계, 스니커, 돈
- 담배 연기, 네온 반사
- 자동차 헤드라이트 플레어
- 도시 반사광, 비 젖은 아스팔트

${MUSIC_GENRE_STYLE_PRIORITY}

[사용자 설정]
훅 변주 강도: {hook_variation_intensity}
기승전결 적용: {apply_narrative_arc}

[사용자 커스텀 캐릭터 레퍼런스] (있을 경우 1순위 적용)
{character_reference}

[사용자 특별 지시사항] (있을 경우 2순위 적용)
{special_instructions}

[가사]
{script}

${MUSIC_GENRE_OUTPUT_FORMAT}`,

// ════════ ④ R&B/소울/어반 ════════
rnb_soul: `세련된 R&B/소울 뮤직비디오용 Visual Beat 분할을 수행합니다.

${MUSIC_GENRE_COMMON_RULES}

${MUSIC_MCR_FLEXIBILITY_RULES}

${MUSIC_STYLE_PRESET_CONFLICT_PREVENTION}

${MUSIC_ANGLE_ENFORCEMENT_RULES}

${MUSIC_MACRO_CU_REQUIREMENT}

${MUSIC_HOOK_REPEAT_SEQUENCE}

[장르 미학]
어반 감성, 세련된 어둠, 섹슈얼 긴장감, 내면의 고독, 밤의 시

[필수 앵글 비율]
- 정면 응시샷: 최대 10%
- 매크로 클로즈업: 25%
- 극단 풀샷: 10~15%
- 프로필/측면: 20~25%
- 뒷모습/실루엣: 20~25%
- BG 컷: 25~30%

[매크로 클로즈업 대상]
- 신체: 목선, 쇄골, 손끝, 눈동자 반사, 입술, 귀걸이, 흘러내린 머리
- 오브젝트: 와인잔, 담배 연기, 얼음, 커튼 결, 실크 시트 주름
- 디테일: 네온 반사가 담긴 선글라스, 립스틱 자국, 반지

[극단 풀샷 대상]
- 거대한 호텔 방, 빈 수영장, 펜트하우스 전경
- 도시 야경 (펜트하우스 창가)
- 한밤중 고속도로, 빈 주차장
- 작은 인물 + 거대한 모던 공간

[시각 스타일]
- "Moody urban cinematography"
- "Neon-lit nighttime atmosphere"
- "Soft focus, velvet textures"
- "Low-key lighting with high contrast"
- 레퍼런스: Hiro Murai, Sing Howie, The Weeknd MV 스타일

[색채 팔레트]
딥 블루 + 앰버 / 버건디 + 네이비 / 퍼플 + 핑크 네온

[주요 모티프]
- 창문 비, 실내 어둠, 네온 빛 스트릭
- 시가 연기, 와인, 실크
- 도시 야경 반사

${MUSIC_GENRE_STYLE_PRIORITY}

[사용자 설정]
훅 변주 강도: {hook_variation_intensity}
기승전결 적용: {apply_narrative_arc}

[사용자 커스텀 캐릭터 레퍼런스] (있을 경우 1순위 적용)
{character_reference}

[사용자 특별 지시사항] (있을 경우 2순위 적용)
{special_instructions}

[가사]
{script}

${MUSIC_GENRE_OUTPUT_FORMAT}`,

// ════════ ⑤ 인디/포크/어쿠스틱 ════════
indie_folk: `세련된 인디/포크/어쿠스틱 뮤직비디오용 Visual Beat 분할을 수행합니다.

${MUSIC_GENRE_COMMON_RULES}

${MUSIC_MCR_FLEXIBILITY_RULES}

${MUSIC_STYLE_PRESET_CONFLICT_PREVENTION}

${MUSIC_ANGLE_ENFORCEMENT_RULES}

${MUSIC_MACRO_CU_REQUIREMENT}

${MUSIC_HOOK_REPEAT_SEQUENCE}

[장르 미학]
로파이 감성, 자연스러운 일상, 어쓰톤, 진솔함, 핸드메이드 따뜻함

[필수 앵글 비율]
- 정면 응시샷: 최대 15%
- 매크로 클로즈업: 25%
- 극단 풀샷: 15~20%
- 프로필/측면: 20%
- 뒷모습/실루엣: 15%
- BG 컷(자연/일상): 25~30%

[매크로 클로즈업 대상]
- 자연: 야생화, 풀잎 이슬, 커피 김, 책장 넘김, 필름 사진
- 일상: 손편지 쓰는 손, 기타 줄, 피아노 건반, 찻잔, LP판
- 신체: 맨발로 잔디 밟기, 바람에 날리는 머리, 웃을 때 눈가 주름

[극단 풀샷 대상]
- 황금빛 밀밭, 들꽃 만발한 언덕
- 호숫가·강가 평화로운 풍경
- 시골 오솔길, 작은 집, 나무 한 그루
- 일몰 무렵 실루엣 풍경

[시각 스타일]
- "Lo-fi indie aesthetic"
- "Super 8 film texture, light leaks"
- "Natural lighting, handheld feel"
- "Faded warm color grading"
- 레퍼런스: Wes Anderson (부분), Sofia Coppola, Terrence Malick

[색채 팔레트]
어쓰톤 (베이지·머스타드·올리브) / 파스텔 핑크+크림 / 빈티지 세피아

[주요 모티프]
- 햇살, 먼지 입자, 커튼 흔들림
- 필름 카메라, 자전거, 폴라로이드
- 카페, 서점, 작은 방

${MUSIC_GENRE_STYLE_PRIORITY}

[사용자 설정]
훅 변주 강도: {hook_variation_intensity}
기승전결 적용: {apply_narrative_arc}

[사용자 커스텀 캐릭터 레퍼런스] (있을 경우 1순위 적용)
{character_reference}

[사용자 특별 지시사항] (있을 경우 2순위 적용)
{special_instructions}

[가사]
{script}

${MUSIC_GENRE_OUTPUT_FORMAT}`,

// ════════ ⑥ EDM/댄스/일렉트로닉 ════════
edm_dance: `역동적 EDM/댄스 뮤직비디오용 Visual Beat 분할을 수행합니다.

${MUSIC_GENRE_COMMON_RULES}

${MUSIC_MCR_FLEXIBILITY_RULES}

${MUSIC_STYLE_PRESET_CONFLICT_PREVENTION}

${MUSIC_ANGLE_ENFORCEMENT_RULES}

${MUSIC_MACRO_CU_REQUIREMENT}

${MUSIC_HOOK_REPEAT_SEQUENCE}

[장르 미학]
폭발적 에너지, 사이버펑크, 네온 카오스, 고채도, 미래적 감각

[필수 앵글 비율]
- 정면 응시샷: 25~30% (강력한 임팩트)
- 매크로 클로즈업: 15%
- 동적 미디엄샷: 20~25%
- 크루/군중 샷: 10%
- BG 컷(추상·그래픽): 20%

[매크로 클로즈업 대상]
- 눈 (강렬한 시선)
- 입술·치아
- 빛나는 액세서리
- 땀방울, 머리카락 휘날림
- 손가락 튕김

[극단 풀샷/공간 대상]
- 거대한 클럽, 경기장 무대
- 사이버펑크 도시
- 네온 터널, 홀로그램 공간
- 우주적 추상 공간

[시각 스타일]
- "Neon cyberpunk aesthetic"
- "High saturation, digital art"
- "Motion blur, light trails"
- "Strobe effect simulation"
- "Anime-inspired dynamics"
- 레퍼런스: Blade Runner 2049, Tron Legacy

[색채 팔레트]
네온 핑크+사이언 / 레드+블루 (사이버펑크) / 보라+그린 (UV)

[주요 모티프]
- 레이저, 스트로브, 홀로그램
- 파티클 이펙트
- 디지털 글리치
- 미래 건축물

${MUSIC_GENRE_STYLE_PRIORITY}

[사용자 설정]
훅 변주 강도: {hook_variation_intensity}
기승전결 적용: {apply_narrative_arc}

[사용자 커스텀 캐릭터 레퍼런스] (있을 경우 1순위 적용)
{character_reference}

[사용자 특별 지시사항] (있을 경우 2순위 적용)
{special_instructions}

[가사]
{script}

${MUSIC_GENRE_OUTPUT_FORMAT}`,

// ════════ ⑦ 록/얼터너티브 ════════
rock_alternative: `세련된 록/얼터너티브 뮤직비디오용 Visual Beat 분할을 수행합니다.

${MUSIC_GENRE_COMMON_RULES}

${MUSIC_MCR_FLEXIBILITY_RULES}

${MUSIC_STYLE_PRESET_CONFLICT_PREVENTION}

${MUSIC_ANGLE_ENFORCEMENT_RULES}

${MUSIC_MACRO_CU_REQUIREMENT}

${MUSIC_HOOK_REPEAT_SEQUENCE}

[장르 미학]
카리스마, 반항, 강한 에너지, 모노크롬 미학, 음산한 아름다움

[필수 앵글 비율]
- 정면 응시샷: 최대 15%
- 매크로 클로즈업: 20%
- 극단 풀샷: 15%
- 로우 앵글: 15% (권위·위엄)
- 크루/밴드 샷: 15%
- 슬로우 모션: 10%
- BG 컷: 20%

[매크로 클로즈업 대상]
- 기타 픽, 드럼 스틱, 마이크
- 가죽 재킷 디테일, 찢어진 청바지
- 땀방울, 눈빛, 굳게 쥔 주먹
- 피어싱, 타투

[극단 풀샷 대상]
- 무대 와이드, 콘서트 홀
- 황량한 사막·공사장
- 비바람 몰아치는 해안 절벽
- 빈 도시 새벽

[시각 스타일]
- "High contrast monochrome"
- "Gritty grain, bleach bypass"
- "Dramatic chiaroscuro lighting"
- "Anamorphic lens distortion"
- 레퍼런스: Anton Corbijn, Chris Cunningham, David Fincher

[색채 팔레트]
흑백 + 빨강 포인트 / 블리치 바이패스 / 로우키 모노톤

[주요 모티프]
- 번개, 비, 바람
- 깨진 유리, 불꽃
- 악기 클로즈업

${MUSIC_GENRE_STYLE_PRIORITY}

[사용자 설정]
훅 변주 강도: {hook_variation_intensity}
기승전결 적용: {apply_narrative_arc}

[사용자 커스텀 캐릭터 레퍼런스] (있을 경우 1순위 적용)
{character_reference}

[사용자 특별 지시사항] (있을 경우 2순위 적용)
{special_instructions}

[가사]
{script}

${MUSIC_GENRE_OUTPUT_FORMAT}`,

// ════════ ⑧ 트로트/성인가요 ════════
trot: `감성적 트로트/성인가요 뮤직비디오용 Visual Beat 분할을 수행합니다.

${MUSIC_GENRE_COMMON_RULES}

${MUSIC_MCR_FLEXIBILITY_RULES}

${MUSIC_STYLE_PRESET_CONFLICT_PREVENTION}

${MUSIC_ANGLE_ENFORCEMENT_RULES}

${MUSIC_MACRO_CU_REQUIREMENT}

${MUSIC_HOOK_REPEAT_SEQUENCE}

[장르 미학]
노스탤지어, 한국적 정서, 드라마 같은 서사, 인생의 굴곡, 따뜻한 회상

[필수 앵글 비율]
- 정면 응시샷: 20% (감정 전달 직접)
- 매크로 클로즈업: 20%
- 극단 풀샷: 15%
- 프로필/측면: 20%
- 뒷모습: 10%
- 크루/군중: 5%
- BG 컷(향수 감성): 20%

[매크로 클로즈업 대상]
- 주름진 손, 눈가 주름, 은반지
- 오래된 사진, 빛바랜 편지
- 소주잔, 막걸리 잔, 김치
- 시골 풍경 소품

[극단 풀샷 대상]
- 시골 들판, 노을 지는 논
- 한국 재래시장, 포장마차
- 옛 기차역, 시골 버스 정류장
- 바닷가 마을 전경

[시각 스타일]
- "Nostalgic 1980s Korean film aesthetic"
- "Warm faded colors, golden hour dominance"
- "Slight film grain, vintage Kodak"
- "Soft-focus romanticism"
- 레퍼런스: 1970~80년대 한국 영화

[색채 팔레트]
세피아 + 골드 / 웜 베이지 + 브라운 / 오렌지 석양 + 네이비

[주요 모티프]
- 기차, 역, 술집
- 어머니·아버지·고향 (인물 서사)
- 계절 (봄비, 낙엽, 첫눈)

${MUSIC_GENRE_STYLE_PRIORITY}

[사용자 설정]
훅 변주 강도: {hook_variation_intensity}
기승전결 적용: {apply_narrative_arc}

[사용자 커스텀 캐릭터 레퍼런스] (있을 경우 1순위 적용)
{character_reference}

[사용자 특별 지시사항] (있을 경우 2순위 적용)
{special_instructions}

[가사]
{script}

${MUSIC_GENRE_OUTPUT_FORMAT}`,

// ════════ ⑨ 동요/어린이/판타지 ════════
children_fantasy: `밝고 따뜻한 동요/어린이/판타지 뮤직비디오용 Visual Beat 분할을 수행합니다.

${MUSIC_GENRE_COMMON_RULES}

${MUSIC_MCR_FLEXIBILITY_RULES}

${MUSIC_STYLE_PRESET_CONFLICT_PREVENTION}

${MUSIC_ANGLE_ENFORCEMENT_RULES}

${MUSIC_MACRO_CU_REQUIREMENT}

${MUSIC_HOOK_REPEAT_SEQUENCE}

[장르 미학]
순수함, 상상력, 동화적 판타지, 수채화 감성, 마법 같은 일상

[필수 앵글 비율]
- 정면 응시샷: 20%
- 매크로 클로즈업: 25%
- 극단 풀샷/버드아이뷰: 20%
- 프로필/측면: 15%
- 뒷모습: 10%
- BG 컷: 10%

[매크로 클로즈업 대상]
- 무당벌레, 나비 날개, 민들레 홀씨
- 물방울에 비친 무지개
- 아이 손바닥 위 씨앗
- 색연필, 크레용, 도화지
- 과일, 사탕, 구슬

[극단 풀샷 대상]
- 꽃밭, 잔디밭, 언덕
- 구름 위 상상 공간
- 동화 속 성, 숲 속 오두막
- 거대한 나무와 작은 아이
- 무지개 아래 들판

[시각 스타일]
- "Children's book watercolor illustration"
- "Studio Ghibli inspired magical realism"
- "Soft pastel palette, whimsical"
- "Dreamy bokeh, warm light"
- 레퍼런스: 하야오 미야자키, Beatrix Potter

[색채 팔레트]
파스텔 레인보우 / 민트+피치 / 라벤더+크림

[주요 모티프]
- 꽃, 나비, 새
- 구름, 별, 달
- 동물 친구들

${MUSIC_GENRE_STYLE_PRIORITY}

[사용자 설정]
훅 변주 강도: {hook_variation_intensity}
기승전결 적용: {apply_narrative_arc}

[사용자 커스텀 캐릭터 레퍼런스] (있을 경우 1순위 적용)
{character_reference}

[사용자 특별 지시사항] (있을 경우 2순위 적용)
{special_instructions}

[가사]
{script}

${MUSIC_GENRE_OUTPUT_FORMAT}`

};

// ─────────────────────────────────────────────
// Helper: 변수 치환
// ─────────────────────────────────────────────
function _replaceMusicPromptVariables(template, vars) {
    const safeString = (v) => (v === null || v === undefined) ? '' : String(v);
    return template
        .replace(/\{script\}/g, safeString(vars.script))
        .replace(/\{hook_variation_intensity\}/g, safeString(vars.hook_variation_intensity) || 'medium')
        .replace(/\{apply_narrative_arc\}/g, vars.apply_narrative_arc ? 'true' : 'false')
        .replace(/\{character_reference\}/g, safeString(vars.character_reference))
        .replace(/\{special_instructions\}/g, safeString(vars.special_instructions));
}

/**
 * 장르별 음악 프롬프트 가져오기 + 변수 치환
 * @param {string} genre - 9종 중 하나 ('cinematic_ballad', 'korean_traditional', ...)
 * @param {Object} variables - { script, hook_variation_intensity, apply_narrative_arc, character_reference, special_instructions }
 * @returns {string} 치환 완료된 최종 프롬프트
 */
function getMusicGenrePrompt(genre, variables) {
    const template = MUSIC_GENRE_PROMPTS[genre] || MUSIC_GENRE_PROMPTS.cinematic_ballad;
    return _replaceMusicPromptVariables(template, variables || {});
}

/**
 * 지원되는 장르 키 목록
 */
function getMusicGenreList() {
    return Object.keys(MUSIC_GENRE_PROMPTS);
}

// chrome extension 컨텍스트용 export (window + globalThis)
if (typeof window !== 'undefined') {
    window.MUSIC_GENRE_PROMPTS = MUSIC_GENRE_PROMPTS;
    window.getMusicGenrePrompt = getMusicGenrePrompt;
    window.getMusicGenreList = getMusicGenreList;
}
if (typeof globalThis !== 'undefined') {
    globalThis.MUSIC_GENRE_PROMPTS = MUSIC_GENRE_PROMPTS;
    globalThis.getMusicGenrePrompt = getMusicGenrePrompt;
    globalThis.getMusicGenreList = getMusicGenreList;
}
