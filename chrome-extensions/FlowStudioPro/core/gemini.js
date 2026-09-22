if(typeof console!=="undefined" && (typeof globalThis!=="undefined" && globalThis.__FLOW_SILENT__ === true)){console.log=function(){};console.warn=function(){};console.error=function(){};}
// core/gemini.js - Flow Factory Gemini integration

// ── Gemini 모델 정의 (DAPARA Factory 동일) ──
const GEMINI_FREE_MODELS = [
    { name: 'gemini-3-flash-preview',        label: 'G3F',   isDefault: true },
    { name: 'gemini-3.1-flash-lite-preview', label: 'G3.1L' },
    { name: 'gemini-2.5-pro',                label: 'G2.5P' },
    { name: 'gemini-2.5-flash',              label: 'G2.5F' },
    { name: 'gemini-2.5-flash-lite',         label: 'G2.5FL' },
];
const GEMINI_PAID_MODELS = [
    { name: 'gemini-3.1-pro-preview', label: 'G3.1P' },
];
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
let _activeGeminiModel = 'gemini-3-flash-preview';
function setActiveGeminiModel(model) { _activeGeminiModel = model || 'gemini-3-flash-preview'; }
function getActiveGeminiModel() { return _activeGeminiModel; }
function isGeminiFreeModel(name) { return GEMINI_FREE_MODELS.some(m => m.name === name); }
function getGeminiModelLabel(name) {
    return [...GEMINI_FREE_MODELS, ...GEMINI_PAID_MODELS].find(m => m.name === name)?.label || name;
}

