if(typeof console!=="undefined" && (typeof globalThis!=="undefined" && globalThis.__FLOW_SILENT__ === true)){console.log=function(){};console.warn=function(){};console.error=function(){};}
/**
 * flow-automation.js — FLOW Factory DOM 자동화 유틸
 */

if (typeof window.__flowAutomationLoaded !== 'undefined') {
} else {
  window.__flowAutomationLoaded = true;


const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const PROMPT_EDITOR_SELECTOR = '[contenteditable="true"][data-slate-editor="true"], .ProseMirror[contenteditable="true"]';
const FLOW_TILE_SELECTOR = '[data-tile-id], flow-grid-tile-container';

function getFlowTiles() {
  return document.querySelectorAll(FLOW_TILE_SELECTOR);
}

function getFlowTileId(tile) {
  return tile?.getAttribute('data-tile-id') || tile?.querySelector('img[data-media-id]')?.getAttribute('data-media-id') || '';
}

function countFlowTiles() {
  const tiles = [...getFlowTiles()];
  const ids = tiles.map(getFlowTileId).filter(Boolean);
  return ids.length ? new Set(ids).size : tiles.length;
}

function isCompletedMediaUrl(src) {
  return !!src && (src.includes('getMediaUrlRedirect') || /^https:\/\/flow-content\.google\/(?:image|video)\//.test(src));
}

function getFlowMediaName(src, tile) {
  return src?.match(/[?&]name=([^&]+)/)?.[1]
    || tile?.querySelector('img[data-media-id]')?.getAttribute('data-media-id')
    || src?.match(/\/(?:image|video)\/([^?]+)/)?.[1]
    || '';
}

function findPromptEditor() {
  return document.querySelector(PROMPT_EDITOR_SELECTOR);
}

function isElementVisible(el) {
  if (!el) return false;
  const rect = el.getBoundingClientRect();
  const style = window.getComputedStyle(el);
  return rect.width > 0 && rect.height > 0
    && style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
}

async function waitForElement(selector, visible = true, timeout = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const el = document.querySelector(selector);
    if (el) {
      if (!visible) return el;
      if (isElementVisible(el)) return el;
    }
    await sleep(200);
  }
  throw new Error(`waitForElement timeout: ${selector}`);
}

function findImageFileInput() {
  return [...document.querySelectorAll('input[type="file"]')].find(input =>
    /image\/|\.(?:png|jpe?g|webp|gif|heif|heic)\b/i.test(input.accept || '')
  ) || null;
}

async function ensureImageFileInput(timeout = 5000) {
  let input = findImageFileInput();
  if (input) return input;

  const addBtn = document.querySelector('button.add-menu-trigger, button[aria-label="Add ingredients to the prompt box"]');
  if (addBtn && addBtn.getAttribute('aria-expanded') !== 'true') addBtn.click();

  const start = Date.now();
  let uploadBtn = null;
  while (Date.now() - start < timeout) {
    uploadBtn = document.querySelector('button.sidebar-upload-btn') || [...document.querySelectorAll('button')].find(btn =>
      btn.querySelector('.google-symbols')?.textContent?.trim() === 'upload'
    );
    if (uploadBtn) break;
    await sleep(100);
  }
  if (!uploadBtn) throw new Error('Flow upload button not found');
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Flow upload bridge timeout')), timeout);
    window.addEventListener('__flowPrepareUploadInputDone', (event) => {
      clearTimeout(timer);
      event.detail?.ok ? resolve() : reject(new Error(event.detail?.error || 'Flow upload input not created'));
    }, { once: true });
    window.dispatchEvent(new CustomEvent('__flowPrepareUploadInput'));
  });

  while (Date.now() - start < timeout) {
    input = findImageFileInput();
    if (input) return input;
    await sleep(100);
  }
  throw new Error('Flow image upload input not found');
}

let clickMutex = false;

