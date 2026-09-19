if(typeof console!=="undefined"){console.log=function(){};console.warn=function(){};console.error=function(){};}
/**
 * flow-selectors.js — FLOW Factory DOM 셀렉터
 * PDF HTML 전수 분석 기반 확정 셀렉터 (2026-03-07)
 * 동적 요소(NEW_PROJECT, MODEL_SETTINGS, MODEL_DROPDOWN)는 헬퍼 함수 사용
 */

const SELECTORS = {
  // STEP 1: add_2 + "새 프로젝트" — findNewProjectButton() 사용
  NEW_PROJECT: null,

  // STEP 2: settings_2 아이콘 — findSettingsButton() 사용
  SETTINGS_BTN: null,

  // STEP 3~5
  GRID_MODE: 'button[aria-label="Grid"]',
  GRID_SMALL: 'button[aria-label="작게"]',
  // STEP 5: 제출 시 프롬프트 지우기 → 사용 (findClearOnSubmitEnableButton 사용)
  CLEAR_ON_SUBMIT: null,

  // STEP 7: submit 부모 내 탐색 — findModelSettingsButton() 사용
  MODEL_SETTINGS_BTN: null,

  // STEP 8~10
  IMAGE_TAB: 'button[id*="trigger-IMAGE"]',
  VIDEO_TAB: 'button[id*="trigger-VIDEO"]',
  LANDSCAPE: 'button[id*="trigger-LANDSCAPE"]',
  PORTRAIT: 'button[id*="trigger-PORTRAIT"]',
  COUNT_X2: 'button[id$="trigger-2"]',

  // STEP 11: submit 부모 내 탐색 — findModelDropdownButton() 사용
  MODEL_DROPDOWN: null,

  MODEL_NB_2_LITE: 'Nano Banana 2 Lite',
  MODEL_NB_PRO: 'Nano Banana Pro',
  MODEL_NB_2: 'Nano Banana 2',

  // STEP 14~15
  PROMPT_INPUT: '[contenteditable="true"][data-slate-editor="true"], .ProseMirror[contenteditable="true"]',
  SUBMIT_BTN_ICON: '.google-symbols',

  TILE: '[data-tile-id], flow-grid-tile-container',
  TILE_IMG: '[data-tile-id] img, flow-grid-tile-container img[data-media-id]',
  TILE_LOADING: '[data-tile-id] img[src=""], flow-grid-tile-container img[src=""]',

  PROGRESS_REGEX: /(\d+)%/,
  DONE_URL_KEY: 'getMediaUrlRedirect'
};

const URL_PATTERNS = {
  MEDIA_URL: 'https://flow.google.com/api/trpc/media.getMediaUrlRedirect?name=',
  FLOW_PAGE: 'flow.google.com'
};

if (typeof window !== 'undefined') {
  window.SELECTORS = SELECTORS;
  window.URL_PATTERNS = URL_PATTERNS;
}