/** scriptText에서 공백·구두점·특수기호를 모두 제거하여 순수 텍스트만 반환 */
function cleanScriptText(text) {
    if (!text) return '';
    return text
        // ★ 괄호 안 내용(메타/프롬프트) 전부 제거 — 파일명용
        //   [Korean Context], [no name labels], (char props), {variable} 등
        //   언어 불문 (한/영/일/중/아랍/베트남...)
        .replace(/\[[\s\S]*?\]/g, '')
        .replace(/\([\s\S]*?\)/g, '')
        .replace(/\{[\s\S]*?\}/g, '')
        // 특수문자/공백 제거
        .replace(/[\s!?.,;:'"''""\-—–…·「」『』《》〈〉()\[\]{}\/\\@#$%^&*_+=|~`<>]/g, '')
        // 최대 16자 (sanitizeFilename 과 일치)
        .substring(0, 16);
}

// Style prompt comes from custom styles / CCR only. No preset style bank.

/**
 * Generate Whisk-optimized prompts from script
 * @param {string} script - Korean script
 * @param {number} numPrompts - Number of prompts
 * @param {string} apiKey - Gemini API key
 * @param {string} styleId - Custom style id (custom_*) or empty
 * @param {string} customStyle - Custom style text (when styleId is custom_*)
 */
// ── 분할호출 설정 ──
// 1회 API 호출당 25개 제한. 최대 200개 (기승전결 비율 유지, 동적 배치 수)
// RPD: ≤25 → 1회, 26~200 → 동적 배치 (기승전결 세그먼트를 25개 이하 서브배치로 분할)
const SINGLE_MAX = 25;              // 단일 호출 최대
const BATCH_MAX = 25;               // 배치당 최대
const FALLBACK_BATCH_MAX = 20;      // 폴백 시 축소 배치
const GISEUNGJEONGGYEOL_RATIO = [3, 2, 3, 2]; // 기:승:전:결 (10분의 3:2:3:2)

// ★ 실제 "쿼터 소진" (유저가 인지해야 할 하드 에러)만 true.
//   - PerDay 쿼터 소진 / "사용량이 초과" 메시지 → true (상위에서 중단 + 키 교체 유도)
//   - 429_RATE_LIMIT / 429_SERVER_BUSY → false (재시도 루프 계속)
function _is429Error(e) {
    if (!e || !e.message) return false;
    const msg = e.message;
    // 재시도 가능한 케이스는 쿼터 소진으로 취급 안 함
    if (msg.includes('429_RATE_LIMIT') || msg.includes('429_SERVER_BUSY')) return false;
    // 실제 쿼터 소진 지표
    return msg.includes('무료 사용량이 초과') || msg.includes('사용량이 초과') || msg.includes('quota exhausted');
}

// ★ 재시도 가능한 일시 오류 판정 — 레이트리밋 or 서버 과부하
function _isRetriableError(e) {
    if (!e || !e.message) return false;
    const msg = e.message;
    return msg.includes('429_RATE_LIMIT') || msg.includes('429_SERVER_BUSY') || /rate.*limit/i.test(msg);
}

/**
 * 명확한 구분선만 제거 (==, ---). 나머지는 AI가 대본/메타 구분
 */
function _stripMetaContent(script) {
    if (!script || typeof script !== 'string') return script;
    return script.replace(/\n\s*=+[\s=]*\n/g, '\n\n').replace(/\n\s*-{3,}[\s-]*\n/g, '\n\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * 비서사 줄 제거 (프롬프트 생성에서 제외)
 * - [Intro], [Verse 1], [Chorus] 등 가사/음악 구조 마커
 * - (instrumental...), (fade out...) 등 연주/악기 지시
 * - ## N단계, ## 제목 등 마크다운 헤딩/섹션 구분
 * - === 또는 --- 구분선 (stripMetaContent에서 이미 처리하지만 이중 방어)
 * - "um um um" 등 의미없는 보컬 필러
 */
function _stripNonNarrativeLines(script) {
    if (!script || typeof script !== 'string') return script;
    return script.split('\n').filter(line => {
        const trimmed = line.trim();
        if (!trimmed) return true; // 빈 줄 유지 (문단 구분용)
        if (/^\[.*\]$/.test(trimmed)) return false; // [Intro], [Verse 1] 등
        if (/^\(.*\)$/.test(trimmed)) return false; // (instrumental...) 등
        if (/^#{1,4}\s+\d*\s*단계/.test(trimmed)) return false; // ## 5단계: 절망적 상황 (4분)
        if (/^#{1,4}\s+.{0,30}$/.test(trimmed)) return false; // ## 제목, ### 소제목 (짧은 헤딩만)
        if (/^={3,}$/.test(trimmed)) return false; // ======= 구분선
        if (/^-{3,}$/.test(trimmed)) return false; // ------- 구분선
        if (/^\d+부\s*(완료|시작)?$/.test(trimmed)) return false; // 1부완료, 2부 시작
        if (/^(um\s*)+$/i.test(trimmed)) return false; // um um um
        if (/^(la\s*)+$/i.test(trimmed)) return false; // la la la
        if (/^(na\s*)+$/i.test(trimmed)) return false; // na na na
        return true;
    }).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

async function generatePromptsFromScript(script, numPrompts, apiKey, styleId = '', customStyle = '', nationality = 'Korean', userDirections = '', onBatchProgress = null, userProvidedCharRefs = null, splitMode = 'giseungjeongyeol', musicOptions = null) {
    script = _stripNonNarrativeLines(_stripMetaContent(script));

    // ★ v1.6 CCR 스타일 절대 우선권 — CCR 유저 스타일 제공 시 설정 스타일 전부 무시
    //   동작:
    //     1. 현재 styleId 값과 무관하게 'custom_ccr' sentinel 로 교체
    //     2. customStyle 에 유저 CCR primary 프롬프트의 스타일 anchor 주입
    //     3. getStyleLayers('custom_ccr', userAnchor) 는 custom_ prefix 감지 → customStyle 만 사용
    //   결과: 다운스트림 전체(scene division, char ref sheet, 배치 프롬프트 빌더)에서
    //         유저 CCR 스타일이 유일한 스타일 원천이 됨.
    //   CCR 체크박스 OFF → userProvidedCharRefs=null → 이 블록 skip → 커스텀 스타일 정상 반영
    let _ccrOverrideApplied = false;
    const _hasUserStyledRefs = Array.isArray(userProvidedCharRefs)
        && userProvidedCharRefs.length > 0
        && userProvidedCharRefs.some(r => r && r.prompt && String(r.prompt).trim().length > 10);
    if (_hasUserStyledRefs) {
        const userAnchor = _deriveStyleAnchorFromUserRefs(userProvidedCharRefs);
        if (userAnchor) {
            const prevStyleId = styleId;
            const prevCustom = customStyle;
            styleId = 'custom_ccr';        // 무조건 override — 설정 스타일 전부 교체
            customStyle = userAnchor;
            _ccrOverrideApplied = true;
            console.log(`🎨 [CCR override] styleId '${prevStyleId}' → 'custom_ccr', customStyle = user anchor (${userAnchor.length} chars). prev customStyle discarded (${(prevCustom||'').length} chars).`);
        }
    }

    // ★ v1.5: 2-레이어 스타일 resolver — stylePrompt = fullPrompt (rendering + humanIdentity)
    //   downstream은 customStyle/styleId 받아서 getStyleLayers()로 rendering/humanIdentity 재분리 가능
    let stylePrompt = getStyleLayers(styleId, customStyle).fullPrompt;

    // ★ PRO 2.0: userProvidedCharRefs가 있으면 stylePrompt 강화 (append 모드)
    //   ※ CCR override 이미 적용된 경우 skip — 이미 stylePrompt 전체가 userAnchor 이므로 중복 방지
    //     (anchor + '. ' + anchor 같은 이중 삽입 회피)
    if (!_ccrOverrideApplied && Array.isArray(userProvidedCharRefs) && userProvidedCharRefs.length > 0) {
        const styleAnchor = _deriveStyleAnchorFromUserRefs(userProvidedCharRefs);
        if (styleAnchor) {
            stylePrompt = (stylePrompt ? stylePrompt + '. ' : '') + styleAnchor;
        }
    }

    // ═══════════════════════════════════════════
    // ★ PRO 2.0: 신규 분할 방식 (문장/문단/의미) → Phase 0 분기
    // ═══════════════════════════════════════════
    if (splitMode && splitMode !== 'giseungjeongyeol') {
        return await _runSplitMode(
            script, splitMode, apiKey, styleId, customStyle, nationality,
            userDirections, stylePrompt, userProvidedCharRefs, onBatchProgress,
            musicOptions  // ★ PRO: 음악 장르 옵션 (lyrics + genre 선택 시만 값 있음)
        );
    }

    // ═══════════════════════════════════════════
    // ≤30: 단일 호출 → 재시도 → 소배치 폴백
    // ═══════════════════════════════════════════
    if (numPrompts <= SINGLE_MAX) {
        // 시도 1: 단일 호출 (1 RPD)
        try {
            if (onBatchProgress) onBatchProgress('single', 1, 1);
            const result = await _callGeminiSingle(script, numPrompts, apiKey, stylePrompt, nationality, styleId, userDirections, userProvidedCharRefs, customStyle);
            if (!result.prompts || result.prompts.length === 0) throw new Error('Single call returned 0 prompts');
            return result;
        } catch (e) {
            if (_is429Error(e)) throw e;
        }

        // 시도 2: 3초 대기 후 재시도 (1 RPD)
        try {
            if (onBatchProgress) onBatchProgress('retry', 1, 1);
            await new Promise(r => setTimeout(r, 3000));
            const result = await _callGeminiSingle(script, numPrompts, apiKey, stylePrompt, nationality, styleId, userDirections, userProvidedCharRefs, customStyle);
            if (!result.prompts || result.prompts.length === 0) throw new Error('Retry returned 0 prompts');
            return result;
        } catch (e) {
            if (_is429Error(e)) throw e;
        }

        // 시도 3: 소배치(25개씩) 분할 모드로 전환 (2+ RPD)
        if (onBatchProgress) onBatchProgress('fallback', 0, 0);
        return await _runBatchMode(script, numPrompts, apiKey, stylePrompt, nationality, styleId, userDirections, FALLBACK_BATCH_MAX, onBatchProgress, userProvidedCharRefs, customStyle);
    }

    // ═══════════════════════════════════════════
    // 26~200: 기승전결 동적 배치 (Phase1 없음, 배치 수 = ceil(세그먼트/25))
    // ═══════════════════════════════════════════
    return await _runGiseungjeongyeolMode(script, numPrompts, apiKey, stylePrompt, nationality, styleId, userDirections, onBatchProgress, userProvidedCharRefs, customStyle);
}

// ★ PRO 2.0: 사용자 업로드 캐릭터 프롬프트에서 스타일 토큰 추출 — 길이 무제한
// 이전엔 150자 하드 컷으로 "crea" 처럼 단어 중간 절단되어 Gemini가 스타일 단서 손실.
// 이제는 첫 마침표까지 전부, 없으면 전체 프롬프트를 그대로 사용 (유저 스타일 원형 100% 보존).
// 예: "Rough hand-drawn marker illustration style, thick wobbly black ink outlines,
//      ..., casual doodle sketchbook aesthetic (Amy Slaton Instagram cartoonist vibe)."
function _deriveStyleAnchorFromUserRefs(userProvidedCharRefs) {
    if (!userProvidedCharRefs || userProvidedCharRefs.length === 0) return '';
    // MCR 우선, 없으면 첫 번째 ref
    const primary = userProvidedCharRefs.find(r => r.code === 'MCR') || userProvidedCharRefs[0];
    if (!primary || !primary.prompt) return '';
    const text = String(primary.prompt).replace(/\s+/g, ' ').trim();
    // 1순위: 첫 마침표까지 (길이 무제한)
    //        괄호 안 마침표는 건너뛰기 — "(Amy Slaton Instagram cartoonist vibe)." 대응
    let firstStop = -1;
    let depth = 0;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (ch === '(' || ch === '[') depth++;
        else if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
        else if (depth === 0 && (ch === '.' || ch === '。')) { firstStop = i; break; }
    }
    if (firstStop > 0) return text.slice(0, firstStop).trim();
    // 2순위: 마침표 없으면 전체 프롬프트 그대로 반환 (하드 컷 없음)
    return text;
}

// ═══════════════════════════════════════════
// 기승전결 4배치 모드 (Phase1 없음, 4 RPD)
// 비율 3:2:3:2, 결 구간 에필로그 최소 4씬 보장
// 씬 경계 정렬: 배치 1↔2, 2↔3, 3↔4 경계를 [N] 마커에 맞춰 중간 절단 방지
// ═══════════════════════════════════════════
/** 대본에서 targetChar 근처의 씬 경계 [N] 위치를 반환. 중간 절단 방지 */
function _alignToSceneBoundary(script, targetChar) {
    if (targetChar <= 0 || targetChar >= script.length) return targetChar;
    const sceneMarker = /\n\s*\[\d+\]\s*(?:\n|$)/g;
    const maxSearch = Math.max(80, Math.floor(script.length * 0.15));
    const lo = Math.max(0, targetChar - maxSearch);
    const hi = Math.min(script.length, targetChar + maxSearch);
    const searchText = script.slice(lo, hi);
    let best = -1, bestDist = Infinity;
    for (const m of searchText.matchAll(sceneMarker)) {
        const absPos = lo + m.index;
        const dist = Math.abs(absPos - targetChar);
        if (dist < bestDist) { best = absPos; bestDist = dist; }
    }
    if (best >= 0) return best;
    // ★ 씬 마커 없으면 문장/줄/공백 경계로 폴백 (단어 중간 절단 방지)
    return _findSafeSplitPoint(script, targetChar, 0);
}

function _segmentScriptByGiseungjeongyeol(script, numPrompts) {
    const total = script.length;
    const [r1, r2, r3, r4] = GISEUNGJEONGGYEOL_RATIO;
    const sum = r1 + r2 + r3 + r4;
    let counts = [
        Math.round(numPrompts * r1 / sum),
        Math.round(numPrompts * r2 / sum),
        Math.round(numPrompts * r3 / sum),
        Math.round(numPrompts * r4 / sum)
    ];
    const diff = numPrompts - counts.reduce((a, b) => a + b, 0);
    counts[0] = Math.max(1, counts[0] + diff);

    const rawPos = [0, Math.floor(total * r1 / sum), Math.floor(total * (r1 + r2) / sum), Math.floor(total * (r1 + r2 + r3) / sum), total];
    let pos = [0,
        _alignToSceneBoundary(script, rawPos[1]),
        _alignToSceneBoundary(script, rawPos[2]),
        _alignToSceneBoundary(script, rawPos[3]),
        total
    ];
    if (pos[1] < 1) pos[1] = Math.max(1, rawPos[1]);
    if (pos[1] >= pos[2]) pos[1] = Math.max(1, Math.floor(pos[2] * 0.4));
    if (pos[2] >= pos[3]) pos[2] = Math.max(pos[1] + 1, Math.floor((pos[1] + pos[3]) / 2));
    if (pos[3] >= total) pos[3] = Math.max(pos[2] + 1, total - 1);
    return [
        { label: '기', labelEn: 'Introduction (hook)', text: script.slice(pos[0], pos[1]), numPrompts: counts[0] },
        { label: '승', labelEn: 'Development', text: script.slice(pos[1], pos[2]), numPrompts: counts[1] },
        { label: '전', labelEn: 'Climax', text: script.slice(pos[2], pos[3]), numPrompts: counts[2] },
        { label: '결', labelEn: 'Conclusion (epilogue)', text: script.slice(pos[3], pos[4]), numPrompts: counts[3] }
    ];
}

/**
 * target 부근에서 씬·문단·문장 경계를 찾아 끊김 방지
 * 우선순위: 씬시작([N]) > 문단시작(\n\n) > 문장끝(.!?。！？) > 줄시작(\n) > 공백
 */
function _findSafeSplitPoint(text, target, minStart = 0) {
    if (target <= minStart || target >= text.length) return target;
    const maxSearch = Math.max(120, Math.floor(text.length * 0.3));
    let best = -1;
    let bestScore = 0;
    const score = (t) => (t === 'scene' ? 5 : t === 'para' ? 4 : t === 'sent' ? 3 : t === 'line' ? 2 : 1);
    const check = (pos, type) => {
        if (pos < minStart || pos > text.length) return;
        const s = score(type);
        if (s > bestScore) { best = pos; bestScore = s; }
    };
    const lo = Math.max(minStart, target - maxSearch);
    const hi = Math.min(text.length, target + maxSearch);
    const searchText = text.slice(lo, hi);
    for (const m of searchText.matchAll(/\n\s*\[\d+\]\s*(?:\n|$)/g)) {
        const pos = lo + m.index + m[0].length;
        if (pos >= minStart && pos <= text.length) check(pos, 'scene');
    }
    for (let i = target - 1; i >= lo; i--) {
        const c = text[i];
        const next = text[i + 1];
        if (i > 0 && text[i - 1] === '\n' && c === '\n') check(i + 1, 'para');
        if (/[.!?。！？]/.test(c) && (!next || /[\s\n]/.test(next))) check(i + 1, 'sent');
        if (/[다요까라자세지]/.test(c) && (!next || /[\s\n.!?。！？,，]/.test(next))) check(i + 1, 'sent');
        if (c === '\n') check(i + 1, 'line');
        if (/\s/.test(c)) check(i + 1, 'space');
    }
    if (best >= 0) return best;
    for (let i = target; i < hi; i++) {
        const c = text[i];
        const next = text[i + 1];
        if (i > 0 && text[i - 1] === '\n' && c === '\n') check(i + 1, 'para');
        if (/[.!?。！？]/.test(c) && (!next || /[\s\n]/.test(next))) check(i + 1, 'sent');
        if (/[다요까라자세지]/.test(c) && (!next || /[\s\n.!?。！？,，]/.test(next))) check(i + 1, 'sent');
        if (c === '\n') check(i + 1, 'line');
        if (/\s/.test(c)) check(i + 1, 'space');
    }
    // ★ mid-word 폴백 제거: 가장 가까운 공백/줄바꿈까지 무제한 탐색
    if (best >= 0) return best;
    for (let radius = 1; radius < text.length; radius++) {
        const before = target - radius;
        const after = target + radius;
        if (before >= minStart && /[\s\n]/.test(text[before])) return before + 1;
        if (after < text.length && /[\s\n]/.test(text[after])) return after + 1;
    }
    return Math.max(minStart, target);
}

/**
 * 2단계 분산: 구간 내에서 프롬프트를 장면 전환에 맞게 배분
 * - 경계 마커(## N단계, ###, ---)가 있으면 마커 기준 분할 후 비례 배분
 * - 없으면 문장/문단/단어 경계 근처에서 분할 (한·영 철자 중간 절단 방지)
 */
function _distributeSegmentSecondLevel(segmentText, numPrompts) {
    if (!segmentText || numPrompts <= 0) return { type: 'even', parts: [{ text: segmentText || '', numPrompts: 1 }] };

    const markerPattern = /(?:^|\n)\s*(##\s*\d+\s*단계[^\n]*|###\s+[^\n]+|---\s*\n|SECTION\s*\d+[^\n]*|SCENE\s*\d+[^\n]*|\[\d+\]\s*(?:\n|$))/gim;
    const matches = [...segmentText.matchAll(markerPattern)];
    const indices = [...new Set([0, ...matches.map(m => m.index).filter(i => i > 0), segmentText.length])].sort((a, b) => a - b);

    if (indices.length >= 2) {
        const parts = [];
        for (let i = 0; i < indices.length - 1; i++) {
            const text = segmentText.slice(indices[i], indices[i + 1]).trim();
            if (text.length > 0) parts.push(text);
        }
        if (parts.length === 0) parts.push(segmentText.trim());

        const totalLen = parts.reduce((a, p) => a + p.length, 0);
        let counts = totalLen > 0 ? parts.map(p => Math.max(0, Math.round(numPrompts * p.length / totalLen))) : parts.map(() => 0);
        if (numPrompts >= parts.length) {
            for (let i = 0; i < parts.length; i++) if (counts[i] < 1) counts[i] = 1;
        }
        let sum = counts.reduce((a, b) => a + b, 0);
        for (let idx = 0; sum !== numPrompts && idx < 100; idx++) {
            const i = idx % counts.length;
            if (sum < numPrompts) { counts[i]++; sum++; }
            else if (counts[i] > 0) { counts[i]--; sum--; }
        }
        if (sum < numPrompts && counts.length > 0) counts[0] += numPrompts - sum;

        return {
            type: 'markers',
            parts: parts.map((text, i) => ({ text, numPrompts: Math.min(numPrompts, Math.max(0, counts[i] || 0)) }))
        };
    }

    // ★ 줄 단위로 나누기 (단어 중간 절단 방지 — 짧은 대본에서도 안전)
    const lines = segmentText.split('\n').filter(l => l.trim().length > 0);
    const n = Math.max(1, numPrompts);

    // 줄 수가 프롬프트 수 이상이면 줄 단위로 배분 (가장 안전)
    if (lines.length >= n) {
        const linesPerPart = Math.floor(lines.length / n);
        const remainder = lines.length - linesPerPart * n;
        const parts = [];
        let lineIdx = 0;
        for (let i = 0; i < n; i++) {
            const count = linesPerPart + (i < remainder ? 1 : 0);
            const partLines = lines.slice(lineIdx, lineIdx + count);
            parts.push({ text: partLines.join('\n').trim(), numPrompts: 1 });
            lineIdx += count;
        }
        return { type: 'even', parts };
    }

    // ★ 줄 수 < 프롬프트 수: 줄을 단어 단위로 더 쪼갬 (단어 중간 절단 절대 방지)
    // "무궁화 꽃이 피었습니다" → ["무궁화", "꽃이", "피었습니다"] (3개 — 중복 없음)
    const allWords = [];
    for (const line of lines) {
        const words = line.trim().split(/\s+/).filter(w => w.length > 0);
        if (words.length > 0) allWords.push(...words);
    }
    // 단어 수 기준으로 프롬프트 배분 (단어 수가 프롬프트 수보다 적으면 단어 수만큼만)
    const totalWords = allWords.length;
    const actualParts = Math.min(n, totalWords);
    const wordsPerPart = Math.floor(totalWords / actualParts);
    const extraWords = totalWords - wordsPerPart * actualParts;
    const parts = [];
    let wordIdx = 0;
    for (let i = 0; i < actualParts; i++) {
        const count = wordsPerPart + (i < extraWords ? 1 : 0);
        const partWords = allWords.slice(wordIdx, wordIdx + count);
        parts.push({ text: partWords.join(' ').trim(), numPrompts: 1 });
        wordIdx += count;
    }
    return { type: 'even', parts };
}

/**
 * 기승전결 세그먼트를 25개 이하 배치로 패킹.
 * 세그먼트의 numPrompts > batchMax이면 서브세그먼트로 분할 후 패킹.
 */
function _packSegmentsIntoBatches(segments, batchMax = BATCH_MAX) {
    // 1단계: 25 초과 세그먼트를 서브세그먼트로 분할
    // 짝수 세그먼트: 나머지를 뒤에 (front-load), 홀수 세그먼트: 나머지를 앞에 (back-load)
    // → 인접한 나머지끼리 합쳐져 배치 수 최소화 (200개 기준 10→8배치)
    const expanded = [];
    for (let segIdx = 0; segIdx < segments.length; segIdx++) {
        const seg = segments[segIdx];
        if (seg.numPrompts <= 0) continue;
        if (seg.numPrompts <= batchMax) {
            expanded.push(seg);
        } else {
            // 서브세그먼트 분할: text를 비례 분할, numPrompts를 25 이하로
            const subCount = Math.ceil(seg.numPrompts / batchMax);
            const text = seg.text || '';
            const textLen = text.length;
            let remaining = seg.numPrompts;
            let textStart = 0;

            // 홀수 세그먼트(승,결)는 나머지를 앞에 배치하여 이전 세그먼트의 나머지와 합침
            const putRemainderFirst = (segIdx % 2 === 1);

            for (let s = 0; s < subCount; s++) {
                let subPrompts;
                if (putRemainderFirst) {
                    // 첫 서브세그먼트가 나머지, 나머지는 batchMax
                    subPrompts = s === 0
                        ? seg.numPrompts - batchMax * (subCount - 1)
                        : Math.min(batchMax, remaining);
                } else {
                    // 마지막 서브세그먼트가 나머지, 앞쪽은 batchMax
                    subPrompts = s < subCount - 1
                        ? Math.min(batchMax, remaining - (subCount - s - 1))
                        : remaining;
                }
                // text를 numPrompts 비례로 분할 + 안전 경계
                const promptsSoFar = seg.numPrompts - remaining + subPrompts;
                const rawEnd = s < subCount - 1
                    ? Math.round(textLen * promptsSoFar / seg.numPrompts)
                    : textLen;
                const safeEnd = s < subCount - 1
                    ? _findSafeSplitPoint(text, rawEnd, textStart)
                    : textLen;
                const subText = text.slice(textStart, safeEnd).trim();

                if (!subText && expanded.length > 0) {
                    // 빈 텍스트 → 이전 서브세그먼트에 프롬프트 수 병합
                    expanded[expanded.length - 1].numPrompts += subPrompts;
                } else {
                    expanded.push({
                        label: seg.label,
                        labelEn: seg.labelEn,
                        text: subText || text.slice(textStart).trim() || seg.text,
                        numPrompts: subPrompts
                    });
                }

                remaining -= subPrompts;
                textStart = safeEnd;
            }
        }
    }

    // 2단계: 25개 이하로 묶어 배치 수 최소화
    const batches = [];
    let current = [];
    let currentCount = 0;
    for (const seg of expanded) {
        if (seg.numPrompts <= 0) continue;
        if (currentCount + seg.numPrompts <= batchMax) {
            current.push(seg);
            currentCount += seg.numPrompts;
        } else {
            if (current.length > 0) {
                batches.push(current);
            }
            current = [seg];
            currentCount = seg.numPrompts;
        }
    }
    if (current.length > 0) batches.push(current);
    return batches;
}

async function _runGiseungjeongyeolMode(script, numPrompts, apiKey, stylePrompt, nationality, styleId, userDirections, onBatchProgress, userProvidedCharRefs = null, customStyle = '') {
    const segments = _segmentScriptByGiseungjeongyeol(script, numPrompts);
    const batches = _packSegmentsIntoBatches(segments);

    // ─── DEBUG: 분할 검증 로그 (테스트 후 제거) ───
    console.log('🔍 [DEBUG] ═══ 프롬프트 분할 검증 ═══');
    console.log(`🔍 요청: ${numPrompts}개 | 세그먼트: ${segments.length}개 | 배치: ${batches.length}개`);
    segments.forEach(s => console.log(`🔍 세그먼트: ${s.label} → ${s.numPrompts}개, 텍스트 ${(s.text||'').length}자`));
    batches.forEach((batch, i) => {
        const total = batch.reduce((a, s) => a + s.numPrompts, 0);
        const details = batch.map(s => `${s.label}(${s.numPrompts}개/${(s.text||'').length}자)`).join(' + ');
        console.log(`🔍 배치${i+1}: ${total}개 = ${details}`);
    });
    const totalPrompts = batches.reduce((a, b) => a + b.reduce((x, s) => x + s.numPrompts, 0), 0);
    console.log(`🔍 총 프롬프트: ${totalPrompts}개 (요청: ${numPrompts}개) ${totalPrompts === numPrompts ? '✅ 일치' : '❌ 불일치!'}`);
    if (Array.isArray(userProvidedCharRefs) && userProvidedCharRefs.length > 0) {
        console.log(`🎨 [PRO 2.0] 사용자 제공 캐릭터 ${userProvidedCharRefs.length}개:`,
            userProvidedCharRefs.map(r => r.code).join(', '));
    }
    console.log('🔍 ═══════════════════════════════');
    // ─── DEBUG END ───

    // ★ PRO 2.0: 사용자 제공 characterRefs를 시작부터 주입 (_userProvided 태그 부착)
    let characterRefs = Array.isArray(userProvidedCharRefs) && userProvidedCharRefs.length > 0
        ? userProvidedCharRefs.map(r => ({ ...r, _userProvided: true }))
        : [];
    let allPrompts = [];
    let runningNum = 1;
    let lastBatchCount = 0;
    let lastBatchError = null;

    for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
        const batchSegments = batches[batchIdx];
        const batchPromptCount = batchSegments.reduce((a, s) => a + s.numPrompts, 0);

        // ★ 배치 간 최소 간격 — Gemini RPM 제한(무료 15 RPM) 회피
        //   배치 1→2 전환 시 최소 5초 대기 → 429 rate limit 발생 확률 감소
        if (batchIdx > 0) {
            await new Promise(r => setTimeout(r, 5000));
        }

        if (onBatchProgress) onBatchProgress('batch', batchIdx + 1, batches.length, runningNum, runningNum + batchPromptCount - 1);

        const previousBatchPrompts = batchIdx > 0 && allPrompts.length > 0 ? allPrompts.slice(-5) : null;
        const previousBatchSummary = batchIdx > 0 && lastBatchCount > 0 ? {
            first: String(runningNum - lastBatchCount).padStart(2, '0'),
            last: String(runningNum - 1).padStart(2, '0'),
            count: lastBatchCount
        } : null;

        let batchResult = null;
        // ★ 재시도 전략 강화 — 429 rate limit 복구 대기 시간 증가
        //   Gemini 무료 티어: 1분당 제한 있음 → 배치 간 너무 빠르면 429 발생
        //   기존: 3초 대기 → 부족 / 신규: 429 시 30초까지 대기 (RPM 창 복구)
        const MAX_ATTEMPTS = 3;
        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
            try {
                if (attempt > 1) {
                    // 이전 에러가 429 이면 길게 대기, 아니면 짧게
                    const wasRateLimit = lastBatchError && _is429Error(lastBatchError);
                    const waitMs = wasRateLimit
                        ? (attempt === 2 ? 15000 : 30000)  // 429: 15초, 30초
                        : 3000;                              // 기타: 3초
                    await new Promise(r => setTimeout(r, waitMs));
                }
                batchResult = await _callSegmentPromptGeneration(
                    script, batchSegments, characterRefs, apiKey, stylePrompt, nationality, styleId, userDirections,
                    batchIdx === 0, previousBatchPrompts, previousBatchSummary,
                    userProvidedCharRefs, customStyle
                );
                if (batchResult && batchResult.prompts && batchResult.prompts.length > 0) break;
            } catch (e) {
                // 400/401/403 에러(잘못된 키 등): 첫 배치 실패 시 즉시 중단
                const status = e?.status || e?.message?.match?.(/(\d{3})/)?.[1];
                if (batchIdx === 0 && attempt === MAX_ATTEMPTS && (status == 400 || status == 401 || status == 403)) {
                    throw e;
                }
                lastBatchError = e;
                if (attempt === MAX_ATTEMPTS) batchResult = null;  // 3회 재시도 후 실패 표시
            }
        }

        if (batchResult && batchResult.prompts && batchResult.prompts.length > 0) {
            if (batchIdx === 0 && batchResult.characterRefs && batchResult.characterRefs.length > 0) {
                // ★ PRO 2.0: 하이브리드 병합 — 사용자 제공 코드는 보존, 나머지만 AI 응답으로 추가
                if (Array.isArray(userProvidedCharRefs) && userProvidedCharRefs.length > 0) {
                    const userCodes = new Set(userProvidedCharRefs.map(r => r.code));
                    const newFromAI = batchResult.characterRefs.filter(r => !userCodes.has(r.code));
                    characterRefs = [
                        ...userProvidedCharRefs.map(r => ({ ...r, _userProvided: true })),
                        ...newFromAI
                    ];
                    console.log(`🎨 [PRO 2.0] 하이브리드 병합: 사용자 ${userProvidedCharRefs.length}개 + AI 신규 ${newFromAI.length}개 = 총 ${characterRefs.length}개`);
                } else {
                    characterRefs = batchResult.characterRefs;
                }
            }

            // ★ PRO 2.0: 균일 모드 배치 검증 (대본 이탈, 개수, 번호 연속성)
            const segmentText = batchSegments.map(s => s.text || '').join('\n');
            const validation = _validateUniformBatchIntegrity(
                batchIdx, batches.length, batchPromptCount, batchResult.prompts, segmentText, runningNum
            );
            const severity = _judgeValidationSeverity(validation, batchPromptCount);
            // ★ 개수 편차 있을 때만 로그 (scriptText/번호는 파일명 규칙상 false positive 많음)
            if (severity === 'MAJOR' || severity === 'CRITICAL') {
                console.log(`⚠️ [UNIFORM VALIDATION] Batch ${batchIdx + 1} 개수 편차 ${severity}: 예상 ${batchPromptCount}개 → 반환 ${batchResult.prompts.length}개`);
            }
            if (onBatchProgress) {
                onBatchProgress('validation', batchIdx + 1, batches.length, null, null, {
                    ok: validation.ok,
                    severity,
                    mismatches: validation.mismatches,
                    report: validation.report,
                    matchCount: validation.inSegment,
                    expectedCount: batchPromptCount,
                    splitMode: 'giseungjeongyeol'
                });
            }

            // ★ CRITICAL: 즉시 배치 중단 + partial + resumeState 반환
            if (severity === 'CRITICAL') {
                return {
                    characterRefs,
                    prompts: allPrompts,
                    partial: true,
                    failReason: 'VALIDATION_CRITICAL',
                    failedBatch: batchIdx + 1,
                    totalBatches: batches.length,
                    resumeState: {
                        remainingBatches: batches.slice(batchIdx),  // 실패 배치부터 재시도
                        runningNum,
                        characterRefs,
                        userProvidedCharRefs,
                        script, stylePrompt, nationality, styleId, userDirections, customStyle
                    }
                };
            }

            const renumbered = batchResult.prompts.map((p, idx) => ({
                ..._normalizeBatchPrompt(p),
                number: String(runningNum + idx).padStart(2, '0')
            }));
            lastBatchCount = renumbered.length;
            runningNum += lastBatchCount;
            allPrompts = [...allPrompts, ...renumbered];

            // 배치 완료 콜백: "배치 1/8 완료 ✓ | 25/200개 완료" + 자동 저장
            if (onBatchProgress) onBatchProgress('batch_done', batchIdx + 1, batches.length, null, allPrompts.length, {
                prompts: allPrompts,
                characterRefs,
                resumeState: batchIdx < batches.length - 1 ? {
                    remainingBatches: batches.slice(batchIdx + 1),
                    runningNum,
                    characterRefs,
                    userProvidedCharRefs,  // ★ PRO 2.0: 재개 시 복원용
                    script, stylePrompt, nationality, styleId, userDirections, customStyle
                } : null
            });
        } else {
            // ★ 배치 실패: 이미 생성된 프롬프트가 있으면 멈추고 부분 반환 + 재개 상태
            if (allPrompts.length > 0) {
                const errMsg = _is429Error(lastBatchError) ? '429_RATE_LIMIT' : (lastBatchError?.message || 'BATCH_FAILED');
                console.log(`ℹ️ 배치 ${batchIdx + 1}/${batches.length} 중단 (${errMsg}). ${allPrompts.length}개 생성 완료, 나머지 재개 가능.`);
                const partialPrompts = allPrompts.map((p, idx) => ({
                    ...p,
                    number: String(idx + 1).padStart(2, '0'),
                    prompt: p.prompt || convertCharacterCodes(`${p.sceneDesc || ''} ${p.charProps || ''} ${p.action || ''}`.trim().replace(/\s+/g, ' '))
                }));
                return {
                    characterRefs,
                    prompts: partialPrompts,
                    partial: true,
                    failReason: errMsg,
                    failedBatch: batchIdx + 1,
                    totalBatches: batches.length,
                    resumeState: {
                        remainingBatches: batches.slice(batchIdx),
                        runningNum,
                        characterRefs,
                        userProvidedCharRefs,  // ★ PRO 2.0
                        script, stylePrompt, nationality, styleId, userDirections, customStyle
                    }
                };
            }
            // 첫 배치부터 실패 → throw
            throw lastBatchError || new Error('프롬프트 생성에 실패했습니다.');
        }

        if (batchIdx < batches.length - 1) {
            const delay = batches.length >= 6 ? 5000 : 4000;
            await new Promise(r => setTimeout(r, delay));
        }
    }

    if (allPrompts.length === 0) {
        const cause = lastBatchError?.message || '';
        throw new Error(cause ? `프롬프트 생성 실패: ${cause}` : '프롬프트 생성에 실패했습니다. 다시 시도해주세요.');
    }
    const prompts = allPrompts.map((p, idx) => ({
        ...p,
        number: String(idx + 1).padStart(2, '0'),
        prompt: p.prompt || convertCharacterCodes(`${p.sceneDesc || ''} ${p.charProps || ''} ${p.action || ''}`.trim().replace(/\s+/g, ' '))
    }));
    return { characterRefs, prompts };
}

// ═══════════════════════════════════════════
// 429 중단 후 재개: 남은 배치만 실행하여 기존 결과와 병합
// ═══════════════════════════════════════════
async function resumePromptsGeneration(resumeState, existingPrompts, apiKey, onBatchProgress = null) {
    // ★ PRO 2.0: 신규 분할 모드 resumeState 감지 → 전용 경로로 분기
    if (resumeState && resumeState.splitMode && resumeState.splitMode !== 'giseungjeongyeol' && Array.isArray(resumeState.phase0SceneMap)) {
        console.log(`🔄 [RESUME] 신규 분할 모드 (${resumeState.splitMode}) 재개 — batch ${resumeState.nextBatchIdx}부터`);
        return await _resumeSplitMode(resumeState, existingPrompts, apiKey, onBatchProgress);
    }

    const { remainingBatches, runningNum: startNum, characterRefs,
            script, stylePrompt, nationality, styleId, userDirections,
            userProvidedCharRefs = null,  // ★ PRO 2.0: 재개 시 사용자 제공 refs 복원
            customStyle = ''              // ★ v1.5: 커스텀 스타일 원본 (레거시 session은 '' fallback)
    } = resumeState;

    let allPrompts = [];
    let runningNum = startNum;
    let lastBatchCount = 0;
    let lastBatchError = null;
    const previousFromExisting = existingPrompts && existingPrompts.length > 0
        ? existingPrompts.slice(-5) : null;

    for (let batchIdx = 0; batchIdx < remainingBatches.length; batchIdx++) {
        const batchSegments = remainingBatches[batchIdx];
        const batchPromptCount = batchSegments.reduce((a, s) => a + s.numPrompts, 0);

        if (onBatchProgress) onBatchProgress('batch', batchIdx + 1, remainingBatches.length, runningNum, runningNum + batchPromptCount - 1);

        const previousBatchPrompts = batchIdx === 0
            ? previousFromExisting
            : (allPrompts.length > 0 ? allPrompts.slice(-5) : previousFromExisting);
        const previousBatchSummary = lastBatchCount > 0 ? {
            first: String(runningNum - lastBatchCount).padStart(2, '0'),
            last: String(runningNum - 1).padStart(2, '0'),
            count: lastBatchCount
        } : (existingPrompts && existingPrompts.length > 0 ? {
            first: '01',
            last: String(existingPrompts.length).padStart(2, '0'),
            count: existingPrompts.length
        } : null);

        let batchResult = null;
        for (let attempt = 1; attempt <= 2; attempt++) {
            try {
                if (attempt > 1) await new Promise(r => setTimeout(r, 3000));
                batchResult = await _callSegmentPromptGeneration(
                    script, batchSegments, characterRefs, apiKey, stylePrompt, nationality, styleId, userDirections,
                    false, previousBatchPrompts, previousBatchSummary, userProvidedCharRefs, customStyle
                );
                if (batchResult && batchResult.prompts && batchResult.prompts.length > 0) break;
            } catch (e) {
                if (_is429Error(e)) {
                    if (allPrompts.length > 0) {
                        // 재개 중에도 429 → 여기까지 부분 반환
                        const merged = [...existingPrompts, ...allPrompts];
                        const finalPrompts = merged.map((p, idx) => ({
                            ...p,
                            number: String(idx + 1).padStart(2, '0'),
                            prompt: p.prompt || convertCharacterCodes(`${p.sceneDesc || ''} ${p.charProps || ''} ${p.action || ''}`.trim().replace(/\s+/g, ' '))
                        }));
                        return {
                            characterRefs,
                            prompts: finalPrompts,
                            partial: true,
                            resumeState: {
                                remainingBatches: remainingBatches.slice(batchIdx),
                                runningNum,
                                characterRefs,
                                script, stylePrompt, nationality, styleId, userDirections, customStyle
                            }
                        };
                    }
                    throw e;
                }
                lastBatchError = e;
                if (attempt === 2) batchResult = null;  // 2회 재시도 후 실패 표시
            }
        }

        if (batchResult && batchResult.prompts && batchResult.prompts.length > 0) {
            const renumbered = batchResult.prompts.map((p, idx) => ({
                ..._normalizeBatchPrompt(p),
                number: String(runningNum + idx).padStart(2, '0')
            }));
            lastBatchCount = renumbered.length;
            runningNum += lastBatchCount;
            allPrompts = [...allPrompts, ...renumbered];

            // 재개 배치 완료 콜백 + 자동 저장
            const merged = [...existingPrompts, ...allPrompts];
            if (onBatchProgress) onBatchProgress('batch_done', batchIdx + 1, remainingBatches.length, null, merged.length, {
                prompts: merged,
                characterRefs,
                resumeState: batchIdx < remainingBatches.length - 1 ? {
                    remainingBatches: remainingBatches.slice(batchIdx + 1),
                    runningNum,
                    characterRefs,
                    script, stylePrompt, nationality, styleId, userDirections, customStyle
                } : null
            });
        } else {
            // ★ 재개 중 배치 실패: 여기까지 부분 반환
            const merged = [...existingPrompts, ...allPrompts];
            if (merged.length > 0) {
                const finalPrompts = merged.map((p, idx) => ({
                    ...p,
                    number: String(idx + 1).padStart(2, '0'),
                    prompt: p.prompt || convertCharacterCodes(`${p.sceneDesc || ''} ${p.charProps || ''} ${p.action || ''}`.trim().replace(/\s+/g, ' '))
                }));
                return {
                    characterRefs,
                    prompts: finalPrompts,
                    partial: true,
                    resumeState: {
                        remainingBatches: remainingBatches.slice(batchIdx),
                        runningNum,
                        characterRefs,
                        script, stylePrompt, nationality, styleId, userDirections, customStyle
                    }
                };
            }
            throw lastBatchError || new Error('프롬프트 생성에 실패했습니다.');
        }

        if (batchIdx < remainingBatches.length - 1) {
            await new Promise(r => setTimeout(r, 5000));
        }
    }

    // 기존 + 새로 생성된 프롬프트 병합, 01~N 번호 재매기기
    const merged = [...existingPrompts, ...allPrompts];
    const prompts = merged.map((p, idx) => ({
        ...p,
        number: String(idx + 1).padStart(2, '0'),
        prompt: p.prompt || convertCharacterCodes(`${p.sceneDesc || ''} ${p.charProps || ''} ${p.action || ''}`.trim().replace(/\s+/g, ' '))
    }));
    return { characterRefs, prompts, partial: false };
}

// ═══════════════════════════════════════════
// 배치 모드 실행 (Phase 1: 씬 분할 + Phase 2: 배치 프롬프트 생성)
// 단일 호출 실패 시 폴백용 (≤25 프롬프트)
// ═══════════════════════════════════════════
async function _runBatchMode(script, numPrompts, apiKey, stylePrompt, nationality, styleId, userDirections, batchMax, onBatchProgress, userProvidedCharRefs = null, customStyle = '') {
    const estimatedBatches = Math.ceil(numPrompts / batchMax);

    // ── Phase 1: 씬 분할 (재시도 1회) ──
    if (onBatchProgress) onBatchProgress('divide', 0, estimatedBatches);

    let divisionResult;
    for (let attempt = 1; attempt <= 2; attempt++) {
        try {
            if (attempt > 1) {
                await new Promise(r => setTimeout(r, 3000));
            }
            divisionResult = await _callSceneDivision(script, numPrompts, apiKey, stylePrompt, nationality, styleId, userDirections, userProvidedCharRefs);
            if (divisionResult.scenes.length > 0) break;
        } catch (e) {
            if (_is429Error(e)) throw e;
            if (attempt === 2) throw e;
        }
    }

    let scenes = divisionResult.scenes;
    // ★ PRO 2.0: 사용자 제공 캐릭터 병합 (하이브리드)
    let characterRefs = divisionResult.characterRefs;
    if (Array.isArray(userProvidedCharRefs) && userProvidedCharRefs.length > 0) {
        const userCodes = new Set(userProvidedCharRefs.map(r => r.code));
        const aiOnly = (characterRefs || []).filter(r => !userCodes.has(r.code));
        characterRefs = [...userProvidedCharRefs, ...aiOnly];
    }


    if (scenes.length === 0) {
        throw new Error('씬 분할 실패. 대본을 확인하고 다시 시도해주세요.');
    }

    // 씬 수 보정: 초과 시 자르기
    if (scenes.length > numPrompts) {
        scenes = scenes.slice(0, numPrompts);
    } else if (scenes.length < numPrompts) {
    }

    // ── Phase 2: 배치 프롬프트 생성 ──
    let allPrompts = [];
    let runningNum = 1;
    const totalBatches = Math.ceil(scenes.length / batchMax);

    for (let batch = 0; batch < totalBatches; batch++) {
        const startIdx = batch * batchMax;
        const batchScenes = scenes.slice(startIdx, startIdx + batchMax);

        if (onBatchProgress) onBatchProgress('batch', batch + 1, totalBatches, runningNum, runningNum + batchScenes.length - 1);

        const maxTokens = Math.min(65536, 1000 * batchScenes.length + 2000);
        let batchPrompts = null;
        const previousBatchPrompts = batch > 0 && allPrompts.length > 0
            ? allPrompts.slice(-5)
            : null;
        const previousBatchSummary = batch > 0
            ? { first: String(startIdx - batchMax + 1).padStart(2, '0'), last: String(startIdx).padStart(2, '0'), count: Math.min(batchMax, startIdx) }
            : null;

        // 배치 실행 + 1회 재시도 (429는 즉시 중단)
        for (let attempt = 1; attempt <= 2; attempt++) {
            try {
                if (attempt > 1) {
                    await new Promise(r => setTimeout(r, 3000));
                }
                batchPrompts = await _callBatchPromptGeneration(
                    script, batchScenes, characterRefs, apiKey, stylePrompt, nationality, styleId, userDirections, maxTokens, previousBatchPrompts, previousBatchSummary, null, null, customStyle
                );
                if (batchPrompts && batchPrompts.length > 0) break;
            } catch (e) {
                if (_is429Error(e)) throw e;
                if (attempt === 2) batchPrompts = [];
            }
        }

        if (batchPrompts && batchPrompts.length > 0) {
            const renumbered = batchPrompts.map((p, idx) => ({
                ...p,
                number: String(runningNum + idx).padStart(2, '0')
            }));
            runningNum += batchPrompts.length;
            allPrompts = [...allPrompts, ...renumbered];
        } else {
        }

        if (batch < totalBatches - 1) {
            const delay = totalBatches >= 3 ? 5000 : 3000;
            await new Promise(r => setTimeout(r, delay));
        }
    }

    // 최종 검증
    if (allPrompts.length === 0) {
        throw new Error('프롬프트 생성에 실패했습니다. 다시 시도해주세요.');
    }
    if (allPrompts.length < scenes.length) {
    }

    return { characterRefs, prompts: allPrompts };
}

// ═══════════════════════════════════════════
// ★ PRO 2.0: 신규 분할 모드 (문장/문단/의미) — Phase 0 씬 분할 + 배치 생성
// ═══════════════════════════════════════════

/**
 * 검증 결과 심각도 판정 — 사용자 확정 임계값 A
 *  - MINOR: 편차 <10% (무음, 계속 진행)
 *  - MAJOR: 편차 10~40% (토스트 경고, 수동 대응, 계속 진행)
 *  - CRITICAL: 편차 >40% (즉시 중단, partial + resumeState)
 */
function _judgeValidationSeverity(validation, expectedCount) {
    if (!validation || validation.ok) return 'OK';
    const mm = Array.isArray(validation.mismatches) ? validation.mismatches : [];
    const denom = Math.max(1, expectedCount);

    let countDev = 0;
    let scriptDev = 0;
    let numberDev = 0;

    // COUNT_MISMATCH: 단일 엔트리, expected/got
    const countEntry = mm.find(m => m.type === 'COUNT_MISMATCH');
    if (countEntry) {
        countDev = Math.abs((countEntry.expected || 0) - (countEntry.got || 0)) / Math.max(1, countEntry.expected || 1);
    }

    // SCRIPTTEXT_OUT_OF_SEGMENT (균일): 단일 엔트리, count 필드
    const scriptOutEntry = mm.find(m => m.type === 'SCRIPTTEXT_OUT_OF_SEGMENT');
    if (scriptOutEntry) {
        scriptDev = Math.max(scriptDev, (scriptOutEntry.count || 0) / denom);
    }

    // SCRIPTTEXT_MISMATCH (신규): 씬별 개별 엔트리 — 개수 집계
    const scriptMmCount = mm.filter(m => m.type === 'SCRIPTTEXT_MISMATCH').length;
    if (scriptMmCount > 0) {
        scriptDev = Math.max(scriptDev, scriptMmCount / denom);
    }

    // NUMBER_MISMATCH (신규): 씬별 개별 엔트리
    const numberMmCount = mm.filter(m => m.type === 'NUMBER_MISMATCH').length;
    // NUMBER_SEQUENCE (균일): 단일 엔트리, count 필드
    const numberSeqEntry = mm.find(m => m.type === 'NUMBER_SEQUENCE');
    const numberSeqCount = numberSeqEntry ? (numberSeqEntry.count || 0) : 0;
    numberDev = Math.max(numberMmCount, numberSeqCount) / denom;

    // ★ 개수 편차만 의미 있음 — scriptText/번호 체크는 normalize 한계로 false positive 다수
    //   scriptText 는 파일명용으로 모든 기호 제거된 상태가 정상 (띄어쓰기·기호 없이 반환)
    //   → 원본 대본과 1:1 일치 비교 의미 없음
    //   → 개수(COUNT_MISMATCH) 만 체크
    if (countDev > 0.5) return 'CRITICAL';  // 개수 50% 이상 불일치
    if (countDev > 0.1) return 'MAJOR';     // 개수 10% 이상 불일치
    return 'MINOR';
}

/**
 * 균일 모드용 배치 검증 — segment text 기반 (Phase 0 씬 맵 없음)
 * 확인 항목:
 *  1) 반환 개수가 예상과 일치하는지
 *  2) 각 씬의 scriptText가 해당 segment text에 실제 등장하는지 (대본 이탈 감지)
 *  3) 씬 번호가 연속적인지
 */
function _validateUniformBatchIntegrity(batchIdx, totalBatches, expectedCount, returnedPrompts, segmentText, startNum) {
    const mismatches = [];
    const lines = [];
    // ★ 개선된 normalize — 문자(한/영/일/중) 와 숫자만 유지, 모든 구두점·특수문자 제거
    //   이전: ~, -, ", ', 괄호 등 미처리로 false positive 다수 발생
    //   예: "워따~ 여러분" vs Gemini "워따여러분" 불일치로 잘못 감지
    const normalize = (s) => String(s || '')
        .replace(/[^\uAC00-\uD7A3\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFFa-zA-Z0-9]/g, '');
    const segNorm = normalize(segmentText);

    // 1. 개수
    if (returnedPrompts.length !== expectedCount) {
        mismatches.push({ type: 'COUNT_MISMATCH', expected: expectedCount, got: returnedPrompts.length });
        lines.push(`  ❌ COUNT: expected ${expectedCount}, got ${returnedPrompts.length}`);
    }

    // 2. scriptText 대본 이탈 감지 (각 씬의 scriptText가 segment text에 실제로 있는지)
    let inSegment = 0;
    let outSegment = 0;
    const outDetails = [];
    for (let i = 0; i < returnedPrompts.length; i++) {
        const txt = normalize(returnedPrompts[i].scriptText || '');
        if (!txt) continue;
        // 첫 8자가 segment에 포함되어 있으면 정상
        const probe = txt.slice(0, 8);
        if (probe.length >= 4 && segNorm.includes(probe)) {
            inSegment++;
        } else {
            outSegment++;
            if (outDetails.length < 5) outDetails.push({ idx: i, text: txt.slice(0, 20) });
        }
    }
    if (outSegment > 0) {
        mismatches.push({ type: 'SCRIPTTEXT_OUT_OF_SEGMENT', count: outSegment, samples: outDetails });
        lines.push(`  ⚠️ ${outSegment}개 씬의 scriptText가 segment 외부 (샘플: ${outDetails.map(d => `[${d.idx + 1}]"${d.text}"`).join(', ')})`);
    }

    // 3. 씬 번호 연속성 (Gemini가 반환한 원본 번호 기준, renumber 전)
    let numberErrors = 0;
    for (let i = 0; i < returnedPrompts.length; i++) {
        const gotNum = parseInt(returnedPrompts[i].number, 10);
        const expectedNum = startNum + i;
        if (!isNaN(gotNum) && gotNum !== expectedNum) {
            numberErrors++;
            if (numberErrors <= 3) {
                lines.push(`  ⚠️ NUMBER [pos ${i + 1}]: expected=${expectedNum} got=${gotNum}`);
            }
        }
    }
    if (numberErrors > 0) {
        mismatches.push({ type: 'NUMBER_SEQUENCE', count: numberErrors });
    }

    const ok = mismatches.length === 0;
    const header = `🔍 [UNIFORM VALIDATION] Batch ${batchIdx + 1}/${totalBatches} — 예상 ${expectedCount}개, 반환 ${returnedPrompts.length}개, 대본내 ${inSegment}/${returnedPrompts.length}${numberErrors > 0 ? `, 번호오류 ${numberErrors}건` : ''}`;
    const report = [header, ...lines].join('\n');

    return { ok, mismatches, report, inSegment, outSegment, numberErrors };
}

/**
 * 씬 경계 검증 — Phase 0 결정값 vs 배치 응답 비교
 * Gemini가 씬 번호/경계를 재정의하지 않았는지 확인
 * @returns { ok: boolean, mismatches: [...], report: string }
 */
function _validateBatchSceneIntegrity(batchIdx, totalBatches, expectedScenes, returnedPrompts) {
    const mismatches = [];
    const lines = [];
    const normalize = (s) => String(s || '').replace(/\s+/g, '').replace(/[.,!?。、…]/g, '').slice(0, 14);

    // 1. 개수 불일치
    const countMatch = returnedPrompts.length === expectedScenes.length;
    if (!countMatch) {
        mismatches.push({
            type: 'COUNT_MISMATCH',
            expected: expectedScenes.length,
            got: returnedPrompts.length
        });
        lines.push(`  ❌ COUNT: expected ${expectedScenes.length}, got ${returnedPrompts.length}`);
    }

    // 2. 각 씬의 scriptText 일치 여부 (순서대로 매칭)
    const maxLen = Math.min(expectedScenes.length, returnedPrompts.length);
    let scriptTextMatches = 0;
    let scriptTextFuzzy = 0;
    for (let i = 0; i < maxLen; i++) {
        const expected = normalize(expectedScenes[i].scriptText || expectedScenes[i].scriptStart || '');
        const got = normalize(returnedPrompts[i].scriptText || '');
        if (!expected || !got) continue;
        if (expected === got) {
            scriptTextMatches++;
        } else if (expected.slice(0, 6) === got.slice(0, 6) || got.includes(expected.slice(0, 4)) || expected.includes(got.slice(0, 4))) {
            scriptTextFuzzy++;
            lines.push(`  ⚠️ FUZZY  [${i + 1}]: expected="${expected}" got="${got}"`);
        } else {
            mismatches.push({
                type: 'SCRIPTTEXT_MISMATCH',
                sceneIdx: i,
                expected,
                got
            });
            lines.push(`  ❌ SCENE [${i + 1}]: expected="${expected}" got="${got}"`);
        }
    }

    // 3. 번호 순서 일치 여부
    for (let i = 0; i < maxLen; i++) {
        const expectedNum = parseInt(expectedScenes[i].number, 10);
        const gotNum = parseInt(returnedPrompts[i].number, 10);
        if (!isNaN(expectedNum) && !isNaN(gotNum) && expectedNum !== gotNum) {
            mismatches.push({
                type: 'NUMBER_MISMATCH',
                sceneIdx: i,
                expected: expectedNum,
                got: gotNum
            });
            lines.push(`  ❌ NUMBER [pos ${i + 1}]: expected=${expectedNum} got=${gotNum}`);
        }
    }

    const ok = mismatches.length === 0;
    const header = `🔍 [SPLIT VALIDATION] Batch ${batchIdx + 1}/${totalBatches} — scenes ${expectedScenes.length}개 예상, ${returnedPrompts.length}개 반환, scriptText 정확일치 ${scriptTextMatches}/${maxLen}, 유사일치 ${scriptTextFuzzy}/${maxLen}`;
    const report = [header, ...lines].join('\n');

    return { ok, mismatches, report, matchCount: scriptTextMatches, fuzzyCount: scriptTextFuzzy };
}

/** 모드별 분할 기준 프롬프트 블록 반환 */
function _getSplitCriteriaPrompt(splitMode) {
    switch (splitMode) {
        case 'sentence':
            return `SENTENCE-BY-SENTENCE SPLIT (for short-form content ≤60s):
- Split at every sentence ending: period (.), question mark (?), exclamation (!), ellipsis (...).
- Each sentence = 1 scene.
- Short interjections (≤5 chars like "오!", "워메") → merge with next sentence.
- Sentences starting with conjunctions ("근디", "그래서", "그런데", "근데") → treat as new scene.
- Target: 2~5 seconds per scene.
- Decide the OPTIMAL number of scenes based on the above.`;

        case 'paragraph':
            return `PARAGRAPH-BY-PARAGRAPH SPLIT (for mid-form content 1~8 minutes):
- Split at paragraph boundaries: double line breaks OR clear topic/location/character/emotion shifts.
- Each paragraph = 1 scene.
- Paragraphs <50 chars → merge with adjacent paragraph.
- Paragraphs >400 chars → split into two at natural sentence boundary.
- Target: 20~40 seconds per scene (100~250 chars).
- Decide the OPTIMAL number of scenes based on the above.`;

        case 'semantic':
            return `SEMANTIC BEAT SPLIT — Universal, any category (economics, history, health, science,
mystery, review, travel, cooking, news, self-help, etc.). Optimized for YouTube pacing.

CORE PRINCIPLE: Each beat = a single image-renderable moment. If multiple visual scenes
are fused into one beat, you MUST split them. No vague summaries, no lumped paragraphs.

━━━ 7 TRANSITION CRITERIA ━━━
Start a NEW beat when ANY ONE of the following changes:

  ① LOCATION — street → indoors → cafe → office → landscape
  ② TIME — day → night / past → present / spring → autumn
  ③ CHARACTER — solo MCR → supporting enters → crowd → back to MCR
  ④ CAMERA ANGLE — wide → close-up → over-shoulder → direct gaze
  ⑤ EMOTION/TONE — curiosity → shock → analysis → warmth → anger → laughter
  ⑥ TOPIC/CONCEPT — problem → background → cause → solution → conclusion
  ⑦ NUMBER / PROPER NOUN — concrete figure, year, name, place, product name
     e.g. "9,800원", "1899년", "30 million views", "Thorstein Veblen",
          "Dubai", "Galaxy S25", "두바이쫀득쿠키"
     → These deserve their OWN beat (typography close-up or icon shot).

━━━ BEAT LENGTH ━━━
- IDEAL: 5~8 seconds (Korean: 40~70 chars | English: ~10~18 words)
- MIN: 3 seconds (Korean: ~20 chars). Below this → merge with adjacent beat.
- MAX: 10 seconds (Korean: ~100 chars). Above this → split at natural boundary.
- Standalone beats <3 sec FORBIDDEN.
- Overlong beats >10 sec FORBIDDEN.

━━━ EMOTIONAL EMPHASIS INDEPENDENT BEAT ━━━
The following may become their OWN beat when impactful (close-up reaction style):
- Strong interjections: "세상에!", "진짜로?!", "헐...", "워메~", "Oh my!", "No way!"
- Rhetorical questions: "왜 그럴까요?", "어떻게 이런 일이?", "Why is that?"
- Reveal/twist markers: "그런데 사실은...", "알고 보니...", "But the truth is..."
- Emphasis phrases: "잘 들으세요", "이게 핵심입니다", "Here's the key"

→ When present in context, carve them out as standalone close-up reaction beats.
   Default behavior: if ambiguous, merge with next sentence.

━━━ LIST / ENUMERATION STRUCTURE ━━━
When the script uses enumerative markers like "첫째/둘째/셋째", "1번/2번/3번",
"A/B/C", "first/second/third", "먼저/다음으로/마지막으로":

- Each item = a SEPARATE beat (never lump them together).
- RECOMMENDED (when content permits): split each item into 2 beats:
  • Title beat: the marker + item name ("첫째, 베블런 효과!")
  • Explanation beat: the detail following
- If the explanation is short (<20 chars), keep as 1 beat.

━━━ NUMBER / PROPER-NOUN EMPHASIS ━━━
Any beat containing a concrete number, year, currency, person name, place, or product
should be flagged as a visual-emphasis beat. Treatment options:
- Typography close-up (text intentionally rendered on screen)
- Icon shot (number on price tag, product label, book cover, phone screen)
- Text overlay highlight (chyron, lower-third)
- For named persons: portrait/silhouette (text optional)

NOTE ON TEXT RENDERING: The default sceneDesc uses "[no name labels]" to suppress
garbled AI text. For these emphasis beats, the downstream batch generator will
switch to "[text allowed: <specific text>]" — allowing legible typography only
where intentional. Just ensure scriptText captures the key number/name/product.

━━━ BG (BACKGROUND-ONLY) BEATS ━━━
Target 15~25% of all beats as BG beats (characters:""). Use when:
- Product / object explanation ongoing
- Data / graph / chart display
- Landscape or location emphasis
- Phone screen / document / book close-up
- Abstract concept visualization (money, time, relationships)

Category-aware BG weighting (auto-detect from script content):
  • Economics / finance → numbers, charts, money props
  • History / biography → year typography, portraits, landmarks
  • Health / medicine → body parts, food, medicine props
  • Science / tech → experiments, formulas, devices
  • Mystery / horror → dark locations, relics, scene props
  • Review / product → product close-ups, comparison shots
  • Travel / region → scenery, cultural elements, food
  • Cooking / recipe → ingredients, cooking steps, plated dishes
  • News / current affairs → news feed, documents, reference images
  • Self-help / motivation → abstract visualizations, metaphor shots

Detect category from script keywords and adjust BG emphasis accordingly.

━━━ DENSITY TARGETS (per script length) ━━━
- ~400 chars (≈1 min video)   → 8~12 beats
- ~1,200 chars (≈3 min video) → 25~35 beats
- ~2,000 chars (≈5 min video) → 40~50 beats
- ~4,000 chars (≈10 min video) → 80~100 beats

Baseline: ~0.15~0.2 beats per second. Higher density in climactic / data-heavy
sections, lower in reflective / atmospheric sections.

━━━ MERGE / TRANSITION HANDLING ━━━
- Interjections alone ("워메~", "아이고", "Oh") with no context → merge with next sentence
  UNLESS they carry dramatic weight (see "Emotional Emphasis" above).
- Conjunction-led sentences ("근디 말이여", "자~", "그런데", "But", "However") → new beat
  STARTS with the conjunction.

━━━ SELF-VERIFICATION (before finalizing output) ━━━
Internally check each criterion. If any fail, re-split or merge:
  □ No beat exceeds 10 seconds.
  □ No standalone beat under 3 seconds.
  □ Numbers / years / names are NOT absorbed into larger beats.
  □ Enumerations ("첫째·둘째·셋째") are split, not lumped.
  □ Location / character / emotion changes trigger new beats.
  □ Strong emotional emphasis moments are not flattened.
  □ BG beats constitute ≥15% of total (target 15~25%).
  □ Overall density approaches 0.15~0.2 beats/second for the script length.

Decide the OPTIMAL number of scenes based on all of the above.`;

        case 'lyrics':
            return `MUSIC LYRICS SPLIT (for music videos / MV production):

=== SONG STRUCTURE AWARENESS ===
Detect structural markers and treat them as section boundaries (NOT scenes themselves — skip them):
  [Intro] [Verse 1] [Verse 2] [Pre-Chorus] [Chorus] [Bridge] [Outro] [Hook]
  (chorus), (verse), (instrumental), (fade out), etc.
  Korean: [인트로] [1절] [2절] [후렴] [브릿지] [아우트로]

=== LYRICAL LINE = 1 SCENE ===
- Each SINGLE LYRIC LINE becomes one scene (target 3~8 seconds).
- A "line" is a natural lyrical phrase ending at line break, punctuation, or melodic pause.
- Target: 15~30 chars per scene (Korean) or 4~10 words per scene (English).

=== HANDLING REPEATED CHORUS ===
CRITICAL — If the chorus repeats 2-3 times, DO NOT generate identical scenes for each repetition.
Instead vary the visual interpretation per repetition:
  • 1st chorus: establishing shot of the emotional theme (e.g. wide shot of character alone)
  • 2nd chorus: close-up intensifying the emotion (e.g. tear-filled eyes, clenched hands)
  • 3rd chorus: climactic wide shot with dramatic element (e.g. character in rain, crowd scene)
Same lyric → different visual angle/composition/emotional intensity.

=== EMOTIONAL ARC PER SECTION ===
Map sections to visual tone (suggest in sceneDesc):
  • Intro: atmospheric, establishing, mysterious
  • Verse 1: narrative, grounded, introducing character/setting
  • Pre-Chorus: building tension, rising emotion
  • Chorus: emotional peak, iconic visual moment
  • Verse 2: deeper narrative, memory/flashback common
  • Bridge: pivot moment, revelation, vulnerability
  • Final Chorus: catharsis, climax, visual payoff
  • Outro: resolution, lingering emotion, fade

=== MERGE RULES ===
- Filler syllables ("oh oh oh", "na na na", "라라라", "woah") → merge with adjacent meaningful line.
- Ad-libs in parentheses (e.g. "(yeah)", "(baby)") → merge, do not create separate scene.
- Very short lines (<10 chars) → merge with next line for minimum 3-second scene.

=== STRUCTURAL MARKERS (SKIP) ===
Lines that are purely structural markers ([Intro], [Verse], etc.) DO NOT become scenes.
They serve only to indicate the section boundary for the next lyrical lines.

=== VISUAL VARIETY (MV STYLE) ===
Since music videos are visually dense:
- Alternate between: performance shots, narrative shots, atmospheric b-roll, symbolic imagery
- Suggest in sceneDesc: "performance shot", "narrative scene", "atmospheric b-roll"
- Target 40~60% narrative, 25~35% performance, 15~25% b-roll distribution

=== TIMING ===
- Per scene: 3~8 seconds (15~30 chars)
- Hard min: 2 seconds (merge fillers if needed)
- Hard max: 10 seconds (split long lyrical passages)

Decide the OPTIMAL number of scenes based on the above.`;

        default:
            return '';
    }
}

/** Phase 0: splitMode에 따라 Gemini에 대본 분할 요청 → { characters, scenes } 반환 */
async function _callSceneDivisionBySplitMode(script, splitMode, apiKey, nationality = 'Korean', userDirections = '', userProvidedCharRefs = null) {
    const safeScript = script.replace(/\\/g, '').replace(/"/g, "'").replace(/\t/g, ' ');
    const criteriaBlock = _getSplitCriteriaPrompt(splitMode);

    // 사용자 제공 캐릭터 힌트 — 프롬프트 글자수 제한 없음 (사용자 입력 전체 보존)
    let preProvidedBlock = '';
    if (Array.isArray(userProvidedCharRefs) && userProvidedCharRefs.length > 0) {
        const fixedRefsText = userProvidedCharRefs.map(r => {
            const desc = (r.prompt || r.description || r.name || '').replace(/\s+/g, ' ').trim();
            return `- ${r.code} (${r.name || r.code}): ${desc}`;
        }).join('\n\n');
        const fixedCodesStr = userProvidedCharRefs.map(r => r.code).join(', ');
        preProvidedBlock = `
═══ PRE-PROVIDED CHARACTERS (DO NOT REGENERATE) ═══
Use these characters AS-IS. In output 'characters' array, include ONLY NEW characters (not ${fixedCodesStr}).
${fixedRefsText}

`;
    }

    const userDirBlock = userDirections ? `\n=== USER DIRECTIONS ===\n${userDirections}\n` : '';

    const prompt = `${preProvidedBlock}Analyze the following script and divide it into scenes based on the criteria below.

=== SPLIT CRITERIA ===
${criteriaBlock}
${userDirBlock}
=== OUTPUT FORMAT ===
Return ONLY JSON. No markdown. COMPACT format — minimal whitespace.
{"characters":[{"code":"MCR","name":"이름","description":"${nationality} {gender}, {age}yo, {build}, {hair length/color/style}, wearing {color} {pattern} {outfit}, {accessories/glasses}"}],"scenes":[[1,"MCR","첫문장앞부분"],[2,"","배경설명"],[3,"SC1","키워드"]]}

scenes = array of arrays: [sceneNumber, characters, scriptStart]
- scriptStart: Copy the FIRST sentence of that scene's script VERBATIM. Remove ALL spaces and punctuation. Do NOT summarize. MAX 14 chars.
  Example: "워따여러분이것좀보" (from "워따 여러분 이것 좀 보시오")
- characters: "MCR", "MCR,SC1", "SC1,SC2" 등, or "" (empty for background/props-only scenes). Max 6 codes total: MCR + SC1~SC5.
- MCR is the MAIN CHARACTER. Recurring characters get codes. One-off objects/scenery use "".

=== MCR FLEXIBILITY (NEW) ===
MCR does NOT have to be a human person. Depending on the script, MCR can be:
  - Human (person): "Korean female, 25yo, ..."
  - Animal: "golden retriever", "white Jindo puppy"
  - Plant/Flower: "thousand-year flower", "cherry blossom tree"
  - Object: "vintage grand piano", "antique pocket watch"
  - Nature: "heavy rain", "moonlight", "ocean waves"
  - Abstract: "passage of time (visualized as sand clock)", "longing (letters and photos)"

Auto-detection priority:
  1. If script title/focus is a specific entity (e.g. "천년화" → flower) → that entity = MCR
  2. Otherwise, recurring subject in 2+ scenes → MCR
  3. If uncertain, human MCR fallback
Tag the description prefix accordingly:
  MCR(Human: ...), MCR(Flower: ...), MCR(Animal: ...), MCR(Nature: ...), MCR(Object: ...), MCR(Abstract: ...)

=== STYLE PRESET × MCR TYPE CONFLICT PREVENTION (NEW) ===
When the user's style preset contains human-specific tokens (e.g. "topknot",
"Hanbok", "Sangtu", "Binyeo hairpin", "hairstyle for male/female"), interpret
the preset in 2 layers:

  [Environment layer] — always apply regardless of MCR type:
    • Era (Joseon, modern, future), Space (temple, palace, urban)
    • Architecture, props, lighting, color palette, rendering aesthetic

  [Human-identity layer] — apply conditionally:
    • Hairstyle, clothing, accessories, gender/age-specific descriptions

Rules:
  - If MCR is Human → apply human-identity layer to MCR + all SC characters.
  - If MCR is non-human (Flower/Animal/Nature/Object/Abstract):
    • MCR-only scenes: EXCLUDE human-identity layer completely.
      Do NOT mention Hanbok, topknot, hairstyle on the flower/animal/object.
    • SC-appearance scenes: apply human-identity layer ONLY to SC characters.
      MCR remains in natural form (no human clothing/hair).

  ❌ WRONG: "Joseon. Sangtu topknot. Hanbok. MCR(Flower: white bloom...)"
  ✅ RIGHT: "Joseon temple atmosphere. Golden hour. MCR(Flower: white bloom on
            ancient stone altar)." — human tokens omitted for flower MCR

=== CRITICAL RULES ===
- Output scenes on ONE LINE, no line breaks inside the array.
- scriptStart must come from the script VERBATIM (no summarization).
- Decide N (number of scenes) yourself based on the split criteria above.

=== SCRIPT ===
${safeScript}

=== OUTPUT JSON NOW ===`;

    const phase0Tokens = 65536;
    const data = await _geminiApiCall(apiKey, prompt, phase0Tokens);
    const rawText = data.candidates[0].content.parts[0].text;
    return _parseSceneDivision(rawText);
}

/**
 * ★ 스타일 프리셋에서 인간 전용 토큰이 포함된 문장만 제거 (환경·미학은 유지)
 * 사용 지점: 비인물 MCR(Flower/Animal/Nature/Object/Abstract) 레퍼런스 시트 생성 시
 * 원칙: "환경·공간 계층" (시대·조명·미학) 은 유지, "인물 계층" (헤어·의상·장신구) 은 제거
 */
const _HUMAN_LAYER_KEYWORDS = [
    // 의상
    'hanbok', 'hanfu', 'sari', 'sherwani', 'hijab', 'thobe', 'bisht', 'kimono',
    // 헤어/헤드웨어
    'topknot', 'sangtu', 'binyeo', 'jjokmeori', 'daenggi', 'norigae',
    'gat hat', 'gat horsehair', 'guanmao', 'turban',
    // 성별/연령 특화
    'for male', 'for female', 'for nobility', 'for male singer', 'for female singer',
    'hairstyle', 'pinned bun', 'braided hair',
    // 기타 인간 특화
    'bindi dot', 'monolid eyes', 'neatly trimmed beard', 'jewel pin',
    'gold jewelry and bangles', 'ornate hairpin', 'headband',
    'east asian facial features'
];

function _stripHumanLayerFromStyle(stylePrompt) {
    if (!stylePrompt || typeof stylePrompt !== 'string') return stylePrompt || '';
    // 문장 단위로 분리 (마침표 + 공백/끝)
    const sentences = stylePrompt.split(/(?<=\.)\s+/);
    const kept = sentences.filter(s => {
        const lower = s.toLowerCase();
        return !_HUMAN_LAYER_KEYWORDS.some(k => lower.includes(k));
    });
    // 마지막 마침표 제거 — 템플릿에서 ". [code] Reference..." 로 이어지므로 중복 방지
    return kept.join(' ').replace(/\s+/g, ' ').trim().replace(/\.+\s*$/, '');
}

/**
 * ★ v1.5: _stripHumanLayerFromStyle 의 역함수
 * 제거된(=인간 전용 토큰 포함) 문장들만 반환. 커스텀 스타일에서 humanIdentity 추출용.
 */
function _extractHumanLayerFromStyle(stylePrompt) {
    if (!stylePrompt || typeof stylePrompt !== 'string') return '';
    const sentences = stylePrompt.split(/(?<=\.)\s+/);
    const removed = sentences.filter(s => {
        const lower = s.toLowerCase();
        return _HUMAN_LAYER_KEYWORDS.some(k => lower.includes(k));
    });
    return removed.join(' ').replace(/\s+/g, ' ').trim().replace(/\.+\s*$/, '');
}

/**
 * ★ v1.5: 스타일 2-레이어 분리 조회 — 단일 choke point
 *
 * 반환: { rendering, humanIdentity, fullPrompt, source }
 *   - rendering: sceneDesc용 (렌더링+환경 레이어) — 항상 적용
 *   - humanIdentity: 인물 charProps용 (성별·연령 조건부 의상/헤어) — null 가능
 *   - fullPrompt: rendering + humanIdentity (레거시 호환 / 인물 캐릭터 레퍼런스용)
 *   - source: 'custom' | 'fallback'
 *
 * 커스텀: _stripHumanLayerFromStyle + _extractHumanLayerFromStyle 로 자동 분리
 */
function getStyleLayers(styleId, customStyle = '') {
    if (styleId && typeof styleId === 'string' && styleId.startsWith('custom_') && customStyle) {
        const rendering = _stripHumanLayerFromStyle(customStyle);
        const humanIdentity = _extractHumanLayerFromStyle(customStyle);
        const fullPrompt = (customStyle || '').trim().replace(/\.+\s*$/, '');
        return {
            rendering,
            humanIdentity: humanIdentity || null,
            fullPrompt,
            source: 'custom'
        };
    }

    return { rendering: '', humanIdentity: null, fullPrompt: '', source: 'fallback' };
}

/**
 * ★ v1.5: 컨텍스트별 스타일 문자열 resolver — 편의 wrapper
 * @param {string} styleId — 'custom_XXX' 또는 빈 값
 * @param {string} customStyle — 커스텀 스타일 원본 prompt (styleId가 custom_ 일 때만 의미)
 * @param {object} opts
 *   - isNonHumanRef: true면 rendering만 반환 (비인물 MCR/SC 레퍼런스용)
 *                    false면 fullPrompt 반환 (인물 캐릭터용 — 기존 동작 동등)
 */
function resolveStylePromptForContext(styleId, customStyle, { isNonHumanRef = false } = {}) {
    const layers = getStyleLayers(styleId, customStyle);
    return isNonHumanRef ? layers.rendering : layers.fullPrompt;
}

/**
 * ★ MCR description prefix 로 비인물 MCR 감지
 * 명세서 v1.4 표기: MCR(Human:...), MCR(Flower:...), MCR(Animal:...), MCR(Nature:...), MCR(Object:...), MCR(Abstract:...)
 * description 자체가 이 형태이거나, "mythical flower", "golden retriever" 같은 자연어 추론도 가능하지만
 * Gemini가 v1.4 prefix 규칙 준수 시 정확히 매칭
 */
function _detectNonHumanMCR(description) {
    if (!description || typeof description !== 'string') return false;
    const desc = description.trim();
    // MCR 유형 prefix 명시 케이스 (v1.4 표기)
    if (/^(Flower|Animal|Nature|Object|Abstract)\s*:/i.test(desc)) return true;
    if (/^Human\s*:/i.test(desc)) return false;
    // 자연어 추론 (prefix 없을 때 대비) — 확장 키워드
    const nonHumanTokens = /\b(flower|petals?|blossom|bloom|stem|leaves?|dog|cat|puppy|kitten|retriever|maltese|jindo|shiba|poodle|husky|dragon|bird|butterfly|wolf|rabbit|hamster|fox|deer|lion|tiger|horse|pony|eagle|owl|sparrow|fish|rain|moonlight|sunlight|ocean|sea|wave|wind|cloud|star|moon|sun|piano|guitar|clock|hourglass|robot|mecha|creature|spirit|ghost|sword|shield|tree|grass|mountain|river)\b/i;
    const humanTokens = /\b(male|female|woman|man|girl|boy|person|human|korean|japanese|chinese|arab|indian|\d+yo)\b/i;
    if (nonHumanTokens.test(desc) && !humanTokens.test(desc)) return true;
    return false;
}

/**
 * ★ PRO: _parseSceneDivision 결과의 `characters` → 완전한 `characterRefs` 로 변환
 * (prompt + refSheetPrompt 추가 → "GENERATE CHARACTER REFERENCES" 버튼이 사용할 수 있음)
 * 기존 `_callSceneDivision` (균일 모드)이 내부적으로 하던 동일 로직을 재사용
 *
 * ★ v1.4 충돌 방지: 비인물 MCR 감지 시 stylePrompt의 인간 전용 토큰(Hanbok, topknot 등) 자동 제거
 */
function _buildCharacterRefsFromDivisionResult(divisionResult, styleId, stylePrompt, nationality, customStyle = '') {
    const chars = divisionResult.characters || [];
    if (chars.length === 0) return [];

    const isStickMan = styleId === '27';
    const isStickWoman = styleId === '28';
    const isStickFigure = isStickMan || isStickWoman;

    // ★ v1.5: 2-레이어 resolver — 비인물은 rendering만, 인물은 fullPrompt
    return chars.map(c => {
        const desc = c.description || '';
        const code = c.code || 'MCR';

        const isNonHuman = _detectNonHumanMCR(desc);
        const effectiveStyle = resolveStylePromptForContext(styleId, customStyle, { isNonHumanRef: isNonHuman });

        // 배경 프롬프트: 원본 _callSceneDivision L1840 과 동일 패턴
        const charPrompt = isStickFigure
            ? `2D stick figure ${isStickWoman ? 'woman' : 'man'} (simple white round head, thin black line body${isStickWoman ? ', pastel accessories like ribbon/bow' : ''}) in humorous 2D illustration style. Full body shot, front facing, studio background. [no name labels]. ${code} wearing ${code === 'MCR' ? 'blue' : code === 'SC1' ? 'purple' : code === 'SC2' ? 'green' : code === 'SC3' ? 'orange' : code === 'SC4' ? 'red' : code === 'SC5' ? 'teal' : 'blue'} ${isStickWoman ? 'pastel ' : ''}outfit. Standing in neutral pose. Character reference portrait.`
            : `Studio background. [no name labels]. ${code}(${desc}). Full body shot, front facing. ${isNonHuman ? 'Subject in its natural form (no human clothing/hair/body).' : 'Standing in neutral pose, arms relaxed. Calm expression.'} Character reference portrait.`;

        // 레퍼런스 시트 프롬프트: 4+2 split 레이아웃 (기존 정책)
        // ★ 비인물 MCR: 시트 레이아웃 문구도 "anatomy/body" 대신 "form/subject" 로 완화
        const refSheetPrompt = isStickFigure
            ? `[${nationality} Context]. [no name labels]. ${effectiveStyle}. [${code}] Character reference sheet. 16:9 canvas split vertically. LEFT panel: 4 cells (2x2 grid) for face close-ups — front, 3/4 left, 3/4 right, profile. RIGHT panel: 2 cells (vertical split) — full body front, full body back. Same stick figure character, consistent lighting.`
            : isNonHuman
                ? `[${nationality} Context]. [no name labels]. ${effectiveStyle}. [${code}] Reference sheet. Match style, rendering, texture, color across all panels. Mid-gray neutral background. 16:9 canvas. LEFT panel: 4 cells (2x2) — detail close-ups of the subject from different angles (front, 3/4, side, macro). RIGHT panel: 2 cells — full form from front/top view, full form from side/alternate view. Same subject in its natural form (no human body/clothing/hair). Consistent lighting. ${desc}`
                : `[${nationality} Context]. [no name labels]. ${effectiveStyle}. [${code}] Character reference sheet. Match style, rendering, texture, color across all panels. Mid-gray neutral background. 16:9 canvas. LEFT panel: 4 cells (2x2) — face close-ups (front, 3/4 left, 3/4 right, profile). RIGHT panel: 2 cells — full body front, full body back. Same character, consistent lighting. ${desc}`;

        return {
            code,
            name: c.name || '',
            description: desc,
            prompt: convertCharacterCodes(charPrompt),
            refSheetPrompt: convertCharacterCodes(refSheetPrompt),
            status: 'pending'
        };
    });
}

/**
 * ★ PRO: 음악 장르별 캐릭터 레퍼런스 텍스트 조합
 * APP.customCharRefs 에서 온 userProvidedCharRefs를 음악 프롬프트의
 * {character_reference} 변수에 주입 가능한 평문 형태로 빌드
 */
function _buildCharacterReferenceForMusic(userProvidedCharRefs) {
    if (!Array.isArray(userProvidedCharRefs) || userProvidedCharRefs.length === 0) return '';
    return userProvidedCharRefs.map(r => {
        const name = r.name || r.code || 'Character';
        const code = r.code || 'MCR';
        // 사용자 입력 prompt 전체를 그대로 전달 (truncation 없음 — PRO 원칙)
        const prompt = (r.prompt || r.description || '').replace(/\s+/g, ' ').trim();
        return `[${code}] ${name}: ${prompt}`;
    }).join('\n\n');
}

/**
 * ★ PRO: 음악 가사 장르별 Phase 0 씬 분할
 * core/music-prompts.js 의 9종 장르 템플릿을 활용
 */
async function _callMusicSceneDivision(script, musicOptions, apiKey, userProvidedCharRefs, userDirections) {
    const genre = (musicOptions && musicOptions.genre) || 'cinematic_ballad';
    const hookVariation = (musicOptions && musicOptions.hookVariation) || 'medium';
    const narrativeArc = !!(musicOptions && musicOptions.narrativeArc);

    // 변수 구성 — 1순위 캐릭터 레퍼런스 / 2순위 특별 지시사항 / 3순위 장르 기본값
    const characterReference = _buildCharacterReferenceForMusic(userProvidedCharRefs);
    const specialInstructions = (userDirections || '').trim();

    const variables = {
        script: script,
        hook_variation_intensity: hookVariation,
        apply_narrative_arc: narrativeArc,
        character_reference: characterReference,
        special_instructions: specialInstructions
    };

    // music-prompts.js의 helper로 템플릿 치환 (window/globalThis 노출)
    const fetcher = (typeof getMusicGenrePrompt !== 'undefined')
        ? getMusicGenrePrompt
        : (typeof globalThis !== 'undefined' && globalThis.getMusicGenrePrompt)
            ? globalThis.getMusicGenrePrompt
            : null;
    if (!fetcher) {
        throw new Error('music-prompts.js 로드 실패 — getMusicGenrePrompt 미정의');
    }
    const prompt = fetcher(genre, variables);

    console.log(`🎵 [MUSIC MODE] 장르: ${genre}, 훅: ${hookVariation}, 기승전결: ${narrativeArc}, 커스텀캐릭터: ${characterReference ? 'Y' : 'N'}, 특별지시: ${specialInstructions ? 'Y' : 'N'}`);

    const phase0Tokens = 65536;
    const data = await _geminiApiCall(apiKey, prompt, phase0Tokens);
    const rawText = data.candidates[0].content.parts[0].text;
    return _parseSceneDivision(rawText);
}

/** splitMode (문장/문단/의미/가사) 메인 실행 함수 */
async function _runSplitMode(script, splitMode, apiKey, styleId, customStyle, nationality, userDirections, stylePrompt, userProvidedCharRefs, onBatchProgress, musicOptions = null) {
    // ── Phase 0: Gemini 씬 분할 ──
    if (onBatchProgress) onBatchProgress('divide', 0, 1);

    const useMusicMode = splitMode === 'lyrics' && musicOptions && musicOptions.genre;

    let divisionResult;
    for (let attempt = 1; attempt <= 2; attempt++) {
        try {
            if (attempt > 1) await new Promise(r => setTimeout(r, 3000));
            if (useMusicMode) {
                // ★ PRO: 음악 장르별 전용 프롬프트 사용
                divisionResult = await _callMusicSceneDivision(
                    script, musicOptions, apiKey, userProvidedCharRefs, userDirections
                );
            } else {
                divisionResult = await _callSceneDivisionBySplitMode(
                    script, splitMode, apiKey, nationality, userDirections, userProvidedCharRefs
                );
            }
            if (divisionResult.scenes && divisionResult.scenes.length > 0) break;
        } catch (e) {
            if (_is429Error(e)) throw e;
            if (attempt === 2) throw e;
        }
    }

    const scenes = divisionResult.scenes || [];
    if (scenes.length === 0) {
        throw new Error('씬 분할 실패. 대본이 너무 짧거나 형식을 인식할 수 없습니다.');
    }

    // ★ BUGFIX: _parseSceneDivision 결과의 `characters` 를 완전한 `characterRefs` (prompt+refSheetPrompt 포함) 로 변환
    //   — 이전엔 divisionResult.characterRefs (없는 필드) 접근해서 항상 [] 였음 → 레퍼런스 섹션 숨겨짐
    let characterRefs = divisionResult.characterRefs
        || _buildCharacterRefsFromDivisionResult(divisionResult, styleId, stylePrompt, nationality, customStyle);

    // ★ 사용자 제공 캐릭터 병합 + _userProvided 태그 (charRefContext에서 LOCKED IDENTITY로 인식되려면 필수)
    if (Array.isArray(userProvidedCharRefs) && userProvidedCharRefs.length > 0) {
        const userCodes = new Set(userProvidedCharRefs.map(r => r.code));
        const aiOnly = characterRefs.filter(r => !userCodes.has(r.code));
        characterRefs = [
            ...userProvidedCharRefs.map(r => ({ ...r, _userProvided: true })),
            ...aiOnly
        ];
    }

    // ★ N 결정 → sidepanel에 알림 (토스트 + UI 업데이트)
    const N = scenes.length;
    if (onBatchProgress) onBatchProgress('split_decided', N, 1);

    console.log(`🎬 [SPLIT MODE: ${splitMode}] Phase 0 완료 — ${N}개 씬, ${characterRefs.length}개 캐릭터`);

    // ── Phase 2: 배치 프롬프트 생성 (기존 _runBatchMode 로직 재사용) ──
    const BATCH_MAX = 25;
    const totalBatches = Math.ceil(N / BATCH_MAX);
    let allPrompts = [];
    let runningNum = 1;

    for (let batch = 0; batch < totalBatches; batch++) {
        const startIdx = batch * BATCH_MAX;
        const batchScenes = scenes.slice(startIdx, startIdx + BATCH_MAX);

        if (onBatchProgress) {
            onBatchProgress('batch', batch + 1, totalBatches, runningNum, runningNum + batchScenes.length - 1);
        }

        const maxTokens = Math.min(65536, 1000 * batchScenes.length + 2000);
        const previousBatchPrompts = batch > 0 && allPrompts.length > 0 ? allPrompts.slice(-5) : null;
        const previousBatchSummary = batch > 0
            ? {
                first: String(startIdx - BATCH_MAX + 1).padStart(2, '0'),
                last: String(startIdx).padStart(2, '0'),
                count: Math.min(BATCH_MAX, startIdx)
            }
            : null;

        let batchPrompts = null;
        for (let attempt = 1; attempt <= 2; attempt++) {
            try {
                if (attempt > 1) await new Promise(r => setTimeout(r, 3000));
                batchPrompts = await _callBatchPromptGeneration(
                    script, batchScenes, characterRefs, apiKey, stylePrompt, nationality, styleId, userDirections,
                    maxTokens, previousBatchPrompts, previousBatchSummary,
                    scenes,      // ★ phase0SceneMap — 전체 씬 구조 잠금
                    splitMode,   // ★ splitMode 표시용
                    customStyle  // ★ v1.5: 2-레이어 스타일 resolver
                );
                if (batchPrompts && batchPrompts.length > 0) break;
            } catch (e) {
                if (_is429Error(e)) throw e;
                if (attempt === 2) batchPrompts = [];
            }
        }

        if (batchPrompts && batchPrompts.length > 0) {
            // ★ 검증: 개수 편차 있을 때만 로그
            const validation = _validateBatchSceneIntegrity(batch, totalBatches, batchScenes, batchPrompts);
            const severity = _judgeValidationSeverity(validation, batchScenes.length);
            if (severity === 'MAJOR' || severity === 'CRITICAL') {
                console.log(`⚠️ [SPLIT VALIDATION] Batch ${batch + 1} 개수 편차 ${severity}: 예상 ${batchScenes.length}개 → 반환 ${batchPrompts.length}개`);
            }
            if (onBatchProgress) {
                onBatchProgress('validation', batch + 1, totalBatches, null, null, {
                    ok: validation.ok,
                    severity,
                    mismatches: validation.mismatches,
                    report: validation.report,
                    matchCount: validation.matchCount,
                    expectedCount: batchScenes.length,
                    splitMode
                });
            }

            // ★ CRITICAL: 즉시 배치 중단 + partial + resumeState 반환
            if (severity === 'CRITICAL') {
                return {
                    characterRefs,
                    prompts: allPrompts,
                    partial: true,
                    failReason: 'VALIDATION_CRITICAL',
                    failedBatch: batch + 1,
                    totalBatches,
                    resumeState: {
                        splitMode,
                        phase0SceneMap: scenes,
                        nextBatchIdx: batch,  // 실패 배치부터 재시도
                        runningNum,
                        characterRefs,
                        userProvidedCharRefs,
                        script, stylePrompt, nationality, styleId, userDirections, customStyle
                    }
                };
            }

            // ★ PRO 2.0: 번호는 Phase 0 기준으로 강제 (Gemini가 다르게 반환해도 Phase 0 번호 사용)
            const renumbered = batchPrompts.map((p, idx) => ({
                ...p,
                // Phase 0에서 결정된 씬 번호 우선. 위치 매칭 안 되면 순차 번호로 fallback
                number: (batchScenes[idx]?.number !== undefined && batchScenes[idx]?.number !== null)
                    ? String(batchScenes[idx].number).padStart(2, '0')
                    : String(runningNum + idx).padStart(2, '0'),
                // Phase 0의 scriptText도 원본 우선 (Gemini가 바꿨으면 복원)
                scriptText: batchScenes[idx]?.scriptText || p.scriptText || '',
                characters: batchScenes[idx]?.characters ?? p.characters ?? ''
            }));

            // batch_done 콜백 (resumeState)
            const nextBatchIdx = batch + 1;
            const resumeStateOnSuccess = nextBatchIdx < totalBatches ? {
                splitMode,              // ★ 신규 모드 표시
                phase0SceneMap: scenes, // ★ Phase 0 전체 씬 맵
                nextBatchIdx,
                runningNum: runningNum + batchPrompts.length,
                characterRefs,
                userProvidedCharRefs,
                musicOptions,           // ★ PRO: 음악 장르 옵션 복원용
                script, stylePrompt, nationality, styleId, userDirections, customStyle
            } : null;

            if (onBatchProgress) {
                onBatchProgress('batch_done', batch + 1, totalBatches, null, runningNum + batchPrompts.length - 1, {
                    characterRefs,
                    resumeState: resumeStateOnSuccess
                });
            }

            runningNum += batchPrompts.length;
            allPrompts = [...allPrompts, ...renumbered];
        } else {
            // ★ 배치 실패: 즉시 partial + resumeState 반환 (silent data loss 방지)
            //   allPrompts가 비어있어도(배치 1 실패) 명시적으로 실패 표시 + 재개 가능
            const errMsg = 'BATCH_FAILED';
            console.log(`ℹ️ [SPLIT MODE] 배치 ${batch + 1}/${totalBatches} 중단. ${allPrompts.length}개 생성 완료, 재개 가능.`);
            return {
                characterRefs,
                prompts: allPrompts,
                partial: true,
                failReason: errMsg,
                failedBatch: batch + 1,
                totalBatches,
                resumeState: {
                    splitMode,
                    phase0SceneMap: scenes,
                    nextBatchIdx: batch,   // 실패한 배치부터 재시도
                    runningNum,
                    characterRefs,
                    userProvidedCharRefs,
                    musicOptions,           // ★ PRO: 음악 장르 옵션 복원용
                    script, stylePrompt, nationality, styleId, userDirections, customStyle
                }
            };
        }

        if (batch < totalBatches - 1) {
            const delay = totalBatches >= 3 ? 5000 : 3000;
            await new Promise(r => setTimeout(r, delay));
        }
    }

    if (allPrompts.length === 0) {
        throw new Error('프롬프트 생성에 실패했습니다. 다시 시도해주세요.');
    }

    return { characterRefs, prompts: allPrompts, splitMode, phase0SceneMap: scenes, musicOptions };
}

/** 신규 분할 모드의 Resume 전용 함수 — Phase 0 재호출 없이 저장된 scene map으로 배치 루프만 재시도 */
async function _resumeSplitMode(resumeState, existingPrompts, apiKey, onBatchProgress = null) {
    const {
        splitMode, phase0SceneMap, nextBatchIdx = 0, runningNum: startNum,
        characterRefs, userProvidedCharRefs,
        musicOptions = null,           // ★ PRO: 음악 옵션 복원 (재개 시 원본 장르/훅 설정 유지)
        script, stylePrompt, nationality, styleId, userDirections,
        customStyle = ''               // ★ v1.5: 커스텀 스타일 원본 (2-레이어 resolver용, 레거시 session은 '' fallback)
    } = resumeState;

    const scenes = phase0SceneMap;
    if (!Array.isArray(scenes) || scenes.length === 0) {
        throw new Error('Resume 실패: Phase 0 씬 맵이 없습니다.');
    }

    const BATCH_MAX = 25;
    const totalBatches = Math.ceil(scenes.length / BATCH_MAX);
    let allPrompts = [];
    let runningNum = startNum;
    const previousFromExisting = existingPrompts && existingPrompts.length > 0 ? existingPrompts.slice(-5) : null;

    for (let batch = nextBatchIdx; batch < totalBatches; batch++) {
        const startIdx = batch * BATCH_MAX;
        const batchScenes = scenes.slice(startIdx, startIdx + BATCH_MAX);

        if (onBatchProgress) {
            onBatchProgress('batch', batch + 1, totalBatches, runningNum, runningNum + batchScenes.length - 1);
        }

        const maxTokens = Math.min(65536, 1000 * batchScenes.length + 2000);
        const previousBatchPrompts = allPrompts.length > 0 ? allPrompts.slice(-5) : previousFromExisting;
        const previousBatchSummary = existingPrompts && existingPrompts.length > 0 ? {
            first: '01',
            last: String(existingPrompts.length).padStart(2, '0'),
            count: existingPrompts.length
        } : null;

        let batchPrompts = null;
        for (let attempt = 1; attempt <= 2; attempt++) {
            try {
                if (attempt > 1) await new Promise(r => setTimeout(r, 3000));
                batchPrompts = await _callBatchPromptGeneration(
                    script, batchScenes, characterRefs, apiKey, stylePrompt, nationality, styleId, userDirections,
                    maxTokens, previousBatchPrompts, previousBatchSummary,
                    scenes, splitMode, customStyle
                );
                if (batchPrompts && batchPrompts.length > 0) break;
            } catch (e) {
                if (_is429Error(e)) throw e;
                if (attempt === 2) batchPrompts = [];
            }
        }

        if (batchPrompts && batchPrompts.length > 0) {
            // ★ 검증: 개수 편차만 로그 (resume 경로도 동일 정책)
            const validation = _validateBatchSceneIntegrity(batch, totalBatches, batchScenes, batchPrompts);
            const severity = _judgeValidationSeverity(validation, batchScenes.length);
            if (severity === 'MAJOR' || severity === 'CRITICAL') {
                console.log(`⚠️ [SPLIT VALIDATION RESUME] Batch ${batch + 1} 개수 편차 ${severity}: 예상 ${batchScenes.length}개 → 반환 ${batchPrompts.length}개`);
            }
            if (onBatchProgress) {
                onBatchProgress('validation', batch + 1, totalBatches, null, null, {
                    ok: validation.ok,
                    severity,
                    mismatches: validation.mismatches,
                    report: validation.report,
                    matchCount: validation.matchCount,
                    expectedCount: batchScenes.length,
                    splitMode
                });
            }

            // ★ CRITICAL: 즉시 중단 + partial + resumeState 반환
            if (severity === 'CRITICAL') {
                return {
                    characterRefs,
                    prompts: allPrompts,
                    partial: true,
                    failReason: 'VALIDATION_CRITICAL',
                    failedBatch: batch + 1,
                    totalBatches,
                    resumeState: {
                        splitMode, phase0SceneMap: scenes, nextBatchIdx: batch,
                        runningNum, characterRefs, userProvidedCharRefs,
                        script, stylePrompt, nationality, styleId, userDirections, customStyle
                    }
                };
            }

            // ★ Phase 0 번호·scriptText 강제 (Gemini가 다르게 반환해도 Phase 0 기준)
            const renumbered = batchPrompts.map((p, idx) => ({
                ...p,
                number: (batchScenes[idx]?.number !== undefined && batchScenes[idx]?.number !== null)
                    ? String(batchScenes[idx].number).padStart(2, '0')
                    : String(runningNum + idx).padStart(2, '0'),
                scriptText: batchScenes[idx]?.scriptText || p.scriptText || '',
                characters: batchScenes[idx]?.characters ?? p.characters ?? ''
            }));
            const nextIdx = batch + 1;
            const resumeStateOnSuccess = nextIdx < totalBatches ? {
                splitMode, phase0SceneMap: scenes, nextBatchIdx: nextIdx,
                runningNum: runningNum + batchPrompts.length, characterRefs,
                userProvidedCharRefs, musicOptions,
                script, stylePrompt, nationality, styleId, userDirections, customStyle
            } : null;
            if (onBatchProgress) {
                onBatchProgress('batch_done', batch + 1, totalBatches, null, runningNum + batchPrompts.length - 1, {
                    characterRefs,
                    resumeState: resumeStateOnSuccess
                });
            }
            runningNum += batchPrompts.length;
            allPrompts = [...allPrompts, ...renumbered];
        } else {
            // 다시 실패 — 부분 결과 + resumeState
            return {
                characterRefs, prompts: allPrompts, partial: true,
                failReason: 'BATCH_FAILED', failedBatch: batch + 1, totalBatches,
                resumeState: {
                    splitMode, phase0SceneMap: scenes, nextBatchIdx: batch,
                    runningNum, characterRefs, userProvidedCharRefs, musicOptions,
                    script, stylePrompt, nationality, styleId, userDirections, customStyle
                }
            };
        }

        if (batch < totalBatches - 1) {
            await new Promise(r => setTimeout(r, totalBatches >= 3 ? 5000 : 3000));
        }
    }

    return { characterRefs, prompts: allPrompts, splitMode, phase0SceneMap: scenes, musicOptions };
}

// ═══════════════════════════════════════════
// Phase 1: 씬 분할 — 대본을 N개 씬으로 분할 + 캐릭터 식별
// 가벼운 응답(번호, 대사, 캐릭터)만 받아 토큰 한도 내 안전
// ═══════════════════════════════════════════
async function _callSceneDivision(script, numScenes, apiKey, stylePrompt, nationality, styleId, userDirections, userProvidedCharRefs = null) {
    const safeScript = script.replace(/\\/g, '').replace(/"/g, "'").replace(/\t/g, ' ');
    const scriptEndHint = safeScript.length > 300 ? `\n\n=== SCRIPT ENDING (Scene [${numScenes}] must cover this part) ===\n...${safeScript.slice(-400)}` : '';

    // ★ PRO 2.0: 사용자 제공 캐릭터가 있으면 division 단계에서도 이를 인식시킴
    //   프롬프트 글자수 제한 없음 — 사용자 입력 전체 보존
    let preProvidedBlock = '';
    if (Array.isArray(userProvidedCharRefs) && userProvidedCharRefs.length > 0) {
        const fixedRefsText = userProvidedCharRefs.map(r => {
            const desc = (r.prompt || r.description || r.name || '').replace(/\s+/g, ' ').trim();
            return `- ${r.code} (${r.name || r.code}): ${desc}`;
        }).join('\n\n');
        const fixedCodesStr = userProvidedCharRefs.map(r => r.code).join(', ');
        preProvidedBlock = `
═══ PRE-PROVIDED CHARACTERS (DO NOT REGENERATE) ═══
Use these characters AS-IS. In output 'characters' array, include ONLY NEW characters (not ${fixedCodesStr}).
${fixedRefsText}

`;
    }

    const scriptStartRule = `- scriptStart: Copy the FIRST sentence of that scene's script VERBATIM. Remove ALL spaces and punctuation. Do NOT summarize, do NOT extract keywords. MAX 14 chars.\n  Example: script "오빠가 교육 동의서를 가져오며" → "오빠가교육동의서를가져오며"\n  Example: script "The old man walked slowly" → "Theoldmanwalked"\n  Example: script "彼女は静かに歩いていた" → "彼女は静かに歩いていた"`;
    const prompt = `${preProvidedBlock}Divide this script into exactly ${numScenes} scenes.

=== OUTPUT FORMAT ===
Return ONLY JSON. No markdown. COMPACT format — minimal whitespace.
{"characters":[{"code":"MCR","name":"이름","description":"${nationality} {gender}, {age}yo, {build}, {hair length/color/style}, wearing {color} {pattern} {outfit}, {accessories/glasses}"}],"scenes":[[1,"MCR","키워드"],[2,"","키워드"],[3,"SC1","키워드"]]}

scenes = array of arrays: [sceneNumber, characters, scriptStart]
${scriptStartRule}
- characters: "MCR", "MCR,SC1", "SC1", "SC2", "SC3", "SC4", "SC5" or combinations (e.g. "MCR,SC1", "SC1,SC2"), or "" (empty for background/props-only). STRICT HARD LIMIT — Maximum 6 characters total: MCR (1 main character) + SC1, SC2, SC3, SC4, SC5 (up to 5 supporting). You MUST NOT use SC6, SC7, or any code beyond SC5. If the script has more than 6 named roles, choose only the 6 most important.
- ★ FORBIDDEN CODES: NEVER use MCR_A, MCR_B, MCR_C, MCR1, MCR2, SC1_A, SC1B, SC1.2, or ANY variant/suffix. The ONLY allowed character codes are the exact strings: MCR, SC1, SC2, SC3, SC4, SC5. If a script has multiple main-like subjects (e.g. a human AND an animal both recurring as protagonists), assign ONE as MCR and the rest as SC1, SC2, SC3... in order of importance. Animals, objects, supernatural beings use SC1~SC5 slots, NEVER MCR_B or similar.
- MCR is the MAIN CHARACTER — NOT necessarily a human person. Depending on the script, MCR can be an animal, plant, object, landscape, or any central subject. If the script has NO recurring subjects at all (pure landscape/nature montage, user directed "no characters"), output 0 characters and use "" for all scenes.
- RECURRING non-human subjects MUST get character codes (MCR/SC1~SC5): A dog that appears in multiple scenes → assign MCR or SC code with full characterRef. A flower garden shown repeatedly → assign code. A car/robot/mascot with recurring role → assign code. This ensures visual consistency via reference sheets.
- Use "" ONLY for: one-off establishing shots (scenery, street, room atmosphere), one-off prop close-ups (letter, glass, door — objects that appear only once or don't need consistency), body-part close-ups (hands, feet, eyes of an existing coded character).
- character description (MANDATORY fields for HUMAN characters): ALWAYS include {body build} (slim/average/heavyset/muscular), {hair length + color + style} (e.g. "long wavy black hair", "short cropped brown hair with bangs"), {color} and {pattern} of outfit (e.g. "blue embroidered Hanbok", "vibrant purple striped jacket"), {accessories} (glasses with frame shape, earrings, hat, bag, scarf, etc. — specify "no glasses" or include frame details like "thin round metal-frame glasses").
- character description (NON-HUMAN characters): For animals: species, breed/type, fur color/pattern, size, distinguishing features (e.g. "golden retriever, large, golden fur, floppy ears, red bandana collar"). For plants: type, color, size, condition (e.g. "cherry blossom tree, full bloom, pink petals, 3m tall"). For objects: type, color, size, material, condition.

=== CRITICAL RULES ===
- You MUST output ALL ${numScenes} scenes from [1] to [${numScenes}]. Do NOT stop early.
- ★ MCR SCREEN-TIME BALANCE (STRICT — anti-talking-head):
  * MCR must appear in AT MOST 50% of scenes. Target: 40~50%.
  * When MCR is narrating/explaining/commenting in the script, you MUST alternate
    between (A) showing MCR and (B) showing B-roll: what MCR is talking ABOUT.
  * B-roll options for narration scenes (use "" or other codes, NOT MCR):
    - Establishing shots of the location MCR mentions (street, market, shop interior)
    - Big close-ups of objects/props MCR refers to (cookie, price tag, phone screen, money)
    - Other characters (SC1~SC5) reacting, acting out what MCR describes
    - Visual metaphors/concepts (crowd, line of people, stock chart, book stack)
    - Body-part close-ups (hands counting money, feet walking, eyes widening)
  * Pattern rule: NEVER put MCR in 3+ consecutive scenes. After 2 MCR scenes in a row,
    the next scene MUST be B-roll ("" or SC-only) — no exceptions.
  * Narration ≠ Visual. Just because MCR SAYS something does not mean MCR must be
    visible. Prefer showing WHAT is being talked about over showing WHO is talking.
  * This rule OVERRIDES the instinct to show the speaker. Visual storytelling
    beats talking-head repetition.
- EVEN DISTRIBUTION (MANDATORY): Divide the script into ${numScenes} roughly equal segments. Scene 1 = opening (first segment), Scene ${numScenes} = ending (LAST segment). Each scene's scriptStart MUST come from its corresponding segment. The script's ENDING (final 20%+) MUST appear in scenes [${Math.max(1, numScenes - Math.floor(numScenes / 5))}] to [${numScenes}]. Do NOT cluster all scenes in the first half — the last quarter of the script MUST be covered.
- Output scenes on ONE LINE, no line breaks inside the array.
${userDirections ? `\n=== ★ USER DIRECTIONS (HIGHEST PRIORITY — override all other rules if conflicting) ===\nThe user's special directions below MUST be reflected in EVERY generated prompt as the top priority. If written in non-English, translate the intent to English before applying.\n${userDirections}` : ''}

=== SCRIPT ===
${safeScript}${scriptEndHint}

=== OUTPUT ${numScenes} SCENES NOW ===
REMINDER: Scene [1] = script opening. Scene [${numScenes}] = script ending. Cover the ENTIRE script from start to finish.`;

    const phase1Tokens = 65536;
    const data = await _geminiApiCall(apiKey, prompt, phase1Tokens);
    const rawText = data.candidates[0].content.parts[0].text;

    const result = _sanitizeCharacterCodes(_parseSceneDivision(rawText));

    const isStickMan = styleId === '27';
    const isStickWoman = styleId === '28';
    const isStickFigure = isStickMan || isStickWoman;

    const characterRefs = (result.characters || []).map(c => {
        const desc = c.description || '';
        const charPrompt = isStickFigure
            ? `2D stick figure ${isStickWoman ? 'woman' : 'man'} (simple white round head, thin black line body${isStickWoman ? ', pastel accessories like ribbon/bow' : ''}) in humorous 2D illustration style. Full body shot, front facing, studio background. [no name labels]. ${c.code} wearing ${c.code === 'MCR' ? 'blue' : c.code === 'SC1' ? 'purple' : c.code === 'SC2' ? 'green' : c.code === 'SC3' ? 'orange' : c.code === 'SC4' ? 'red' : c.code === 'SC5' ? 'teal' : 'blue'} ${isStickWoman ? 'pastel ' : ''}outfit. Standing in neutral pose. Character reference portrait.`
            : `Studio background. [no name labels]. ${c.code}(${desc}). Full body shot, front facing. Standing in neutral pose, arms relaxed. Calm expression. Character reference portrait.`;

        return {
            code: c.code || 'MCR',
            name: c.name || '',
            description: desc,
            prompt: convertCharacterCodes(charPrompt),
            status: 'pending'
        };
    });

    return { scenes: result.scenes, characterRefs };
}

function _parseSceneDivision(text) {
    let cleanText = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();

    // 1차: 정상 JSON 파싱
    try {
        const startIdx = cleanText.indexOf('{');
        const endIdx = cleanText.lastIndexOf('}');
        if (startIdx !== -1 && endIdx > startIdx) {
            const json = JSON.parse(cleanText.substring(startIdx, endIdx + 1));
            return _extractSceneDivision(json);
        }
    } catch (e) {
    }

    // 2차: scenes 배열 구조 인식 복구
    try {
        const startIdx = cleanText.indexOf('{');
        if (startIdx !== -1) {
            let truncated = cleanText.substring(startIdx);
            const scenesMatch = truncated.match(/"scenes"\s*:\s*\[/);
            if (scenesMatch) {
                const scenesStart = truncated.indexOf(scenesMatch[0]) + scenesMatch[0].length;
                const afterScenes = truncated.substring(scenesStart);

                let lastCompleteIdx = -1;
                let depth = 0;
                for (let i = 0; i < afterScenes.length; i++) {
                    if (afterScenes[i] === '[') depth++;
                    else if (afterScenes[i] === ']') {
                        depth--;
                        if (depth === 0) lastCompleteIdx = i;
                        if (depth < 0) break;
                    }
                }

                if (lastCompleteIdx > 0) {
                    const fixedScenes = afterScenes.substring(0, lastCompleteIdx + 1);
                    const beforeScenes = truncated.substring(0, scenesStart);
                    const fixed = beforeScenes + fixedScenes + ']}';
                    const json = JSON.parse(fixed);
                    return _extractSceneDivision(json);
                }
            }

            const lastBrace = truncated.lastIndexOf('}');
            if (lastBrace > 0) {
                truncated = truncated.substring(0, lastBrace + 1).replace(/,\s*$/, '');
                const openSquare = (truncated.match(/\[/g) || []).length - (truncated.match(/\]/g) || []).length;
                const openCurly = (truncated.match(/\{/g) || []).length - (truncated.match(/\}/g) || []).length;
                truncated += ']'.repeat(Math.max(0, openSquare)) + '}'.repeat(Math.max(0, openCurly));
                truncated = truncated.replace(/,\s*([}\]])/g, '$1');
                const json = JSON.parse(truncated);
                return _extractSceneDivision(json);
            }
        }
    } catch (e) {
    }

    // 3차: regex 개별 추출
    try {
        const characters = [];
        const charRegex = /\{"code"\s*:\s*"(\w+)"\s*,\s*"name"\s*:\s*"([^"]*)"\s*,\s*"description"\s*:\s*"([^"]*)"\}/g;
        let cm;
        while ((cm = charRegex.exec(cleanText)) !== null) {
            characters.push({ code: cm[1], name: cm[2], description: cm[3] });
        }

        const scenes = [];
        const sceneRegex = /\[\s*(\d+)\s*,\s*"([^"]+)"\s*,\s*"([^"]+)"\s*\]/g;
        let sm;
        while ((sm = sceneRegex.exec(cleanText)) !== null) {
            scenes.push({
                number: String(sm[1]).padStart(2, '0'),
                characters: sm[2],
                scriptText: sm[3].replace(/\s+/g, '').substring(0, 16)
            });
        }

        if (scenes.length > 0) {
            return { characters, scenes };
        }
    } catch (e) {
    }

    return { characters: [], scenes: [] };
}

function _extractSceneDivision(json) {
    let scenes = [];
    if (Array.isArray(json.scenes)) {
        scenes = json.scenes.map(s => {
            if (Array.isArray(s)) {
                return {
                    number: String(s[0] || '01').padStart(2, '0'),
                    characters: s[1] === '' ? '' : String(s[1] || 'MCR'),
                    scriptText: (String(s[2] || '')).replace(/\s+/g, '').substring(0, 16)
                };
            }
            return {
                number: String(s.number || '01').padStart(2, '0'),
                characters: s.characters === '' ? '' : (s.characters || 'MCR'),
                scriptText: (s.scriptText || '').replace(/\s+/g, '').substring(0, 16)
            };
        });
    }
    return { characters: json.characters || [], scenes };
}

// ═══════════════════════════════════════════
// refSheetPrompt 후처리 (의상 동기화 + 가드)
// ═══════════════════════════════════════════
const ALLOWED_CHAR_CODES = ['MCR', 'SC1', 'SC2', 'SC3', 'SC4', 'SC5'];
const ALLOWED_CHAR_CODES_SET = new Set(ALLOWED_CHAR_CODES);

/**
 * Gemini 가 환각으로 만든 변종 코드(MCR_B, MCR_A, SC1_B, SC6 등)를
 * 허용 코드(MCR, SC1~SC5)로 정규화.
 *
 * 원칙:
 *   - 유효 코드는 그대로 유지 (중복 시 뒤 등장분만 재할당)
 *   - 변종 코드는 비어있는 SC 슬롯으로 순차 재할당 (SC1 → SC2 → ...)
 *   - 빈 슬롯 소진 시 해당 ref 드롭 (최대 6명 제약)
 *   - characterRefs[].code, scenePrompts[].characters 양쪽에 remap 적용
 *
 * @param {Object} result  Gemini 파싱 결과 (characterRefs, scenePrompts 또는 characters, scenes)
 * @returns {Object} 동일 구조, 코드 정규화됨
 */
function _sanitizeCharacterCodes(result) {
    if (!result) return result;

    // 두 가지 스키마 지원: {characterRefs, scenePrompts} 및 {characters, scenes}
    const refsKey = Array.isArray(result.characterRefs) ? 'characterRefs'
                  : Array.isArray(result.characters) ? 'characters' : null;
    const scenesKey = Array.isArray(result.scenePrompts) ? 'scenePrompts'
                    : Array.isArray(result.scenes) ? 'scenes' : null;
    if (!refsKey) return result;

    const refs = result[refsKey];
    const remap = {};           // oldCode -> newCode
    const taken = new Set();    // 이미 할당된 유효 코드
    const sanitizedRefs = [];

    for (const ref of refs) {
        const originalCode = (ref && ref.code ? String(ref.code).trim() : '').toUpperCase();

        if (ALLOWED_CHAR_CODES_SET.has(originalCode) && !taken.has(originalCode)) {
            // 유효 + 미사용 → 그대로
            taken.add(originalCode);
            sanitizedRefs.push(ref);
            continue;
        }

        // 변종 또는 중복 → 다음 빈 SC 슬롯으로 재할당
        // MCR 은 특별 (주인공 1명만) — MCR 이 이미 점유됐으면 SC 로 강등
        let newCode = null;
        // MCR 이 비어있으면 우선 배정 (단, 원본이 MCR 변종일 때만 — 예: MCR_B)
        if (!taken.has('MCR') && /^MCR/i.test(originalCode)) {
            newCode = 'MCR';
        } else {
            // SC1~SC5 중 빈 슬롯
            for (const c of ['SC1', 'SC2', 'SC3', 'SC4', 'SC5']) {
                if (!taken.has(c)) { newCode = c; break; }
            }
        }

        if (!newCode) {
            // 슬롯 꽉참 → ref 드롭, remap 에도 넣지 않음 (씬에서 사라지게)
            console.log(`[sanitizeCharacterCodes] dropped ref (slots full): ${originalCode}`);
            continue;
        }

        taken.add(newCode);
        remap[originalCode] = newCode;
        console.log(`[sanitizeCharacterCodes] remapped ${originalCode} → ${newCode}`);
        sanitizedRefs.push({ ...ref, code: newCode });
    }

    result[refsKey] = sanitizedRefs;

    // 씬 프롬프트의 characters 필드에도 remap 적용
    if (scenesKey && Object.keys(remap).length > 0) {
        result[scenesKey] = result[scenesKey].map(scene => {
            if (!scene || !scene.characters) return scene;
            const codes = String(scene.characters).split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
            const remapped = codes.map(c => {
                if (ALLOWED_CHAR_CODES_SET.has(c)) return c;
                return remap[c] || null;  // 드롭된 ref 의 코드는 제거
            }).filter(Boolean);
            // 중복 제거 + 정렬 (MCR 먼저, 그다음 SC1~SC5)
            const uniq = Array.from(new Set(remapped))
                .sort((a, b) => ALLOWED_CHAR_CODES.indexOf(a) - ALLOWED_CHAR_CODES.indexOf(b));
            return { ...scene, characters: uniq.join(',') };
        });
    }

    return result;
}

function _defaultOutfitByCode(code) {
    const c = (code || 'MCR').toString().toUpperCase().trim();
    if (c === 'SC1') return 'charcoal checked hoodie over a light-gray inner t-shirt and dark cargo pants';
    if (c === 'SC2') return 'muted olive floral cardigan over a cream inner blouse and dark patterned skirt';
    if (c === 'SC3') return 'brown striped jacket over a white inner shirt and dark straight trousers';
    if (c === 'SC4') return 'deep-red plaid jacket over a black inner t-shirt and black denim pants';
    return 'dark navy striped outer blouse layered with a white inner blouse, black straight-leg jeans, and small silver earrings';
}

function _extractAppearanceHintsFromScenePrompts(scenePrompts) {
    const hints = {};
    const arr = Array.isArray(scenePrompts) ? scenePrompts : [];
    for (const p of arr) {
        const cp = (p?.charProps || '').toString();
        if (!cp) continue;
        for (const code of ALLOWED_CHAR_CODES) {
            if (hints[code]?.outfit) continue;
            const rx = new RegExp(`${code}\\s*\\(([^)]*)\\)`, 'i');
            const m = cp.match(rx);
            if (!m) continue;
            const inner = (m[1] || '').trim();
            const wearingMatch = inner.match(/\bwearing\s+(.+)$/i);
            if (!wearingMatch) continue;
            const outfit = (wearingMatch[1] || '').trim().replace(/\s+/g, ' ').replace(/[.,;]\s*$/g, '');
            if (!outfit) continue;
            hints[code] = { outfit };
        }
    }
    return hints;
}

function _ensureOutfitTokensInRefSheetPrompt(refSheetPrompt, appearanceHints = {}) {
    const hasOuterwear = (text) => /\b(jacket|coat|cardigan|hoodie|blazer|outer|parka|windbreaker)\b/i.test(text);
    const hasInnerTop = (text) => /\b(inner|undershirt|inner shirt|inner blouse|shirt|blouse|t-shirt|tee|tank top|cami|camisole|knit top)\b/i.test(text);
    const hasBottomOrOnePiece = (text) => /\b(pants|trousers|jeans|slacks|shorts|miniskirt|mini skirt|skirt|long skirt|midi skirt|maxi skirt|dress|one-piece|one piece|jumpsuit|coverall|overalls|workwear|uniform)\b/i.test(text);
    const hasSuitLike = (text) => /\b(suit|business suit|two-piece suit|three-piece suit|formal suit|tailored suit)\b/i.test(text);
    const hasTie = (text) => /\b(tie|necktie)\b/i.test(text);
    let text = (refSheetPrompt || '').toString().trim();
    if (!text) return text;

    // 패턴 A: MCR(...) 괄호 형식이 있는 경우
    const codes = ['MCR', 'SC1', 'SC2', 'SC3', 'SC4', 'SC5'];
    let matchedParenFormat = false;
    for (const code of codes) {
        const rx = new RegExp(`${code}\\s*\\(([^)]*)\\)`, 'i');
        const m = text.match(rx);
        if (!m) continue;
        matchedParenFormat = true;
        let inner = (m[1] || '').trim();
        const hintedOutfit = appearanceHints?.[code]?.outfit ? String(appearanceHints[code].outfit).trim() : '';
        // ★ PRO 2.0: 의상 토큰이 이미 있으면 건드리지 않음 (본문 프롬프트와 자동 일치)
        const hasOutfitTokens = /\b(apron|shirt|blouse|t-shirt|tee|trousers|pants|jeans|skirt|dress|suit|jacket|coat|cardigan|hoodie|blazer|uniform|hanbok|robe|gown|kimono|one-piece|one piece|jumpsuit|overalls|bandana|scarf)\b/i.test(inner);
        if (!/\bwearing\b/i.test(inner) && !hasOutfitTokens) {
            // 의상이 전혀 없을 때만 씬 힌트로 주입 (default fallback 제거 — 임의 의상 주입 금지)
            if (hintedOutfit) {
                inner = `${inner}${inner ? ', ' : ''}wearing ${hintedOutfit}`;
            }
            // hintedOutfit도 없으면 아무것도 하지 않음 → Gemini 원문 그대로
        }
        // wearing이 이미 있거나 의상 토큰이 있으면: 본문과 일치하도록 원문 보존 (덮어쓰기/보충 금지)
        const withOutfit = `${code}(${inner})`;
        text = text.replace(rx, withOutfit);
    }

    // 패턴 B: FLOW 스타일 — "consistent lighting. Korean female, 25yo..." 형태 (괄호 없음)
    // refSheetPrompt 끝에 평문 캐릭터 설명이 있는 경우 의상 동기화
    if (!matchedParenFormat) {
        // refSheetPrompt에서 [MCR]/[SC1] 등의 캐릭터 코드를 찾아 어떤 캐릭터인지 확인
        const codeMatch = text.match(/\[(MCR|SC[1-5])\]/i);
        const charCode = codeMatch ? codeMatch[1].toUpperCase() : 'MCR';
        const hintedOutfit = appearanceHints?.[charCode]?.outfit ? String(appearanceHints[charCode].outfit).trim() : '';

        // "consistent lighting." 이후의 트레일링 캐릭터 설명 찾기
        const trailingMatch = text.match(/(consistent lighting\.?\s*)(.+)$/i);
        if (trailingMatch) {
            let trailing = trailingMatch[2].trim();
            // ★ PRO 2.0: 의상 토큰이 이미 있으면 건드리지 않음 — 본문과 일치 보장, 임의 주입 금지
            const hasOutfitTokens = /\b(apron|shirt|blouse|t-shirt|tee|trousers|pants|jeans|skirt|dress|suit|jacket|coat|cardigan|hoodie|blazer|uniform|hanbok|robe|gown|kimono|one-piece|one piece|jumpsuit|overalls|bandana|scarf)\b/i.test(trailing);
            if (!/\bwearing\b/i.test(trailing) && !hasOutfitTokens) {
                // 의상이 전혀 없을 때만 씬 힌트로 주입 (default fallback 제거)
                if (hintedOutfit) {
                    trailing = `${trailing.replace(/\.?\s*$/, '')}, wearing ${hintedOutfit}.`;
                    text = text.replace(/(consistent lighting\.?\s*).+$/i, `$1${trailing}`);
                }
                // hintedOutfit도 없으면 Gemini 원문 그대로 (default outfit 주입 금지)
            }
            // wearing이 있거나 의상 토큰이 있으면: 원문 그대로 (덮어쓰기/보충 금지)
        }
    }

    return text;
}

function _ensureRefSheetClothingGuard(refSheetPrompt) {
    const text = (refSheetPrompt || '').toString().trim();
    if (!text) return text;

    // ★ 비인간(동물/식물/사물/크리처) 감지
    const nonHumanPattern = /\b(dog|cat|puppy|kitten|retriever|shepherd|poodle|husky|bird|dragon|creature|beast|monster|dinosaur|wolf|fox|bear|rabbit|tiger|lion|horse|deer|fish|snake|turtle|insect|bee|butterfly|flower|blossom|petal|plant|tree|leaf|branch|mushroom|cactus|rose|lily|sunflower|vegetable|fruit|robot|machine|vehicle|statue|gem|crystal|sword|spirit|ghost|fairy|orb|cloud|star)\b/i;

    // ★ PRO 2.0: 의도적 의인화 신호 감지 — 대본/프롬프트에 명시된 인간 요소
    const anthropomorphismSignals = /\b(anthropomorphic|humanoid|human-like|bipedal|standing upright|wearing|dressed|costume|uniform|suit|tuxedo|blazer|jacket|shirt|dress|robe|hanbok|hat|cap|helmet|crown|tie|scarf|gloves|boots|shoes|glasses|holding|speaking|smiling)\b/i;
    const koreanAnthroSignals = /(옷|입고|쓰고|입은|신은|걸친|두른|모자|제복|유니폼|법복|가운|한복|양복|안경|들고|말하는)/;

    const isNonHuman = nonHumanPattern.test(text);
    const isAnthropomorphic = anthropomorphismSignals.test(text) || koreanAnthroSignals.test(text);

    // 이미 가드가 있으면 재처리 없이 반환
    if (/FULLY CLOTHED \(STRICT\)|FULL OUTFIT REQUIRED \(STRICT\)|NON-HUMAN SUBJECT \(STRICT\)|CONSISTENT ANTHROPOMORPHIC/i.test(text)) {
        return text;
    }

    if (isNonHuman && !isAnthropomorphic) {
        // Case A: 순수 자연형 비인간 (대본/프롬프트에 의인화 단서 없음)
        const nonHumanGuard = 'NON-HUMAN SUBJECT (STRICT): show natural species anatomy only. DO NOT add human arms, legs, hands, clothing, outfit, shirt, pants, or humanoid body structure. Use species-appropriate poses and views.';
        if (/Same character in all panels|Same animal in all panels/i.test(text)) {
            return text.replace(/Same (?:character|animal) in all panels/i, `${nonHumanGuard} Same subject in all panels`);
        }
        return `${text} ${nonHumanGuard}`;
    }

    if (isNonHuman && isAnthropomorphic) {
        // Case B: 의도적 의인화 (script/prompt에 옷/도구/직업 명시됨)
        //   → 사용자 설명 그대로 신뢰, 패널 간 일관성만 강제
        const anthroGuard = 'CONSISTENT ANTHROPOMORPHIC CHARACTER: maintain the EXACT same outfit, accessories, body proportions, and species features described in the prompt across ALL panels. Do NOT add OR remove human elements that are not explicitly described. Do NOT vary clothing or features between panels.';
        if (/Same character in all panels|Same animal in all panels/i.test(text)) {
            return text.replace(/Same (?:character|animal) in all panels/i, `${anthroGuard} Same character in all panels`);
        }
        return `${text} ${anthroGuard}`;
    }

    // Case C: 일반 인간 — 기존 옷 가드
    const guard = 'FULL OUTFIT REQUIRED (STRICT): outfit must include a clearly visible top and bottom with complete coverage in all panels. If the top has buttons, keep it fully buttoned.';
    if (/Same character in all panels/i.test(text)) {
        return text.replace(/Same character in all panels/i, `${guard} Same character in all panels`);
    }
    return `${text} ${guard}`;
}

function _stripVerboseRefSheetLayout(refSheetPrompt) {
    let text = (refSheetPrompt || '').toString().trim();
    if (!text) return text;
    text = text.replace(/Character reference sheet\.\s*Match image style, rendering, texture, color and aesthetic across all panels\.[\s\S]*?Maintain consistent anatomy, proportion, size and alignment\.\s*/gi, '');
    text = text.replace(/16:9 canvas split vertically\.[\s\S]*?Maintain consistent anatomy, proportion, size and alignment\.\s*/gi, '');
    return text.replace(/\s+/g, ' ').trim();
}

function _ensureRefSheetLayoutBlock(refSheetPrompt) {
    const text = _stripVerboseRefSheetLayout(refSheetPrompt);
    if (!text) return text;
    // ★ PRO 2.0: Gemini가 이미 레이아웃 문구를 다양한 표현으로 출력하므로
    // 엄격한 문자열 매칭 대신 "레이아웃 구조가 이미 묘사되어 있는지"를 느슨하게 감지
    const hasSheetKeyword = /character\s+reference\s+sheet/i.test(text);
    const hasCanvasInfo = /16:9/i.test(text) && /(mid-gray|neutral background|solid background)/i.test(text);
    const hasLeftFaces = /LEFT:\s*[^.]*(2x2|4 cells|face close-ups)/i.test(text);
    const hasRightBody = /RIGHT:\s*[^.]*(full body|2 cells)/i.test(text);
    const hasLayout = hasSheetKeyword && hasCanvasInfo && hasLeftFaces && hasRightBody;
    if (hasLayout) return text;
    const block = 'Character reference sheet. 16:9 canvas, mid-gray solid background. Split LEFT/RIGHT vertically. LEFT: 2x2 grid face close-ups (front, 3/4 left, 3/4 right, profile). RIGHT: vertical split, 2 cells (full body front, full body back, neutral standing pose). Side-by-side only, no top/bottom stacking. Consistent style, anatomy, proportion across all panels.';
    return `${text} ${block}`;
}

function _finalizeRefSheetPrompt(refSheetPrompt, appearanceHints = {}) {
    return _ensureRefSheetLayoutBlock(_ensureRefSheetClothingGuard(_ensureOutfitTokensInRefSheetPrompt(refSheetPrompt, appearanceHints)));
}

// ═══════════════════════════════════════════
// 기승전결 배치: 세그먼트(구간) 기반 프롬프트 생성
// Batch 1: characterRefs + scenePrompts 출력
// Batch 2-4: 이전 배치 5개 프롬프트 + 요약 참조 (continuationBlock)
// ═══════════════════════════════════════════
async function _callSegmentPromptGeneration(script, segments, characterRefs, apiKey, stylePrompt, nationality, styleId, userDirections, isFirstBatch, previousBatchPrompts = null, previousBatchSummary = null, userProvidedCharRefs = null, customStyle = '') {
    const segmentList = Array.isArray(segments) ? segments : [segments];
    const totalNumPrompts = segmentList.reduce((a, s) => a + s.numPrompts, 0);

    const isStickMan = styleId === '27';
    const isStickWoman = styleId === '28';
    const isStickFigure = isStickMan || isStickWoman;
    const charPropsTemplate = isStickFigure
        ? `{CharCode} is a 2D stick figure ${isStickWoman ? 'woman' : 'man'} (simple white round head, thin black line body${isStickWoman ? ', pastel accessories like ribbon/bow' : ''}) in humorous 2D illustration style, wearing {color} ${isStickWoman ? 'pastel ' : ''}outfit.`
        : `{CharCode}(${nationality} {gender}, {age}yo, {build}, {hair length/color/style}, wearing {color} {pattern} {outfit}, {accessories/glasses}).`;

    // ★ v1.5: 2-레이어 스타일 해석
    const styleLayers = getStyleLayers(styleId, customStyle);
    const sceneStyle = styleLayers.rendering;  // sceneDesc 전용
    const humanIdentityBlockSeg = styleLayers.humanIdentity
        ? `\n\n=== HUMAN IDENTITY LAYER (apply ONLY to Human-type characters) ===
${styleLayers.humanIdentity}`
        : '';

    const hasNonHumanCharSeg = Array.isArray(characterRefs) && characterRefs.some(r => {
        if (!r) return false;
        const text = r.description || r.prompt || r.refSheetPrompt || '';
        return _detectNonHumanMCR(text);
    });

    // ★ v1.5+: 자율 인식 지침 — Gemini가 데이터 분리 누락/오염도 의미론적으로 보정
    const nonHumanNoteSeg = `\n\n⚡ AUTONOMOUS STYLE-LAYER ENFORCEMENT (CRITICAL — read carefully):

A. 2-LAYER SEMANTIC CLASSIFICATION (your judgment):
The STYLE section above may have been pre-split, but you MUST semantically re-classify each
token. Any token describing the following belongs to HUMAN-IDENTITY layer (even if it
appears in the STYLE/rendering section):
  • Clothing/garments: Hanbok, Hanfu, Qipao/Cheongsam, Kimono, Sari, Sherwani, Thobe, Bisht,
    Chima-jeogori, Durumagi, Haori, Hakama, bonnet, cowboy vest, sheriff badge, etc.
  • Head/hair: Gat, Sangtu/topknot, Binyeo, Jjokmeori, Daenggi, turban, hijab, headband,
    hairpin, ornate crown, feathered headdress, cowboy hat, etc.
  • Facial/body: Bindi dot, monolid eyes, beard, jewelry/bangles, "for male/female/nobility"
  • Any phrase implying a person wearing/having something

All OTHER tokens belong to ENVIRONMENT/RENDERING layer:
  • Era/dynasty (Joseon, Edo, Qing, Mughal, frontier, cyberpunk)
  • Architecture/setting (Hanok, temple, palace, desert, street)
  • Lighting, color palette, rendering technique, aesthetic descriptors

B. LAYER APPLICATION RULES:
  • sceneDesc: Use ONLY environment/rendering tokens. NEVER include human-identity tokens
    even if inferable from period (e.g., Joseon → don't add Hanbok to sceneDesc yourself).
  • charProps (Human): Apply relevant humanIdentity tokens per character context.
  • charProps (Non-human — Flower/Animal/Nature/Object/Abstract): Natural form only.
    NEVER human clothing/hair/body. Never "Flower in Hanbok" or similar contradictions.

C. EXAMPLES:
  ❌ "sceneDesc: Joseon Dynasty. Hanbok. Temple." → Hanbok doesn't belong in sceneDesc
  ❌ "charProps: MCR(Flower wearing Hanbok)" → flowers don't wear clothes
  ✅ "sceneDesc: Joseon Dynasty. Authentic period details. Dawn. Temple eaves."
     "charProps: MCR(Flower: mystical bloom, white petals, crimson tips)"
  ✅ "sceneDesc: Joseon Dynasty. Temple courtyard."
     "charProps: SC1(Korean female, Jjokmeori bun, pale blue Hanbok)" — SC1 is Human

D. MCR TYPE DETECTION:
Step 1 — Check characterRefs description prefix: MCR(Human:...), MCR(Flower:...),
         MCR(Animal:...), MCR(Nature:...), MCR(Object:...), MCR(Abstract:...)
Step 2 — If prefix missing, infer from description content. Default to Human if ambiguous.
${hasNonHumanCharSeg ? `
NOTE: Phase 0 confirmed non-human MCR. Be especially careful with layer separation.` : ''}`;

    // ★ PRO 2.0: 사용자 제공 캐릭터는 FULL prompt 사용 (description은 너무 짧아 Gemini가 paraphrase함)
    const userCodesSet = new Set((userProvidedCharRefs || []).map(r => r.code));
    const charRefContext = characterRefs.length > 0 ? characterRefs.map(r => {
        if (userCodesSet.has(r.code)) {
            const fullText = r.prompt || r.refSheetPrompt || r.description || r.name;
            return `${r.code} [LOCKED IDENTITY — copy VERBATIM into charProps]: ${fullText}`;
        }
        return `${r.code}: ${r.description || r.name}`;
    }).join('\n    ') : '(Identify from script segment)';
    const safeScript = script.replace(/\\/g, '\\\\').replace(/"/g, "'").replace(/\t/g, ' ');
    const escapeForPrompt = t => (t || '').replace(/\\/g, '\\\\').replace(/"/g, "'").replace(/\t/g, ' ');

    const blockParts = [];
    const distNotes = [];
    for (const segment of segmentList) {
        const dist = _distributeSegmentSecondLevel(segment.text, segment.numPrompts);
        if (dist.type === 'markers' && dist.parts.length > 0) {
            blockParts.push(`=== ${segment.label} (${segment.labelEn}) — ${segment.numPrompts} prompts ===\n` +
                dist.parts.map((p, i) => `--- Section ${i + 1} (${p.numPrompts}) ---\n${escapeForPrompt(p.text)}`).join('\n\n'));
            distNotes.push(`${segment.label}: ${dist.parts.map((p, i) => `S${i + 1}=${p.numPrompts}`).join(', ')}`);
        } else {
            blockParts.push(`=== ${segment.label} (${segment.labelEn}) — ${segment.numPrompts} prompts ===\n` +
                dist.parts.map((p, i) => `--- Part ${i + 1} of ${dist.parts.length} ---\n${escapeForPrompt(p.text)}`).join('\n\n'));
            distNotes.push(`${segment.label}: ${dist.parts.length} parts`);
        }
    }
    const segmentBlock = blockParts.join('\n\n');
    const distributionNote = `DISTRIBUTION: Generate exactly ${totalNumPrompts} prompts total. ${distNotes.join(' | ')}. Respect the section/part boundaries. Prefer prompt boundaries at line or sentence START (줄·문장의 시작)—NEVER cut mid-word or mid-sentence. Each scene's scriptText MUST begin at a line start or sentence start. CRITICAL: You MUST output exactly ${totalNumPrompts} scenePrompts—no fewer, no more.`;
    const segmentLabels = segmentList.map(s => `${s.label} (${s.labelEn})`).join(', ');

    const lastPromptCharProps = (previousBatchPrompts && previousBatchPrompts.length > 0) ? (previousBatchPrompts[previousBatchPrompts.length - 1].charProps || '') : '';
    const summaryLine = previousBatchSummary ? `Previous batch generated scenes [${previousBatchSummary.first}]-[${previousBatchSummary.last}] (${previousBatchSummary.count} prompts) — script coverage: up to scene ${previousBatchSummary.last}.` : '';
    const singlePassNote = `Generate as if ALL scenes were written in ONE continuous pass. No tonal shift between batches. Treat this as a single storyboard.`;
    const continuationBlock = (previousBatchPrompts && previousBatchPrompts.length > 0) ? `
=== CONTINUATION CONTEXT (maintain tone and consistency — scenes from previous batch) ===
${summaryLine}
${singlePassNote}
Scene [01] of this segment must flow naturally from the last scene below. Use these character descriptions in charProps only (NEVER in the characters field). characters = simple codes like "MCR", "SC1" only.

Last ${previousBatchPrompts.length} prompts from previous batch:
${previousBatchPrompts.map(p => `[${p.number}] ${p.characters || 'MCR'} | scriptText: ${p.scriptText || ''}
sceneDesc: ${p.sceneDesc || ''}
charProps: ${p.charProps || ''}
action: ${p.action || ''}`).join('\n---\n')}

` : '';

    const stickRules = isStickFigure ? `
STICK FIGURE RULES:
- charProps MUST include: "2D stick figure ${isStickWoman ? 'woman' : 'man'}" 
- charProps MUST include: "(simple white round head, thin black line body)"
- charProps MUST include: "in humorous 2D illustration style"
- sceneDesc must NOT mention "stick figure" (charProps only)
- PATTERN and COLOR are MANDATORY: MCR=blue, SC1=purple, SC2=green; pattern (e.g. solid, pastel).` : '';

    const scriptContextRules = !isStickFigure ? `
SCRIPT CONTEXT & HISTORICAL ACCURACY:
- charProps: Base character appearance on SCRIPT CONTEXT. Historical settings: Use PERIOD-ACCURATE accessories and costumes.` : '';

    const isJoseon = styleId === '2' || styleId === '6';
    const joseonRules = isJoseon ? `
JOSEON-SPECIFIC: sceneDesc: Do NOT put outfit/costume in sceneDesc. Only [Context], shot, angle, [no text...], style, time, place, light.` : '';

    const sceneDescFormat = `[${nationality} Context] {Shot}, {Angle}. [no name labels]. {environment/rendering tokens from STYLE — exclude ANY human-identity tokens like clothing/hair/accessories}. {time}. {place}. {light}.`;
    const actionFormat = `{action}. {expression}. {mood}.`;

    // ★ 환경 필드 강제 — Gemini가 뒤쪽 씬으로 갈수록 {place}/{light}를 빼먹는 경향 방지
    //   장소 LOCK 금지: 대본 전환에 따라 장소는 자유롭게 바뀔 수 있음
    //   하지만 NULL/빈 문자열 금지: 매 씬마다 구체적 환경 3요소(time/place/light) 필수
    //   낮은 등급 모델일수록 이 규칙이 더 엄격해야 효과 있음
    const environmentRule = `
═══ ENVIRONMENT FIELDS (CRITICAL — EVERY SCENE) ═══
sceneDesc의 {time}, {place}, {light} 3개 필드는 매 씬마다 구체적으로 채워라.
절대 생략 금지 — 아무 씬도 "Day." 만 남기지 말 것.

{time}: 단순 "Day" 금지. 분위기 단서 포함.
  ✅ "Bright sunny midday", "Warm late afternoon", "Soft overcast morning"
  ❌ "Day", "Night"

{place}: 구체적 장소 + 2~3개 환경 요소 (시각 앵커) 포함.
  ✅ "Bustling Hongdae pedestrian street with neon signs and passing crowds"
  ✅ "Cramped trendy bakery interior lined with display cases and queue outside"
  ✅ "Cozy minimalist cafe with wooden tables and hanging plants"
  ❌ "Street", "Cafe", "Shop" (단어 하나만)
  ❌ 완전 공백

{light}: 광량 + 방향 + 색조.
  ✅ "Bright natural sunlight from left, crisp shadows, warm amber tones"
  ✅ "Soft indoor LED lighting, even illumination, cool white tones"
  ❌ "Light" 단독, 누락

★ 대본에 명시적 장소 전환이 있으면 따라가라 (장소 고정 금지).
★ 대본이 모호하면 직전 씬 장소를 참고하여 자연스럽게 이어가되, 완전 복붙 금지.
★ 설명/모놀로그/추상 씬 (예: 경제 이론 설명 장면)도 반드시 구체 장소 부여.
  유저가 무지 배경을 원한 경우가 아니면 "talking head against blank" 금지.
  해당 캐릭터의 현실적 환경(예: 자기 방, 책상 앞, 거리 벤치) 중 하나 선택.

★ 낮은 품질 출력 패턴 자동 거부:
  "Day." (place 누락), "Day. Street." (place 빈약), "Day. Cafe." (정도 부족)
  → 즉시 재작성. 모든 씬 풀 디테일.
`;

    // charRefPrefix: 인물 캐릭터 레퍼런스 시트용 — fullPrompt 사용 (rendering + humanIdentity 모두)
    //   비인물 캐릭터의 개별 레퍼런스는 _buildCharacterRefsFromDivisionResult에서 rendering만 사용
    const charRefPrefix = `[${nationality} Context]. [no name labels]. ${styleLayers.fullPrompt}. `;
    const charRefStyleEnv = `Match image style, rendering, texture, color and aesthetic across all panels. Clean mid-gray neutral solid background. 16:9 aspect ratio. `;
    // refSheetPrompt: 16:9 split. LEFT = face 2x2, RIGHT = full body vertical 2. Consistency: same person, uniform lighting.
    const charRefSheetTemplate = isStickFigure
        ? charRefPrefix + `[{CharCode}] Character reference sheet. ${charRefStyleEnv}16:9 canvas split vertically. LEFT panel: 4 equal cells (2x2 grid) for face close-ups — top-left: face front, camera-facing; top-right: face 3/4 view facing left; bottom-left: face 3/4 view facing right; bottom-right: face profile (side view). Uniform face size and even spacing. RIGHT panel: 2 equal cells (vertical split) — top: full body front, standing neutral pose; bottom: full body back, same pose. Maintain consistent anatomy, proportion, size and alignment. 2D stick figure {gender} (simple white round head, thin black line body{female_stick_detail}) in humorous 2D illustration style. {color} {outfit_modifier}outfit. Consistent lighting across all panels.`
        : charRefPrefix + `[{CharCode}] Character reference sheet. ${charRefStyleEnv}16:9 canvas split vertically. LEFT panel: 4 equal cells (2x2 grid) for face close-ups — top-left: face front, camera-facing; top-right: face 3/4 view facing left; bottom-left: face 3/4 view facing right; bottom-right: face profile (side view). Uniform face size and even spacing. RIGHT panel: 2 equal cells (vertical split) — top: full body front, standing neutral pose; bottom: full body back, same pose. Maintain consistent anatomy, proportion, size and alignment. {nationality} {gender}, {age}yo, {build}, {hair length/color/style}, wearing {color} {pattern} {outfit}, {accessories/glasses}. Same character in all panels (unified facial features, hair, skin tone, body build). Consistent lighting.`;

    const charRefPromptTemplate = isStickFigure
        ? charRefPrefix + `2D stick figure {gender} (simple white round head, thin black line body{female_stick_detail}) in humorous 2D illustration style. Full body shot, front facing, studio background. {CharCode} wearing {color} {outfit_modifier}outfit. Standing in neutral pose. Character reference portrait.`
        : charRefPrefix + `{CharCode}({description}). Full body shot, front facing. Standing in neutral pose, arms relaxed. Calm expression. Character reference portrait.`;

    const charRefDescTemplate = isStickFigure
        ? `2D stick figure {gender}, simple white round head, thin black line body{female_stick_detail}, wearing {color} {outfit_modifier}outfit`
        : `${nationality} {gender}, {age}yo, {build}, {hair length/color/style}, wearing {color} {pattern} {outfit}, {accessories/glasses}`;

    const exampleCharNameSeg = nationality === 'Korean' ? '이수아' : 'Jia';

    if (isFirstBatch) {
        // ★ PRO 2.0: 사용자 제공 캐릭터가 있을 경우 PRE-PROVIDED 블록 삽입
        const hasUserRefs = Array.isArray(userProvidedCharRefs) && userProvidedCharRefs.length > 0;
        let preProvidedBlock = '';
        if (hasUserRefs) {
            const fixedRefsText = userProvidedCharRefs.map(r => {
                // 전체 프롬프트를 description으로 사용 (절단 금지 — 사용자 의도 보존)
                const fullDesc = (r.prompt || r.description || '').replace(/\s+/g, ' ').trim();
                return `- ${r.code} (${r.name || r.code}): ${fullDesc}`;
            }).join('\n\n');
            const fixedCodesStr = userProvidedCharRefs.map(r => r.code).join(', ');
            const styleAnchor = _deriveStyleAnchorFromUserRefs(userProvidedCharRefs);
            preProvidedBlock = `
═══ PRE-PROVIDED CHARACTER REFERENCES (STRICT — IDENTITY LOCKED) ═══
The following characters are FIXED by the user. Below is their text.

${fixedRefsText}

═══ STYLE ANCHOR (from pre-provided characters) ═══
Master style tokens: ${styleAnchor}

═══ WHAT TO PRESERVE VS. WHAT TO VARY (CRITICAL) ═══
★ PRESERVE VERBATIM (locked identity — copy word-for-word every scene):
  - Art/rendering style (e.g. "Rough hand-drawn marker illustration style")
  - Species / gender / age / body build / proportions
  - Facial features, hair, skin, fur, eyes
  - Clothing / outfit / accessories / colors / patterns
  - Any permanent visual markers (freckles, scars, tattoos, distinctive items)

★ VARY PER SCENE (Gemini decides based on script context):
  - Location / setting / background / time / lighting
  - Pose / body posture / camera angle
  - Action (what the character is doing in THIS scene)
  - Facial expression (joy, fear, anger, sadness, surprise, disgust, etc.)
    — EVEN IF the user's reference shows a NEUTRAL or default expression,
       the scene's emotion MUST come from the script (not copied from the reference).
  - Gaze direction
  - Interactions with other characters/objects

RULE: When building charProps for codes ${fixedCodesStr}, preserve ALL appearance
tokens from the pre-provided description VERBATIM, but REPLACE or ADD pose/action/
expression/location tokens based on what this specific scene requires from the script.
DO NOT lock poses. DO NOT copy "standing pose with hands on hips" or
"neutral smile" if the scene requires sitting, walking, crying, or shouting.

EXAMPLE: User's MCR prompt: "...freckles, red lipstick, green cardigan, mompe pants, standing pose, neutral smile"
  - Scene about surprise: charProps = "MCR(freckles, red lipstick, green cardigan, mompe pants,
    EYES WIDE OPEN, MOUTH AGAPE, HANDS RAISED in surprise)" ← appearance preserved, emotion dynamic
  - Scene about sadness: charProps = "MCR(freckles, red lipstick, green cardigan, mompe pants,
    DOWNCAST GAZE, TEARS IN EYES, HUNCHED SHOULDERS)" ← same identity, different emotion

═══ OTHER RULES ═══
1. NON-HUMAN PRE-PROVIDED CHARACTERS: If a pre-provided description mentions animal,
   creature, plant, robot, or any non-human subject, IGNORE the "{nationality} {gender}, {age}yo, {build}..."
   template for that character. Use the user's appearance tokens VERBATIM, but still
   adapt pose/action/expression per scene.
2. DO NOT change appearance details (clothing colors, hair, species, etc.).
3. DO NOT add appearance fields the user didn't include (age, nationality, etc.).
4. New characters (not in ${fixedCodesStr}) MUST match the style/rendering of pre-provided
   characters (same art style, proportions, rendering technique).
4a. ★ CRITICAL — NEW CHARACTERS MUST HAVE FULL STRUCTURED DETAIL. Every required field
    must be a CONCRETE specific value, not a generic adjective or role noun.
    Fill EVERY field below (none optional):
    • build: exactly one of {slim / average / muscular / chubby / stocky / lanky}
             ❌ BAD: "student", "greedy-looking", "tired" (these are NOT build)
             ✅ GOOD: "average build", "chubby build", "slim build"
    • hair: MUST specify BOTH color + length + style (3 parts)
             ❌ BAD: "slicked-back hair" (missing color), "short hair" (missing color+style)
             ✅ GOOD: "short black slicked-back hair", "medium brown curly hair"
    • outfit color: a NAMED COLOR (navy blue, forest green, mustard yellow, charcoal gray...)
             ❌ BAD: "casual hoodie", "nice shirt" (no color)
             ✅ GOOD: "navy blue hoodie", "mustard yellow striped shirt"
    • pattern: one of {solid / striped / plaid / floral / graphic-print / checkered}
             ❌ BAD: missing or "nice pattern"
             ✅ GOOD: "solid navy hoodie", "red striped shirt"
    • accessories: MANDATORY — at least ONE concrete item
             ❌ BAD: "authentic look", "exaggerated face" (these are expressions, not items)
             ✅ GOOD: "silver-rimmed glasses", "gold wristwatch", "black beanie",
                     "silver hoop earrings", "brown leather belt", "red scarf"
    Do NOT use generic filler words ("authentic", "confused expression", "nice", "cool").
    Those describe emotion/quality, not identity markers — put emotion in scene charProps
    instead, not in the character reference sheet.
5. In OUTPUT 'characterRefs' array, include ONLY newly generated characters.
   DO NOT re-emit the pre-provided ones (${fixedCodesStr}).

`;
        }
        const prompt = `You are a storyboard artist for Grok AI.
${continuationBlock}${preProvidedBlock}=== STEP 1: SCRIPT UNDERSTANDING (internal) ===
Read the FULL SCRIPT and the SCRIPT SEGMENT below. Understand: plot, setting, character roles, emotional arc.

=== FULL SCRIPT (for context) ===
${safeScript}

=== THIS SEGMENT: ${segmentLabels} ===
${distributionNote}

${segmentBlock}

=== STYLE (sceneDesc에 적용될 렌더링+환경 레이어) ===
${sceneStyle}${humanIdentityBlockSeg}${nonHumanNoteSeg}

=== OUTPUT FORMAT ===
Return ONLY a JSON object: { "characterRefs": [...], "scenePrompts": [...] }
CRITICAL — Every characterRef MUST include prompt and refSheetPrompt. Every scenePrompt MUST include charActions (object). Do NOT omit.
CHARACTER NAME LANGUAGE: When nationality is NOT Korean, characterRefs[].name MUST be in English only (e.g. Jia, Sarah). When nationality is Korean, name may be 한글. Never use 한글 for name when nationality is not Korean.
═══ EXAMPLES — characterRefs (follow these patterns EXACTLY) ═══

⚠️ IMPORTANT — THE MAIN CHARACTER (MCR) IS NOT REQUIRED TO BE A HUMAN ⚠️
MCR can be ANY recurring subject in the script: human, animal (dog/cat/dragon/bird), plant (flower/tree), object (sword/robot/car), spirit/creature, or even an abstract entity. READ THE SCRIPT CAREFULLY — if the story's protagonist is a cherry blossom that waits 1000 years to bloom, MCR = the flower (not a human). If the hero is a dragon, MCR = dragon. Assign MCR to whoever/whatever the script is actually about.

⚠️ SCRIPT-CONTEXT FLEXIBILITY (CRITICAL) ⚠️
Non-human characters have TWO modes — CHOOSE based on script context:
(A) NATURAL MODE: script describes animals/plants/objects in their natural form
    → no clothing, no human body parts, natural anatomy (FOLLOW EXAMPLE 3 / 4 / 5)
(B) ANTHROPOMORPHIC MODE: script explicitly describes the non-human character with human
    clothing, human tools, speech, upright posture, or human social roles
    (e.g. "강아지 판사가 법봉을 두드렸다", "tuxedo cat with a gold pocket watch",
    "꽃 요정이 빨간 드레스를 입고 춤췄다", "robot butler serving tea")
    → KEEP the anthropomorphic elements the script describes. Do NOT strip clothing
    or human features that the SCRIPT explicitly assigns to the character.

RULE: Read the script first. If the script says "강아지가 네 발로 풀밭을 뛰었다" →
natural mode. If the script says "강아지 승무원이 모자를 쓰고 손님을 맞았다" →
anthropomorphic mode (keep hat, upright, human-like service role).

EXAMPLE 1 — HUMAN female (MCR): Notice ALL identity tokens: build, hair (length+color+style), outfit (color+pattern+type+inner layer), accessories (glasses frame shape, earrings):
{ "code": "MCR", "name": "${exampleCharNameSeg}", "description": "${nationality === 'Korean' ? 'Korean' : nationality} female, 25yo, slim, long straight black hair with side-swept bangs, wearing burgundy plaid blazer over cream inner blouse and dark navy pencil skirt, thin round gold-frame glasses, small pearl earrings", "prompt": "[${nationality} Context]. [no name labels]. Hyper-realistic cinematic photograph. ${nationality} drama aesthetic. Natural lighting. High-quality DSLR photography. MCR(${nationality === 'Korean' ? 'Korean' : nationality} female, 25yo, slim, long straight black hair with side-swept bangs, wearing burgundy plaid blazer over cream inner blouse and dark navy pencil skirt, thin round gold-frame glasses, small pearl earrings). Full body shot, front facing. Standing in neutral pose, arms relaxed. Calm expression. Character reference portrait.", "refSheetPrompt": "[${nationality} Context]. [no name labels]. Hyper-realistic cinematic photograph. ${nationality} aesthetic. Natural lighting. High-quality DSLR photography. [MCR] Character reference sheet. Match style, rendering, texture, color across all panels. Mid-gray neutral background. 16:9. LEFT: 4 cells (2x2) face close-ups — front, 3/4 left, 3/4 right, profile. RIGHT: 2 cells — full body front, full body back. Same character, consistent lighting. ${nationality === 'Korean' ? 'Korean' : nationality} female, 25yo, slim, long straight black hair with side-swept bangs, wearing burgundy plaid blazer over cream inner blouse and dark navy pencil skirt, thin round gold-frame glasses, small pearl earrings." }

EXAMPLE 2 — HUMAN male (SC1): Notice heavyset build, explicit "no glasses", different outfit details:
{ "code": "SC1", "name": "${nationality === 'Korean' ? '동훈' : 'James'}", "description": "${nationality === 'Korean' ? 'Korean' : nationality} male, 35yo, heavyset, short cropped grey hair, wearing charcoal checked hoodie over light-gray inner t-shirt and dark cargo pants, no glasses, silver chain bracelet", "prompt": "[${nationality} Context]. [no name labels]. Hyper-realistic cinematic photograph. ${nationality} drama aesthetic. Natural lighting. SC1(${nationality === 'Korean' ? 'Korean' : nationality} male, 35yo, heavyset, short cropped grey hair, wearing charcoal checked hoodie over light-gray inner t-shirt and dark cargo pants, no glasses, silver chain bracelet). Full body shot, front facing. Standing in neutral pose. Character reference portrait.", "refSheetPrompt": "[${nationality} Context]. [no name labels]. Hyper-realistic cinematic photograph. ${nationality} aesthetic. [SC1] Character reference sheet. Match style, rendering, texture, color across all panels. Mid-gray neutral background. 16:9. LEFT: 4 cells (2x2) face close-ups — front, 3/4 left, 3/4 right, profile. RIGHT: 2 cells — full body front, full body back. Same character, consistent lighting. ${nationality === 'Korean' ? 'Korean' : nationality} male, 35yo, heavyset, short cropped grey hair, wearing charcoal checked hoodie over light-gray inner t-shirt and dark cargo pants, no glasses, silver chain bracelet." }

EXAMPLE 3a — NATURAL animal (MCR): When script describes animal in NATURAL form (no human clothing/roles). NO human body parts, NO clothing:
{ "code": "MCR", "name": "Buddy", "description": "golden retriever, large, golden fur, floppy ears, brown eyes, red tartan bandana collar, bushy tail", "prompt": "[${nationality} Context]. [no name labels]. Hyper-realistic cinematic photograph. Natural lighting. MCR(golden retriever, large, golden fur, floppy ears, brown eyes, red tartan bandana collar, bushy tail). Full body shot, front facing. Standing on grass, alert pose. Character reference portrait.", "refSheetPrompt": "[${nationality} Context]. [no name labels]. Hyper-realistic cinematic photograph. [MCR] Character reference sheet. Mid-gray neutral background. 16:9. LEFT: 4 cells (2x2) face close-ups — front, 3/4 left, 3/4 right, profile. RIGHT: 2 cells — full body side profile standing on four legs, full body front view standing on four legs. Same animal on four legs, consistent lighting. NO human arms/legs/clothing. Golden retriever, large, golden fur, floppy ears, brown eyes, red tartan bandana collar, bushy tail." }

EXAMPLE 3b — ANTHROPOMORPHIC animal (MCR): When script explicitly describes animal with human clothing, human roles, or upright posture (e.g. "강아지 승무원", "tuxedo cat judge", "robot butler"). KEEP the anthropomorphic elements the script specifies:
{ "code": "MCR", "name": "머니", "description": "3D Pixar-style anthropomorphic Maltese dog, 2.5 head-body ratio, white fluffy fur, chocolate-brown round eyes, gold wire-rimmed glasses, wearing navy blue conductor uniform with gold buttons and matching cap, standing upright like a human, bipedal", "prompt": "[${nationality} Context]. [no name labels]. 3D Pixar-style cinematic illustration. MCR(3D Pixar-style anthropomorphic Maltese dog, 2.5 head-body ratio, white fluffy fur, chocolate-brown round eyes, gold wire-rimmed glasses, wearing navy blue conductor uniform with gold buttons and matching cap, standing upright like a human, bipedal). Full body shot, front facing. Character reference portrait.", "refSheetPrompt": "[${nationality} Context]. [no name labels]. 3D Pixar-style cinematic illustration. [MCR] Character reference sheet. Mid-gray neutral background. 16:9. LEFT: 4 cells (2x2) face close-ups — front, 3/4 left, 3/4 right, profile (all with conductor cap and glasses). RIGHT: 2 cells — full body front (standing upright in conductor uniform), full body back. Same anthropomorphic character, CONSISTENT outfit across all panels. 3D Pixar-style anthropomorphic Maltese dog, 2.5 head-body ratio, white fluffy fur, gold wire-rimmed glasses, navy blue conductor uniform with gold buttons and matching cap, standing upright." }

EXAMPLE 4 — NATURAL plant/flower (MCR): When script describes plant/flower in NATURAL form (no anthropomorphization). NO human body parts, NO clothing:
{ "code": "MCR", "name": "Cheonnyeonhwa", "description": "mythical thousand-year flower, large white petals with soft pink tips, golden pollen center, slender jade-green stem, curved leaves with silver veins, mystical glow", "prompt": "[${nationality} Context]. [no name labels]. Hyper-realistic cinematic photograph. Soft natural lighting. MCR(mythical thousand-year flower, large white petals with soft pink tips, golden pollen center, slender jade-green stem, curved leaves with silver veins, mystical glow). Close-up botanical shot. Natural flower form only. Character reference portrait.", "refSheetPrompt": "[${nationality} Context]. [no name labels]. Hyper-realistic cinematic photograph. [MCR] Character reference sheet. Mid-gray neutral background. 16:9. LEFT: 4 cells (2x2) detail close-ups — full bloom front, petal side view, stem-leaf detail, pollen center macro. RIGHT: 2 cells — full plant with stem and leaves, bloom cluster from above. Same flower, consistent lighting. STRICTLY FLOWER/PLANT ONLY — NO human face, NO arms, NO legs, NO clothing, NO humanoid body. Mythical thousand-year flower, large white petals with soft pink tips, golden pollen center, slender jade-green stem, curved leaves with silver veins, mystical glow." }

EXAMPLE 5 — NON-HUMAN dragon/creature (SC1): When the character is a mythical creature. Show natural species anatomy, NO humanoid hybrid:
{ "code": "SC1", "name": "Goldscale", "description": "eastern dragon, serpentine body 20ft long, golden scales with emerald underbelly, long whiskers, antler-like horns, four clawed feet, flowing mane", "prompt": "[${nationality} Context]. [no name labels]. Hyper-realistic cinematic photograph. SC1(eastern dragon, serpentine body 20ft long, golden scales with emerald underbelly, long whiskers, antler-like horns, four clawed feet, flowing mane). Full creature shot, coiled pose. Character reference portrait.", "refSheetPrompt": "[${nationality} Context]. [no name labels]. Hyper-realistic cinematic photograph. [SC1] Character reference sheet. Mid-gray neutral background. 16:9. LEFT: 4 cells (2x2) detail close-ups — head front, head profile, scale texture, claw/foot detail. RIGHT: 2 cells — full serpentine body coiled, full body stretched in flight pose. Same dragon, consistent lighting. STRICTLY DRAGON ANATOMY — NO humanoid legs, NO clothing, NO robes, NO standing-upright human pose. Eastern dragon, serpentine body 20ft long, golden scales with emerald underbelly, long whiskers, antler-like horns, four clawed feet, flowing mane." }

═══ KEY RULES FROM EXAMPLES ═══
CRITICAL — description, charProps (in scenePrompts), and refSheetPrompt ending MUST contain IDENTICAL identity tokens. Copy-paste the SAME token string across all three fields.
CRITICAL — HUMAN identity tokens (ALL required): (1) gender + age, (2) body build (slim/average/heavyset/muscular), (3) hair: length + color + style (e.g. "long straight black hair with side-swept bangs"), (4) outfit: color + pattern + type + inner layer if outerwear (e.g. "burgundy plaid blazer over cream inner blouse and dark navy pencil skirt"), (5) accessories: glasses WITH frame shape (e.g. "thin round gold-frame glasses") OR explicit "no glasses", PLUS any earrings/hat/bag/scarf/watch. Do NOT omit ANY token. plain/solid/무지 FORBIDDEN for outfit patterns.
CRITICAL — NON-HUMAN identity tokens (ALL required): species/type, breed (if animal), color/pattern, size, ALL distinguishing features (collar, markings, accessories). Repeat in EVERY prompt.
CRITICAL — NON-HUMAN refSheetPrompt (CONTEXT-AWARE):
  (A) NATURAL MODE — script describes the non-human subject in its natural form (no clothing, no human roles):
      refSheetPrompt MUST NOT include human body parts, human clothing, or upright human poses.
      Use species-appropriate views: (animal) side profile + standing front, natural quadruped pose;
      (bird) perched side view + wings-open view; (flower/plant) full bloom + stem/leaf detail;
      (object) 3/4 angle + side view + top view. DO NOT anthropomorphize. Show natural anatomy only.
  (B) ANTHROPOMORPHIC MODE — script EXPLICITLY assigns human clothing, tools, speech, upright posture,
      or human social roles to the character (e.g. "강아지 승무원이 제복을 입고", "tuxedo cat judge",
      "robot butler", "꽃 요정 in red dress"):
      KEEP the anthropomorphic elements the script/description specifies. Do NOT strip clothing, hats,
      glasses, or upright posture that are part of the character's identity. The refSheetPrompt should
      show the character AS DESCRIBED (e.g. bipedal with conductor uniform) consistently across panels.
      Follow EXAMPLE 3b for animals, or analogous anthropomorphic styling for other subjects.
  RULE: Infer mode from the script and from the user's description. If both are silent on clothing/roles,
  default to (A) NATURAL MODE. If ANY human-element signal is present, use (B) ANTHROPOMORPHIC MODE and
  preserve those elements verbatim.
CRITICAL — Characters are NOT limited to humans. Depending on the script, MCR/SC can be animals, plants, objects, or environmental subjects. RECURRING non-human subjects appearing in 2+ scenes MUST get character codes (MCR/SC1~SC5) for visual consistency. Use characters="" ONLY for one-off background shots.
CRITICAL — STRICT HARD LIMIT: Maximum 6 characterRefs total (MCR + up to SC1~SC5). NEVER SC6 or beyond. If the script has NO recurring subjects (pure landscape/nature montage), output 0 characterRefs and use characters="" for all scenes.
Identify main and supporting characters (MCR, SC1, SC2, SC3, SC4, SC5 only — max 6 total) from the script. characterRefs: [{ "code", "name", "description", "prompt", "refSheetPrompt" }]
★ CHARACTER CODE RULES: The ONLY valid codes are the exact strings MCR, SC1, SC2, SC3, SC4, SC5. FORBIDDEN: MCR_A, MCR_B, MCR_C, MCR1, MCR2, SC1_A, SC1B, or ANY variant/suffix. One script = at most 1 MCR. Additional recurring subjects (including animals, supernatural beings, objects) MUST use SC1~SC5 in order. NEVER invent new codes.
scenePrompts: array of ${totalNumPrompts} objects. Each: { "number", "characters", "scriptText", "sceneDesc", "charProps", "action", "charActions" }.
  characters: ONLY "MCR", "SC1", "SC2", "SC3", "SC4", "SC5" or combinations (e.g. "MCR,SC1", "SC1,SC2"), or "" (NEVER SC6 or beyond; NEVER charProps or descriptions).
  scriptText: FIRST 14 chars of THIS scene's script (remove spaces). Each scene MUST start at a LINE or SENTENCE BOUNDARY—scriptText must be the beginning of a line or sentence, NEVER from the middle of a word. Copy from script.
  sceneDesc: "${sceneDescFormat}"
${environmentRule}
  charProps: "${charPropsTemplate}"
  action: "${actionFormat}"
  charActions: { "MCR": "MCR's action and expression", "SC1": "SC1's action and expression", ... } — split action per character; characters="" → {}

═══ EXAMPLES — scenePrompts (follow these patterns EXACTLY) ═══

EXAMPLE scenePrompt A — Two humans (charProps has FULL identity for BOTH):
{ "number": "01", "characters": "MCR,SC1", "scriptText": "갑자기사레가들렸다", "sceneDesc": "[${nationality} Context] Full shot, Eye level. [no name labels]. Hyper-realistic cinematic photograph. ${nationality} drama aesthetic. Dawn. Narrow residential alley. Soft golden streetlight glow.", "charProps": "MCR(${nationality === 'Korean' ? 'Korean' : nationality} female, 25yo, slim, long straight black hair with side-swept bangs, wearing burgundy plaid blazer over cream inner blouse and dark navy pencil skirt, thin round gold-frame glasses, small pearl earrings). SC1(${nationality === 'Korean' ? 'Korean' : nationality} male, 35yo, heavyset, short cropped grey hair, wearing charcoal checked hoodie over light-gray inner t-shirt and dark cargo pants, no glasses, silver chain bracelet).", "action": "MCR and SC1 walking through dawn alley. Surprised expression.", "charActions": { "MCR": "stops mid-step, hand on chest, startled wide-eyed expression.", "SC1": "turns head toward MCR, protective concerned frown." } }

EXAMPLE scenePrompt B — Human + Animal together:
{ "number": "05", "characters": "MCR,SC2", "scriptText": "공원에서산책하며", "sceneDesc": "[${nationality} Context] Full shot, Low angle. [no name labels]. Hyper-realistic cinematic photograph. Afternoon. City park with autumn leaves. Warm golden hour light.", "charProps": "MCR(${nationality === 'Korean' ? 'Korean' : nationality} female, 25yo, slim, long straight black hair with side-swept bangs, wearing burgundy plaid blazer over cream inner blouse and dark navy pencil skirt, thin round gold-frame glasses, small pearl earrings). SC2(golden retriever, large, golden fur, floppy ears, brown eyes, red tartan bandana collar, bushy tail).", "action": "MCR walking with SC2 on leash through autumn park.", "charActions": { "MCR": "smiles gently, holding leash loosely, relaxed stride.", "SC2": "trots alongside happily, tail wagging, sniffing fallen leaves." } }

EXAMPLE scenePrompt C — Background-only (no character, one-off scenery):
{ "number": "08", "characters": "", "scriptText": "고요한새벽바다위로", "sceneDesc": "[${nationality} Context] Full shot, Bird's eye. [no name labels]. Hyper-realistic cinematic photograph. Pre-dawn. Calm ocean surface. Deep blue-violet sky with faint horizon glow.", "charProps": "Establishing shot of calm pre-dawn ocean. Deep blue-violet water stretching to horizon, faint orange glow at the edge, still and peaceful.", "action": "Vast ocean, quiet atmosphere. Serene, contemplative mood.", "charActions": {} }

=== RULES ===
1. Generate EXACTLY ${totalNumPrompts} prompts. Respect the section/part boundaries above. Each prompt = one scene/paragraph unit—place boundaries at LINE START or SENTENCE START (줄·문장의 시작). NEVER split mid-word or mid-sentence. Each scene MUST begin at the start of a new line or sentence.
2. scriptText: Copy FIRST part of each scene's script VERBATIM, remove spaces/punctuation, max 14 chars. CRITICAL: scriptText must NEVER begin from the middle of a word. Start at a new line or sentence start.
3. SCENE DIVERSITY (CRITICAL—vary shots, do NOT repeat face close-up only):
   - ★ MCR SCREEN-TIME CAP: MCR MUST appear in AT MOST 50% of the generated scenes (target 40~50%). When MCR is narrating in the script, SHOW WHAT MCR IS TALKING ABOUT instead of MCR's face — B-roll: location establishing shots, object close-ups (cookie, price tag, phone, money), other characters acting, visual metaphors (crowd, line, chart). NEVER place MCR in 3+ consecutive scenes — after 2 MCR scenes, the next MUST be non-MCR (characters:"" or SC-only).
   - ★ MACRO CLOSE-UP for PSYCHOLOGICAL/EMOTIONAL MOMENTS (STRICT — 25% of total scenes, minimum 20%):
     * Exactly 25% of scenes (e.g. 30 scenes → 7~8 scenes, 60 scenes → 15 scenes) MUST be MACRO close-ups — regardless of content category (drama/music/education/economy/vlog/cooking/sports).
     * Macro close-up = extreme tight framing on a SINGLE detail symbolizing emotion/tension/concept.
     * Categories (USE 3+ DIFFERENT types across output, do not repeat same subject):
       (a) Body-emotion: single eye/dilated pupil/trembling lip/tear welling/clenched fist/sweat drop/heartbeat pulse on neck/eyelash flutter/goosebumps
       (b) Micro-gesture: fingers gripping fabric or phone, nervous fingertip tapping, knuckle whitening, throat swallowing, pen tip touching paper, ring sliding
       (c) Object-symbol: price tag text, coin edge, watch second-hand, ring, currency weave, key teeth, button press, letter seal
       (d) Nature-detail: petal dewdrop, raindrop rolling, leaf vein, candle flame flicker, steam curl, snow crystal, water ripple
       (e) Genre-specific: chart line detail, cookie cross-section, food steam, screen pixels, book spine, tool edge, instrument string
     * USE WHEN: script expresses doubt, shock, realization, fear, regret, longing, greed, suppressed anger, inner conflict, decision moment, secret thought, emotional climax, key concept reveal, punchline.
     * Format: characters="{Code}" for body/gesture (identity lock), OR characters="" for object/nature/symbol macros.
       charProps="{Code}(extreme macro close-up of {body part}, {micro-action showing emotion}, {full identity description})" OR charProps="Extreme macro close-up of {object detail}."
     * Example A (body): characters="MCR", charProps="MCR(extreme macro close-up of single eye with glasses rim, pupil slightly dilated, faint tear welling at lower lid, ${nationality} female ...full identity...).", action="Pupil contracts slightly. Realization expression. Quiet emotional weight mood."
     * Example B (object): characters="", charProps="Extreme macro close-up of the '9,800' price tag text, ink fibers visible, slight paper grain.", action="Static focus on text detail. Financial shock mood."
     * Macro close-ups DO NOT count toward MCR screen-time cap above (they are interior/symbolic shots, not talking-head).
     * DO NOT repeat the same macro subject — vary categories (a)~(e).
   - MCR is NOT required every scene. Include: background-only, prop/object close-ups, body-part close-ups.
   - RECURRING non-human subjects (animal/plant/object appearing in 2+ scenes) MUST have character codes and use their code in characters field. Use characters="" ONLY for one-off backgrounds/props.
   - STORY-RELEVANT ONLY: Use body-part or prop close-ups ONLY when the script/narrative explicitly focuses on them (e.g. script mentions "휴지 in nostrils"→nostrils; "phone grabbed"→hands; "빈 차"→empty car interior). Do NOT insert arbitrary/meaningless close-ups for variety.
   - Background-only (characters:"", charProps:"Establishing shot of {place}."): one-off scenery, street, room, atmosphere—when script sets location/mood.
   - Prop/object close-up (characters:"", charProps:"Big close-up of {subject}."): one-off objects only (letter, glass, door, car interior, CCTV screen, etc.).
   - Body-part close-up: hands, feet, eyes—when script focuses on that action (gripping, writing, stepping, glancing).
   - Within every 10 scenes: at least THREE (30%) must be atmosphere-implying shots — big close-ups of body parts (eyes, hands, feet), objects, or scenery/establishing shots (characters:""). Do NOT use face close-up for all even-numbered scenes.
4. CAMERA: Odd numbers [01,03,05...]=Full shot. Even numbers [02,04,06...]=Close-up OR Macro close-up. Shot distribution target: Full shot ~50%, Face close-up ~25%, MACRO close-up (psychological) ~25%. Macro close-ups replace roughly half of the even-numbered close-up slots at moments of emotional/psychological intensity. Vary when script calls for it. NO consecutive full shots. Angles: eye level, low angle, bird's eye, Dutch angle, high angle, macro (cycle).
5. sceneDesc: MANDATORY format—start with [${nationality} Context], include [no name labels], FULL style description, time, place, light. Do NOT shorten style.
   ★ EXCEPTION — INTENTIONAL TEXT/TYPOGRAPHY SCENES:
     When the scene intentionally features readable text (numbers, years, currency, names,
     product names, chart labels, book covers, phone screens, price tags, documents),
     REPLACE [no name labels] with [text allowed: <specific text content>].
     Examples:
       - Number:   [text allowed: '9,800원']
       - Year:     [text allowed: '1899']
       - Currency: [text allowed: '$1,000,000']
       - Person:   [text allowed: 'Thorstein Veblen']
       - Product:  [text allowed: 'Galaxy S25']
       - Chart:    [text allowed: chart labels and numbers]
       - Phone:    [text allowed: app UI with notification text]
     This ensures readable typography only where intentional, while keeping default
     scenes (character shots, ambient scenery) label-free.
6. action: MANDATORY format—{action}. {expression}. {mood}.
7. LANGUAGE (CRITICAL—AI image models require English): sceneDesc, charProps, action MUST be 100% English. NO Korean, no 한글. scriptText keeps original language. Translate time/place/atmosphere: 새벽→dawn, 주택가 골목→residential alley, 가로등 불빛→streetlight glow, 어둡고 을씨년스러운→dark dreary, 조용한→quiet, 밤→night.
8. FORMAT: Single space between words. NO blank lines inside sceneDesc, charProps, or action.
9. charProps (CRITICAL — NO ABBREVIATION): When characters="" use "Establishing shot of {place}." or "Big close-up of {subject}." (no character in frame). Do NOT write "Empty" in charProps—it is internal; output only the shot description. When characters present: Format "${charPropsTemplate}". Body-part close-up: "MCR(extreme close-up of {hands/face/eyes/feet}, {action/expression})". EVERY PROMPT must repeat the FULL character description inside charProps. NEVER use "(...)" or abbreviate. AI image generators have NO memory of previous prompts, so each charProps must be SELF-CONTAINED and COMPLETE.
   MANDATORY FIELDS for HUMAN characters in charProps: (1) gender + age, (2) body build (slim/average/heavyset/muscular), (3) hair: length + color + style (e.g. "long wavy black hair", "short cropped brown hair with side-swept bangs"), (4) outfit: color + pattern/texture + type (e.g. "dark navy striped blazer over white inner blouse and black pencil skirt"), (5) accessories: glasses (frame shape like "thin round metal-frame glasses") or "no glasses", plus any earrings/hat/bag/scarf/watch. Example: "MCR(Korean female, 25yo, slim, long straight black hair, wearing burgundy plaid blazer over cream inner blouse and dark navy pencil skirt, thin round gold-frame glasses, small pearl earrings)." NOT "MCR(Korean female, 25yo, long black hair, wearing white plain blouse)." NOT "MCR(...)." NOT "MCR(same as before)."
   NON-HUMAN characters: For animals use species, breed/type, color, size, features. For plants/objects use type, color, size, condition.
10. charActions: Split action per character. characters="" → {}. Always object. English only. Do NOT invent new content.
${stickRules}
${scriptContextRules}
${joseonRules}
11. refSheetPrompt and prompt: MUST start with [${nationality} Context]. [no name labels]. {FULL style}. then [{CharCode}]. Match style, rendering, texture, color across all panels. Mid-gray neutral solid background. 16:9. Layout: LEFT = 4 cells (2x2) face close-ups; RIGHT = 2 cells full body. Same character, consistent lighting. [{CharCode}] at front. Replace {CharCode} with [MCR]/[SC1]/[SC2]/[SC3]/[SC4]/[SC5] only — never SC6 or higher. CRITICAL — refSheetPrompt MUST end with the character's COMPLETE IDENTITY matching charProps exactly: gender, age, body build (slim/average/heavyset/muscular), hair (length + color + style), wearing {color} {pattern} {outfit}, accessories (glasses with frame shape, earrings, hat, bag, etc.). Do NOT write just "Korean female, 25yo" — ALWAYS include ALL identity tokens: build, full hair description, full outfit with color+pattern, and all accessories. The refSheetPrompt identity MUST be identical to charProps identity. For non-human characters: describe species/type, color, size, distinguishing features instead. For stick figures: {gender} per character; female=pastel accessories, pastel outfit.
12. CHARACTER COUNT: Output exactly 1~6 characterRefs. Never 7 or more. Never use code SC6.
13. SKIP: Do NOT generate prompts for: title cards (e.g. "A title card appears", "Title card for", N단계 markers like 9단계진실폭로), part/phase dividers (1부완료, 2부 등), production notes (Display...), structural markers, lines in [...] brackets (e.g. [Intro], [Verse 1], [Chorus], [Bridge], [Outro]), lines in (...) parentheses (e.g. (instrumental...), (fade out...)), vocal fillers (um um um, la la la), or any meta-text. You MUST distinguish actual narrative from non-narrative using your reasoning ability. Ask yourself: "Can this line be visualized as an image scene?" If NO (section headers, stage directions, instrument cues, timestamps, credits, structural dividers, meta-comments), SKIP it. Generate prompts ONLY for lines that describe visualizable content: character actions, dialogue, emotions, settings, or story moments.
14. PROHIBITED: CRITICAL—More than 6 characterRefs; SC6, SC7, or any character code beyond SC5. Any Korean/한글. Word "Empty" in charProps. Arbitrary/meaningless body-part or prop close-ups (use only when script focuses on them). Same angle consecutively. Shortening or abbreviating charProps with "(...)" or "same as before".
${userDirections ? `\n=== ★ USER DIRECTIONS (HIGHEST PRIORITY — override all other rules if conflicting) ===\nThe user's special directions below MUST be reflected in EVERY generated prompt as the top priority.\n${userDirections}` : ''}

=== GENERATE characterRefs AND ${totalNumPrompts} SCENE PROMPTS AS JSON OBJECT ===`;

        const maxTokens = Math.min(65536, 1000 * totalNumPrompts + 3000);
        const data = await _geminiApiCall(apiKey, prompt, maxTokens);
        const rawText = data.candidates[0].content.parts[0].text;
        const result = _sanitizeCharacterCodes(parseGeminiResponseV5(rawText));

        // 씬 프롬프트에서 의상 힌트 추출 → refSheetPrompt 동기화용
        const appearanceHints = _extractAppearanceHintsFromScenePrompts(result.scenePrompts || []);

        const charRefs = (result.characterRefs || []).map(ref => {
            const desc = ref.description || '';
            // Change 3: Infer gender from description for fallback (woman/man)
            const isFemale = /woman|female|she\b/i.test(desc);
            const charPrompt = isStickFigure
                ? `2D stick figure ${isFemale ? 'woman' : 'man'} (simple white round head, thin black line body${isFemale ? ', pastel accessories like ribbon/bow' : ''}) in humorous 2D illustration style. Full body shot, front facing, studio background. [no name labels]. ${ref.code || 'MCR'} wearing ${ref.code === 'SC1' ? 'purple' : ref.code === 'SC2' ? 'green' : ref.code === 'SC3' ? 'orange' : ref.code === 'SC4' ? 'red' : ref.code === 'SC5' ? 'teal' : 'blue'} ${isFemale ? 'pastel ' : ''}outfit. Standing in neutral pose. Character reference portrait.`
                : `Studio background. [no name labels]. ${ref.code || 'MCR'}(${desc}). Full body shot, front facing. Standing in neutral pose, arms relaxed. Calm expression. Character reference portrait.`;
            // refSheetPrompt 후처리: 의상 동기화 + 가드 + 레이아웃 보장
            const rawRefSheet = ref.refSheetPrompt || '';
            const finalRefSheet = isStickFigure
                ? convertCharacterCodes(_finalizeRefSheetPrompt(rawRefSheet, appearanceHints))
                : _finalizeRefSheetPrompt(rawRefSheet, appearanceHints);
            return {
                code: ref.code || 'MCR',
                name: ref.name || '',
                description: desc,
                prompt: convertCharacterCodes(ref.prompt || charPrompt),
                refSheetPrompt: finalRefSheet,
                status: 'pending'
            };
        });
        const prompts = (result.scenePrompts || []).map(p => _normalizeBatchPrompt(p));
        return { characterRefs: charRefs, prompts };
    }

    // ★ PRO 2.0: 배치 2+에서도 사용자 제공 refs 지속성 유지
    let preProvidedBlockCont = '';
    if (Array.isArray(userProvidedCharRefs) && userProvidedCharRefs.length > 0) {
        const fixedCodesStr = userProvidedCharRefs.map(r => r.code).join(', ');
        const styleAnchor = _deriveStyleAnchorFromUserRefs(userProvidedCharRefs);
        preProvidedBlockCont = `
═══ PRE-PROVIDED CHARACTERS (IDENTITY LOCKED — ACTIONS DYNAMIC) ═══
Codes ${fixedCodesStr} are FIXED by the user. EVERY scene in this batch must follow:

★ SPLIT THE LOCKED IDENTITY TEXT INTO TWO PARTS:
  PART A = STYLE/RENDERING TOKENS (common to all scenes, already in sceneDesc):
    e.g. "Rough hand-drawn marker illustration style, thick wobbly black ink outlines..."
    → DO NOT repeat inside {CharCode}(...). It's already in sceneDesc.

  PART B = CHARACTER IDENTITY TOKENS (per-character, goes INSIDE parentheses):
    • Name (e.g. "김하늘", "별이", "백구")
    • Species/breed (e.g. "Korean Jindo puppy" — NOT "Maltese")
    • Age/gender/build/hair/face/accessories/outfit/proportions/personality
    → ALL of these MUST appear inside {CharCode}(...) for every scene. NEVER omit.

★ EXAMPLE:
  ❌ WRONG: "MCR(Rough hand-drawn marker style... A middle-aged Korean woman, short
            permed hair, floral vest, purple pants)."
            → Style redundant + identity dropped (name/glasses/freckles/exact colors missing)

  ✅ CORRECT: "MCR(A chubby chibi Korean ajumma character named '김하늘', tight curly
              black permed hair with bouncy volume, thick round black horn-rimmed glasses,
              freckles scattered on nose and cheeks, bold red lipstick pout, rosy cheeks.
              Wearing grass-green knit cardigan with red rose floral pattern, white inner
              shirt, baggy wide cobalt-blue traditional Korean mompe pants, white rubber
              shoes. Short chibi 2.5-head proportions, playful humorous warm personality)."

★ VARY PER SCENE (dynamic — append after identity):
  pose, action, facial expression, gaze, location context, interactions

★ STRICTLY FORBIDDEN in charProps for ${fixedCodesStr}:
  - Copying style tokens into parens (already in sceneDesc)
  - "middle-aged Korean woman" / "small white dog" (generic — drops identity)
  - Wrong breed: "Maltese" instead of "Jindo"
  - Wrong colors: "purple pants" instead of "cobalt-blue mompe"
  - Missing name: must include "김하늘", "별이"
  - Missing accessories: dropping glasses, bandana, freckles, blush dots
  - Simplified proportions: "plump" alone — must include "chibi 2.5-head"

STYLE ANCHOR (maintain across all scenes, for sceneDesc): ${styleAnchor}

`;
    }

    const prompt = `You are a storyboard artist for Grok AI.
${continuationBlock}${preProvidedBlockCont}=== STEP 1: SCRIPT UNDERSTANDING (internal) ===
Read the FULL SCRIPT and this SEGMENT. Understand context and flow from previous batch.

=== FULL SCRIPT (for context) ===
${safeScript}

=== THIS SEGMENT: ${segmentLabels} ===
${distributionNote}

${segmentBlock}

=== STYLE (sceneDesc에 적용될 렌더링+환경 레이어) ===
${sceneStyle}${humanIdentityBlockSeg}${nonHumanNoteSeg}

=== ESTABLISHED CHARACTERS ===
    ${charRefContext}

=== OUTPUT FORMAT ===
Return ONLY a JSON array. No other text, no markdown.
[ { "number": "01", "characters": "MCR", "scriptText": "...", "sceneDesc": "...", "charProps": "...", "action": "...", "charActions": { "MCR": "MCR's action and expression" } } ]
characters: ONLY "MCR", "SC1", "SC2", "SC3", "SC4", "SC5" or combinations (max 6 total), or "" (empty for background/props). NEVER put charProps or character descriptions in characters.
scriptText: FIRST 14 chars of THIS scene's script (remove spaces/punctuation). Each scene MUST start at a LINE or SENTENCE BOUNDARY—scriptText must be the beginning of a line or sentence, NEVER from the middle of a word. Copy from script, NOT from character names.
charActions: split action per character; characters="" → {}
MANDATORY: sceneDesc="${sceneDescFormat}" | action="${actionFormat}"
${environmentRule}

=== RULES ===
1. Generate EXACTLY ${totalNumPrompts} prompts. Respect the section/part boundaries above. Each prompt = one scene/paragraph unit—place boundaries at LINE START or SENTENCE START (줄·문장의 시작). NEVER split mid-word or mid-sentence. Each scene MUST begin at the start of a new line or sentence.
2. Number from "01" sequentially within this segment. characters = codes only. scriptText = from script for THIS scene. CRITICAL: scriptText must NEVER begin from the middle of a word.
3. SCENE DIVERSITY (CRITICAL—vary shots, do NOT repeat face close-up only):
   - ★ MCR SCREEN-TIME CAP: MCR MUST appear in AT MOST 50% of the generated scenes (target 40~50%). When MCR is narrating in the script, SHOW WHAT MCR IS TALKING ABOUT instead of MCR's face — B-roll: location establishing shots, object close-ups (cookie, price tag, phone, money), other characters acting, visual metaphors (crowd, line, chart). NEVER place MCR in 3+ consecutive scenes — after 2 MCR scenes, the next MUST be non-MCR (characters:"" or SC-only).
   - ★ MACRO CLOSE-UP for PSYCHOLOGICAL/EMOTIONAL MOMENTS (STRICT — 25% of total scenes, minimum 20%):
     * Exactly 25% of scenes (e.g. 30 scenes → 7~8 scenes, 60 scenes → 15 scenes) MUST be MACRO close-ups — regardless of content category (drama/music/education/economy/vlog/cooking/sports).
     * Macro close-up = extreme tight framing on a SINGLE detail symbolizing emotion/tension/concept.
     * Categories (USE 3+ DIFFERENT types across output, do not repeat same subject):
       (a) Body-emotion: single eye/dilated pupil/trembling lip/tear welling/clenched fist/sweat drop/heartbeat pulse on neck/eyelash flutter/goosebumps
       (b) Micro-gesture: fingers gripping fabric or phone, nervous fingertip tapping, knuckle whitening, throat swallowing, pen tip touching paper, ring sliding
       (c) Object-symbol: price tag text, coin edge, watch second-hand, ring, currency weave, key teeth, button press, letter seal
       (d) Nature-detail: petal dewdrop, raindrop rolling, leaf vein, candle flame flicker, steam curl, snow crystal, water ripple
       (e) Genre-specific: chart line detail, cookie cross-section, food steam, screen pixels, book spine, tool edge, instrument string
     * USE WHEN: script expresses doubt, shock, realization, fear, regret, longing, greed, suppressed anger, inner conflict, decision moment, secret thought, emotional climax, key concept reveal, punchline.
     * Format: characters="{Code}" for body/gesture (identity lock), OR characters="" for object/nature/symbol macros.
       charProps="{Code}(extreme macro close-up of {body part}, {micro-action showing emotion}, {full identity description})" OR charProps="Extreme macro close-up of {object detail}."
     * Example A (body): characters="MCR", charProps="MCR(extreme macro close-up of single eye with glasses rim, pupil slightly dilated, faint tear welling at lower lid, ${nationality} female ...full identity...).", action="Pupil contracts slightly. Realization expression. Quiet emotional weight mood."
     * Example B (object): characters="", charProps="Extreme macro close-up of the '9,800' price tag text, ink fibers visible, slight paper grain.", action="Static focus on text detail. Financial shock mood."
     * Macro close-ups DO NOT count toward MCR screen-time cap above (they are interior/symbolic shots, not talking-head).
     * DO NOT repeat the same macro subject — vary categories (a)~(e).
   - MCR is NOT required every scene. Include: background-only, prop/object close-ups, body-part close-ups.
   - RECURRING non-human subjects (animal/plant/object appearing in 2+ scenes) MUST have character codes and use their code in characters field. Use characters="" ONLY for one-off backgrounds/props.
   - STORY-RELEVANT ONLY: Use body-part or prop close-ups ONLY when the script/narrative explicitly focuses on them (e.g. script mentions "휴지 in nostrils"→nostrils; "phone grabbed"→hands; "빈 차"→empty car interior). Do NOT insert arbitrary/meaningless close-ups for variety.
   - Background-only (characters:"", charProps:"Establishing shot of {place}."): one-off scenery, street, room, atmosphere—when script sets location/mood.
   - Prop/object close-up (characters:"", charProps:"Big close-up of {subject}."): one-off objects only (letter, glass, door, car interior, CCTV screen, etc.).
   - Body-part close-up: hands, feet, eyes—when script focuses on that action (gripping, writing, stepping, glancing).
   - Within every 10 scenes: at least THREE (30%) must be atmosphere-implying shots — big close-ups of body parts (eyes, hands, feet), objects, or scenery/establishing shots (characters:""). Do NOT use face close-up for all even-numbered scenes.
4. CAMERA: Odd numbers [01,03,05...]=Full shot. Even numbers [02,04,06...]=Close-up OR Macro close-up. Shot distribution target: Full shot ~50%, Face close-up ~25%, MACRO close-up (psychological) ~25%. Macro close-ups replace roughly half of the even-numbered close-up slots at moments of emotional/psychological intensity. Vary when script calls for it. NO consecutive full shots. Angles: eye level, low angle, bird's eye, Dutch angle, high angle, macro (cycle).
5. sceneDesc: MANDATORY—start with [${nationality} Context], include [no name labels], FULL style, time, place, light. Do NOT shorten style.
   ★ EXCEPTION — INTENTIONAL TEXT/TYPOGRAPHY SCENES:
     When the scene intentionally features readable text (numbers, years, currency, names,
     product names, chart labels, documents), REPLACE [no name labels] with
     [text allowed: <specific text content>].
     Examples: [text allowed: '9,800원'], [text allowed: '1899'],
               [text allowed: 'Thorstein Veblen'], [text allowed: 'Galaxy S25'],
               [text allowed: chart labels and numbers]
     Default scenes (character shots, scenery) keep [no name labels] as is.
6. action: MANDATORY—{action}. {expression}. {mood}.
7. LANGUAGE (CRITICAL—AI image models require English): sceneDesc, charProps, action MUST be 100% English. NO Korean, no 한글. scriptText keeps original language. Translate time/place/atmosphere: 새벽→dawn, 주택가 골목→residential alley, 가로등 불빛→streetlight glow, 어둡고 을씨년스러운→dark dreary, 조용한→quiet, 밤→night.
8. FORMAT: Single space between words. NO blank lines inside sceneDesc, charProps, or action.
9. charProps (CRITICAL — NO ABBREVIATION): When characters="" use "Establishing shot of {place}." or "Big close-up of {subject}." (no character in frame). Do NOT write "Empty" in charProps—it is internal; output only the shot description. When characters present: Format "${charPropsTemplate}". Body-part close-up: "MCR(extreme close-up of {hands/face/eyes/feet}, {action/expression})". PATTERN and COLOR MANDATORY when characters present. EVERY PROMPT must repeat the FULL character description inside charProps — gender, age, hair, outfit with color and pattern. NEVER use "(...)" or abbreviate. AI image generators have NO memory of previous prompts, so each charProps must be SELF-CONTAINED and COMPLETE.
10. charActions: Split action per character. characters="" → {}. Always object. English only.
${stickRules}
${scriptContextRules}
${joseonRules}
11. SKIP: Do NOT generate prompts for: title cards ("A title card appears", "Title card for", N단계 markers), part/phase dividers (1부완료, 2부 등), production notes (Display...), structural markers, lines in [...] brackets (e.g. [Intro], [Verse], [Chorus], [Bridge], [Outro]), lines in (...) parentheses (e.g. (instrumental...), (fade out...)), vocal fillers (um um um, la la la). Distinguish meta-text from real narrative. Generate ONLY for actual narrative/lyric lines (character action, dialogue, setting, emotion).
12. PROHIBITED: CRITICAL—Any Korean/한글. Word "Empty" in charProps. Arbitrary/meaningless body-part or prop close-ups (use only when script focuses on them). Same angle consecutively. Shortening or abbreviating charProps with "(...)" or "same as before".
${userDirections ? `\n=== ★ USER DIRECTIONS (HIGHEST PRIORITY — override all other rules if conflicting) ===\nThe user's special directions below MUST be reflected in EVERY generated prompt as the top priority.\n${userDirections}` : ''}

=== GENERATE ${totalNumPrompts} IMAGE PROMPTS AS JSON ARRAY ===`;

    const maxTokens = Math.min(65536, 1000 * totalNumPrompts + 2000);
    const data = await _geminiApiCall(apiKey, prompt, maxTokens);
    const rawText = data.candidates[0].content.parts[0].text;
    const prompts = _parseBatchPrompts(rawText);
    return { prompts };
}

// ═══════════════════════════════════════════
// Phase 2: 배치 프롬프트 생성 — 확정된 씬 목록 기반 (폴백용)
// ═══════════════════════════════════════════
async function _callBatchPromptGeneration(script, batchScenes, characterRefs, apiKey, stylePrompt, nationality, styleId, userDirections, maxTokens = 16384, previousBatchPrompts = null, previousBatchSummary = null, phase0SceneMap = null, splitMode = null, customStyle = '') {
    const isStickMan = styleId === '27';
    const isStickWoman = styleId === '28';
    const isStickFigure = isStickMan || isStickWoman;

    // ★ v1.5: 2-레이어 스타일 해석 — 데이터 분리(코드) + 의미 분리(Gemini 자율) 이중 방어
    const styleLayers = getStyleLayers(styleId, customStyle);
    const sceneStyle = styleLayers.rendering;  // sceneDesc 전용 (환경/렌더링만)
    const humanIdentityBlock = styleLayers.humanIdentity
        ? `\n\n=== HUMAN IDENTITY LAYER (apply ONLY to Human-type characters) ===
${styleLayers.humanIdentity}`
        : '';

    // ★ 비인물 MCR 존재 여부 감지 (지침 강조용)
    const hasNonHumanChar = Array.isArray(characterRefs) && characterRefs.some(r => {
        if (!r) return false;
        const text = r.description || r.prompt || r.refSheetPrompt || '';
        return _detectNonHumanMCR(text);
    });

    // ★ v1.5+: 자율 인식 지침 — Gemini가 데이터 분리 누락/오염도 의미론적으로 보정
    const nonHumanNote = `\n\n⚡ AUTONOMOUS STYLE-LAYER ENFORCEMENT (CRITICAL — read carefully):

A. 2-LAYER SEMANTIC CLASSIFICATION (your judgment):
The STYLE section above may have been pre-split into rendering vs humanIdentity, but you MUST
semantically re-classify each token yourself. Any token describing the following belongs to
HUMAN-IDENTITY layer (even if it appears in the STYLE/rendering section):
  • Clothing/garments: Hanbok, Hanfu, Qipao/Cheongsam, Kimono, Sari, Sherwani, Thobe, Bisht,
    Chima-jeogori, Durumagi, Haori, Hakama, bonnet, cowboy vest, sheriff badge, etc.
  • Head/hair accessories: Gat, Sangtu/topknot, Binyeo, Jjokmeori, Daenggi, turban, hijab,
    headband, hairpin, ornate crown, feathered headdress, cowboy hat, etc.
  • Facial/body details tied to humans: Bindi dot, monolid eyes, beard, jewelry/bangles,
    skin-tone qualifiers for characters, "for male/female/nobility" qualifiers
  • Any phrase that implies a person wearing/having something

All OTHER tokens belong to ENVIRONMENT/RENDERING layer:
  • Era, dynasty, historical period name (Joseon, Edo, Qing, Mughal, frontier, cyberpunk)
  • Architecture, landscape, setting (Hanok, temple, palace, desert, urban street)
  • Lighting, color palette, rendering technique, aesthetic descriptors
  • Camera/photographic qualifiers (cinematic, hyper-realistic, watercolor, ukiyo-e)

B. LAYER APPLICATION RULES:
  • sceneDesc: Use ONLY environment/rendering tokens. NEVER include human-identity tokens,
    even if you can infer them from the period setting. If you see "Joseon Dynasty" in the
    STYLE, do NOT add "Hanbok" to sceneDesc from your own historical knowledge.
  • charProps (Human MCR/SC): Apply relevant humanIdentity tokens per character (age/gender
    appropriate). Use your cultural/period knowledge for accuracy within charProps.
  • charProps (Non-human MCR/SC — Flower/Animal/Nature/Object/Abstract): Describe in natural
    form only. NEVER human clothing/hair/body parts. Never "in Hanbok form" or similar.

C. COMMON PITFALLS TO AVOID:
  ❌ "sceneDesc: Joseon Dynasty. Hanbok. Temple." → Hanbok doesn't belong in sceneDesc
  ❌ "charProps: MCR(Flower wearing traditional Hanbok)" → flowers don't wear clothes
  ❌ "sceneDesc: Joseon Dynasty." + adding Hanbok to MCR flower's charProps from knowledge
  ✅ "sceneDesc: Joseon Dynasty. Authentic period details. Dawn. Temple eaves."
     "charProps: MCR(Flower: mystical bloom with white petals and crimson tips)"
  ✅ "sceneDesc: Joseon Dynasty. Temple courtyard."
     "charProps: SC1(Korean female, Jjokmeori bun with Binyeo, pale blue Hanbok)"
     — SC1 is Human, so Hanbok appears in SC1's charProps only

D. MCR TYPE DETECTION PRIORITY:
Step 1 — Check characterRefs description prefix: MCR(Human:...), MCR(Flower:...),
         MCR(Animal:...), MCR(Nature:...), MCR(Object:...), MCR(Abstract:...)
Step 2 — If prefix missing, infer from description content.
Step 3 — If still ambiguous, default to Human.
${hasNonHumanChar ? `
NOTE: Phase 0 confirmed non-human MCR exists. Be especially careful not to leak human tokens
into MCR charProps or sceneDesc.` : ''}`;

    const charPropsTemplate = isStickFigure
        ? `{CharCode} is a 2D stick figure ${isStickWoman ? 'woman' : 'man'} (simple white round head, thin black line body${isStickWoman ? ', pastel accessories like ribbon/bow' : ''}) in humorous 2D illustration style, wearing {color} ${isStickWoman ? 'pastel ' : ''}outfit.`
        : `{CharCode}(${nationality} {gender}, {age}yo, {build}, {hair length/color/style}, wearing {color} {pattern} {outfit}, {accessories/glasses}).`;

    // ★ PRO 2.0: 사용자 제공 refs는 description이 아닌 FULL prompt를 컨텍스트에 주입
    const charRefContext = characterRefs.map(r => {
        const isUserProvided = r.userProvided || r._userProvided;
        if (isUserProvided) {
            const fullText = r.prompt || r.refSheetPrompt || r.description || r.name;
            return `${r.code} [LOCKED IDENTITY — copy VERBATIM into charProps]: ${fullText}`;
        }
        return `${r.code}: ${r.description || r.name}`;
    }).join('\n    ');

    const sceneListJson = JSON.stringify(batchScenes.map(s => ({
        number: s.number,
        characters: s.characters,
        scriptText: s.scriptText
    })), null, 2);

    const stickRules = isStickFigure ? `
STICK FIGURE RULES:
- charProps MUST include: "2D stick figure ${isStickWoman ? 'woman' : 'man'}" 
- charProps MUST include: "(simple white round head, thin black line body)"
- PATTERN and COLOR are MANDATORY: MCR=blue, SC1=purple, SC2=green; pattern (e.g. solid, pastel). Same color+pattern = same character.` : '';

    const scriptContextRules = !isStickFigure ? `
SCRIPT CONTEXT & HISTORICAL ACCURACY:
- charProps: Base character appearance (outfit, accessories, headgear) on SCRIPT CONTEXT. Each scene/situation determines what characters wear.
- Historical settings (Joseon, Japanese imperial era, etc.): Use PERIOD-ACCURATE accessories and costumes. Apply your knowledge: Joseon (Hanbok, gat, armor, helmets); Japanese imperial era (period-appropriate attire). Research and reflect era-appropriate details.` : '';

    const isJoseon = styleId === '2' || styleId === '6';
    const joseonRules = isJoseon ? `
JOSEON-SPECIFIC:
- sceneDesc: Do NOT put outfit/costume/accessory details here. Only [Context], shot, angle, [no text...], FULL style, time, place, light.` : '';

    const safeScriptForPhase2 = script.replace(/\\/g, '\\\\').replace(/"/g, "'").replace(/\t/g, ' ');
    const firstSceneNum = batchScenes[0]?.number || '01';
    const lastPromptCharProps = (previousBatchPrompts && previousBatchPrompts.length > 0) ? (previousBatchPrompts[previousBatchPrompts.length - 1].charProps || '') : '';
    const summaryLine = previousBatchSummary
        ? `Previous batch generated scenes [${previousBatchSummary.first}]-[${previousBatchSummary.last}] (${previousBatchSummary.count} prompts) — script coverage: up to scene ${previousBatchSummary.last}.`
        : '';
    const singlePassNote = `Generate as if ALL scenes were written in ONE continuous pass. No tonal shift between batches. Treat this as a single storyboard.`;
    const continuationBlock = (previousBatchPrompts && previousBatchPrompts.length > 0) ? `
=== CONTINUATION CONTEXT (maintain tone and consistency — scenes from previous batch) ===
${summaryLine}
${singlePassNote}
Scene [${firstSceneNum}] must flow naturally from the last scene below. Use these character descriptions in charProps only (NEVER in the characters field). characters = simple codes like "MCR", "SC1" only.

Last ${previousBatchPrompts.length} prompts from previous batch:
${previousBatchPrompts.map(p => `[${p.number}] ${p.characters || 'MCR'} | scriptText: ${p.scriptText || ''}
sceneDesc: ${p.sceneDesc || ''}
charProps: ${p.charProps || ''}
action: ${p.action || ''}`).join('\n---\n')}

` : '';
    // ★ PRO 2.0: Phase 0 씬 지도 블록 (신규 분할 모드에서만 전달)
    let phase0MapBlock = '';
    if (Array.isArray(phase0SceneMap) && phase0SceneMap.length > 0) {
        const mapLines = phase0SceneMap.map(s => {
            const num = s.number || '?';
            const chars = s.characters || 'BG';
            const start = s.scriptText || s.scriptStart || '';
            return `[${num}] ${chars} | ${start}`;
        }).join('\n');
        const firstNum = batchScenes[0]?.number || '?';
        const lastNum = batchScenes[batchScenes.length - 1]?.number || '?';
        phase0MapBlock = `
=== PHASE 0 SCENE DIVISION MAP (split mode: ${splitMode || 'n/a'} — DO NOT REDEFINE) ===
Total scenes decided in Phase 0: ${phase0SceneMap.length}
Pre-decided scene boundaries (index | characters | scriptStart):
${mapLines}

CRITICAL: Use these EXACT scene boundaries and scriptStart values.
Do NOT merge, split, or reorder scenes. Do NOT assign different scene numbers.
Your job in this batch is ONLY to fill in sceneDesc + charProps + action + charActions for each scene.
This batch covers scenes [${firstNum}]-[${lastNum}] from the map above.

`;
    }

    // ★ PRO 2.0: 사용자 제공 캐릭터 LOCKED IDENTITY 블록
    //   정책: 스타일 토큰은 sceneDesc에 1회만 (공통), charProps 괄호 안은 캐릭터 정체성 전용
    //   Gemini가 혼동하지 않도록 WRONG/CORRECT 예시로 명확히 지시
    let preProvidedBlockCont = '';
    const userProvidedInRefs = (characterRefs || []).filter(r => r.userProvided || r._userProvided);
    if (userProvidedInRefs.length > 0) {
        const fixedCodesStr = userProvidedInRefs.map(r => r.code).join(', ');
        preProvidedBlockCont = `
═══ PRE-PROVIDED CHARACTERS (IDENTITY LOCKED — ACTIONS DYNAMIC) ═══
Codes ${fixedCodesStr} are FIXED by the user. EVERY scene in this batch must follow:

★ SPLIT THE LOCKED IDENTITY TEXT INTO TWO PARTS:
  PART A = STYLE/RENDERING TOKENS (common to all scenes, already in sceneDesc):
    e.g. "Rough hand-drawn marker illustration style, thick wobbly black ink outlines,
          imperfect scratchy lines, flat bold colors with slight marker bleed, cream
          off-white paper background, casual doodle sketchbook aesthetic (Amy Slaton vibe)"
    → DO NOT repeat inside {CharCode}(...). It's already in sceneDesc.

  PART B = CHARACTER IDENTITY TOKENS (per-character, goes INSIDE parentheses):
    • Name (e.g. "김하늘", "별이", "백구")
    • Species/breed (e.g. "Korean Jindo puppy" — NOT "Maltese" or generic "dog")
    • Age/gender/build (e.g. "chibi 2-year-old", "chubby chibi Korean ajumma")
    • Hair — length + color + style (e.g. "tight curly black permed hair, bouncy volume")
    • Face details — freckles, blush dots, lipstick, eye features
    • Accessories — glasses frame, bandana pattern, ribbons, necklace
    • Outfit — EXACT colors + patterns (e.g. "grass-green knit cardigan with red rose
      floral pattern, white inner shirt, cobalt-blue mompe pants")
    • Proportions (e.g. "chibi 2.5-head", "super chibi 2-head", "pear-shaped body")
    • Personality (e.g. "playful humorous warm", "loyal and adorable")
    → ALL of these MUST appear inside {CharCode}(...) for every scene. NEVER omit.

★ EXAMPLE (Gemini must follow this pattern exactly):

  sceneDesc: "[Korean Context] Full shot, Eye level. [no name labels]. Rough hand-drawn
  marker illustration style, thick wobbly black ink outlines, imperfect scratchy lines,
  flat bold colors with slight marker bleed, cream off-white paper background, casual
  doodle sketchbook aesthetic (Amy Slaton Instagram cartoonist vibe). Day. Hongdae
  street. Bright sunlight."

  ❌ WRONG charProps (redundant style + dropped identity):
  "MCR(Rough hand-drawn marker illustration style, thick wobbly black ink outlines,
   imperfect scratchy lines, flat bold colors... A middle-aged Korean woman, short
   permed black hair, floral vest, purple pants, red necklace)."
   → Copies style (redundant) + drops name/glasses/freckles/exact colors/proportions.

  ✅ CORRECT charProps (identity only, VERBATIM from LOCKED IDENTITY):
  "MCR(A chubby chibi Korean ajumma character named '김하늘', tight curly black permed
   hair with bouncy volume, thick round black horn-rimmed glasses, cute freckles
   scattered on nose and cheeks, bold red lipstick pout, rosy chubby cheeks, small
   confident smile. Wearing grass-green knit cardigan covered in red rose floral pattern,
   white inner shirt peeking at neckline, baggy wide cobalt-blue traditional Korean mompe
   pants, white rubber shoes. Short chibi 2.5-head proportions, slightly pear-shaped
   body, playful humorous warm personality)."

★ VARY PER SCENE (dynamic — append after identity):
  pose, action, facial expression, gaze, location context — add AFTER identity tokens,
  e.g. "...playful humorous warm personality, standing with hands on hips, pointing
  excitedly at a long queue)."

★ STRICTLY FORBIDDEN in charProps for ${fixedCodesStr}:
  - Copying style tokens (already in sceneDesc — redundant)
  - "middle-aged Korean woman" / "small white dog" (generic — drops identity)
  - Wrong breed: "Maltese" instead of "Jindo" → NEVER change species
  - Wrong colors: "purple pants" instead of "cobalt-blue mompe" → EXACT colors only
  - Missing name: must include "김하늘", "별이" etc.
  - Missing accessories: dropping glasses, bandana, freckles, blush dots
  - Simplified proportions: "plump" alone is not enough — must include "chibi 2.5-head"

`;
    }

    const prompt = `You are a storyboard artist for Grok AI.
${continuationBlock}${preProvidedBlockCont}${phase0MapBlock}=== STEP 1: SCRIPT UNDERSTANDING (internal) ===
Read the FULL SCRIPT below and understand: plot, setting, character roles, emotional arc, key props/locations. Use this understanding to generate consistent, detailed prompts that reflect each scene's true context.

=== FULL SCRIPT (for context) ===
${safeScriptForPhase2}

=== STYLE (sceneDesc에 적용될 렌더링+환경 레이어) ===
${sceneStyle}${humanIdentityBlock}${nonHumanNote}

=== ESTABLISHED CHARACTERS ===
    ${charRefContext}

=== PRE-ASSIGNED SCENES (current batch) ===
${sceneListJson}

=== OUTPUT FORMAT ===
Return ONLY a JSON array. No other text, no markdown.
[
  {
    "number": "01",
    "characters": "MCR",
    "scriptText": "copy from input AS-IS",
    "sceneDesc": "[${nationality} Context] {Shot}, {Angle}. [no name labels]. {environment/rendering tokens from STYLE — exclude ANY clothing/hair/human-identity tokens even if they appear in STYLE text}. {time}. {place}. {light}.",
    "charProps": "${charPropsTemplate}",
    "action": "{action}. {expression}. {mood}.",
    "charActions": { "MCR": "MCR's action and expression" }
  }
]
charActions: split action per character; characters="" → {}

═══ EXAMPLES — charProps MUST repeat ALL identity tokens every time ═══
HUMAN: "MCR(${nationality === 'Korean' ? 'Korean' : nationality} female, 25yo, slim, long straight black hair with side-swept bangs, wearing burgundy plaid blazer over cream inner blouse and dark navy pencil skirt, thin round gold-frame glasses, small pearl earrings). SC1(${nationality === 'Korean' ? 'Korean' : nationality} male, 35yo, heavyset, short cropped grey hair, wearing charcoal checked hoodie over light-gray inner t-shirt and dark cargo pants, no glasses, silver chain bracelet)."
ANIMAL: "MCR(golden retriever, large, golden fur, floppy ears, brown eyes, red tartan bandana collar, bushy tail)."
BACKGROUND: "Establishing shot of calm pre-dawn ocean."
═══ NEVER abbreviate as "MCR(...)" or "same as before". ALL tokens: build, hair, outfit (color+pattern+type+inner), accessories/glasses. ═══

=== RULES ===
1. Generate EXACTLY ${batchScenes.length} prompts matching the scene list above
2. Copy number, characters, scriptText from each scene AS-IS (do NOT modify scriptText)
3. SCENE DIVERSITY (atmosphere, foreshadowing, tension, psychology): MCR is NOT required in every scene. Include background-only and prop/object close-ups — CRITICAL for dramatic impact:
   - RECURRING non-human subjects (animal/plant/object in 2+ scenes) MUST use their assigned character code. Use characters="" ONLY for one-off backgrounds/props.
   - STORY-RELEVANT ONLY: Use body-part or prop close-ups ONLY when the script explicitly focuses on them. Do NOT insert arbitrary/meaningless close-ups for variety.
   - Background-only (characters:"", charProps:"Establishing shot of {place}.") — one-off scenery, when script sets location/mood (e.g. dark alley at midnight, peaceful morning)
   - Prop/object big close-up (characters:"", charProps:"Big close-up of {subject}.") — one-off objects only (letter, candle, car interior, CCTV, etc.)
   - Body-part big close-up — hands/feet/eyes when script focuses on that action (gripping phone, writing, stepping). Face/expression for psychology.
   - ★ MACRO CLOSE-UP for PSYCHOLOGICAL/EMOTIONAL MOMENTS (STRICT — 25% of total scenes, minimum 20%):
     * Exactly 25% of scenes (e.g. 20 scenes → 5 scenes, 60 scenes → 15 scenes) MUST be MACRO close-ups — regardless of content category (drama/music/education/economy/vlog/cooking/sports).
     * Macro close-up = extreme tight framing on a SINGLE detail symbolizing emotion/tension/concept.
     * Categories (USE 3+ DIFFERENT types across output, do not repeat same subject):
       (a) Body-emotion: single eye/dilated pupil/trembling lip/tear welling/clenched fist/sweat drop/heartbeat pulse on neck/eyelash flutter/goosebumps
       (b) Micro-gesture: fingers gripping fabric or phone, nervous fingertip tapping, knuckle whitening, throat swallowing, pen tip touching paper, ring sliding
       (c) Object-symbol: price tag text, coin edge, watch second-hand, ring, currency weave, key teeth, button press, letter seal
       (d) Nature-detail: petal dewdrop, raindrop rolling, leaf vein, candle flame flicker, steam curl, snow crystal, water ripple
       (e) Genre-specific: chart line detail, cookie cross-section, food steam, screen pixels, book spine, tool edge, instrument string
     * USE WHEN: script expresses doubt, shock, realization, fear, regret, longing, greed, suppressed anger, inner conflict, decision moment, secret thought, emotional climax, key concept reveal, punchline.
     * Format: characters="{Code}" for body/gesture (identity lock), OR characters="" for object/nature/symbol macros.
       charProps="{Code}(extreme macro close-up of {body part}, {micro-action showing emotion}, {full identity description})" OR charProps="Extreme macro close-up of {object detail}."
     * Example A (body): characters="MCR", charProps="MCR(extreme macro close-up of single eye with glasses rim, pupil slightly dilated, faint tear welling at lower lid, ${nationality} female ...full identity...).", action="Pupil contracts slightly. Realization expression. Quiet emotional weight mood."
     * Example B (object): characters="", charProps="Extreme macro close-up of the '9,800' price tag text, ink fibers visible, slight paper grain.", action="Static focus on text detail. Financial shock mood."
     * DO NOT repeat the same macro subject — vary categories (a)~(e).
   - Use MCR only when the scene focuses on the main character. For tension/atmosphere, lean on background, props, and detail shots.
4. LANGUAGE (CRITICAL): sceneDesc, charProps, action MUST be 100% English. NO Korean, no 한글. scriptText keeps original. Translate: 새벽→dawn, 주택가 골목→residential alley, 가로등 불빛→streetlight glow, 어둡고 을씨년스러운→dark dreary, 분위기→atmosphere
5. CAMERA (CRITICAL — no consecutive full shots):
   - ALTERNATE: Full shot → Close-up → Full shot → Close-up. Full shot and Full shot must NEVER be consecutive (causes jarring cut).
   - Shot distribution TARGET: Full shot ~45%, Face/Character Close-up ~30%, MACRO Close-up (psychological/symbolic) ~25%.
   - Macro close-ups fit especially into even-numbered slots at emotional/psychological intensity moments. Plain "Close-up" alone is NOT enough.
   - Within every 10 scenes: at least TWO (20%) must be MACRO close-ups (categories a~e above) — not just regular Big close-ups.
   - Angles: eye level→low→bird's eye→Dutch→high→macro (cycle)
6. sceneDesc: Start with [${nationality} Context], shot, angle, [no text...], FULL style description (use complete style prompt — DO NOT shorten), time/place/light. For Joseon styles do NOT duplicate outfit/costume in sceneDesc — those go in charProps only.
7. charProps (CRITICAL — FULL IDENTITY EVERY TIME): When characters="" use "Establishing shot of {place}." or "Big close-up of {subject}." For body-part: "MCR(extreme close-up of {hands/face/eyes/feet}, {action/expression})".
   When characters present: EVERY prompt MUST repeat ALL identity tokens in charProps — (1) gender+age, (2) body build, (3) hair: length+color+style, (4) outfit: color+pattern+type+inner layer, (5) ALL accessories: glasses with frame shape or "no glasses", earrings/hat/bag/etc. Format: "${charPropsTemplate}". NEVER abbreviate as "MCR(...)" or "same as before". plain/solid/무지 FORBIDDEN (except stick-figure styles where solid color is allowed).
   For NON-HUMAN coded characters: repeat full identity (species, color, size, features) in EVERY prompt. E.g. "MCR(golden retriever, large, golden fur, floppy ears, red bandana collar)."
8. Keep character appearances CONSISTENT with characterRefs — charProps identity tokens MUST be IDENTICAL to characterRef description
9. charActions: Split action per character. characters="" → {}. Always object. English only.
${stickRules}
${scriptContextRules}
${joseonRules}
10. PROHIBITED: CRITICAL—Korean/한글 in sceneDesc/charProps/action. Word "Empty" in charProps. Color temperature. Changing appearance. Same angle consecutively. Shortening style. Instruction-like text.
${userDirections ? `\n=== ★ USER DIRECTIONS (HIGHEST PRIORITY — override all other rules if conflicting) ===\nThe user's special directions below MUST be reflected in EVERY generated prompt as the top priority. If written in non-English, translate the intent to English before applying.\n${userDirections}` : ''}

=== GENERATE ${batchScenes.length} IMAGE PROMPTS AS JSON ARRAY ===`;

    const data = await _geminiApiCall(apiKey, prompt, maxTokens);
    const rawText = data.candidates[0].content.parts[0].text;

    return _parseBatchPrompts(rawText);
}

function _parseBatchPrompts(text) {
    let cleanText = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();

    // 1차: 정상 JSON 배열 파싱
    try {
        const startIdx = cleanText.indexOf('[');
        const endIdx = cleanText.lastIndexOf(']');
        if (startIdx !== -1 && endIdx > startIdx) {
            const arr = JSON.parse(cleanText.substring(startIdx, endIdx + 1));
            return arr.map(_normalizeBatchPrompt);
        }
    } catch (e) {
    }

    // 2차: 잘린 JSON 복구 — ']' 누락 시 마지막 완전한 '}' 이후를 잘라내고 ']' 추가
    try {
        const startIdx = cleanText.indexOf('[');
        if (startIdx !== -1) {
            let truncated = cleanText.substring(startIdx);
            const lastBrace = truncated.lastIndexOf('}');
            if (lastBrace > 0) {
                truncated = truncated.substring(0, lastBrace + 1).replace(/,\s*$/, '') + ']';
                const arr = JSON.parse(truncated);
                return arr.map(_normalizeBatchPrompt);
            }
        }
    } catch (e) {
    }

    return [];
}

function _normalizeBatchPrompt(p) {
    const st = cleanScriptText(p.scriptText);
    // Strip "Empty. " from charProps—it's a meta-tag, must not appear in final image prompt
    const charPropsRaw = (p.charProps || '').replace(/\s+/g, ' ').trim().replace(/^Empty\.\s*/i, '');
    const raw = `${p.sceneDesc || ''} ${charPropsRaw} ${p.action || ''}`.trim().replace(/\s+/g, ' ');
    // characters must be simple codes only; if model put charProps there, extract codes or default
    let chars = p.characters === '' ? '' : (p.characters || 'MCR');
    if (chars.length > 25 || /\(\s*Korean|wearing|yo\s*\)/i.test(chars)) {
        const m = chars.match(/\b(SC\d|MCR)\b/g);
        chars = m && m.length ? m.join(',') : 'MCR';
    }
    const charActions = p.charActions && typeof p.charActions === 'object' && !Array.isArray(p.charActions) ? p.charActions : {};
    return {
        number: String(p.number || '01').padStart(2, '0'),
        characters: chars,
        scriptText: st,
        sceneDesc: (p.sceneDesc || '').replace(/\s+/g, ' ').trim(),
        charProps: charPropsRaw,
        action: (p.action || '').replace(/\s+/g, ' ').trim(),
        charActions,
        prompt: convertCharacterCodes(raw)
    };
}

// ═══════════════════════════════════════════
// 공통 Gemini API 호출
// ═══════════════════════════════════════════
async function _geminiApiCall(apiKey, prompt, maxOutputTokens = 16384) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 900000);

    let response;
    try {
        response = await fetch(`${GEMINI_API_BASE}/${_activeGeminiModel}:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
            signal: controller.signal,
        body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
                temperature: 0.7,
                    maxOutputTokens,
                topP: 0.95,
                topK: 40
            }
        })
    });
    } catch (e) {
        clearTimeout(timeout);
        if (e.name === 'AbortError') {
            throw new Error('Gemini API 응답 시간 초과 (15분). 대본이 길면 나눠서 시도해보세요.');
        }
        const msg = (e?.message || '').toLowerCase();
        if (msg.includes('failed to fetch') || msg.includes('network') || msg.includes('load failed')) {
            throw new Error('네트워크 오류. 연결을 확인한 뒤 다시 시도해주세요.');
        }
        throw e;
    }
    clearTimeout(timeout);

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const apiMsg = (errorData.error?.message || '').toLowerCase();
        if (response.status === 429) {
            // ★ 429 세분화 — "일일 쿼터 소진" vs "분당 레이트리밋"은 서로 다른 상황
            //   Gemini API 에러 payload의 quotaId 확인:
            //     - PerDay / PerMonth → 실제 쿼터 소진 (키 교체 or 다음날 대기 필요)
            //     - PerMinute / PerHour → 레이트리밋 (수 초 ~ 수 분 대기로 해소)
            //   구분 안 하면 일시 오류를 "키 소진"으로 오탐 → 유저에게 불필요한 키 교체 유도
            const violations = errorData.error?.details?.find(d =>
                d['@type']?.includes('QuotaFailure'))?.violations || [];
            const quotaIds = violations.map(v => String(v.quotaId || '')).join(' ');
            const rawMsg = String(errorData.error?.message || '');
            const isRateLimit = /PerMinute|PerHour|per minute|per hour|rate.*limit/i.test(quotaIds + ' ' + rawMsg);
            const isActualQuota = /PerDay|PerMonth|per day|per month|daily.*quota|daily.*limit/i.test(quotaIds + ' ' + rawMsg);

            if (isRateLimit && !isActualQuota) {
                // 일시적 레이트리밋 — 재시도 유도 (상위 _is429Error에서 처리)
                throw new Error('429_RATE_LIMIT: Gemini API 분당 레이트리밋. 잠시 후 다시 시도해주세요.');
            }
            // quotaId 없거나 PerDay 명시 → 실제 쿼터 소진으로 판정 (보수적 기본값: 소진)
            throw new Error('Gemini API 무료 사용량이 초과되었습니다. 한국시간 오후 5시에 초기화됩니다.');
        }
        if (response.status === 503 || response.status === 500 || response.status === 502 || response.status === 504) {
            // ★ 5xx 서버 에러 — 일시적 과부하. 쿼터 소진 아님
            throw new Error(`429_SERVER_BUSY: Gemini 서버 일시 과부하 (${response.status}). 잠시 후 재시도.`);
        }
        if (response.status === 400 && /token|context|limit|exceeded|resource|invalid/i.test(apiMsg)) {
            throw new Error('토큰 한도 초과. 대본 길이를 줄이거나 프롬프트 수를 낮춰 보세요.');
        }
        throw new Error(`Gemini API error: ${response.status} - ${errorData.error?.message || 'Unknown error'}`);
    }

    const data = await response.json();

    const candidate = data.candidates?.[0];
    const responseText = candidate?.content?.parts?.[0]?.text;
    if (!responseText) {
        const reason = candidate?.finishReason || 'UNKNOWN';
        if (reason === 'SAFETY') {
            throw new Error('대본 내용이 안전 필터에 걸렸습니다. 대본을 수정해주세요.');
        }
        throw new Error(`Invalid response from Gemini API (finishReason: ${reason})`);
    }

    // ★ MAX_TOKENS 감지 — Gemini가 출력 토큰 한도에 도달해 응답을 잘랐음
    //   이 경우 JSON이 미완료 → 후속 파서에서 파싱 실패 or 부분 데이터만 복원
    //   기존엔 조용히 통과 → 유저는 "왜 씬이 부족하지?" 영문도 모름
    //   이제는 콘솔 경고 + usageMetadata 로깅으로 디버깅 가능하게 함
    if (candidate?.finishReason === 'MAX_TOKENS') {
        const usage = data.usageMetadata || {};
        console.log('[GEMINI] ⚠️ MAX_TOKENS truncation detected — response incomplete', {
            promptTokens: usage.promptTokenCount,
            outputTokens: usage.candidatesTokenCount,
            totalTokens: usage.totalTokenCount,
            maxOutputTokens,
            model: _activeGeminiModel,
            hint: 'Reduce numPrompts or split script, or switch to a model with higher output cap'
        });
    }

    return data;
}