async function simulateClick(el) {
  if (!el) throw new Error('simulateClick: 요소 없음');
  if (clickMutex) await sleep(100);
  clickMutex = true;

  try {
    el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    await sleep(50);
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const opts = { bubbles: true, cancelable: true, composed: true, clientX: cx, clientY: cy };

    // ★ v1.1.2: submit 버튼 판별 — native click 단독 사용 (합성 click 중복 제출 방지)
    const submitIcon = el.querySelector?.('.google-symbols');
    const isSubmitBtn = submitIcon && submitIcon.textContent.trim() === 'arrow_forward';

    // hover → press → release (Flow UI 시각 피드백용)
    el.dispatchEvent(new PointerEvent('pointerover', opts));
    el.dispatchEvent(new PointerEvent('pointerenter', opts));
    el.dispatchEvent(new MouseEvent('mouseover', opts));
    el.dispatchEvent(new MouseEvent('mouseenter', opts));
    el.dispatchEvent(new PointerEvent('pointerdown', opts));
    el.dispatchEvent(new MouseEvent('mousedown', opts));
    el.dispatchEvent(new PointerEvent('pointerup', opts));
    el.dispatchEvent(new MouseEvent('mouseup', opts));

    if (isSubmitBtn) {
      // ★ v1.1.3: CDP 실제 마우스 클릭 + attach 후 좌표 재측정 (알림바 시프트 대응)
      console.log(`[SUBMIT-DEBUG] CDP 클릭 시도: 원래좌표=(${Math.round(cx)},${Math.round(cy)})`);
      const cdpResult = await new Promise((resolve) => {
        chrome.runtime.sendMessage({
          type: 'CDP_CLICK',
          x: Math.round(cx),
          y: Math.round(cy),
          selector: '.google-symbols'
        }, (r) => {
          resolve(r || { ok: false, error: 'no response' });
        });
      });
      console.log('[SUBMIT-DEBUG] CDP 응답:', JSON.stringify(cdpResult));
      if (!cdpResult.ok) {
        console.warn('[SUBMIT] CDP 클릭 실패, native 폴백', cdpResult.error);
        el.click();
      }
    } else {
      // ★ v1.1.8 #3 재설계: 클릭은 기존 합성 방식(작동 보장) + 클릭 직전 CDP 마우스 궤적 이동만
      //   배경: 전체 CDP 클릭화는 React navigation 버튼(새 프로젝트 등)을 트리거 못 해 깨짐
      //   해결: CDP는 "마우스를 버튼까지 사람처럼 이동"만 (isTrusted mousemove 궤적 = reCAPTCHA 신호)
      //         실제 클릭은 검증된 합성 dispatchEvent (navigation 정상 작동)
      const inViewport = cx > 0 && cy > 0 && cx < window.innerWidth && cy < window.innerHeight;
      if (inViewport) {
        // 마우스 궤적만 — fire-and-forget (클릭 동작에 영향 없음, 실패해도 무시)
        try {
          chrome.runtime.sendMessage({ type: 'CDP_MOVE_TO', x: Math.round(cx), y: Math.round(cy) });
        } catch (_) { /* noop */ }
        await sleep(120 + Math.floor(Math.random() * 200));  // 이동 시간 확보 (120~320ms)
      }
      el.dispatchEvent(new MouseEvent('click', opts));
    }

    // Radix Tabs는 React 합성 이벤트 사용 — dispatchEvent만으로는 미반응 시 native click 보완
    const id = el.id || '';
    if (id.includes('trigger-IMAGE') || id.includes('trigger-VIDEO') || el.getAttribute('role') === 'tab') {
      el.click();
    }
    await sleep(300);
  } finally {
    clickMutex = false;
  }
}

/**
 * ★ v1.1.8 Tier1-A: 인간화 요소 클릭 — 모달 항목/+ 버튼 등 el.click() 이 필요한 경우용
 *   배경: 캐릭터 ref/이미지 선택 모달 클릭이 직접 el.click() (마우스 궤적 없음) → 봇 신호 누적
 *   방식: CDP 마우스 궤적 이동(isTrusted mousemove) → el.click() (모달 항목은 native click 확실)
 *   simulateClick 과 달리 좌표 클릭이 아닌 el.click() 사용 (모달 항목 React 핸들러 호환)
 *   반환: 없음 (호출부가 기존처럼 후속 폴링으로 결과 판정)
 */
async function humanClick(el, { scroll = true } = {}) {
  if (!el) return;
  try {
    // ★ v1.1.8 fix: 모달 항목은 이미 보이므로 scrollIntoView 금지(스크롤이 항목 위치 어긋나게 함)
    //   scroll:false 시 궤적 이동만 후 click — 모달 항목/팝업 항목용
    if (scroll) {
      el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
      await sleep(40 + Math.floor(Math.random() * 60));
    }
    await humanMoveTo(el);
  } catch (_) { /* 좌표/이동 실패는 무시 — 클릭은 진행 */ }
  el.click();
}

/**
 * ★ v1.1.8 Tier1-A: CDP 마우스 궤적 이동만 (클릭/스크롤 없음)
 *   컨텍스트 메뉴 항목처럼 scrollIntoView 가 메뉴를 닫을 위험이 있는 경우용 —
 *   기존 클릭 로직은 그대로 두고 이 함수로 "버튼까지 마우스 이동"만 추가
 */
async function humanMoveTo(el) {
  if (!el) return;
  try {
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    if (cx > 0 && cy > 0 && cx < window.innerWidth && cy < window.innerHeight) {
      try {
        chrome.runtime.sendMessage({ type: 'CDP_MOVE_TO', x: Math.round(cx), y: Math.round(cy) });
      } catch (_) { /* noop */ }
      await sleep(120 + Math.floor(Math.random() * 200));  // 궤적 이동 시간 확보
    }
  } catch (_) { /* noop */ }
}

