if(typeof console!=="undefined" && (typeof globalThis!=="undefined" && globalThis.__FLOW_SILENT__ === true)){console.log=function(){};console.warn=function(){};console.error=function(){};}
/**
 * settings.js — 설정 관리 유틸리티
 * chrome.storage.local 기반 (localStorage 대체)
 */

const DEFAULT_SETTINGS = {
    // API
    geminiApiKey: '',
    geminiApiKeyPaid: '',
    geminiModel: 'gemini-3-flash-preview',

    // 캐릭터
    nationality: 'korean',

    // 다운로드
    downloadFolder: 'AI4Next',
    projectName: '',

    // 비율
    aspectRatio: '16:9',
    flowImageModel: 'Nano Banana 2 Lite',
    outputCount: 1,

    // 비디오
    videoResolution: '480p',
    videoDuration: '6s',
    videoPreset: 'normal',

    // 딜레이
    promptDelay: 30,
    promptSeparator: '###',

    // 기본 프롬프트
    defaultVideoPrompt: 'Dynamic action, Active camera angle',

    // 스타일
    selectedStyle: '',
    customStyles: [],

    // UI
    theme: 'light',
    language: 'ko',
    settingsPanel: 'basic',

    // 모드
    lastMode: 'textToImage'
};

/**
 * 설정 저장
 * @param {Object} settings - 저장할 설정 (부분 가능)
 * @returns {Promise<void>}
 */
async function saveSettings(settings) {
    return new Promise((resolve) => {
        chrome.storage.local.set({ grokSettings: settings }, resolve);
    });
}

/**
 * 설정 로드
 * @returns {Promise<Object>} 전체 설정 (기본값 병합)
 */
async function loadSettings() {
    return new Promise((resolve) => {
        chrome.storage.local.get('grokSettings', (result) => {
            const saved = result.grokSettings || {};
            resolve({ ...DEFAULT_SETTINGS, ...saved });
        });
    });
}

/**
 * 단일 설정값 업데이트
 * @param {string} key 
 * @param {*} value 
 * @returns {Promise<void>}
 */
async function updateSetting(key, value) {
    const settings = await loadSettings();
    settings[key] = value;
    return saveSettings(settings);
}

/**
 * 설정 초기화
 * @returns {Promise<void>}
 */
async function resetSettings() {
    return saveSettings({ ...DEFAULT_SETTINGS });
}

/**
 * 프리미엄 기능 폴백 적용
 * @param {Object} settings 
 * @param {Object} premium - { has720p: boolean, has10s: boolean }
 * @returns {Object} 보정된 설정
 */
function applyPremiumFallback(settings, premium) {
    const result = { ...settings };

    if (!premium.has720p && settings.videoResolution === '720p') {
        result.videoResolution = '480p';
        result._fallbackApplied = true;
        result._fallbackMessage = '720p is premium-only. Falling back to 480p.';
    }

    if (!premium.has10s && settings.videoDuration === '10s') {
        result.videoDuration = '6s';
        result._fallbackApplied = true;
        result._fallbackMessage = (result._fallbackMessage || '') + ' 10s is premium-only. Falling back to 6s.';
    }

    return result;
}