// ═══════════════════════════════════════════
// 단일 호출 (30개 이하) — 기존 V5 로직 그대로
// ═══════════════════════════════════════════
async function _callGeminiSingle(script, numPrompts, apiKey, stylePrompt, nationality, styleId, userDirections, userProvidedCharRefs = null, customStyle = '') {
    const systemPrompt = buildSystemPromptV5(script, numPrompts, stylePrompt, nationality, styleId, userDirections, userProvidedCharRefs, customStyle);

    const data = await _geminiApiCall(apiKey, systemPrompt, 16384);
    const rawText = data.candidates[0].content.parts[0].text;


    const result = _sanitizeCharacterCodes(parseGeminiResponseV5(rawText));

    // ★ PRO 2.0: 사용자 제공 캐릭터 병합 (하이브리드)
    if (Array.isArray(userProvidedCharRefs) && userProvidedCharRefs.length > 0) {
        const userCodes = new Set(userProvidedCharRefs.map(r => r.code));
        const aiOnly = (result.characterRefs || []).filter(r => !userCodes.has(r.code));
        result.characterRefs = [...userProvidedCharRefs, ...aiOnly];
    }

    const isStickFigure = styleId === '27' || styleId === '28';

    // 씬 프롬프트에서 의상 힌트 추출 → refSheetPrompt 동기화용
    const appearanceHints = _extractAppearanceHintsFromScenePrompts(result.scenePrompts || []);

    const prompts = result.scenePrompts.map(p => ({
        ...p,
        prompt: convertCharacterCodes(p.prompt)
    }));

    const characterRefs = (result.characterRefs || []).map(ref => ({
        ...ref,
        prompt: convertCharacterCodes(ref.prompt),
        refSheetPrompt: isStickFigure
            ? convertCharacterCodes(_finalizeRefSheetPrompt(ref.refSheetPrompt || '', appearanceHints))
            : _finalizeRefSheetPrompt(ref.refSheetPrompt || '', appearanceHints)
    }));

    return { characterRefs, prompts };
}