/** bridge 준비 폴링 — 빈 텍스트로 ping → 응답 오면 준비 완료 (__flowBridgeReady 놓침 방지) */
async function waitForBridgeReady(timeout = 3000) {
  const start = Date.now();
  let attempt = 0;
  while (Date.now() - start < timeout) {
    attempt++;
    const ready = await new Promise((resolve) => {
      window.addEventListener('__flowFillPromptDone', () => resolve(true), { once: true });
      window.dispatchEvent(new CustomEvent('__flowFillPrompt', { detail: { text: '' } }));
      setTimeout(() => resolve(false), 500);
    });
    if (ready) {
      return;
    }
    await sleep(200);
  }
}

// ★ Slate 에디터 — MAIN world page-bridge + 재시도 (첫 프롬프트 실패 방지)
// options.replaceAll: true 시 기존 내용 전부 삭제 후 입력 (플레이스홀더 "무엇을..." 제거)
async function fillPrompt(editor, text, retry = 3, options = {}) {
  for (let attempt = 0; attempt < retry; attempt++) {
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('fillPrompt 타임아웃')), 5000);
        window.addEventListener('__flowFillPromptDone', (e) => {
          clearTimeout(timer);
          e.detail.ok ? resolve() : reject(new Error(e.detail.error || '입력 실패'));
        }, { once: true });
        window.dispatchEvent(new CustomEvent('__flowFillPrompt', { detail: { text, replaceAll: !!options.replaceAll } }));
      });

      const filled = await waitForEditorFilled();
      if (filled) {
        return;
      }
      throw new Error('에디터 미반영');
    } catch (err) {
      if (attempt === retry - 1) throw err;
      await sleep(500);
    }
  }
}

async function stripMentionTriggerAt(timeout = 2000) {
  await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeout);
    window.addEventListener('__flowStripMentionTriggerAtDone', () => {
      clearTimeout(timer);
      resolve(true);
    }, { once: true });
    window.dispatchEvent(new CustomEvent('__flowStripMentionTriggerAt'));
  });
}

async function waitForEditorFilled(timeout = 3000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const el = findPromptEditor();
    let text = el?.textContent?.trim() || '';
    const ph = el?.querySelectorAll?.('[data-slate-placeholder]');
    if (ph) {
      for (const p of ph) {
        const pt = p.textContent || '';
        if (pt) text = text.split(pt).join('').trim();
      }
    }
    text = text.replace(/[\uFEFF\u200B]/g, '').trim();
    if (text.length > 0) return true;
    await sleep(100);
  }
  return false;
}

/** 패널/드롭다운 닫기 — Escape 키 (v1.1.6)
 *  이전: 좌표 (50, 200) 클릭 → 새 Flow UI에서 좌측 사이드바 "캐릭터" 메뉴 위치와 충돌
 *        → "신규 캐릭터" 페이지로 navigation 발생 → 이후 모든 단계 실패
 *  현재: Escape 키 dispatch — Radix UI 표준 닫기 동작, 좌표 무관 */
async function clickEmptyAreaToClose() {
  const opts = { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true };
  document.dispatchEvent(new KeyboardEvent('keydown', opts));
  document.dispatchEvent(new KeyboardEvent('keyup', opts));
  // 활성 요소가 있으면 그쪽에도 한 번 더 보냄 (포커스가 패널 내부일 때 대비)
  const active = document.activeElement;
  if (active && active !== document.body) {
    active.dispatchEvent(new KeyboardEvent('keydown', opts));
    active.dispatchEvent(new KeyboardEvent('keyup', opts));
  }
  await sleep(300);
}

/** 드롭다운이 완전히 닫힐 때까지 대기 */
async function waitForDropdownClosed(timeout = 3000) {
  const start = Date.now();
  let count = 0;
  while (Date.now() - start < timeout) {
    count++;
    const open = document.querySelector('[role="menu"]');
    if (!open) {
      return true;
    }
    await sleep(100);
  }
  return true;
}

/** 모델 설정 패널 닫힘 확인 — Image/Video 탭이 화면에서 사라질 때까지 */
async function waitForPanelClosed(timeout = 3000) {
  const start = Date.now();
  let count = 0;
  while (Date.now() - start < timeout) {
    count++;
    const panel = document.querySelector('button[id*="trigger-IMAGE"]');
    if (!isElementVisible(panel)) {
      return true;
    }
    await sleep(100);
  }
  return true;
}

async function waitForEditorEmpty(timeout = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const editor = findPromptEditor();
    const text = editor?.textContent?.trim() || '';
    // ★ text만 기준 — placeholder는 DOM에 항상 있을 수 있어 오탐 방지
    if (text === '') return true;
    await sleep(200);
  }
  return false;
}

async function waitForSubmitAccepted(options = {}) {
  const { timeout = 12000, tileCountBefore = 0, pollInterval = 300 } = options;
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const editorText = findPromptEditor()?.textContent?.trim() || '';
    if (editorText === '') return { accepted: true, signal: 'editor-empty' };

    const currentTiles = getFlowTiles().length;
    if (currentTiles > tileCountBefore) return { accepted: true, signal: 'new-tile' };

    await sleep(pollInterval);
  }
  return { accepted: false, signal: 'timeout' };
}

