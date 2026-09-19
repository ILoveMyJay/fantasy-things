if(typeof console!=="undefined"){console.log=function(){};console.warn=function(){};console.error=function(){};}
/**
 * filename.js — 파일명 생성 유틸리티
 * plan3.0 섹션 10.2 기반
 */

// Guard: 중복 주입 방지
if (typeof window.__flowFilenameLoaded !== 'undefined') {
} else {
    window.__flowFilenameLoaded = true;

/**
 * 파일명에서 특수문자 제거
 * 한글, 영문, 일문(히라가나/카타카나/한자), 숫자만 허용. 공백 제거(영문/일문 포함)
 * @param {string} text
 * @returns {string}
 */
function sanitizeFilename(text) {
    const safeText = text || 'Untitled';
    let name = safeText
        // ★ 괄호 안 내용 제거 — 모든 언어(한/영/일/중/아랍 등) 공통
        //   [...] 대괄호: [Korean Context], [no name labels] 등 메타 태그
        //   (...) 소괄호: (sub note), (Amy Slaton vibe) 등
        //   {...} 중괄호: {variable}, {placeholder} 등
        //   [\s\S]*? : 줄바꿈 포함 lazy 매칭 (multi-line 안전)
        .replace(/\[[\s\S]*?\]/g, '')
        .replace(/\([\s\S]*?\)/g, '')
        .replace(/\{[\s\S]*?\}/g, '')
        // ★ 허용 문자 화이트리스트 — 주요 언어 유니코드 범위 포함
        //   a-zA-Z0-9        : 라틴 알파벳 + 숫자
        //   가-힣            : 한글 완성형
        //   \u3040-\u309F    : 히라가나
        //   \u30A0-\u30FF    : 카타카나
        //   \u4E00-\u9FFF    : CJK 통합 한자 (중/일 공용)
        //   \u00C0-\u024F    : 라틴 확장 (베트남어/유럽어 악센트)
        //   \u0600-\u06FF    : 아랍어 기본
        //   \u0750-\u077F    : 아랍어 보충
        //   \u0E00-\u0E7F    : 태국어
        //   \u0400-\u04FF    : 키릴 (러시아어 등)
        //   \s               : 공백 (뒤에서 제거)
        .replace(/[^a-zA-Z0-9가-힣\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF\u00C0-\u024F\u0600-\u06FF\u0750-\u077F\u0E00-\u0E7F\u0400-\u04FF\s]/g, '')
        .replace(/\s+/g, '')
        .substring(0, 16);
    return name || 'untitled';
}

/**
 * 파일명 name 부분용: 캐릭터 코드(MCR, SC1, SC2 등) 제거 후 대사/설명만 반환
 * 공백 없이 붙은 "MCRSC1그날은금요일밤이"도 처리 (\b 미사용)
 */
function scriptTextForFilename(text) {
    if (!text || typeof text !== 'string') return '';
    return text
        .replace(/MCR/gi, '')
        .replace(/SC\d{1,2}/g, '')
        .replace(/TC\d{1,2}/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * 모드별 파일명 생성 (Whisk Factory 동일 규칙)
 * scriptToImage: scriptText(대본 세 번째 줄)를 파일명에 사용
 * @param {Object} options
 * @param {string} options.mode
 * @param {number} options.promptIndex - 프롬프트 인덱스 (0-based)
 * @param {number} [options.imageIndex] - 이미지 인덱스 (0-based)
 * @param {string} [options.scriptText] - 대본 텍스트 (프롬프트의 세 번째 줄)
 * @param {string} [options.promptText] - 프롬프트 텍스트 (fallback)
 * @param {string} [options.characterCode] - 캐릭터 코드 (예: MCR, MCR_SC1)
 * @param {string} [options.sceneNumber] - 씬 번호 (예: '01')
 * @param {string} [options.originalFilename] - 원본 파일명 (이미지→비디오용)
 * @param {boolean} [options.isCharacterRef] - 캐릭터 레퍼런스 여부 (true면 씬번호 없이 MCR_a_이름.jpg)
 * @returns {string}
 */
function generateFilename(options) {
    const {
        mode,
        promptIndex = 0,
        imageIndex = 0,
        scriptText = '',
        promptText = '',
        characterCode = '',
        sceneNumber = '',
        originalFilename = '',
        isCharacterRef = false,
        skipLetter = false  // ★ v1.1.4: outputCount=1 시 letter(_a) 생략
    } = options;

    const letter = skipLetter ? '' : String.fromCharCode(97 + imageIndex); // a, b, c... or '' if single output
    // ★ 캐릭터 코드 처리 — 'BG' 또는 빈 값은 파일명에서 생략 (의미 없는 기본값이므로)
    //   - 매칭된 유효 코드(MCR/SC1~5): 파일명에 포함
    //   - BG / '' / null: 파일명에서 생략 → S01_a_텍스트.jpg
    const rawChar = (characterCode || '').trim().toUpperCase();
    const isValidCharCode = rawChar && rawChar !== 'BG';
    const charCode = isValidCharCode ? rawChar.replace(/[\s,]+/g, '_') : '';
    const charPart = charCode ? `${charCode}_` : '';

    const ext = (mode === 'textToVideo' || mode === 'imageToVideo') ? 'mp4' : 'jpg';
    const rawName = scriptTextForFilename(scriptText || promptText) || (scriptText || promptText);
    const nameText = sanitizeFilename(rawName);
    // ★ v1.1.4: letter 가 빈 문자열이면 underscore 도 생략 (S01_MCR_text.jpg 형태)
    const letterPart = letter ? `${letter}_` : '';

    // 캐릭터 레퍼런스 전용: 씬번호 없이 MCR_a_이수아.jpg
    if (isCharacterRef) {
        // 레퍼런스 생성 자체는 반드시 코드 필요 (MCR / SC1~5) → 생략 규칙 미적용
        const refCode = charCode || 'MCR';
        return `${refCode}_${letterPart}${nameText}.${ext}`;
    }

    // ★ sceneNum 정규화: S01, S02 형식만 허용 (S-1, S0 등 방지)
    let sceneNum = '';
    const raw = String(sceneNumber || '').trim();
    const parsed = parseInt(raw, 10);
    if (raw && !isNaN(parsed) && parsed >= 1 && parsed <= 99) {
        sceneNum = String(parsed).padStart(2, '0');
    }
    if (!sceneNum) sceneNum = String(Math.max(1, promptIndex + 1)).padStart(2, '0');
    const seqNum = String(promptIndex + 1).padStart(3, '0');

    switch (mode) {
        case 'scriptToImage':
        case 'textToImage':
        case 'textToVideo':
            return `S${sceneNum}_${charPart}${letterPart}${nameText}.${ext}`;

        case 'imageToVideo': {
            if (originalFilename) {
                return originalFilename.replace(/\.\w+$/, '.mp4');
            }
            return `S${sceneNum}_${charPart}${letterPart}${nameText}.mp4`;
        }

        default:
            return `S${sceneNum}_${charPart}${letterPart}${nameText}.${ext}`;
    }
}

/**
 * Flow Factory 파일명 생성
 * generateFilename 사용: S{sceneNum}_{charCode}_{letter}_{nameText}.jpg
 * @param {Object} tile - parseGalleryUrls() 결과 항목
 * @param {string[]} prompts - 프롬프트 배열
 * @param {string} projectName - 프로젝트명
 * @param {Array} [payloads] - payload 배열 (scriptText, characters, number 등)
 * @param {Object} [settings] - 설정 (mode 등)
 * @param {Object} [overridePayload] - 해당 타일의 payload (재생성 시 payloads 인덱스 불일치 방지)
 * @returns {string} projectName/S01_MCR_a_hand_holding.jpg
 */
function buildFilename(tile, prompts, projectName, payloads, settings, overridePayload) {
    const { promptNo, slot } = tile;
    const promptIndex = promptNo - 1;
    const imageIndex = Math.max(0, ['A', 'B', 'C', 'D'].indexOf(slot));
    const payload = overridePayload || (payloads && payloads[promptIndex]) || {};
    const mode = (settings && settings.mode) || 'textToImage';
    const isCharacterRef = payload.type === 'characterRef';

    let promptText = payload.rawPrompt || payload.prompt || prompts[promptIndex] || '';
    promptText = promptText.replace(/^(?:Generate an image:\s*|Refer to attached style image\.\s*Generate:\s*)/i, '').trim();

    // ★ v1.1.4: outputCount=1 시 _a 접미사 생략 (단일 이미지면 letter 불필요)
    const outputCount = Math.max(1, Math.min(4, Number(payload.outputCount) || 1));
    const skipLetter = outputCount === 1 && !isCharacterRef;

    const baseName = generateFilename({
        mode,
        promptIndex,
        imageIndex,
        scriptText: isCharacterRef ? (payload.name || '') : (payload.scriptText || ''),
        promptText,
        characterCode: isCharacterRef ? (payload.code || payload.characters || 'MCR') : (payload.characters || ''),
        sceneNumber: payload.number || '',
        isCharacterRef,
        skipLetter
    });

    return `${projectName}/${baseName}`;
}

/**
 * 실패 로그 생성
 * @param {Array} failedItems - 실패 아이템 배열
 * @returns {string}
 */
function generateFailedLog(failedItems) {
    const now = new Date().toISOString();
    let log = `# FLOW Factory - Failed Prompts Log\n`;
    log += `# Generated: ${now}\n`;
    log += `# Total Failed: ${failedItems.length}\n`;
    log += `${'='.repeat(60)}\n\n`;

    failedItems.forEach((item, idx) => {
        log += `[${idx + 1}] Prompt #${String(item.promptIndex + 1).padStart(2, '0')}\n`;
        log += `${'─'.repeat(36)}\n`;
        log += `Mode: ${item.mode}\n`;
        if (item.imageName) log += `Image: ${item.imageName}\n`;
        log += `Error: ${item.error}\n`;
        log += `Prompt: "${item.prompt}"\n\n`;
    });

    return log;
}

// Content Script / Side Panel에서 사용
if (typeof window !== 'undefined') {
    window.sanitizeFilename = sanitizeFilename;
    window.scriptTextForFilename = scriptTextForFilename;
    window.generateFilename = generateFilename;
    window.generateFailedLog = generateFailedLog;
    window.buildFilename = buildFilename;
}

} // End of guard