/**
 * Convert character codes to descriptive phrases
 * MCR/SC1~SC5 -> "The Nth character" (max 6)
 * Only for stick figure styles to prevent text rendering in image
 */
function convertCharacterCodes(text) {
    if (!text) return text;

    return text
        .replace(/\bMCR\b/g, 'The main character')
        .replace(/\bSC1\b/g, 'The second character')
        .replace(/\bSC2\b/g, 'The third character')
        .replace(/\bSC3\b/g, 'The fourth character')
        .replace(/\bSC4\b/g, 'The fifth character')
        .replace(/\bSC5\b/g, 'The sixth character');
}

/**
 * V4.0.5 System Prompt - JSON Output Format
 * Updated: JSON output for reliable parsing
 * Updated: Stick figure character rules for Style 7, 8
 */
function buildSystemPromptV4(script, numPrompts, stylePrompt, nationality, styleId = '1', userDirections = '') {
    // Stick figure styles need special character rules
    const isStickMan = styleId === '27';
    const isStickWoman = styleId === '28';
    const isStickFigure = isStickMan || isStickWoman;

    // Character props template based on style
    // 스틱 피규어: 스타일과 캐릭터를 charProps에 통합하여 중복 방지
    const charPropsTemplate = isStickFigure
        ? `{CharCode} is a 2D stick figure ${isStickWoman ? 'woman' : 'man'} (simple white round head, thin black line body${isStickWoman ? ', pastel accessories like ribbon/bow' : ''}) in humorous 2D illustration style, wearing {color} ${isStickWoman ? 'pastel ' : ''}outfit.`
        : `{CharCode}(${nationality} {gender}, {age}yo, {build}, {hair length/color/style}, wearing {color} {pattern} {outfit}, {accessories/glasses}).`;

    const stickFigureRules = isStickFigure ? `
STICK FIGURE RULES (Style ${styleId}):
- charProps MUST include: "2D stick figure ${isStickWoman ? 'woman' : 'man'}" (gender is important!)
- charProps MUST include: "(simple white round head, thin black line body)"
- charProps MUST include: "in humorous 2D illustration style"
- NO age, NO hair color, NO nationality in charProps
- PATTERN and COLOR are MANDATORY: MCR=blue, SC1=purple, SC2=green; pattern (e.g. solid, pastel). Same color+pattern = same character.
- sceneDesc should NOT mention "stick figure" (avoid duplication)
- Example charProps: "MCR is a 2D stick figure ${isStickWoman ? 'woman' : 'man'} (simple white round head, thin black line body${isStickWoman ? ', pastel accessories like ribbon/bow' : ''}) in humorous 2D illustration style, wearing blue ${isStickWoman ? 'pastel ' : ''}outfit."` : '';

    return `You are a storyboard artist for Grok AI.

=== STEP 1: SCRIPT UNDERSTANDING (internal) ===
Read the FULL SCRIPT below and understand: plot, setting, character roles, emotional arc, key props/locations. Use this understanding to generate consistent, detailed prompts.

Convert the script into ${numPrompts} image prompts.

=== STYLE (USE FULL DESCRIPTION - DO NOT SHORTEN) ===
${stylePrompt}

=== OUTPUT FORMAT ===
Return ONLY a JSON array. No other text, no markdown, no explanation.

JSON Structure:
[
  {
    "number": "01",
    "characters": "MCR",
    "scriptText": "대본첫12자공백제거",
    "sceneDesc": "[${nationality} Context] {Shot}, {Angle}. [no name labels]. {FULL style description}. {time}. {place}. {light}.",
    "charProps": "${charPropsTemplate}",
    "action": "{action}. {expression}. {mood}."
  }
]

═══ EXAMPLES — scenePrompts (follow these patterns EXACTLY) ═══

EXAMPLE A — Two humans (charProps MUST have ALL identity tokens for EVERY character):
{ "number": "01", "characters": "MCR,SC1", "scriptText": "갑자기사레가들렸다", "sceneDesc": "[${nationality} Context] Full shot, Eye level. [no name labels]. ${stylePrompt}. Dawn. Narrow residential alley. Soft golden streetlight glow.", "charProps": "MCR(${nationality === 'Korean' ? 'Korean' : nationality} female, 25yo, slim, long straight black hair with side-swept bangs, wearing burgundy plaid blazer over cream inner blouse and dark navy pencil skirt, thin round gold-frame glasses, small pearl earrings). SC1(${nationality === 'Korean' ? 'Korean' : nationality} male, 35yo, heavyset, short cropped grey hair, wearing charcoal checked hoodie over light-gray inner t-shirt and dark cargo pants, no glasses, silver chain bracelet).", "action": "MCR and SC1 walking through dawn alley. Surprised expression." }

EXAMPLE B — Human + Animal (non-human SC2 with full identity tokens):
{ "number": "05", "characters": "MCR,SC2", "scriptText": "공원에서산책하며", "sceneDesc": "[${nationality} Context] Full shot, Low angle. [no name labels]. ${stylePrompt}. Afternoon. City park with autumn leaves. Warm golden hour light.", "charProps": "MCR(${nationality === 'Korean' ? 'Korean' : nationality} female, 25yo, slim, long straight black hair with side-swept bangs, wearing burgundy plaid blazer over cream inner blouse and dark navy pencil skirt, thin round gold-frame glasses, small pearl earrings). SC2(golden retriever, large, golden fur, floppy ears, brown eyes, red tartan bandana collar, bushy tail).", "action": "MCR walking with SC2 on leash through autumn park. Gentle smile." }

EXAMPLE C — Background-only (no character):
{ "number": "08", "characters": "", "scriptText": "고요한새벽바다위로", "sceneDesc": "[${nationality} Context] Full shot, Bird's eye. [no name labels]. ${stylePrompt}. Pre-dawn. Calm ocean surface. Deep blue-violet sky with faint horizon glow.", "charProps": "Establishing shot of calm pre-dawn ocean. Deep blue-violet water stretching to horizon, faint orange glow at the edge.", "action": "Vast ocean, quiet atmosphere. Serene, contemplative mood." }

═══ KEY: charProps identity tokens MUST be IDENTICAL in EVERY prompt for the same character. NEVER abbreviate. ═══

=== RULES ===

1. CHARACTERS & SCENE DIVERSITY (atmosphere, foreshadowing, tension, psychology):
   - MCR is NOT required in every scene. Include background-only and prop/animal close-ups when script calls for them.
   - RECURRING non-human subjects (animal/plant/object in 2+ scenes) MUST use their assigned character code. Use characters="" ONLY for one-off backgrounds/props.
   - STORY-RELEVANT ONLY: Body-part or prop close-ups ONLY when the script explicitly focuses on them. Do NOT insert arbitrary/meaningless close-ups.
   - Background-only (characters:"", charProps:"Establishing shot of {place}."): one-off scenery, when script sets location/mood
   - Prop/object big close-up (characters:"", charProps:"Big close-up of {subject}."): one-off objects only when script mentions
   - Body-part big close-up: hands/feet/eyes when script focuses on that action; face/eyes for psychology
   - ★ MACRO CLOSE-UP for PSYCHOLOGICAL/EMOTIONAL MOMENTS (STRICT — 25% of total scenes, minimum 20%):
     * Exactly 25% of scenes MUST be MACRO close-ups — regardless of content category (drama/music/education/economy/vlog/cooking/sports).
     * Macro close-up = extreme tight framing on a SINGLE detail symbolizing emotion/tension/concept.
     * Categories (USE 3+ different types, no repeats):
       (a) Body-emotion: single eye/dilated pupil/trembling lip/tear welling/clenched fist/sweat drop/heartbeat pulse on neck/eyelash flutter/goosebumps
       (b) Micro-gesture: fingers gripping fabric/phone, nervous tapping, knuckle whitening, throat swallowing, pen tip on paper, ring sliding
       (c) Object-symbol: price tag text, coin edge, watch second-hand, ring, currency weave, key teeth, button press, letter seal
       (d) Nature-detail: petal dewdrop, raindrop, leaf vein, candle flame flicker, steam curl, snow crystal, water ripple
       (e) Genre-specific: chart line, cookie texture, food steam, screen pixels, book spine, tool edge, instrument string
     * USE WHEN: script expresses doubt, shock, realization, fear, regret, longing, greed, suppressed anger, inner conflict, decision, secret thought, emotional climax, key concept reveal, punchline.
     * Format: characters="{Code}" for body/gesture OR characters="" for object/nature/symbol macros.
     * Example A (body): charProps="MCR(extreme macro close-up of single eye with glasses rim, pupil slightly dilated, faint tear welling at lower lid, full identity tokens...)."
     * Example B (object): charProps="Extreme macro close-up of '9,800' price tag text, ink fibers visible."
     * DO NOT repeat the same macro subject — vary categories (a)~(e).
   - characters: "MCR", "SC1", "SC2", "SC3", "SC4", "SC5" or combinations (max 6), or "" (one-off backgrounds only)

2. CAMERA (CRITICAL — no consecutive full shots):
   - ALTERNATE: Full shot → Close-up → Full shot → Close-up. Full shot and Full shot must NEVER be consecutive (causes jarring cut).
   - Shot distribution TARGET: Full shot ~45%, Face/Character Close-up ~30%, MACRO Close-up (psychological/symbolic) ~25%.
   - Odd numbers [01,03,05...] = Full shot. Even numbers [02,04,06...] = Close-up OR MACRO Close-up. At emotional/psychological intensity moments, USE MACRO instead of regular close-up.
   - Within every 10 scenes: at least TWO (20%) must be MACRO close-ups (categories a~e above) — not just regular Big close-ups.
   - Angles: eye level, low angle, high angle, bird's eye, Dutch angle, macro. Cycle through all 6.

3. CHARACTER CONSISTENCY (MANDATORY):
   - Define COMPLETE identity at first appearance, keep IDENTICAL in ALL scenes and characterRefs
   - Characters may be human, animal, plant, object, or environmental subject depending on script
${isStickFigure ? `   - MCR=blue outfit, SC1=purple outfit, SC2=green outfit` : `   - MANDATORY identity tokens for HUMAN characters: nationality, gender, age, body build (slim/average/heavyset/muscular), hair (length+color+style), outfit (color+pattern+type, inner layer if outerwear), accessories (glasses with frame shape OR "no glasses", earrings, hat, bag, etc.)
   - Defaults: MCR=slim+long black hair+burgundy plaid blazer+gold-frame glasses, SC1=heavyset+short grey hair+charcoal checked hoodie+no glasses, SC2=slim+brown wavy hair+olive floral cardigan+rectangular black-rim glasses`}
   - plain/solid/무지 is FORBIDDEN for character outfits (except stick-figure styles) — ALWAYS specify a visible pattern or texture
   - refSheetPrompt identity tokens MUST be IDENTICAL to charProps identity tokens
   - Code-Identity Lock: one code = one character for entire output
   - Wardrobe Change: only when script explicitly indicates a change

4. LANGUAGE (CRITICAL): sceneDesc, charProps, action MUST be 100% English. NO Korean, no 한글. scriptText keeps original. Translate: 새벽→dawn, 주택가 골목→residential alley, 가로등 불빛→streetlight glow, 어둡고 을씨년스러운→dark dreary, 분위기→atmosphere.

5. scriptText RULES:
   - Copy the FIRST part of the script line VERBATIM (NO summarizing, NO paraphrasing)
   - Remove ALL spaces and punctuation, take first 14 chars
   - Example: "갑자기사레가들렸다음식을" (from "갑자기 사레가 들렸다! 음식을...")
   - Example: "Theoldmanwalked" (from "The old man walked slowly...")
   - This is for filename only

6. sceneDesc RULES:
   - Start with [${nationality} Context]
   - Include [no name labels]
   - Include style: "${stylePrompt}"
   - Include time, place, light — ALL IN ENGLISH
${isStickFigure ? `   - DO NOT mention "stick figure" in sceneDesc (it goes in charProps only)` : ''}

7. charProps RULES:
   - When characters="" use "Establishing shot of {place}." or "Big close-up of {subject}." — one-off backgrounds/props only. For body-part: "MCR(extreme close-up of {hands/face/eyes/feet}, {action/expression})"
   - HUMAN characters: Write FULL description for EVERY character in EVERY prompt. Format: MCR(${nationality} female, 25yo, slim, long straight black hair, wearing burgundy plaid blazer over cream inner blouse and dark navy pencil skirt, thin round gold-frame glasses, small pearl earrings). SC1(${nationality} male, 28yo, heavyset, short cropped grey hair, wearing charcoal checked hoodie over light-gray inner t-shirt and dark cargo pants, no glasses). NEVER abbreviate as "MCR(...)" or "SC1(same as before)". AI image generators have NO memory — each prompt must be SELF-CONTAINED. ALL identity tokens MANDATORY: build, hair (length+color+style), outfit (color+pattern+type), accessories/glasses. plain/solid/무지 FORBIDDEN (except stick-figure styles where solid color is allowed).
   - NON-HUMAN coded characters: repeat full identity in EVERY prompt. E.g. "MCR(golden retriever, large, golden fur, floppy ears, red bandana collar)." or "SC1(cherry blossom tree, full bloom, pink petals, 3m tall)."
${stickFigureRules}

8. PROHIBITED:
   - CRITICAL: Any Korean/한글 in sceneDesc, charProps, or action. Write ONLY in English
   - CRITICAL: Abbreviating charProps with "(...)" or "same as before" — ALWAYS write FULL character descriptions
   - Color temperature (2700K)
   - Changing appearance between scenes
   - Same angle consecutively
   - Shortening style description
   - Any text outside JSON array

=== CRITICAL ===
- Return ONLY valid JSON array
- No markdown code blocks (no \`\`\`)
- No explanatory text before or after
- Escape quotes inside strings with \\"
${userDirections ? `
=== ★ USER SPECIAL DIRECTIONS (HIGHEST PRIORITY — override all other rules if conflicting) ===
The user's special directions below MUST be reflected in EVERY generated prompt as the top priority.
(If written in non-English, translate the intent to English before applying to prompt fields):
${userDirections}
===
` : ''}
=== SCRIPT ===
${script}

=== GENERATE ${numPrompts} PROMPTS AS JSON ARRAY ===`;
}