async function submitWithVerification(submitBtn, options = {}) {
  const { maxAttempts = 4, verifyTimeout = 12000, backoffBase = 1500, backoffMultiplier = 1.5 } = options;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const tileCountBefore = getFlowTiles().length;

    // ★ v1.1.3: 시도별 차별화된 사전 액션 — 같은 실패 반복 방지
    //   1차: 기본 클릭
    //   2차: 백오프 후 클릭 (DOM 안정화)
    //   3차: 에디터 재포커스 → 클릭 (Slate focus 손실 케이스)
    //   4차: 에디터 빈→원복 사이클 → 클릭 (Slate 상태 리셋)
    let preAction = 'none';
    if (attempt === 3) {
      preAction = 'editor-refocus';
      const editor = findPromptEditor();
      if (editor) {
        editor.focus();
        editor.dispatchEvent(new Event('focus', { bubbles: true }));
        await sleep(300);
        console.log('[SUBMIT-VERIFY] 3차 사전: 에디터 재포커스');
      }
    } else if (attempt === 4) {
      preAction = 'editor-reset';
      const editor = findPromptEditor();
      if (editor) {
        const originalText = editor.textContent || '';
        if (originalText.trim()) {
          console.log('[SUBMIT-VERIFY] 4차 사전: 에디터 빈→원복 사이클 시작');
          // 빈 입력
          await new Promise(resolve => {
            const t = setTimeout(resolve, 1000);
            window.addEventListener('__flowFillPromptDone', () => { clearTimeout(t); resolve(); }, { once: true });
            window.dispatchEvent(new CustomEvent('__flowFillPrompt', { detail: { text: '', replaceAll: true } }));
          });
          await sleep(200);
          // 원복
          await new Promise(resolve => {
            const t = setTimeout(resolve, 1500);
            window.addEventListener('__flowFillPromptDone', () => { clearTimeout(t); resolve(); }, { once: true });
            window.dispatchEvent(new CustomEvent('__flowFillPrompt', { detail: { text: originalText, replaceAll: true } }));
          });
          await sleep(300);
          // submit 버튼 재발견 (DOM 재구성 가능성)
          const refreshedBtn = findSubmitButton();
          if (refreshedBtn) submitBtn = refreshedBtn;
          console.log('[SUBMIT-VERIFY] 4차 사전: 에디터 리셋 완료');
        }
      }
    }

    console.log(`[SUBMIT-VERIFY] 시도 ${attempt}/${maxAttempts} (CDP 클릭, pre=${preAction}) | 타일수=${tileCountBefore}`);
    await simulateClick(submitBtn);

    // ★ v1.1.3: 클릭 직후 fast-fail 검증 — "Prompt must be provided" 감지 시 12s 대기 스킵
    //   Flow가 명시적으로 거절 메시지 표시 시 = 진정한 거절 (silent 처리 케이스 아님)
    //   → 즉시 다음 시도로 (전체 시간 절약)
    //   ★ Boolean flag로 detection 결과 보존 (토스트가 사라진 후 재검사로 누락 방지)
    let fastFailTriggered = false;
    let fastFailChecks = 0;  // 진단용 — 몇 번 체크했는지
    if (typeof window.detectPromptMustBeProvided === 'function') {
      const fastFailStart = Date.now();
      // 검사 윈도우 2.5초로 확대 (Flow 알림 표시 지연 대응) + 100ms 폴링
      while (Date.now() - fastFailStart < 2500) {
        fastFailChecks++;
        if (window.detectPromptMustBeProvided()) {
          fastFailTriggered = true;
          console.log(`[SUBMIT-VERIFY] ★ 시도 ${attempt} fast-fail: "Prompt must be provided" 감지 (${fastFailChecks}회 체크 후) — 12s timeout 스킵`);
          break;
        }
        await sleep(100);
      }
      if (!fastFailTriggered) {
        // 진단: 2.5초 동안 못 잡았음 → selector 문제 or 알림 표시 안 됨
        console.log(`[SUBMIT-VERIFY] fast-fail 감지 안 됨 (${fastFailChecks}회 체크). Flow 알림 없음 OR selector 미스. waitForSubmitAccepted 정상 진행`);
      }
      if (fastFailTriggered) {
        // ★ v1.1.3: fast-fail 후 5초 grace 검증 — Flow가 "경고 표시 + silent 처리" 패턴 대응
        //   "Prompt must be provided" 표시되더라도 실제로는 Flow가 처리할 수도 있음
        //   → 5초 더 기다려서 타일이 생기는지 확인
        //   → 타일 생성됨: silent 성공 (재시도 스킵, 중복 방지)
        //   → 타일 없음: 진짜 거절 (재시도)
        console.log(`[SUBMIT-VERIFY] 시도 ${attempt} fast-fail 후 5초 grace 검증 (silent 처리 확인)`);
        const fastFailGrace = await waitForSubmitAccepted({ tileCountBefore, timeout: 5000 });
        if (fastFailGrace.accepted) {
          console.log(`[SUBMIT-VERIFY] ★ 시도 ${attempt} fast-fail 후 타일 감지 — 경고 표시됐지만 silent 처리됨 — 재시도 스킵 (중복 방지)`);
          return { success: true, attempts: attempt, signal: 'silent-after-fastfail', method: 'click', preAction };
        }
        // 진짜 거절이면 backoff 짧게 + 다음 attempt로 (continue)
        console.log(`[SUBMIT-VERIFY] 시도 ${attempt} fast-fail 후 타일 없음 — 진짜 거절로 판정, 재시도 진행`);
        if (attempt < maxAttempts) {
          await sleep(500);
          submitBtn = findSubmitButton();
          if (submitBtn) continue;
          console.warn('[SUBMIT-VERIFY] fast-fail 후 버튼 소실');
          break;
        }
        // 마지막 시도였으면 종료
        break;
      }
    } else {
      console.warn('[SUBMIT-VERIFY] window.detectPromptMustBeProvided 함수 없음 — 확장 재로드 필요');
    }

    const result = await waitForSubmitAccepted({ tileCountBefore, timeout: verifyTimeout });
    console.log(`[SUBMIT-VERIFY] 시도 ${attempt} 결과:`, JSON.stringify(result));
    if (result.accepted) {
      return { success: true, attempts: attempt, signal: result.signal, method: 'click', preAction };
    }

    // ★ v1.1.3: timeout 직후 1차 grace 검증 — 폴링 보다 짧은 즉시 재확인
    //   waitForSubmitAccepted 의 300ms 폴링이 타일 생성 시점 사이를 놓칠 수 있음
    //   timeout 반환 직후 즉시 한 번 더 체크해서 미세한 boundary case 잡음
    const postTimeoutTile = getFlowTiles().length;
    if (postTimeoutTile > tileCountBefore) {
      console.log(`[SUBMIT-VERIFY] ★ 시도 ${attempt} timeout 직후 타일 감지 (${tileCountBefore}→${postTimeoutTile}) — 재시도 스킵`);
      return { success: true, attempts: attempt, signal: 'post-timeout-tile', method: 'click', preAction };
    }

    // ★ v1.1.3: 2차 extended grace — Flow가 느리게 처리하는 경우 추가 5초 대기
    //   "Prompt must be provided" 알림과 함께 Flow가 silent 처리하는 케이스 대응
    //   누적 DOM 부하 시 placeholder 생성이 12s 이상 걸릴 수 있음
    console.log(`[SUBMIT-VERIFY] 시도 ${attempt} grace 5초 추가 대기 (중복 submit 방지)`);
    const graceResult = await waitForSubmitAccepted({ tileCountBefore, timeout: 5000 });
    if (graceResult.accepted) {
      console.log(`[SUBMIT-VERIFY] ★ 시도 ${attempt} grace 성공 감지 — 재시도 스킵`);
      return { success: true, attempts: attempt, signal: 'grace-' + graceResult.signal, method: 'click', preAction };
    }

    if (attempt < maxAttempts) {
      const delay = backoffBase * Math.pow(backoffMultiplier, attempt - 1);
      console.log(`[SUBMIT-VERIFY] 실패 — ${Math.round(delay)}ms 백오프 후 재시도`);
      await sleep(delay);

      // ★ v1.1.3: 3차 backoff 후 안전망 — 위 grace로 못 잡은 늦은 처리 잡음
      const finalTileCount = getFlowTiles().length;
      if (finalTileCount > tileCountBefore) {
        console.log(`[SUBMIT-VERIFY] ★ 시도 ${attempt} 늦은 성공 감지 — backoff 후 타일 생성됨 (${tileCountBefore}→${finalTileCount}) — 재시도 스킵`);
        return { success: true, attempts: attempt, signal: 'late-tile', method: 'click', preAction };
      }

      submitBtn = findSubmitButton();
      if (!submitBtn) { console.warn('[SUBMIT-VERIFY] 버튼 소실 — 중단'); break; }
    }
  }
  return { success: false, attempts: maxAttempts, signal: 'exhausted' };
}

async function ensureEditorClean(timeout = 2000) {
  const editor = findPromptEditor();
  const text = editor?.textContent?.trim() || '';
  if (text === '') return true;

  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 3000);
    window.addEventListener('__flowFillPromptDone', () => { clearTimeout(timer); resolve(); }, { once: true });
    window.dispatchEvent(new CustomEvent('__flowFillPrompt', { detail: { text: '', replaceAll: true } }));
  });

  const start = Date.now();
  while (Date.now() - start < timeout) {
    const t = findPromptEditor()?.textContent?.trim() || '';
    if (t === '') return true;
    await sleep(200);
  }
  return false;
}

function findSettingsBtn() {
  return [...document.querySelectorAll('.google-symbols')]
    .find(el => el.textContent.trim() === 'settings_2')
    ?.closest('button') || document.querySelector('button[aria-label="Tile grid settings"]');
}

function findGridTab() {
  return (
    document.querySelector('[aria-controls$="-content-grid"][role="tab"]') ??
    document.querySelector('[aria-label="Grid"][role="tab"]') ??
    document.querySelector('[aria-label="그리드"][role="tab"]')
  );
}

function findSmallTab() {
  return (
    document.querySelector('[aria-controls$="-content-SMALL"][role="tab"]') ??
    document.querySelector('[aria-label="Small"][role="tab"]') ??
    document.querySelector('[aria-label="작게"][role="tab"]')
  );
}