/**
 * V5 System Prompt - Character Reference + Scene Prompts
 * Updated: Adds character reference generation before scene prompts
 */
function buildSystemPromptV5(script, numPrompts, stylePrompt, nationality, styleId = '1', userDirections = '', userProvidedCharRefs = null, customStyle = '') {
    // ★ v1.5: 2-레이어 스타일 해석 — sceneDesc는 rendering만, 인물 charRef는 fullPrompt
    const styleLayers = getStyleLayers(styleId, customStyle);
    const sceneStyle = styleLayers.rendering;
    const humanIdentityBlockV5 = styleLayers.humanIdentity
        ? `\n\n=== HUMAN IDENTITY LAYER (apply ONLY to Human-type characters) ===
${styleLayers.humanIdentity}`
        : '';

    // ★ PRO 2.0: 사용자 제공 캐릭터 블록 생성
    let preProvidedBlock = '';
    if (Array.isArray(userProvidedCharRefs) && userProvidedCharRefs.length > 0) {
        const fixedRefsText = userProvidedCharRefs.map(r => {
            // 전체 프롬프트 포함 (절단 금지)
            const fullDesc = (r.prompt || r.description || '').replace(/\s+/g, ' ').trim();
            return `- ${r.code} (${r.name || r.code}): ${fullDesc}`;
        }).join('\n\n');
        const fixedCodesStr = userProvidedCharRefs.map(r => r.code).join(', ');
        const styleAnchor = _deriveStyleAnchorFromUserRefs(userProvidedCharRefs);
        preProvidedBlock = `
═══ PRE-PROVIDED CHARACTER REFERENCES (IDENTITY LOCKED — ACTIONS DYNAMIC) ═══
The following characters are FIXED by the user. Below is their text.

${fixedRefsText}

═══ STYLE ANCHOR ═══
Master style tokens: ${styleAnchor}

═══ WHAT TO PRESERVE VS. WHAT TO VARY (CRITICAL) ═══
★ PRESERVE VERBATIM (locked identity — copy word-for-word every scene):
  - Art/rendering style
  - Species / gender / age / body build / proportions
  - Face features, hair, skin, fur, eyes
  - Clothing / outfit / accessories / colors / patterns
  - Permanent visual markers

★ VARY PER SCENE (Gemini decides based on script context):
  - Location / setting / background / time / lighting
  - Pose / camera angle / body posture
  - Action (what the character is doing in THIS scene)
  - Facial expression (crying, laughing, angry, surprised, sad, determined, etc.)
    — even if the user's reference shows a NEUTRAL or default expression,
       the scene's emotion MUST come from the script (not copied from the reference).
  - Gaze direction
  - Interactions with others / props / environment

EXAMPLE: If user's MCR prompt says "standing pose with hands on hips, neutral smile":
  - Scene 01 (사연: 놀라움): charProps MUST still include all appearance tokens VERBATIM,
    but pose/expression → "eyes wide open, mouth slightly agape, hands raised in surprise"
  - Scene 02 (사연: 슬픔): pose/expression → "hunched shoulders, downcast gaze, tears in eyes"
  - Scene 03 (사연: 분노): pose/expression → "fists clenched, furrowed brows, teeth bared"

═══ PRE-PROVIDED RULES (CRITICAL) ═══
1. For codes ${fixedCodesStr}: preserve appearance/clothing/style tokens VERBATIM.
2. DO NOT change appearance details across scenes.
3. DO NOT lock poses/expressions to the reference default — adapt per script emotion.
4. New characters (not in list) MUST match the rendering style of pre-provided ones.
5. In output 'characterRefs' array, include ONLY NEW characters.
6. scenePrompts reference codes ${fixedCodesStr} with their appearance tokens preserved.

`;
    }

    // Stick figure styles need special character rules
    const isStickMan = styleId === '27';
    const isStickWoman = styleId === '28';
    const isStickFigure = isStickMan || isStickWoman;

    // Character props template based on style
    const charPropsTemplate = isStickFigure
        ? `{CharCode} is a 2D stick figure ${isStickWoman ? 'woman' : 'man'} (simple white round head, thin black line body${isStickWoman ? ', pastel accessories like ribbon/bow' : ''}) in humorous 2D illustration style, wearing {color} ${isStickWoman ? 'pastel ' : ''}outfit.`
        : `{CharCode}(${nationality} {gender}, {age}yo, {build}, {hair length/color/style}, wearing {color} {pattern} {outfit}, {accessories/glasses}).`;

    const stickFigureRules = isStickFigure ? `
STICK FIGURE RULES (Style ${styleId}):
- charProps MUST include: "2D stick figure ${isStickWoman ? 'woman' : 'man'}" (gender is important!)
- charProps MUST include: "(simple white round head, thin black line body)"
- charProps MUST include: "in humorous 2D illustration style"
- NO age, NO hair color, NO nationality in charProps
- PATTERN and COLOR are MANDATORY: MCR=blue, SC1=purple, SC2=green; pattern (e.g. solid, pastel). Same color+pattern = same character.
- sceneDesc should NOT mention "stick figure" (avoid duplication)
- Example charProps: "MCR is a 2D stick figure ${isStickWoman ? 'woman' : 'man'} (simple white round head, thin black line body${isStickWoman ? ', pastel accessories like ribbon/bow' : ''}) in humorous 2D illustration style, wearing blue ${isStickWoman ? 'pastel ' : ''}outfit."` : '';

    const scriptContextRules = !isStickFigure ? `
SCRIPT CONTEXT & HISTORICAL ACCURACY:
- charProps: Base character appearance (outfit, accessories, headgear) on SCRIPT CONTEXT. Each scene/situation determines what characters wear.
- Historical settings (Joseon, Japanese imperial era, etc.): Use PERIOD-ACCURATE accessories and costumes. Apply your knowledge: Joseon (Hanbok, gat, armor, helmets); Japanese imperial era (period-appropriate attire). Research and reflect era-appropriate details.
- ALWAYS specify PATTERN and COLOR. Same color+pattern = same character for viewers.` : '';

    const isJoseon = styleId === '2' || styleId === '6';
    const joseonRules = isJoseon ? `
JOSEON-SPECIFIC:
- sceneDesc: Do NOT put outfit/costume/accessory details here. Only [Context], shot, angle, [no text...], FULL style, time, place, light.` : '';

    // Character name format based on nationality — 비한국 시 이름은 반드시 영어 스펠링
    const isKorean = nationality === 'Korean';
    const charNameFormat = isKorean
        ? `"name": "캐릭터 이름 (한글, 예: 한국남성, 김철수)"`
        : `"name": "Character Name (in English only, e.g., Jia or Sarah — Romanized or English, never 한글)"`;
    const exampleCharName = isKorean ? '이수아' : 'Jia';
    const exampleCharDesc = isKorean ? 'Korean female, 25yo, slim, long straight black hair, wearing burgundy plaid blazer over cream inner blouse and dark navy pencil skirt, thin round gold-frame glasses, small pearl earrings' : `${nationality} female, 25yo, slim, long straight black hair, wearing burgundy plaid blazer over cream inner blouse and dark navy pencil skirt, thin round gold-frame glasses, small pearl earrings`;

    // Character reference description template - different for stick figures
    // Change 3: Use {gender} per character (MCR/SC1/SC2 each can be man or woman)
    const charRefDescTemplate = isStickFigure
        ? `2D stick figure {gender}, simple white round head, thin black line body{female_stick_detail}, wearing {color} {outfit_modifier}outfit`
        : `${nationality} {gender}, {age}yo, {build}, {hair length/color/style}, wearing {color} {pattern} {outfit}, {accessories/glasses}`;

    // ★ v1.5: 2-레이어 데이터 스키마 기반 — 인물 캐릭터 레퍼런스는 fullPrompt (rendering + humanIdentity)
    //   비인물 캐릭터 레퍼런스 생성은 Gemini가 HUMAN IDENTITY LAYER 지침을 따라 humanIdentity 제외 결정
    const charRefPrefix = `[${nationality} Context]. [no name labels]. ${styleLayers.fullPrompt}. `;
    const charRefStyleEnv = `Match image style, rendering, texture, color and aesthetic across all panels. Clean mid-gray neutral solid background. 16:9 aspect ratio. `;
    const charRefPromptTemplate = isStickFigure
        ? charRefPrefix + `2D stick figure {gender} (simple white round head, thin black line body{female_stick_detail}) in humorous 2D illustration style. Full body shot, front facing, studio background. {CharCode} wearing {color} {outfit_modifier}outfit. Standing in neutral pose. Character reference portrait.`
        : charRefPrefix + `{CharCode}({description}). Full body shot, front facing. Standing in neutral pose, arms relaxed. Calm expression. Character reference portrait.`;

    // refSheetPrompt: style/env + LEFT = face 2x2, RIGHT = full body. Same character, consistent lighting.
    const charRefSheetTemplate = isStickFigure
        ? charRefPrefix + `[{CharCode}] Character reference sheet. ${charRefStyleEnv}16:9 canvas split vertically. LEFT panel: 4 equal cells (2x2 grid) for face close-ups — top-left: face front, camera-facing; top-right: face 3/4 view facing left; bottom-left: face 3/4 view facing right; bottom-right: face profile (side view). Uniform face size and even spacing. RIGHT panel: 2 equal cells (vertical split) — top: full body front, standing neutral pose; bottom: full body back, same pose. Maintain consistent anatomy, proportion, size and alignment. 2D stick figure {gender} (simple white round head, thin black line body{female_stick_detail}) in humorous 2D illustration style. {color} {outfit_modifier}outfit. Consistent lighting across all panels.`
        : charRefPrefix + `[{CharCode}] Character reference sheet. ${charRefStyleEnv}16:9 canvas split vertically. LEFT panel: 4 equal cells (2x2 grid) for face close-ups — top-left: face front, camera-facing; top-right: face 3/4 view facing left; bottom-left: face 3/4 view facing right; bottom-right: face profile (side view). Uniform face size and even spacing. RIGHT panel: 2 equal cells (vertical split) — top: full body front, standing neutral pose; bottom: full body back, same pose. Maintain consistent anatomy, proportion, size and alignment. {nationality} {gender}, {age}yo, {build}, {hair length/color/style}, wearing {color} {pattern} {outfit}, {accessories/glasses}. Same character in all panels (unified facial features, hair, skin tone, body build). Consistent lighting.`;

    return `You are a storyboard artist for Grok AI.
${preProvidedBlock}
=== STEP 1: SCRIPT UNDERSTANDING (internal) ===
Read the FULL SCRIPT below and understand: plot, setting, character roles, emotional arc, key props/locations. Use this understanding to generate consistent, detailed prompts that reflect each scene's true context.

NARRATIVE STRUCTURE: Distribute the ${numPrompts} prompts across 기(Setup) ~30%, 승(Rise) ~20%, 전(Climax) ~30%, 결(Conclusion) ~20%. Apply this proportion when allocating scenes to the script's narrative arc. Place prompt boundaries at line, sentence, or paragraph START (줄·문장·문단의 시작)—NEVER cut mid-word, mid-sentence, or mid-paragraph. For lyrics/poetry, each scene should start at a new line.

Convert the script into character references and ${numPrompts} image prompts.

=== STYLE (sceneDesc에 적용될 렌더링+환경 레이어) ===
${sceneStyle}${humanIdentityBlockV5}

=== ⚡ AUTONOMOUS STYLE-LAYER ENFORCEMENT (CRITICAL — read carefully) ===

A. 2-LAYER SEMANTIC CLASSIFICATION (your judgment):
The STYLE section above may have been pre-split, but you MUST semantically re-classify each
token yourself. Any token describing the following belongs to HUMAN-IDENTITY layer (even if
it appears in the STYLE/rendering section):
  • Clothing/garments: Hanbok, Hanfu, Qipao/Cheongsam, Kimono, Sari, Sherwani, Thobe, Bisht,
    Chima-jeogori, Durumagi, Haori, Hakama, bonnet, cowboy vest, sheriff badge, etc.
  • Head/hair: Gat, Sangtu/topknot, Binyeo, Jjokmeori, Daenggi, turban, hijab, headband,
    hairpin, ornate crown, feathered headdress, cowboy hat, etc.
  • Facial/body: Bindi dot, monolid eyes, beard, jewelry/bangles, "for male/female/nobility"
  • Any phrase implying a person wearing/having something

All OTHER tokens belong to ENVIRONMENT/RENDERING layer:
  • Era/dynasty (Joseon, Edo, Qing, Mughal, frontier, cyberpunk)
  • Architecture/setting (Hanok, temple, palace, desert, street)
  • Lighting, color palette, rendering technique, aesthetic descriptors

B. LAYER APPLICATION RULES:
  • sceneDesc: Use ONLY environment/rendering tokens. NEVER include human-identity tokens
    even if inferable from period (e.g., Joseon → don't add Hanbok to sceneDesc yourself).
  • charProps (Human MCR/SC): Apply relevant humanIdentity tokens per character context
    (age/gender/period-appropriate). Use your cultural knowledge for accuracy within charProps.
  • charProps (Non-human MCR — Flower/Animal/Nature/Object/Abstract): Natural form only.
    NEVER human clothing/hair/body parts. Never "Flower wearing Hanbok" or similar.

C. EXAMPLES:
  ❌ "sceneDesc: Joseon Dynasty. Hanbok. Temple." → Hanbok doesn't belong in sceneDesc
  ❌ "charProps: MCR(Flower wearing traditional Hanbok)" → flowers don't wear clothes
  ❌ "sceneDesc: Joseon Dynasty." + adding Hanbok to MCR flower's charProps from your knowledge
  ✅ "sceneDesc: Joseon Dynasty. Authentic period details. Dawn. Temple eaves."
     "charProps: MCR(Flower: mystical bloom, white petals, crimson tips)"
  ✅ "sceneDesc: Joseon Dynasty. Temple courtyard."
     "charProps: SC1(Korean female, Jjokmeori bun, pale blue Hanbok)" — SC1 is Human

D. MCR TYPE DETECTION:
Decide MCR type from the script:
  • Human (person) → characterRef description prefix "Human:", apply humanIdentity in charProps
  • Non-human (Flower/Animal/Nature/Object/Abstract) → prefix accordingly, natural form in charProps

MCR description prefix (REQUIRED): tag MCR type in characterRefs description:
  MCR(Human: ...), MCR(Flower: ...), MCR(Animal: ...), MCR(Nature: ...), MCR(Object: ...), MCR(Abstract: ...)

=== OUTPUT FORMAT ===
Return ONLY a JSON object. No other text, no markdown, no explanation.

CRITICAL — Every characterRef MUST have: code, name, description, prompt, refSheetPrompt. Every scenePrompt MUST have: number, characters, scriptText, sceneDesc, charProps, action, charActions. Do NOT omit any field.

JSON Structure:
{
  "characterRefs": [
    {
      "code": "MCR",
      ${charNameFormat},
      "description": "${charRefDescTemplate}",
      "prompt": "${charRefPromptTemplate}",
      "refSheetPrompt": "${charRefSheetTemplate}"
    }
  ],
  "scenePrompts": [
    {
      "number": "01",
      "characters": "MCR",
      "scriptText": "대본첫12자공백제거",
      "sceneDesc": "[${nationality} Context] {Shot}, {Angle}. [no name labels]. {environment/rendering tokens from STYLE — exclude ANY human-identity tokens like clothing/hair/accessories}. {time}. {place}. {light}.",
      "charProps": "${charPropsTemplate}",
      "action": "{action}. {expression}. {mood}.",
      "charActions": { "MCR": "MCR's specific action and expression" }
    }
  ]
}

═══ EXAMPLES — characterRefs (follow these patterns EXACTLY) ═══

EXAMPLE 1 — HUMAN female MCR (ALL identity tokens: build, hair length+color+style, outfit color+pattern+type+inner, glasses frame, accessories):
{ "code": "MCR", "name": "${exampleCharName}", "description": "${exampleCharDesc}", "prompt": "[${nationality} Context]. [no name labels]. Hyper-realistic cinematic photograph. ${nationality} drama aesthetic. Natural lighting. High-quality DSLR photography. MCR(${exampleCharDesc}). Full body shot, front facing. Standing in neutral pose, arms relaxed. Calm expression. Character reference portrait.", "refSheetPrompt": "[${nationality} Context]. [no name labels]. Hyper-realistic cinematic photograph. ${nationality} aesthetic. Natural lighting. High-quality DSLR photography. [MCR] Character reference sheet. Match style, rendering, texture, color across all panels. Mid-gray neutral background. 16:9. LEFT: 4 cells (2x2) face close-ups — front, 3/4 left, 3/4 right, profile. RIGHT: 2 cells — full body front, full body back. Same character, consistent lighting. ${exampleCharDesc}." }

EXAMPLE 2 — HUMAN male SC1 (heavyset build, explicit "no glasses", different outfit):
{ "code": "SC1", "name": "${isKorean ? '동훈' : 'James'}", "description": "${nationality === 'Korean' ? 'Korean' : nationality} male, 35yo, heavyset, short cropped grey hair, wearing charcoal checked hoodie over light-gray inner t-shirt and dark cargo pants, no glasses, silver chain bracelet", "prompt": "[${nationality} Context]. [no name labels]. Hyper-realistic cinematic photograph. SC1(${nationality === 'Korean' ? 'Korean' : nationality} male, 35yo, heavyset, short cropped grey hair, wearing charcoal checked hoodie over light-gray inner t-shirt and dark cargo pants, no glasses, silver chain bracelet). Full body shot, front facing. Standing in neutral pose. Character reference portrait.", "refSheetPrompt": "[${nationality} Context]. [no name labels]. Hyper-realistic cinematic photograph. [SC1] Character reference sheet. Match style, rendering, texture, color across all panels. Mid-gray neutral background. 16:9. LEFT: 4 cells (2x2) face close-ups — front, 3/4 left, 3/4 right, profile. RIGHT: 2 cells — full body front, full body back. Same character, consistent lighting. ${nationality === 'Korean' ? 'Korean' : nationality} male, 35yo, heavyset, short cropped grey hair, wearing charcoal checked hoodie over light-gray inner t-shirt and dark cargo pants, no glasses, silver chain bracelet." }

EXAMPLE 3 — NON-HUMAN animal MCR (species, fur color/pattern, size, distinguishing features):
{ "code": "MCR", "name": "Buddy", "description": "golden retriever, large, golden fur, floppy ears, brown eyes, red tartan bandana collar, bushy tail", "prompt": "[${nationality} Context]. [no name labels]. Hyper-realistic cinematic photograph. Natural lighting. MCR(golden retriever, large, golden fur, floppy ears, brown eyes, red tartan bandana collar, bushy tail). Full body shot, front facing. Standing on grass, alert pose. Character reference portrait.", "refSheetPrompt": "[${nationality} Context]. [no name labels]. Hyper-realistic cinematic photograph. [MCR] Character reference sheet. Mid-gray neutral background. 16:9. LEFT: 4 cells (2x2) face close-ups — front, 3/4 left, 3/4 right, profile. RIGHT: 2 cells — full body side view, full body front. Same animal, consistent lighting. Golden retriever, large, golden fur, floppy ears, brown eyes, red tartan bandana collar, bushy tail." }

═══ KEY: description, charProps, refSheetPrompt ending MUST contain the IDENTICAL identity token string. ═══

═══ EXAMPLES — scenePrompts (follow these patterns EXACTLY) ═══

EXAMPLE A — Two humans (FULL identity in charProps for EVERY character):
{ "number": "01", "characters": "MCR,SC1", "scriptText": "갑자기사레가들렸다", "sceneDesc": "[${nationality} Context] Full shot, Eye level. [no name labels]. Hyper-realistic cinematic photograph. ${nationality} drama aesthetic. Dawn. Narrow residential alley. Soft golden streetlight glow.", "charProps": "MCR(${nationality === 'Korean' ? 'Korean' : nationality} female, 25yo, slim, long straight black hair with side-swept bangs, wearing burgundy plaid blazer over cream inner blouse and dark navy pencil skirt, thin round gold-frame glasses, small pearl earrings). SC1(${nationality === 'Korean' ? 'Korean' : nationality} male, 35yo, heavyset, short cropped grey hair, wearing charcoal checked hoodie over light-gray inner t-shirt and dark cargo pants, no glasses, silver chain bracelet).", "action": "MCR and SC1 walking through dawn alley. Surprised expression.", "charActions": { "MCR": "stops mid-step, hand on chest, startled wide-eyed expression.", "SC1": "turns head toward MCR, protective concerned frown." } }

EXAMPLE B — Human + Animal together:
{ "number": "05", "characters": "MCR,SC2", "scriptText": "공원에서산책하며", "sceneDesc": "[${nationality} Context] Full shot, Low angle. [no name labels]. Hyper-realistic cinematic photograph. Afternoon. City park with autumn leaves. Warm golden hour light.", "charProps": "MCR(${nationality === 'Korean' ? 'Korean' : nationality} female, 25yo, slim, long straight black hair with side-swept bangs, wearing burgundy plaid blazer over cream inner blouse and dark navy pencil skirt, thin round gold-frame glasses, small pearl earrings). SC2(golden retriever, large, golden fur, floppy ears, brown eyes, red tartan bandana collar, bushy tail).", "action": "MCR walking with SC2 on leash through autumn park.", "charActions": { "MCR": "smiles gently, holding leash loosely, relaxed stride.", "SC2": "trots alongside happily, tail wagging, sniffing fallen leaves." } }

EXAMPLE C — Background-only (no character, one-off scenery):
{ "number": "08", "characters": "", "scriptText": "고요한새벽바다위로", "sceneDesc": "[${nationality} Context] Full shot, Bird's eye. [no name labels]. Hyper-realistic cinematic photograph. Pre-dawn. Calm ocean surface. Deep blue-violet sky with faint horizon glow.", "charProps": "Establishing shot of calm pre-dawn ocean. Deep blue-violet water stretching to horizon, faint orange glow at the edge, still and peaceful.", "action": "Vast ocean, quiet atmosphere. Serene, contemplative mood.", "charActions": {} }

=== CHARACTER REFERENCE RULES ===

0. CHARACTER NAME LANGUAGE (CRITICAL): When nationality is Korean, characterRefs[].name may be in Korean (한글). When nationality is NOT Korean (e.g. American, Black, Japanese, Southeast Asian, Indian, Latin American, Arab), characterRefs[].name MUST be in English only — use Romanized spelling (e.g. Jia) or an English name. Never use 한글 for name when nationality is not Korean.

1. CHARACTER IDENTIFICATION:
   - Analyze script and identify characters that ACTUALLY appear
   - MCR (Main Character): The central subject — can be a person, animal, plant, object, or environmental element depending on script content
   - SC1 (Supporting Character 1): If exists in script
   - SC2 (Supporting Character 2): If exists in script
   - IMPORTANT: Only include characters that ACTUALLY appear in script
   - Do NOT invent characters
   - If only MCR speaks → characterRefs has only MCR

2. REFERENCE PROMPT FORMAT:
   - Location/setting: studio background only (no style-specific location)
   - Full body shot, front facing (정면 전신샷)
   - description: FULL detailed character+outfit+accessories with PATTERN and COLOR (same as charProps). Example: "Korean male, 35yo, average, short black hair tied in topknot, wearing blue embroidered Hanbok with white collar and dark navy baji trousers, gat (wide-brimmed black headpiece), no glasses" — all identity tokens from the start.
   - Neutral standing pose, arms relaxed
   - Include "Character reference portrait" at the end

3. CHARACTER REFERENCE CONTENT:
   - description and prompt must contain FULL detailed character+outfit+accessories with PATTERN and COLOR — same level of detail as charProps. Same color+pattern = same character for viewers.
${isJoseon ? `   - For Joseon: Include outfit and accessories with pattern+color. Base headgear on script context and role (soldiers→helmet, generals→armor, civil officials→gat+Hanbok).` : ''}

4. CHARACTER CONSISTENCY (MANDATORY):
   - Use IDENTICAL COMPLETE description in characterRefs and scenePrompts
   - Characters may be human, animal, plant, object, or environmental subject depending on script
${isStickFigure ? `   - MCR=blue outfit, SC1=purple outfit, SC2=green outfit` : `   - MANDATORY identity tokens for HUMAN characters: nationality, gender, age, body build (slim/average/heavyset/muscular), hair (length+color+style), outfit (color+pattern+type, inner layer if outerwear), accessories (glasses with frame shape OR "no glasses", earrings, hat, bag, etc.)
   - Defaults: MCR=slim+long black hair+burgundy plaid blazer+gold-frame glasses, SC1=heavyset+short grey hair+charcoal checked hoodie+no glasses, SC2=slim+brown wavy hair+olive floral cardigan+rectangular black-rim glasses`}
   - plain/solid/무지 is FORBIDDEN for character outfits (except stick-figure styles) — ALWAYS specify a visible pattern or texture
   - refSheetPrompt identity tokens MUST be IDENTICAL to charProps identity tokens
   - Code-Identity Lock: one code = one character for entire output
   - Wardrobe Change: only when script explicitly indicates a change

5. REF SHEET PROMPT & PROMPT:
   - MUST start with [${nationality} Context]. [no name labels]. {FULL style}. Then [{CharCode}].
   - refSheetPrompt: Match image style, rendering, texture, color and aesthetic across all panels. Clean mid-gray neutral solid background. 16:9 aspect ratio. LEFT = 4 cells (2x2) face close-ups: front, 3/4 left, 3/4 right, profile. RIGHT = 2 cells: full body front, full body back. Same character, consistent lighting.
   - [{CharCode}] at front. Replace {CharCode} with actual code (MCR, SC1, SC2, SC3, SC4, SC5 as needed, max 6).
${isStickFigure ? `   - For stick figures: {gender}=man|woman per character from script. {female_stick_detail}=', pastel accessories like ribbon/bow' for female, '' for male. {outfit_modifier}='pastel ' for female, '' for male.` : ''}
   - CRITICAL: refSheetPrompt ending MUST contain ALL identity tokens identical to charProps: build, hair (length+color+style), outfit (color+pattern+type+inner layer), ALL accessories (glasses with frame shape, earrings, hat, bag, etc.)
   - No scene context, no action, appearance only

=== SCENE PROMPTS RULES ===

1. CHARACTERS & SCENE DIVERSITY (atmosphere, foreshadowing, tension, psychology):
   - MCR is NOT required in every scene. Include background-only and prop/animal close-ups when script calls for them.
   - RECURRING non-human subjects (animal/plant/object in 2+ scenes) MUST use their assigned character code. Use characters="" ONLY for one-off backgrounds/props.
   - STORY-RELEVANT ONLY: Body-part or prop close-ups ONLY when the script explicitly focuses on them. Do NOT insert arbitrary/meaningless close-ups.
   - Background-only (characters:"", charProps:"Establishing shot of {place}."): one-off scenery, when script sets location/mood
   - Prop/object big close-up (characters:"", charProps:"Big close-up of {subject}."): one-off objects only when script mentions
   - Body-part big close-up: hands/feet/eyes when script focuses on that action; face/eyes for psychology
   - ★ MACRO CLOSE-UP for PSYCHOLOGICAL/EMOTIONAL MOMENTS (STRICT — 25% of total scenes, minimum 20%):
     * Exactly 25% of scenes MUST be MACRO close-ups — regardless of content category (drama/music/education/economy/vlog/cooking/sports).
     * Macro close-up = extreme tight framing on a SINGLE detail symbolizing emotion/tension/concept.
     * Categories (USE 3+ different types, no repeats):
       (a) Body-emotion: single eye/dilated pupil/trembling lip/tear welling/clenched fist/sweat drop/heartbeat pulse on neck/eyelash flutter/goosebumps
       (b) Micro-gesture: fingers gripping fabric/phone, nervous tapping, knuckle whitening, throat swallowing, pen tip on paper, ring sliding
       (c) Object-symbol: price tag text, coin edge, watch second-hand, ring, currency weave, key teeth, button press, letter seal
       (d) Nature-detail: petal dewdrop, raindrop, leaf vein, candle flame flicker, steam curl, snow crystal, water ripple
       (e) Genre-specific: chart line, cookie texture, food steam, screen pixels, book spine, tool edge, instrument string
     * USE WHEN: script expresses doubt, shock, realization, fear, regret, longing, greed, suppressed anger, inner conflict, decision, secret thought, emotional climax, key concept reveal, punchline.
     * Format: characters="{Code}" for body/gesture OR characters="" for object/nature/symbol macros.
     * Example A (body): charProps="MCR(extreme macro close-up of single eye with glasses rim, pupil slightly dilated, faint tear welling at lower lid, full identity tokens...)."
     * Example B (object): charProps="Extreme macro close-up of '9,800' price tag text, ink fibers visible."
     * DO NOT repeat the same macro subject — vary categories (a)~(e).
   - characters: "MCR", "SC1", "SC2", "SC3", "SC4", "SC5" or combinations (max 6), or "" (one-off backgrounds only)

2. CAMERA (CRITICAL — no consecutive full shots):
   - ALTERNATE: Full shot → Close-up → Full shot → Close-up. Full shot and Full shot must NEVER be consecutive (causes jarring cut).
   - Shot distribution TARGET: Full shot ~45%, Face/Character Close-up ~30%, MACRO Close-up (psychological/symbolic) ~25%.
   - Odd numbers [01,03,05...] = Full shot. Even numbers [02,04,06...] = Close-up OR MACRO Close-up. At emotional/psychological intensity moments, USE MACRO instead of regular close-up.
   - Within every 10 scenes: at least TWO (20%) must be MACRO close-ups (categories a~e above) — not just regular Big close-ups.
   - Angles: eye level, low angle, high angle, bird's eye, Dutch angle, macro. Cycle through all 6.

3. LANGUAGE (CRITICAL): sceneDesc, charProps, action MUST be 100% English. NO Korean, no 한글. scriptText keeps original. Translate: 새벽→dawn, 주택가 골목→residential alley, 가로등 불빛→streetlight glow, 어둡고 을씨년스러운→dark dreary, 분위기→atmosphere.

4. scriptText RULES:
   - Copy the FIRST part of the script assigned to THIS scene VERBATIM (NO summarizing, NO paraphrasing)
   - CRITICAL: Each scene's script portion MUST start at a line or sentence boundary. scriptText MUST be the beginning of a line or sentence—NEVER from the middle of a word. For lyrics/poetry, each scene should start at a new line.
   - For CJK scripts: remove spaces/punctuation, take first 14 chars from the line/sentence start
   - For English scripts: keep spaces, remove punctuation, take first 3~4 words from the line/sentence start
   - This is for filename only

5. sceneDesc RULES:
   - Start with [${nationality} Context]
   - Include [no name labels]
   - Include FULL style description (use complete style prompt — DO NOT shorten) and time, place, light — ALL IN ENGLISH
${isJoseon ? `   - Do NOT put outfit/costume/accessory (Hanbok, gat, etc.) in sceneDesc — those go in charProps only` : ''}
${isStickFigure ? `   - DO NOT mention "stick figure" in sceneDesc (it goes in charProps only)` : ''}

6. charProps RULES:
   - When characters="" use "Establishing shot of {place}." or "Big close-up of {subject}." — one-off backgrounds/props only, no character in frame.
   - For body-part big close-up (hands writing, fingers, face/eyes, feet on ice): "MCR(extreme close-up of {hands/face/eyes/feet}, {action/expression}, psychological portrait when face)"
   - HUMAN characters: Write FULL description for EVERY character in EVERY prompt. Format: MCR(${nationality} female, 25yo, slim, long straight black hair, wearing burgundy plaid blazer over cream inner blouse and dark navy pencil skirt, thin round gold-frame glasses, small pearl earrings). SC1(${nationality} male, 28yo, heavyset, short cropped grey hair, wearing charcoal checked hoodie over light-gray inner t-shirt and dark cargo pants, no glasses). NEVER abbreviate as "MCR(...)" or "SC1(same as before)". AI image generators have NO memory — each prompt must be SELF-CONTAINED. ALL identity tokens MANDATORY: build, hair (length+color+style), outfit (color+pattern+type), accessories/glasses. plain/solid/무지 FORBIDDEN (except stick-figure styles where solid color is allowed).
   - NON-HUMAN coded characters: repeat full identity in EVERY prompt. E.g. "MCR(golden retriever, large, golden fur, floppy ears, red bandana collar)." or "SC1(cherry blossom tree, full bloom, pink petals, 3m tall)."
${stickFigureRules}
${scriptContextRules}
${joseonRules}

7. SKIP: Do NOT generate prompts for: title cards (e.g. "A title card appears", "Title card for", N단계 markers like 9단계진실폭로), part/phase dividers (1부완료, 2부 등), production notes (Display...), structural markers, lines in [...] brackets (e.g. [Intro], [Verse 1], [Chorus], [Bridge], [Outro]), lines in (...) parentheses (e.g. (instrumental...), (fade out...)), vocal fillers (um um um, la la la), or any meta-text. You MUST distinguish actual narrative from non-narrative using your reasoning ability. Ask yourself: "Can this line be visualized as an image scene?" If NO (section headers, stage directions, instrument cues, timestamps, credits, structural dividers, meta-comments), SKIP it. Generate prompts ONLY for lines that describe visualizable content: character actions, dialogue, emotions, settings, or story moments.
8. PROHIBITED:
   - Korean text in sceneDesc, charProps, or action fields
   - CRITICAL: Abbreviating charProps with "(...)" or "same as before" — ALWAYS write FULL character descriptions
   - Color temperature (2700K)
   - Changing appearance between scenes
   - Same angle consecutively
   - Shortening style description
   - Instruction-like text in output (e.g. "Gat only for outdoor")
   - Any text outside JSON object

9. charActions RULES:
   - Split action field content per character — do NOT invent new content
   - Include only characters listed in the characters field
   - characters="" scenes: "charActions": {}
   - Always output as object (never array or string)
   - English only
   - Used exclusively for Flow @ tag lines (existing action field unchanged)

=== CRITICAL ===
- Return ONLY valid JSON object with "characterRefs" and "scenePrompts"
- Each characterRef MUST have code, name, description, prompt, refSheetPrompt (all 5 fields required)
- Each scenePrompt MUST have number, characters, scriptText, sceneDesc, charProps, action, charActions (charActions = object, use {} when characters="")
- No markdown code blocks (no \`\`\`)
- No explanatory text before or after
- Escape quotes inside strings with \\"
${userDirections ? `
=== ★ USER SPECIAL DIRECTIONS (HIGHEST PRIORITY — override all other rules if conflicting) ===
The user's special directions below MUST be reflected in EVERY generated prompt as the top priority.
(If written in non-English, translate the intent to English before applying to prompt fields):
${userDirections}
===
` : ''}
=== SCRIPT ===
${script}

=== GENERATE CHARACTER REFERENCES AND ${numPrompts} SCENE PROMPTS AS JSON OBJECT ===`;
}