/** 제출 시 프롬프트 지우기 → "사용"/"On" 탭 (마우스오버·타일세부정보와 구분, 한/영 지원) */
function findClearPromptTab() {
  const useSelectors = '[aria-label="사용"][role="tab"], [aria-label="Use"][role="tab"], [aria-label="On"][role="tab"]';
  const useTabs = document.querySelectorAll(useSelectors);
  for (const tab of useTabs) {
    let el = tab.parentElement;
    for (let i = 0; i < 8 && el; i++) {
      const t = (el.textContent || '').toLowerCase();
      const isClearPromptRow = t.includes('제출 시 프롬프트 지우기') || t.includes('clear prompt on submit');
      const isOtherRow = t.includes('마우스 오버') || t.includes('타일 세부정보') || t.includes('sound') || t.includes('show tile details');
      if (isClearPromptRow && !isOtherRow) return tab;
      el = el.parentElement;
    }
  }
  return document.querySelector('[aria-label="사용"][role="tab"]') ?? document.querySelector('[aria-label="Use"][role="tab"]') ?? document.querySelector('[aria-label="On"][role="tab"]');
}

function _queryAll(selector, root = document) {
  const out = [];
  const add = (r) => {
    out.push(...r.querySelectorAll(selector));
    r.querySelectorAll('*').forEach(el => { if (el.shadowRoot) add(el.shadowRoot); });
  };
  add(root);
  return out;
}

function findSubmitButton() {
  // 🥇 1순위 (기존 로직 — 불변): arrow_forward 아이콘 텍스트 매칭
  const icons = _queryAll('.google-symbols');
  const primary = [...icons].find(el => el.textContent.trim() === 'arrow_forward')?.closest('button');
  if (primary) return primary;

  // ──────────────────────────────────────────────────────────────
  // 아래 폴백은 primary가 null일 때만 실행됨 (한/영 유저 동작 변화 0)
  // Chrome 사이트번역으로 'arrow_forward' 아이콘 텍스트가 번역된 경우 대응
  // ──────────────────────────────────────────────────────────────

  // 🥈 1.5순위: 숨김 span 텍스트 "만들기"/"Create" 매칭 (v1.1.2 — arrow_forward 아이콘 텍스트 변경 시 폴백)
  try {
    const SUBMIT_SPAN = /^(만들기|create|生成|作成|criar|создать|buat|إنشاء)$/i;
    const candidateBtns = _queryAll('button');
    for (const btn of candidateBtns) {
      if (!isElementVisible(btn)) continue;
      if (!btn.querySelector('.google-symbols')) continue;
      const spans = btn.querySelectorAll('span');
      for (const span of spans) {
        if (SUBMIT_SPAN.test(span.textContent.trim())) return btn;
      }
    }
  } catch (_) { /* noop */ }

  // 🥉 2순위: aria-label 기반 (Flow i18n 설정값 — Chrome 번역 거의 안 탐)
  // 'create'/'send'/'作成' 같은 일반어 제외 — 피드백/프로젝트생성 버튼 오탐 방지
  // "생성/제출/submit/generate" 의미에 한정된 단어만 허용
  const SUBMIT_ARIA = /generate|submit|생성|제출|生成|送信|gerar|enviar|отправить|kirim|إرسال|उत्पन्न/i;
  try {
    const ariaBtns = _queryAll('button[aria-label]');
    for (const btn of ariaBtns) {
      if (!isElementVisible(btn)) continue;
      const label = btn.getAttribute('aria-label') || '';
      if (!SUBMIT_ARIA.test(label)) continue;
      if (btn.getAttribute('aria-haspopup') === 'menu') continue; // 모델 드롭다운 제외
      if (btn.querySelector('.google-symbols')) return btn;
    }
  } catch (_) { /* noop — 폴백 실패는 무시하고 다음 폴백 시도 */ }

  // 🥉 3순위: 구조 기반 (프롬프트 에디터 컨테이너 내의 google-symbols 아이콘 버튼)
  try {
    const editor = findPromptEditor();
    if (editor) {
      // 에디터 기준 조상 4단계까지 탐색하며 버튼 수집
      let container = editor.parentElement;
      for (let i = 0; i < 4 && container; i++) {
        const btns = container.querySelectorAll('button');
        for (const btn of btns) {
          if (!isElementVisible(btn)) continue;
          if (btn.getAttribute('aria-haspopup') === 'menu') continue; // 모델 드롭다운 제외
          if (!btn.querySelector('.google-symbols')) continue;
          // ★ v1.1.8: 크레딧 소진 시 제출 화살표 자리에 나타나는 주황 스티커(flow_alert_sphere + info)를
          //   제출 버튼으로 오인하지 않도록 제외 → detectCreditExhausted 경로로 정상 분기되게 함
          if (btn.querySelector('img[src*="flow_alert_sphere"]')) continue;
          // cancel/close 아이콘 제외 (잔여 이미지 삭제 버튼 등) + info(크레딧 스티커) 제외
          const iconText = (btn.querySelector('.google-symbols')?.textContent || '').trim().toLowerCase();
          if (iconText === 'cancel' || iconText === 'close' || iconText === 'more_vert' ||
              iconText === 'settings_2' || iconText === 'add_2' || iconText === 'arrow_drop_down' ||
              iconText === 'info') continue;
          return btn;
        }
        container = container.parentElement;
      }
    }
  } catch (_) { /* noop — 최종 null 반환 */ }

  return null;
}