/**
 * Parse V4 response - JSON format (Primary)
 */
function parseGeminiResponseV4(text) {

    try {
        // JSON 코드블록 제거 (혹시 있으면)
        let cleanText = text.trim();

        // Remove markdown code blocks
        cleanText = cleanText.replace(/^```json\s*/i, '');
        cleanText = cleanText.replace(/^```\s*/i, '');
        cleanText = cleanText.replace(/\s*```$/i, '');
        cleanText = cleanText.trim();

        // Find JSON array bounds
        const startIdx = cleanText.indexOf('[');
        const endIdx = cleanText.lastIndexOf(']');

        if (startIdx === -1 || endIdx === -1 || startIdx >= endIdx) {
            throw new Error('No JSON array found');
        }

        // Extract JSON array
        cleanText = cleanText.substring(startIdx, endIdx + 1);

        // JSON 파싱
        const prompts = JSON.parse(cleanText);

        // 유효성 검사
        if (!Array.isArray(prompts) || prompts.length === 0) {
            throw new Error('Empty or invalid array');
        }


        // 필수 필드 확인 및 정규화
        return prompts.map(p => {
            const st = cleanScriptText(p.scriptText);
            return {
            number: String(p.number || '01').padStart(2, '0'),
            characters: p.characters || 'MCR',
                scriptText: st,
            sceneDesc: p.sceneDesc || '',
            charProps: p.charProps || '',
            action: p.action || '',
                prompt: `${p.sceneDesc || ''} ${p.charProps || ''} ${p.action || ''}`.trim()
            };
        });

    } catch (error) {

        return parseGeminiResponseV3(text);
    }
}

/**
 * Parse V5 response - Character References + Scene Prompts (JSON format)
 */
function parseGeminiResponseV5(text) {

    try {
        // JSON 코드블록 제거 (혹시 있으면)
        let cleanText = text.trim();

        // Remove markdown code blocks
        cleanText = cleanText.replace(/^```json\s*/i, '');
        cleanText = cleanText.replace(/^```\s*/i, '');
        cleanText = cleanText.replace(/\s*```$/i, '');
        cleanText = cleanText.trim();

        // Find JSON object bounds
        const startIdx = cleanText.indexOf('{');
        const endIdx = cleanText.lastIndexOf('}');

        if (startIdx === -1 || endIdx === -1 || startIdx >= endIdx) {
            // Fallback: V4 파싱 (scenePrompts만 반환)
            const prompts = parseGeminiResponseV4(text);
            return {
                characterRefs: [],
                scenePrompts: prompts
            };
        }

        // Extract JSON object
        cleanText = cleanText.substring(startIdx, endIdx + 1);

        // JSON 파싱
        const result = JSON.parse(cleanText);

        // characterRefs 파싱
        const characterRefs = Array.isArray(result.characterRefs) ? result.characterRefs.map(ref => ({
            code: ref.code || '',
            name: ref.name || '',
            description: ref.description || '',
            prompt: ref.prompt || '',
            refSheetPrompt: ref.refSheetPrompt || '',
            status: 'pending'  // 초기 상태
        })) : [];

        // scenePrompts 파싱
        const scenePrompts = Array.isArray(result.scenePrompts) ? result.scenePrompts.map(p => {
            const st = cleanScriptText(p.scriptText);
            const charActions = p.charActions && typeof p.charActions === 'object' && !Array.isArray(p.charActions) ? p.charActions : {};
            return {
            number: String(p.number || '01').padStart(2, '0'),
            characters: p.characters || 'MCR',
                scriptText: st,
            sceneDesc: p.sceneDesc || '',
            charProps: p.charProps || '',
            action: p.action || '',
                charActions,
                prompt: `${p.sceneDesc || ''} ${p.charProps || ''} ${p.action || ''}`.trim()
            };
        }) : [];

        const firstRef = characterRefs[0];
        const firstScene = scenePrompts[0];

        return {
            characterRefs,
            scenePrompts
        };

    } catch (error) {

        // Fallback: V4 파싱 (scenePrompts만 반환)
        const prompts = parseGeminiResponseV4(text);
        return {
            characterRefs: [],
            scenePrompts: prompts
        };
    }
}