/** fillPrompt 후 submit 버튼 활성화 대기 — React re-render 완료 확인 */
async function waitForSubmitEnabled(timeout = 3000) {
  const start = Date.now();
  let count = 0;
  while (Date.now() - start < timeout) {
    count++;
    const btn = findSubmitButton();
    if (btn && !btn.disabled && btn.getAttribute('aria-disabled') !== 'true' && btn.getAttribute('data-state') !== 'disabled') {
      return true;
    }
    await sleep(100);
  }
  return false;
}

/** STEP 7 모델 설정 버튼 — submit 부모 내 menu 버튼 (텍스트 무관: Nano Banana / 동영상 / Veo 등) */
function findModelSettingsBtn() {
  const DEBUG = window.__flowDebugModelSettings ?? false;

  // 1) submit → 부모 내 menu 버튼 또는 settings-trigger-button
  const submitBtn = findSubmitButton();
  if (submitBtn) {
    const menuBtn = submitBtn.parentElement?.querySelector('button[aria-haspopup="menu"], .settings-trigger-button');
    if (isElementVisible(menuBtn)) {
      return menuBtn;
    }
  }

  // 2) Flow 最新 UI: settings-trigger-button 类名或多语言 aria-label
  const triggerBtn = document.querySelector('.settings-trigger-button, button[aria-label="Settings trigger"], button[aria-label="设置触发器"], button[aria-label*="触发器"]');
  if (triggerBtn && isElementVisible(triggerBtn)) return triggerBtn;

  // 3) 폴백: arrow_forward와 같은 부모를 가진 menu 버튼 (shadow DOM 포함)
  const menuBtns = _queryAll('button[aria-haspopup="menu"], .settings-trigger-button');
  for (const btn of menuBtns) {
    if (!isElementVisible(btn)) continue;
    const parent = btn.parentElement;
    if (!parent) continue;
    const icons = parent.querySelectorAll('.google-symbols');
    const hasSubmit = [...icons].some(i => i.textContent.trim() === 'arrow_forward');
    if (hasSubmit) {
      return btn;
    }
  }

  // 4) 폴백2: x2/x1/Nano/동영상/Veo/Omni 포함 + 보이는 menu 버튼
  for (const btn of menuBtns) {
    if (!isElementVisible(btn)) continue;
    const text = (btn.textContent || '').trim();
    if (/x2|x1|Nano|동영상|Veo|Omni|Imagen|Fast|设置/i.test(text)) {
      return btn;
    }
  }

  return triggerBtn || document.querySelector('button[aria-label="Settings trigger"]');
}

/** STEP 11 모델 드롭다운 버튼 */
function findModelDropdownBtn() {
  return [...document.querySelectorAll('.google-symbols')]
    .find(el => el.textContent.trim() === 'arrow_drop_down')
    ?.closest('button[aria-haspopup="menu"]') || null;
}

const MODEL_NAMES = ['Nano Banana 2 Lite', 'Nano Banana Pro', 'Nano Banana 2', 'Imagen 4'];

function findModelByName(targetModel) {
  const normalize = (v) => String(v || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const target = normalize(targetModel);
  const buttons = [...document.querySelectorAll('button')].filter(isElementVisible);
  return buttons.find(btn => normalize(btn.textContent) === target)
    || buttons.find(btn => {
      const text = normalize(btn.textContent);
      if (target === 'nano banana 2') return /\bnano banana 2\b/i.test(text) && !/\blite\b/i.test(text);
      return text.includes(target);
    });
}

/** 새 프로젝트 클릭 후 화면 전환 완료 대기.
 * 새 ProseMirror UI는 placeholder를 CSS로 그려 DOM 노드가 없으므로 editor 자체를 준비 신호로 사용한다.
 */
async function waitForNewProjectReady(timeout = 22000) {
  await sleep(500);
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const editor = findPromptEditor();
    if (editor) return true;
    await sleep(300);
  }
  throw new Error('创建新项目加载超时');
}