/**
 * Parse V3 response - More robust parsing (Fallback)
 */
function parseGeminiResponseV3(text) {
    const prompts = [];


    // Normalize line endings and clean up
    let normalizedText = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    // Remove markdown code blocks if present
    normalizedText = normalizedText.replace(/```[\s\S]*?```/g, (match) => {
        // Extract content inside code block
        return match.replace(/```\w*\n?/g, '').replace(/```/g, '');
    });

    // Remove bold/italic markers
    normalizedText = normalizedText.replace(/\*\*/g, '').replace(/\*/g, '');


    // Split by [Number] pattern - handle various formats: [01], [1], **[01]**
    const blocks = normalizedText.split(/(?=\[0?\d+\])/).filter(b => b.trim());


    for (let blockIdx = 0; blockIdx < blocks.length; blockIdx++) {
        const block = blocks[blockIdx];
        // Get all non-empty lines
        const allLines = block.trim().split('\n');
        const lines = allLines.filter(l => l.trim());


        // Need at least 2 lines for a valid prompt
        if (lines.length < 2) {
            continue;
        }

        // Parse [Number] - can be anywhere in first line, handle [01] or [1]
        const numMatch = lines[0].match(/\[0?(\d+)\]/);

        // 3. 정규표현식 매칭 결과 확인

        if (!numMatch) {
            continue;
        }

        const number = numMatch[1].padStart(2, '0');

        // Check if line[0] has more content after [Number]
        const firstLineExtra = lines[0].replace(/\[0?\d+\]\s*/, '').trim();

        let characters, scriptText, sceneDesc, charProps, action;

        // Flexible parsing based on line count
        if (lines.length >= 6) {
            // Full 6-line format
            if (firstLineExtra) {
                characters = firstLineExtra;
                scriptText = lines[1]?.trim() || '';
                sceneDesc = lines[2]?.trim() || '';
                charProps = lines[3]?.trim() || '';
                action = lines.slice(4).map(l => l.trim()).filter(l => l).join(' ');
            } else {
                characters = lines[1]?.trim() || 'MCR';
                scriptText = lines[2]?.trim() || '';
                sceneDesc = lines[3]?.trim() || '';
                charProps = lines[4]?.trim() || '';
                action = lines.slice(5).map(l => l.trim()).filter(l => l).join(' ');
            }
        } else if (lines.length >= 4) {
            // 4-5 line format
            if (firstLineExtra) {
                characters = firstLineExtra;
                scriptText = lines[1]?.trim() || '';
                sceneDesc = lines[2]?.trim() || '';
                charProps = lines.slice(3).map(l => l.trim()).filter(l => l).join(' ');
                action = '';
            } else {
                characters = lines[1]?.trim() || 'MCR';
                scriptText = lines[2]?.trim() || '';
                sceneDesc = lines[3]?.trim() || '';
                charProps = lines.slice(4).map(l => l.trim()).filter(l => l).join(' ');
                action = '';
            }
        } else {
            // Minimal format (2-3 lines) - try to extract what we can
            characters = 'MCR';
            scriptText = firstLineExtra || lines[1]?.trim() || '';
            sceneDesc = lines[lines.length > 2 ? 2 : 1]?.trim() || '';
            charProps = '';
            action = '';
        }

        // Validate we have meaningful content
        if (!sceneDesc && !scriptText) {
            continue;
        }

        // Combine into single prompt (no line breaks for Grok)
        const fullPrompt = [sceneDesc, charProps, action].filter(s => s).join(' ');

        const st = cleanScriptText(scriptText);
        prompts.push({
            number,
            characters,
            scriptText: st,
            sceneDesc,
            charProps,
            action,
            prompt: [st, sceneDesc, charProps, action].filter(s => s).join(' ') || st
        });

    }

    if (prompts.length === 0) {
        return fallbackParseV3(normalizedText);
    }

    return prompts;
}