function getTileStatus(tile) {
  const SELECTORS = window.SELECTORS || {};
  const src = tile.querySelector('img')?.src || '';
  const innerText = tile.innerText || '';
  const match = innerText.match(SELECTORS.PROGRESS_REGEX || /(\d+)%/);
  const percent = match ? parseInt(match[1], 10) : null;
  if (isCompletedMediaUrl(src)) return { state: 'done', percent: 100 };
  if (percent !== null) return { state: 'generating', percent };
  return { state: 'waiting', percent: 0 };
}

function getOverallProgress() {
  const tiles = [...getFlowTiles()];
  if (!tiles.length) return null;

  const statuses = tiles.map(getTileStatus);
  const done = statuses.filter(s => s.state === 'done').length;
  const generating = statuses.filter(s => s.state === 'generating').length;
  const waiting = statuses.filter(s => s.state === 'waiting').length;
  const avgPercent = Math.floor(statuses.reduce((sum, s) => sum + s.percent, 0) / tiles.length);

  return { total: tiles.length, done, generating, waiting, avgPercent };
}

async function waitForGeneration(expectedCount, timeout = 300000) {
  const start = Date.now();

  while (Date.now() - start < timeout) {
    const progress = getOverallProgress();

    if (progress) {
      // ★ 그록팩토리 동일: 이전 타일 잔존 시 progress.done이 초과할 수 있으므로 cap
      const cappedDone = Math.min(progress.done, expectedCount);

      if (
        progress.total >= expectedCount &&
        progress.generating === 0 &&
        progress.waiting === 0
      ) {
        return getFlowTiles();
      }
    }

    await sleep(2000);
  }

  throw new Error('TIMEOUT: 생성 시간 초과');
}

function parseGalleryUrls(expectedCount) {
  const tiles = getFlowTiles();
  const result = [];
  const limit = expectedCount != null ? Math.min(tiles.length, expectedCount) : tiles.length;
  for (let i = 0; i < limit; i++) {
    const tile = tiles[i];
    const img = tile.querySelector('img');
    const tileId = getFlowTileId(tile);
    const src = img?.src || '';
    result.push({
      index: i,
      tileId,
      url: src,
      promptNo: Math.floor(i / 2) + 1,
      slot: i % 2 === 0 ? 'A' : 'B'
    });
  }
  return result;
}

if (typeof window !== 'undefined') {
  window.sleep = sleep;
  window.PROMPT_EDITOR_SELECTOR = PROMPT_EDITOR_SELECTOR;
  window.FLOW_TILE_SELECTOR = FLOW_TILE_SELECTOR;
  window.getFlowTiles = getFlowTiles;
  window.getFlowTileId = getFlowTileId;
  window.countFlowTiles = countFlowTiles;
  window.isCompletedMediaUrl = isCompletedMediaUrl;
  window.getFlowMediaName = getFlowMediaName;
  window.findPromptEditor = findPromptEditor;
  window.isElementVisible = isElementVisible;
  window.waitForElement = waitForElement;
  window.findImageFileInput = findImageFileInput;
  window.ensureImageFileInput = ensureImageFileInput;
  window.waitForBridgeReady = waitForBridgeReady;
  window.simulateClick = simulateClick;
  window.humanClick = humanClick;
  window.humanMoveTo = humanMoveTo;
  window.fillPrompt = fillPrompt;
  window.stripMentionTriggerAt = stripMentionTriggerAt;
  window.waitForEditorFilled = waitForEditorFilled;
  window.waitForEditorEmpty = waitForEditorEmpty;
  window.waitForSubmitAccepted = waitForSubmitAccepted;
  window.submitWithVerification = submitWithVerification;
  window.ensureEditorClean = ensureEditorClean;
  window.findSettingsBtn = findSettingsBtn;
  window.findGridTab = findGridTab;
  window.findSmallTab = findSmallTab;
  window.findClearPromptTab = findClearPromptTab;
  window.findSubmitButton = findSubmitButton;
  window.waitForSubmitEnabled = waitForSubmitEnabled;
  window.findModelSettingsBtn = findModelSettingsBtn;
  window.findModelDropdownBtn = findModelDropdownBtn;
  window.findModelByName = findModelByName;
  window.waitForNewProjectReady = waitForNewProjectReady;
  window.clickEmptyAreaToClose = clickEmptyAreaToClose;
  window.waitForDropdownClosed = waitForDropdownClosed;
  window.waitForPanelClosed = waitForPanelClosed;
  window.getTileStatus = getTileStatus;
  window.getOverallProgress = getOverallProgress;
  window.waitForGeneration = waitForGeneration;
  window.parseGalleryUrls = parseGalleryUrls;
}

} // end __flowAutomationLoaded guard