/**
 * Fallback parser V3 - More flexible matching
 */
function fallbackParseV3(text) {
    const prompts = [];


    // Clean text further
    let cleanText = text
        .replace(/```[\s\S]*?```/g, (m) => m.replace(/```\w*\n?/g, '').replace(/```/g, ''))
        .replace(/\*\*/g, '')
        .replace(/\*/g, '');

    // Try multiple regex patterns
    const patterns = [
        // Standard 6-line format
        /\[0?(\d+)\]\s*\n([^\n]+)\s*\n([^\n]+)\s*\n([^\n]+)\s*\n([^\n]+)\s*\n([^\n]+)/g,
        // With content on same line as number
        /\[0?(\d+)\]\s+([^\n]+)\s*\n([^\n]+)\s*\n([^\n]+)\s*\n([^\n]+)\s*\n([^\n]+)/g,
        // 4-line format
        /\[0?(\d+)\]\s*\n?([^\n]+)\s*\n([^\n]+)\s*\n([^\n]+)\s*\n([^\n]+)/g,
        // 3-line format
        /\[0?(\d+)\]\s*\n?([^\n]+)\s*\n([^\n]+)\s*\n([^\n]+)/g
    ];

    for (let i = 0; i < patterns.length; i++) {
        const regex = patterns[i];
        let match;
        regex.lastIndex = 0;


        while ((match = regex.exec(cleanText)) !== null) {
            // 3. 정규표현식 매칭 결과 확인

            const number = match[1].padStart(2, '0');

            // Avoid duplicates
            if (prompts.find(p => p.number === number)) continue;

            const characters = match[2]?.trim() || 'MCR';
            const st = cleanScriptText(match[3]);
            const sceneDesc = match[4]?.trim() || '';
            const charProps = match[5]?.trim() || '';
            const action = match[6]?.trim() || '';

            prompts.push({
                number,
                characters,
                scriptText: st,
                sceneDesc,
                charProps,
                action,
                prompt: [sceneDesc, charProps, action].filter(s => s).join(' ') || st
            });
        }

        if (prompts.length > 0) {
            break;
        }
    }

    // Last resort: extract any [Number] followed by any content
    if (prompts.length === 0) {

        // Match [Number] followed by content until next [Number] or end
        const simpleRegex = /\[0?(\d+)\]([\s\S]*?)(?=\[0?\d+\]|$)/g;
        let match;

        while ((match = simpleRegex.exec(cleanText)) !== null) {
            const number = match[1].padStart(2, '0');
            const content = match[2].trim();
            const lines = content.split('\n').map(l => l.trim()).filter(l => l);

            if (lines.length >= 1) {
                // Avoid duplicates
                if (prompts.find(p => p.number === number)) continue;

                prompts.push({
                    number,
                    characters: 'MCR',
                    scriptText: cleanScriptText(lines[0]),
                    sceneDesc: lines[1] || lines[0] || '',
                    charProps: lines[2] || '',
                    action: lines.slice(3).join(' ') || '',
                    prompt: lines.slice(1).join(' ').trim() || lines[0] || ''
                });

            }
        }
    }

    // Ultimate fallback: just split by numbers
    if (prompts.length === 0) {

        const numberPatterns = cleanText.match(/(?:^|\n)\s*(?:\[0?\d+\]|\d+\.|\d+\))/gm);
        if (numberPatterns) {
            const parts = cleanText.split(/(?:^|\n)\s*(?:\[0?\d+\]|\d+\.|\d+\))/);

            for (let i = 1; i < parts.length && i <= 20; i++) {
                const content = parts[i]?.trim();
                if (content && content.length > 10) {
                    prompts.push({
                        number: String(i).padStart(2, '0'),
                        characters: 'MCR',
                        scriptText: '',
                        sceneDesc: content.split('\n')[0] || '',
                        charProps: '',
                        action: '',
                        prompt: content.replace(/\n/g, ' ').substring(0, 500)
                    });
                }
            }
        }
    }

    if (prompts.length === 0) {
        throw new Error('프롬프트 생성 실패, 다시 시도해주세요.');
    }

    return prompts;
}

/**
 * Generate filename
 * Format: Scene01_MCR_a_ScriptText.png
 */
function generateGeminiFilename(sceneNum, suffix, characters, scriptText) {
    const num = String(sceneNum).padStart(2, '0');
    const chars = characters.replace(/,/g, '_');
    const text = scriptText.substring(0, 20);

    return `Scene${num}_${chars}_${suffix}_${text}.png`;
}

function getStyleOptions() {
    return [];
}

function getRecommendedNationality(_styleId) {
    return '';
}

function getStylePrompt(_styleId) {
    return '';
}

function validateApiKey(apiKey) {
    if (!apiKey || typeof apiKey !== 'string') return false;
    const k = apiKey.trim();
    // 길이 가드 — 무작위 텍스트 / 오타 차단
    if (k.length <= 30) return false;
    // 1순위: 표준 Google AI Studio 키 (AIza...)
    if (k.startsWith('AIza')) return true;
    // 2순위 (v1.1.7): 신형 키 (AQ.Ab... — Google 이 지역별/조건별로 발급하는 신규 포맷)
    if (k.startsWith('AQ.')) return true;
    // ★ 3순위 (v1.1.7): 관대 모드 — 미래의 새 prefix 도 폴백 허용
    //   안전 문자셋(영숫자 + . _ - \) 만 검사. 실제 키 유효성은 서버가 판단.
    //   유효하지 않으면 생성 호출 시 명확한 토스트로 안내됨 (getPromptErrorToast 의 API_KEY 분기)
    if (/^[A-Za-z0-9._\-\\]+$/.test(k)) return true;
    return false;
}

// =============================================
// FACTORY MODE: 동영상 프롬프트 생성
// =============================================

/**
 * 이미지 프롬프트를 기반으로 동영상 프롬프트 생성
 * ★ 전체 대본 + 전체 이미지 프롬프트 전송 (제한 없음)
 * ★ 스토리 감정선, 기승전결, 후킹 요소 강조
 * @param {string} script - 원본 대본 (전체)
 * @param {Array} imagePrompts - 배치1 이미지 프롬프트 배열 (전체)
 * @param {string} apiKey - Gemini API 키
 * @returns {Promise<Array>} 동영상 프롬프트 배열
 */
async function generateVideoPromptsFromGemini(script, imagePrompts, apiKey) {
    if (!imagePrompts || imagePrompts.length === 0) {
        throw new Error('이미지 프롬프트가 없습니다.');
    }

    // ★ 이미지 프롬프트 전체 전송 (200자 제한 제거)
    const imagePromptList = imagePrompts.map((p, i) => {
        const num = p.number || String(i + 1).padStart(2, '0');
        const sceneDesc = p.sceneDesc || '';
        const charProps = p.charProps || '';
        const action = p.action || '';
        const scriptText = p.scriptText || '';
        const characters = p.characters || '';
        const fullPrompt = p.prompt || `${sceneDesc} ${charProps} ${action}`.trim();
        
        return `[${num}]
- characters: ${characters || 'none'}
- scriptText: ${scriptText}
- sceneDesc: ${sceneDesc}
- charProps: ${charProps}
- action: ${action}
- fullPrompt: ${fullPrompt}`;
    }).join('\n\n');

    // ★ 전체 대본 전송 (3000자 제한 제거)
    const fullScript = (script || '').replace(/\\/g, '').replace(/"/g, "'");

    const prompt = `You are the WORLD'S BEST STORYBOARD ARTIST, renowned for creating emotionally powerful video sequences that captivate audiences worldwide.

=== YOUR PERSONA ===
You have directed award-winning films, commercials, and viral content. You understand the psychology of visual storytelling — how camera movements, timing, and emotional beats create unforgettable moments. Your video prompts are legendary for their ability to HOOK viewers instantly.

=== CRITICAL MISSION ===
Create VIDEO MOTION PROMPTS for Grok AI's image-to-video feature.
Each image prompt has a "scriptText" field — this is the EXACT SCENE BOUNDARY from the original script.
You MUST divide the script into the SAME scenes as the image prompts using scriptText as markers.

=== SCENE MATCHING RULE (CRITICAL - NO SKIPPING!) ===
- Each image prompt's "scriptText" shows where that scene starts in the script
- Use scriptText to locate the exact portion of the full script for each scene
- Match your video prompt's emotion/action to THAT specific part of the story
- ⚠️ CRITICAL: You MUST generate EXACTLY ${imagePrompts.length} video prompts — ONE for EACH image prompt
- ⚠️ DO NOT SKIP ANY NUMBER! Generate prompts for: ${imagePrompts.map((_, i) => String(i + 1).padStart(2, '0')).join(', ')}
- ⚠️ If you skip even ONE number, the system will FAIL. Generate ALL ${imagePrompts.length} prompts sequentially!

=== STORY ARC ANALYSIS ===
1. SHORT scripts: Full 기승전결 (beginning-development-turn-conclusion) in ${imagePrompts.length} scenes
2. LONG scripts (Batch 1): Opening/Setup (기/起) phase
3. MEDIUM scripts: Opening + Development (기승/起承)
Identify: protagonist intro, conflict setup, emotional peaks, tension points

=== CRITICAL CONTEXT: BATCH 1 = HOOKING VIDEOS ===
IMPORTANT: These ${imagePrompts.length} video prompts are for BATCH 1 only.
- The user will have ~74 IMAGES (full story) but only ~25 VIDEOS (Batch 1)
- Batch 1 videos = OPENING/HOOKING section of the entire story
- These videos MUST capture viewers in the first 3 seconds
- The remaining story will use static images with Ken Burns effect
- Therefore: Batch 1 videos carry the MOST IMPORTANT visual hook responsibility!

=== VIDEO PROMPT CONTENT (MANDATORY ELEMENTS) ===
Each video prompt MUST include:
1. SETTING: nationality context, location, season, time of day
2. CAMERA: BOLD movements (dramatic zoom, sweeping pan, dynamic tracking, tension-building tilt, impactful static, disorienting Dutch angle)
3. CHARACTER ACTION: BOLD physical motion — sudden gestures, dramatic posture shifts, impactful movements, expressive body language
4. PSYCHOLOGY: intense internal emotion, dramatic facial expressions, piercing eye movements, visible breathing changes
5. ATMOSPHERE: dramatic lighting shifts, dynamic ambient motion (strong wind, swirling particles, moving shadows)

=== ACTION INTENSITY RULE ===
- DO NOT be subtle or gentle — be BOLD and DRAMATIC
- Camera movements: prefer "dramatic zoom" over "slow zoom", "sweeping pan" over "gentle pan"
- Character actions: prefer "sudden turn", "sharp gesture", "dramatic lean" over subtle movements
- Emotions: prefer "eyes widen with shock", "jaw drops", "tears stream" over subtle expressions
- The goal: Make viewers UNABLE to scroll past. Every frame must DEMAND attention.

=== CHARACTER CODE REFERENCE ===
- MCR = Main Character (주인공)
- SC1 = Supporting Character 1 (조연1)
- SC2 = Supporting Character 2 (조연2)
- SC3, SC4, SC5 = Additional supporting (max 6 total: MCR + SC1~SC5)
- Empty = No specific character focus (background, objects, scenery)
Use these codes in videoPrompt to refer to characters (e.g., "MCR gestures", "SC1 looks at MCR")

=== HOOKING DIALOGUE RULE (CRITICAL) ===
If the scriptText contains a POWERFUL/EMOTIONAL dialogue line that hooks viewers:
- Include that dialogue IN THE ORIGINAL LANGUAGE in your video prompt
- ⚠️ IMPORTANT: Use「」brackets for dialogue (NOT double quotes " " which break JSON!)
- Format: lips move speaking [Language] dialogue:「actual dialogue」
- Korean script → lips move speaking Korean dialogue:「뭐라고? 너가 그러고도 내 며느리야!」
- English script → lips move speaking English dialogue:「How dare you!」
- Japanese script → lips move speaking Japanese dialogue:「何だと!」
- NOT every scene needs dialogue — only include if it's a HOOKING moment

=== LANGUAGE RULE ===
- Dialogue quotes: ORIGINAL LANGUAGE from script
- Everything else: ENGLISH

=== OUTPUT FORMAT (CRITICAL - MUST MATCH IMAGE PROMPT STRUCTURE) ===
Return ONLY a JSON array with these fields:
- "number": scene number (01, 02, 03...)
- "characters": character codes from image prompt (MCR, SC1, MCR,SC1, or empty)
- "scriptText": EXACT same scriptText from corresponding image prompt
- "videoPrompt": [Context] + camera + action + emotion + atmosphere + dialogue(if hooking)

=== JSON FORMAT RULES (CRITICAL) ===
- Return ONLY valid JSON array — no markdown code blocks (no \`\`\`)
- No explanatory text before or after the JSON
- COMPACT format — minimal whitespace, no line breaks inside strings
- ⚠️ NEVER use double quotes " " inside videoPrompt value — use「」for dialogue instead
- Do NOT use single quotes — use double quotes only for JSON structure
- Do NOT include trailing commas after last array/object item
- If you must include quotes in text, escape them as \\"

=== OUTPUT EXAMPLES ===
[
  {
    "number": "01",
    "characters": "MCR",
    "scriptText": "두바이쫀득쿠키요처음보",
    "videoPrompt": "[Korean Context] Full shot, modern studio, day. Slow zoom in towards MCR, confident stance with subtle weight shift, right hand gestures expressively towards screen, eyebrows raise with curious intrigue, head tilts slightly, lips move speaking Korean dialogue:「두바이 쫀득쿠키요? 처음 보는데요?」, warm studio lighting casts soft shadows"
  },
  {
    "number": "02",
    "characters": "MCR,SC1",
    "scriptText": "시어머니가화난표정으",
    "videoPrompt": "[Korean Context] Medium shot, modern kitchen, winter morning. Slow zoom on SC1's angry face, finger pointing accusingly at MCR, lips move speaking Korean dialogue:「뭐라고? 너가 그러고도 내 며느리야!」, MCR flinches back with fear in eyes, cold fluorescent light flickers"
  },
  {
    "number": "03",
    "characters": "MCR",
    "scriptText": "며느리는슬피울고있",
    "videoPrompt": "[Korean Context] Close-up, same kitchen. Static shot on MCR's face, subtle shoulder trembles, tears slowly form in eyes, downcast gaze avoids camera, deep breath with chest rising, melancholic winter light through window"
  }
]

=== FULL SCRIPT (Read completely to understand story flow) ===
${fullScript}

=== IMAGE PROMPTS (scriptText = scene boundary marker) ===
${imagePromptList}

=== GENERATE EXACTLY ${imagePrompts.length} VIDEO PROMPTS AS JSON ARRAY ===
Remember: You are the world's best storyboard artist. Each prompt must be CINEMATIC, EMOTIONAL, and create HOOKS that make viewers unable to look away.`;

    
    // ★ 별도 API 호출 (temperature 제거, maxOutputTokens = 65536)
    const maxOutputTokens = 65536;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 900000);
    
    let response;
    try {
        response = await fetch(`${GEMINI_API_BASE}/${_activeGeminiModel}:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal,
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: {
                    maxOutputTokens,
                    topP: 0.95,
                    topK: 40
                }
            })
        });
    } catch (e) {
        clearTimeout(timeout);
        if (e.name === 'AbortError') {
            const error = new Error('API_ERROR:응답 시간 초과 (15분)');
            error.code = 'API_ERROR';
            throw error;
        }
        // 네트워크 오류
        const error = new Error(`API_ERROR:네트워크 오류 - ${e.message}`);
        error.code = 'API_ERROR';
        throw error;
    }
    clearTimeout(timeout);
    
    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        
        if (response.status === 429) {
            const error = new Error('API_QUOTA:API 사용량 초과');
            error.code = 'API_QUOTA';
            throw error;
        }
        
        const error = new Error(`API_ERROR:${errorData.error?.message || `HTTP ${response.status}`}`);
        error.code = 'API_ERROR';
        throw error;
    }
    
    const data = await response.json();
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    
    // ★ 상세 디버그 로그
    
    return parseVideoPromptResponse(rawText, imagePrompts);
}

/**
 * 동영상 프롬프트 응답 파싱
 * ★ JSON 파싱 오류 다양한 사례 대처 (특수문자, 줄바꿈, 이스케이프 등)
 * ★ 파싱 실패 시 PARSE_FAILED 에러 throw → popup.js에서 토스트 + 이미지 프롬프트 대체
 */
function parseVideoPromptResponse(text, imagePrompts) {
    const expectedCount = imagePrompts.length;
    
    if (!text || text.trim().length === 0) {
        const error = new Error('PARSE_FAILED:응답이 비어있습니다');
        error.code = 'PARSE_FAILED';
        throw error;
    }
    
    // ★ JSON 정제: 다양한 오류 사례 대처
    let cleanText = text
        .replace(/```json\s*/gi, '')
        .replace(/```\s*/g, '')
        .replace(/[\u0000-\u001F\u007F]/g, ' ')  // 제어 문자 제거
        .replace(/\r\n/g, ' ')                    // Windows 줄바꿈
        .replace(/\r/g, ' ')                      // Mac 줄바꿈
        .replace(/\n/g, ' ')                      // Unix 줄바꿈
        .replace(/\t/g, ' ')                      // 탭
        .replace(/\\n/g, ' ')                     // 이스케이프된 줄바꿈
        .replace(/\\r/g, ' ')                     // 이스케이프된 캐리지 리턴
        .replace(/\\t/g, ' ')                     // 이스케이프된 탭
        .replace(/\s+/g, ' ')                     // 연속 공백 → 단일 공백
        .trim();
    
    
    // ★ 1차 시도: 직접 파싱
    try {
        const startIdx = cleanText.indexOf('[');
        const endIdx = cleanText.lastIndexOf(']');
        
        if (startIdx !== -1 && endIdx > startIdx) {
            const jsonStr = cleanText.substring(startIdx, endIdx + 1);
            const arr = JSON.parse(jsonStr);
            if (Array.isArray(arr) && arr.length > 0) {
                const parsedNums = arr.map(p => p.number).join(', ');
                if (arr.length < expectedCount) {
                }
                return _normalizeVideoPrompts(arr, imagePrompts);
            }
        }
    } catch (e) {
    }
    
    // ★ 2차 시도: 정제 후 파싱
    try {
        const startIdx = cleanText.indexOf('[');
        const endIdx = cleanText.lastIndexOf(']');
        
        if (startIdx === -1 || endIdx <= startIdx) {
            throw new Error('JSON 배열을 찾을 수 없습니다');
        }
        
        let jsonStr = cleanText.substring(startIdx, endIdx + 1);
        
        // JSON 정제
        jsonStr = jsonStr
            .replace(/,\s*}/g, '}')               // 후행 쉼표 제거 (객체)
            .replace(/,\s*\]/g, ']')              // 후행 쉼표 제거 (배열)
            .replace(/"\s*:\s*"/g, '": "')        // 키-값 공백 정규화
            .replace(/"\s*,\s*"/g, '", "')        // 항목 간 공백 정규화
            .replace(/'\s*:\s*'/g, '": "')        // 작은따옴표 → 큰따옴표 (키)
            .replace(/:\s*'([^']*)'/g, ': "$1"'); // 작은따옴표 → 큰따옴표 (값)
        
        const arr = JSON.parse(jsonStr);
        if (Array.isArray(arr) && arr.length > 0) {
            const parsedNums = arr.map(p => p.number).join(', ');
            if (arr.length < expectedCount) {
            }
            return _normalizeVideoPrompts(arr, imagePrompts);
        }
    } catch (e) {
    }
    
    // ★ 3차 시도: 잘린 JSON 복구 (마지막 완전한 객체까지만 사용)
    try {
        const startIdx = cleanText.indexOf('[');
        if (startIdx !== -1) {
            let truncated = cleanText.substring(startIdx);
            
            // 마지막 완전한 } 찾기
            const lastBrace = truncated.lastIndexOf('}');
            if (lastBrace > 0) {
                truncated = truncated.substring(0, lastBrace + 1);
                // 후행 쉼표 제거 후 ] 추가
                truncated = truncated.replace(/,\s*$/, '') + ']';
                
                const arr = JSON.parse(truncated);
                if (Array.isArray(arr) && arr.length > 0) {
                    const parsedNums = arr.map(p => p.number).join(', ');
                    return _normalizeVideoPrompts(arr, imagePrompts);
                }
            }
        }
    } catch (e) {
    }
    
    // ★ 4차 시도: 문자열 값 내부 따옴표 이스케이프 처리
    try {
        const startIdx = cleanText.indexOf('[');
        const endIdx = cleanText.lastIndexOf(']');
        
        if (startIdx !== -1 && endIdx > startIdx) {
            let jsonStr = cleanText.substring(startIdx, endIdx + 1);
            
            // 문자열 값 내부의 이스케이프되지 않은 따옴표 처리
            // "key": "value with "quotes" inside" → "key": "value with \"quotes\" inside"
            jsonStr = jsonStr.replace(/"([^"]*)":\s*"([^"]*)"/g, (match, key, value) => {
                // 값 내부의 따옴표가 이미 이스케이프되어 있지 않으면 이스케이프
                const escapedValue = value.replace(/(?<!\\)"/g, '\\"');
                return `"${key}": "${escapedValue}"`;
            });
            
            // 후행 쉼표 제거
            jsonStr = jsonStr.replace(/,\s*}/g, '}').replace(/,\s*\]/g, ']');
            
            const arr = JSON.parse(jsonStr);
            if (Array.isArray(arr) && arr.length > 0) {
                const parsedNums = arr.map(p => p.number).join(', ');
                return _normalizeVideoPrompts(arr, imagePrompts);
            }
        }
    } catch (e) {
    }
    
    // ★ 5차 시도: 개별 객체 추출 (정규식 - 이스케이프된 따옴표 지원)
    try {
        // ★ 개선된 패턴: (?:[^"\\]|\\.)* → 이스케이프된 따옴표(\")도 매칭
        const objectPattern = /\{\s*"number"\s*:\s*"((?:[^"\\]|\\.)*)"\s*,\s*"characters"\s*:\s*"((?:[^"\\]|\\.)*)"\s*,\s*"scriptText"\s*:\s*"((?:[^"\\]|\\.)*)"\s*,\s*"videoPrompt"\s*:\s*"((?:[^"\\]|\\.)*)"\s*\}/g;
        const matches = [];
        let match;
        
        while ((match = objectPattern.exec(cleanText)) !== null) {
            matches.push({
                number: match[1].replace(/\\"/g, '"'),  // 이스케이프 복원
                characters: match[2].replace(/\\"/g, '"'),
                scriptText: match[3].replace(/\\"/g, '"'),
                videoPrompt: match[4].replace(/\\"/g, '"')
            });
        }
        
        if (matches.length > 0) {
            const parsedNums = matches.map(p => p.number).join(', ');
            return _normalizeVideoPrompts(matches, imagePrompts);
        }
    } catch (e) {
    }
    
    // ★ 6차 시도: 번호 기반 개별 추출 (가장 유연한 방식)
    try {
        const matches = [];
        
        // 각 번호에 대해 해당 객체 찾기
        for (let i = 1; i <= expectedCount; i++) {
            const numStr = String(i).padStart(2, '0');
            const numStrAlt = String(i);  // "1", "2" 형식도 시도
            
            // "number": "01" 또는 "number": "1" 패턴 찾기
            const patterns = [
                new RegExp(`"number"\\s*:\\s*"${numStr}"[^}]*"videoPrompt"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`, 'i'),
                new RegExp(`"number"\\s*:\\s*"${numStrAlt}"[^}]*"videoPrompt"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`, 'i'),
                new RegExp(`"number"\\s*:\\s*${i}[^}]*"videoPrompt"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`, 'i')  // 숫자 형식
            ];
            
            let found = false;
            for (const pattern of patterns) {
                const match = cleanText.match(pattern);
                if (match) {
                    // 해당 객체 전체 찾기
                    const objMatch = cleanText.match(new RegExp(`\\{[^{}]*"number"\\s*:\\s*"?${numStr}"?[^{}]*\\}|\\{[^{}]*"number"\\s*:\\s*"?${numStrAlt}"?[^{}]*\\}`, 'i'));
                    
                    let characters = '';
                    let scriptText = '';
                    
                    if (objMatch) {
                        const charMatch = objMatch[0].match(/"characters"\s*:\s*"((?:[^"\\]|\\.)*)"/);
                        const scriptMatch = objMatch[0].match(/"scriptText"\s*:\s*"((?:[^"\\]|\\.)*)"/);
                        if (charMatch) characters = charMatch[1].replace(/\\"/g, '"');
                        if (scriptMatch) scriptText = scriptMatch[1].replace(/\\"/g, '"');
                    }
                    
                    matches.push({
                        number: numStr,
                        characters: characters,
                        scriptText: scriptText,
                        videoPrompt: match[1].replace(/\\"/g, '"')
                    });
                    found = true;
                    break;
                }
            }
            
            if (!found) {
            }
        }
        
        if (matches.length > 0) {
            const parsedNums = matches.map(p => p.number).join(', ');
            if (matches.length < expectedCount) {
            }
            return _normalizeVideoPrompts(matches, imagePrompts);
        }
    } catch (e) {
    }
    
    // 모든 시도 실패
    const error = new Error('PARSE_FAILED:JSON 파싱에 실패했습니다. 이미지 프롬프트로 대체합니다.');
    error.code = 'PARSE_FAILED';
    throw error;
}

/**
 * 동영상 프롬프트 정규화 (헬퍼 함수)
 * ★ number는 항상 2자리 문자열로 정규화 (01, 02, ... 형식)
 * ★ 누락된 번호는 이미지 프롬프트 정보로 fallback 자동 생성
 */
function _normalizeVideoPrompts(arr, imagePrompts) {
    const expectedCount = imagePrompts.length;
    
    // ★ Gemini 응답을 번호 기반 맵으로 변환
    const responseMap = new Map();
    arr.forEach(p => {
        let rawNum = p.number;
        let normalizedNum;
        if (typeof rawNum === 'number') {
            normalizedNum = String(rawNum).padStart(2, '0');
        } else if (typeof rawNum === 'string') {
            const numPart = parseInt(rawNum, 10);
            normalizedNum = isNaN(numPart) ? null : String(numPart).padStart(2, '0');
        }
        if (normalizedNum) {
            responseMap.set(normalizedNum, p);
        }
    });
    
    
    // ★ 이미지 프롬프트 개수만큼 결과 배열 생성 (누락 시 fallback)
    const result = [];
    const missingNumbers = [];
    
    for (let i = 0; i < expectedCount; i++) {
        const imgPrompt = imagePrompts[i] || {};
        const expectedNum = String(i + 1).padStart(2, '0');
        
        // ★ 해당 번호의 Gemini 응답 찾기
        const geminiResponse = responseMap.get(expectedNum);
        
        if (geminiResponse) {
            // Gemini가 응답한 경우
            result.push({
                number: expectedNum,
                characters: geminiResponse.characters || imgPrompt.characters || '',
                scriptText: geminiResponse.scriptText || imgPrompt.scriptText || '',
                videoPrompt: geminiResponse.videoPrompt || geminiResponse.prompt || ''
            });
        } else {
            // ★ 누락된 경우: 해당 이미지 프롬프트를 그대로 동영상 프롬프트로 사용
            missingNumbers.push(expectedNum);
            
            // ★ 이미지 프롬프트의 전체 prompt를 동영상 프롬프트로 사용
            const imageFullPrompt = imgPrompt.prompt || 
                `${imgPrompt.sceneDesc || ''} ${imgPrompt.charProps || ''} ${imgPrompt.action || ''}`.trim() ||
                'slow camera movement, subtle animation';
            
            result.push({
                number: expectedNum,
                characters: imgPrompt.characters || '',
                scriptText: imgPrompt.scriptText || '',
                videoPrompt: imageFullPrompt  // ★ 이미지 프롬프트 그대로 사용
            });
        }
    }
    
    // ★ 누락 항목 상세 로그
    if (missingNumbers.length > 0) {
    } else {
    }
    
    // ★ 최종 검증
    const finalNumbers = result.map(r => r.number);
    
    if (result.length !== expectedCount) {
    } else {
    }
    
    return result;
}
