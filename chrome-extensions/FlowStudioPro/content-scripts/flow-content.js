if(typeof console!=="undefined"){console.log=function(){};console.warn=function(){};console.error=function(){};}
/**
 * flow-content.js — FLOW Factory 메인 자동화 Content Script
 * 2026-03-07 실기 테스트 완료 기준 (커서 전달 지침 최종)
 */
(function () {
  'use strict';

  const PROMPT_EDITOR_SELECTOR = window.PROMPT_EDITOR_SELECTOR || '[contenteditable="true"][data-slate-editor="true"], .ProseMirror[contenteditable="true"]';
  const elementIsVisible = window.isElementVisible || ((el) => {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    return rect.width > 0 && rect.height > 0
      && style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
  });
  const getTiles = () => window.getFlowTiles?.() || document.querySelectorAll('[data-tile-id], flow-grid-tile-container');
  const getTileId = (tile) => window.getFlowTileId?.(tile)
    || tile?.getAttribute('data-tile-id')
    || tile?.querySelector('img[data-media-id]')?.getAttribute('data-media-id')
    || '';
  const isDoneUrl = (src) => window.isCompletedMediaUrl?.(src)
    ?? (!!src && (src.includes('getMediaUrlRedirect') || /^https:\/\/flow-content\.google\/(?:image|video)\//.test(src)));
  const getMediaName = (src, tile) => window.getFlowMediaName?.(src, tile)
    || src?.match(/[?&]name=([^&]+)/)?.[1]
    || getTileId(tile);

  let controlState = 'IDLE';
  let _currentVideoPipelineResumeData = null;
  let _videoPipelineRunning = false;

  // ─────────────────────────────────────────────────────────────
  // Flow 비디오 모델 매칭 헬퍼 — 언어 무관 (ko/ja/en UI 모두 대응)
  //   Flow 메뉴는 UI 언어에 따라 번역됨:
  //     EN: "Veo 3.1 - Lite" / "Veo 3.1 - Fast" / "Veo 3.1 - Quality"
  //     KO: "Veo 3.1 - 라이트" / "Veo 3.1 - 빠름" / "Veo 3.1 - 품질"
  //     JA: "Veo 3.1 - Lite" / "Veo 3.1 - 高速" / "Veo 3.1 - 品質"
  //   "Veo 3.1"은 브랜드명이라 전 언어 공통 → 이 prefix 로 후보 3개 필터 후
  //   순서로 매칭 (Flow UI는 항상 Lite=0, Fast=1, Quality=2 순서 유지)
  //   폴백: 후보 개수 != 3이면 영문 suffix 매칭 시도
  // ─────────────────────────────────────────────────────────────
  const VEO_ORDER_INDEX = { 'Lite': 0, 'Fast': 1, 'Quality': 2 };
  function pickVideoModelItem(items, selectedModel) {
    const normalizedModel = (selectedModel || 'Veo 3.1 Lite').trim();
    const normalizedLower = normalizedModel.toLowerCase();
    if (normalizedLower.includes('omni')) {
      const omni = items.find(el => {
        if (!elementIsVisible(el)) return false;
        return /omni(?:\s*[\d.]+)?\s*flash/i.test((el.textContent || '').trim());
      });
      if (omni) return omni;
    }

    const suffix = normalizedModel.split(' ').pop(); // 'Lite'|'Fast'|'Quality'
    const wanted = VEO_ORDER_INDEX[suffix] ?? 0; // default Lite (cheapest)

    // 1) Veo 3.1 prefix로 보이는 메뉴 후보 필터링
    const candidates = items.filter(el => {
      if (!elementIsVisible(el)) return false;
      const tx = (el.textContent || '').trim();
      return tx.includes('Veo 3.1');
    });

    // 2) 정확히 3개면 순서 기반 매칭 (가장 안전, 언어 무관)
    if (candidates.length === 3) {
      return candidates[wanted] || candidates[0] || candidates[1];
    }

    // 3) 개수가 예상과 다르면 영문 suffix 매칭 (영어 UI 유저)
    const byEnglish = candidates.find(el => (el.textContent || '').includes(suffix));
    if (byEnglish) return byEnglish;

    // 4) 최종 폴백: 첫 번째 Veo 3.1 후보 (대개 Lite 또는 Fast)
    return candidates[0] || null;
  }

  function findVideoDurationButton(duration) {
    return findVisibleChoiceByExactText(duration || '6s');
  }

  function findVisibleChoiceByExactText(value) {
    const target = String(value || '').trim().toLowerCase();
    const candidates = document.querySelectorAll('button, [role="tab"], [role="radio"], [role="option"]');
    return [...candidates].find(el => {
      if (!elementIsVisible(el)) return false;
      const tx = (el.querySelector('.toggle-text')?.textContent || el.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
      return tx === target;
    }) || null;
  }

  function findModeButton(mode) {
    const upper = mode.toUpperCase();
    const icon = mode === 'Image' ? 'image' : 'videocam';
    return document.querySelector(`[aria-controls$="-content-${upper}"][role="tab"]`)
      || document.querySelector(`[aria-label="${mode}"][role="tab"]`)
      || document.querySelector(`button[id*="trigger-${upper}"]`)
      || [...document.querySelectorAll('button[role="radio"]')].find(btn =>
        elementIsVisible(btn) && (btn.querySelector('.google-symbols')?.textContent.trim() === icon
        || btn.textContent.trim().toLowerCase() === mode.toLowerCase()
        || (mode === 'Image' && /图片|image/i.test(btn.textContent))
        || (mode === 'Video' && /视频|video/i.test(btn.textContent))
        )
      )
      || null;
  }

  async function selectAspectRatio(s) {
    const aspectRatio = s.aspectRatio || '16:9';
    const btn = findVisibleChoiceByExactText(aspectRatio);
    if (btn) {
      await simulateClick(btn);
      await sleep(300);
      log('IMAGE', `${aspectRatio} aspect ratio 선택`);
      return true;
    }
    return false;
  }

  async function selectVideoDuration(s) {
    const duration = s.videoDuration || '6s';
    const btn = findVideoDurationButton(duration);
    if (!btn) {
      log('VIDEO', `duration 버튼 없음 — 스킵 (${duration})`);
      return false;
    }
    await simulateClick(btn);
    await sleep(250);
    log('VIDEO', `${duration} duration 선택`);
    return true;
  }

  /**
   * ★ 정규분포 기반 딜레이 — 균일 분포(Math.random) 대신 가우시안 사용
   * 중앙값(mean) 근처에 몰리되 가끔 빠르거나 느린 값이 나옴 → 봇 균일 패턴 회피
   * Box-Muller 변환으로 정규분포 생성, min~max 범위로 클램핑
   *
   * 예: gaussianDelay(1000, 3000) → 평균 2000ms, 대부분 1200~2800ms, 가끔 1000이나 3000 근처
   */
  function gaussianDelay(min, max) {
    // Box-Muller transform → 표준정규분포 (mean=0, std=1)
    const u1 = Math.random() || 0.0001;
    const u2 = Math.random();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    // mean = 중앙, std = 범위의 1/4 → 95%가 min~max 안에 분포
    const mean = (min + max) / 2;
    const std = (max - min) / 4;
    const value = mean + z * std;
    return Math.floor(Math.max(min, Math.min(max, value)));
  }

  async function waitWhilePaused() {
    const MAX_PAUSE_MS = 600000;
    const pauseStart = Date.now();
    while (controlState === 'PAUSED') {
      await sleep(500);
      if (Date.now() - pauseStart > MAX_PAUSE_MS) {
        controlState = 'STOPPED';
        break;
      }
    }
    if (controlState === 'STOPPED') throw new Error('USER_STOPPED');
  }

  // ★ v1.1.8: window.sleep 을 pause-aware 로 wrap — 긴 sleep 중에도 PAUSE 즉시 반응
  //   문제: sleep(30000) 같은 긴 쿨다운 sleep 도중 사용자가 일시정지 눌러도 30초 후에야 반응
  //   해결: 짧은 sleep(<=600ms)은 그대로, 긴 sleep 은 500ms 분할 + 매 chunk 후 controlState 검사
  //         PAUSED/STOPPED 감지 시 즉시 반환 → 다음 waitWhilePaused 가 즉각 작동
  //   waitWhilePaused 자체의 500ms 폴링은 분할 임계점(600ms) 이하 → 영향 없음 (재귀 방지)
  if (window.sleep && !window.sleep._pauseAware) {
    const _origSleep = window.sleep;
    window.sleep = async function pauseAwareSleep(ms) {
      if (!ms || ms <= 600) return _origSleep(ms);
      const start = Date.now();
      while (Date.now() - start < ms) {
        if (controlState === 'PAUSED' || controlState === 'STOPPED') return;
        const remaining = ms - (Date.now() - start);
        await _origSleep(Math.min(500, remaining));
      }
    };
    window.sleep._pauseAware = true;
  }

  // ★ PRO 2.0 임시 디버그 (REGEN 타일 타이밍 분석) — 배포 시 () => {} 로 원복
  const log = (tag, msg, extra) => {
    try {
      if (extra !== undefined) {
        console.log(`[FLOW:${tag}]`, msg, extra);
      } else {
        console.log(`[FLOW:${tag}]`, msg);
      }
    } catch (_) {}
  };

  /** 새 프로젝트 버튼 찾기 — add_2 + "새 프로젝트" 텍스트 (blog 등 다른 버튼과 구분) */
  async function waitForNewProjectButton(timeout = 10000) {
    const start = Date.now();
    // ★ 다국어 + 3단계 fallback — Google UI 변경·언어 설정에 강건
    //   offsetParent 미사용 (position:fixed 버튼도 감지)
    const isVisible = (el) => {
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return false;
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
      return true;
    };

    // 다국어 "새 프로젝트" 텍스트 패턴 (Google 공식 + Chrome 사이트 번역 변형)
    //   Google Flow 는 한/영 만 공식 지원 → 나머지 언어는 Chrome 사이트 번역 거친 값
    //   Chrome 번역은 사전형 의미 번역이라 Google 공식 번역과 다를 수 있음 (둘 다 등록)
    const NEW_PROJECT_TEXTS = [
      // 🇰🇷 한국어
      '새 프로젝트', '새로운 프로젝트', '신규 프로젝트', '프로젝트 만들기', '프로젝트 생성',
      // 🇺🇸 영어
      'New project', 'Create project', 'Start new project',
      // 🇯🇵 일본어
      '新しいプロジェクト', '新規プロジェクト', 'プロジェクトを作成',
      // 🇨🇳 중국어 간체 (Google 공식 + Chrome 번역)
      '新建项目', '新项目', '创建项目', '新增項目',
      // 🇹🇼 중국어 번체
      '新增專案', '新專案', '建立專案', '建立新專案',
      // 🇪🇸 스페인어
      'Nuevo proyecto', 'Crear proyecto',
      // 🇫🇷 프랑스어
      'Nouveau projet', 'Créer un projet',
      // 🇩🇪 독일어
      'Neues Projekt', 'Projekt erstellen',
      // 🇵🇹 포르투갈어 (BR/PT)
      'Novo projeto', 'Criar projeto',
      // 🇮🇹 이탈리아어
      'Nuovo progetto', 'Crea progetto',
      // 🇻🇳 베트남어
      'Dự án mới', 'Tạo dự án',
      // 🇹🇭 태국어 (โปรเจกต์: 영어 음차, โครงการ: 공식 태국어 — Chrome 은 โครงการ 사용)
      'โปรเจกต์ใหม่', 'สร้างโปรเจกต์',
      'โครงการใหม่', 'สร้างโครงการ',
      // 🇮🇩 인도네시아어
      'Proyek baru', 'Buat proyek',
      // 🇷🇺 러시아어
      'Новый проект', 'Создать проект',
      // 🇸🇦 아랍어 (우→좌 방향이지만 normalize 처리됨)
      'مشروع جديد', 'إنشاء مشروع',
      // 🇮🇳 힌디어 (प्रोजेक्ट: 영어 음차, परियोजना: 순수 힌디어 — 둘 다 사용됨)
      'नया प्रोजेक्ट', 'प्रोजेक्ट बनाएं',
      'नई परियोजना', 'परियोजना बनाएं',  // Chrome 번역은 परियोजना 를 주로 사용
      // 🇮🇳 타밀어 (인도 남부)
      'புதிய திட்டம்', 'திட்டம் உருவாக்கு',
      // 🇧🇩🇮🇳 벵골어 (방글라데시 + 인도 동부)
      'নতুন প্রকল্প', 'প্রকল্প তৈরি করুন',
      // 🇹🇷 터키어
      'Yeni proje', 'Proje oluştur',
      // 🇳🇱 네덜란드어
      'Nieuw project', 'Project maken',
      // 🇵🇱 폴란드어
      'Nowy projekt', 'Utwórz projekt',
      // 🇸🇪 스웨덴어
      'Nytt projekt', 'Skapa projekt',
      // 🇵🇭 필리핀어
      'Bagong proyekto', 'Gumawa ng proyekto',
      // 🇲🇾 말레이어
      'Projek baru',
    ];
    // ★ 띄어쓰기·대소문자 변형 대응
    const normalize = (s) => (s || '').replace(/\s+/g, '').toLowerCase();
    const NORMALIZED_PATTERNS = NEW_PROJECT_TEXTS.map(normalize);

    // ★ 키워드 기반 fallback — 위 패턴 전부 실패 시 "프로젝트" 키워드 포함 체크
    //   Chrome 이 다른 방식으로 번역해도 "프로젝트"/"project" 단어는 유지될 가능성 높음
    const PROJECT_KEYWORDS = [
      '프로젝트',  // 한국어
      'project',   // 영어
      'proyecto',  // 스페인어
      'projet',    // 프랑스어·포르투갈어
      'projekt',   // 독일어·폴란드어·스웨덴어
      'progetto',  // 이탈리아어
      'projeto',   // 포르투갈어
      'proyek',    // 인도네시아어·말레이어
      'proyekto',  // 필리핀어
      'proje',     // 터키어
      'プロジェクト', // 일본어
      '项目', '項目', // 중국어 간체·번체
      '專案',       // 중국어 번체
      'dự án',      // 베트남어
      'โปรเจกต์', 'โครงการ',    // 태국어 (영어 음차 + 공식)
      'проект',     // 러시아어
      'مشروع',      // 아랍어
      'प्रोजेक्ट', 'परियोजना',    // 힌디어 (영어 음차 + 순수 힌디어)
      'திட்டம்',                 // 타밀어
      'প্রকল্প',                  // 벵골어
    ];
    const NORMALIZED_KEYWORDS = PROJECT_KEYWORDS.map(normalize);

    const findButton = () => {
      const candidates = [...document.querySelectorAll('button')];

      // 🥇 1순위: 다국어 텍스트 매칭 (공백/대소문자 무관)
      for (const btn of candidates) {
        if (!isVisible(btn)) continue;
        const normalizedText = normalize(btn.textContent);
        if (!normalizedText) continue;
        for (const pattern of NORMALIZED_PATTERNS) {
          if (normalizedText.includes(pattern)) return btn;
        }
      }

      // 🥈 2순위: "프로젝트" 키워드 + google-symbols 아이콘 존재 (Chrome 번역 저항)
      //   Chrome 이 아이콘 텍스트(add_2 → thêm_2 등) 를 번역해도
      //   class="google-symbols" 는 보존됨 → 클래스만 체크하면 안전
      //   + 키워드 있는 버튼 → "내 프로젝트" 같은 것도 포함되지만 아이콘 있는 것만 필터
      //     (목록 버튼은 보통 chevron·arrow 아이콘, action 버튼은 add 계열)
      //   → 아이콘 클래스 존재 + 버튼 텍스트 50자 이내 로 action 버튼 구분
      for (const btn of candidates) {
        if (!isVisible(btn)) continue;
        const normalizedText = normalize(btn.textContent);
        if (!normalizedText || normalizedText.length > 60) continue;
        const hasKeyword = NORMALIZED_KEYWORDS.some(k => normalizedText.includes(k));
        if (!hasKeyword) continue;
        const hasGoogleIcon = btn.querySelector('.google-symbols') !== null;
        if (hasGoogleIcon) return btn;
      }

      // 3️⃣ 3순위: add 계열 아이콘 텍스트 매칭 (다국어 Chrome 번역 포함)
      //   Chrome 은 icon 텍스트(add_2)까지 각 언어로 번역 (thêm_2, 添加_2, 추가_2 등)
      const ADD_ICON_PATTERNS = [
        // 영어 원본 + 기호
        'add', 'plus', '+',
        // 각 언어 Chrome 번역
        '추가',           // 한국어
        '追加',           // 일본어
        '添加', '新增',    // 중국어
        'thêm',           // 베트남어
        'agregar', 'añadir', // 스페인어
        'ajouter',        // 프랑스어
        'aggiungi',       // 이탈리아어
        'hinzufügen',     // 독일어
        'adicionar',      // 포르투갈어
        'dodaj',          // 폴란드어
        'lägg',           // 스웨덴어
        'toevoegen',      // 네덜란드어
        'ekle',           // 터키어
        'добав',          // 러시아어
        'إضافة', 'أضف',    // 아랍어
        'जोड़',             // 힌디어
        'เพิ่ม',            // 태국어
        'tambah',         // 인도네시아어·말레이어
        'magdagdag', 'idagdag',  // 필리핀어 (Chrome 번역은 'idagdag')
      ];
      for (const icon of document.querySelectorAll('.google-symbols')) {
        const iconText = (icon.textContent || '').toLowerCase();
        if (!ADD_ICON_PATTERNS.some(p => iconText.includes(p.toLowerCase()))) continue;
        const btn = icon.closest('button');
        if (!btn || !isVisible(btn)) continue;
        const txt = btn.textContent?.trim() || '';
        if (txt.length > 0 && txt.length <= 60) return btn;
      }

      // 4️⃣ 4순위: [data-type="button-overlay"] + google-symbols 아이콘 (구조 기반)
      //   Chrome 번역돼도 data-type 속성과 google-symbols 클래스는 보존
      for (const overlay of document.querySelectorAll('[data-type="button-overlay"]')) {
        const btn = overlay.closest('button');
        if (!btn || !isVisible(btn)) continue;
        const hasGoogleIcon = btn.querySelector('.google-symbols') !== null;
        if (!hasGoogleIcon) continue;
        // 버튼 크기 필터 (아이콘 전용 작은 버튼 제외)
        const rect = btn.getBoundingClientRect();
        if (rect.width < 80 || rect.height < 30) continue;
        return btn;
      }

      // 5️⃣ 5순위 (최후 수단): "프로젝트" 키워드만 포함 (아이콘 조건 없음)
      //   1~4 전부 실패 시 Chrome 이 모든 걸 망가뜨린 극단 상황
      //   "내 프로젝트" "최근 프로젝트" 같은 false positive 위험 있으나
      //   아예 못 찾는 것보다 시도해보는 게 UX 상 낫다
      //   단, 첫 번째 발견되는 것만 반환 (보통 상단 위치한 primary 버튼)
      for (const btn of candidates) {
        if (!isVisible(btn)) continue;
        const normalizedText = normalize(btn.textContent);
        if (!normalizedText || normalizedText.length > 60) continue;
        if (NORMALIZED_KEYWORDS.some(k => normalizedText.includes(k))) {
          return btn;
        }
      }

      return null;
    };

    // 즉시 시도 → 매 100ms 재시도
    while (Date.now() - start < timeout) {
      const btn = findButton();
      if (btn) return btn;
      await new Promise(r => setTimeout(r, 100));
    }
    throw new Error('[FLOW] 새 프로젝트 버튼 타임아웃 (10초 경과)');
  }

  /**
   * ★ 안전한 sendMessage — Extension context invalidated 에러 방지
   *   확장 리로드 후 구 content script 가 남아있을 때 chrome.runtime 이 끊겨
   *   "Uncaught (in promise) Error: Extension context invalidated" 발생.
   *   이 헬퍼로 감싸면 에러 대신 warn 로그만 찍고 조용히 종료.
   *   Google CWS 심사 시 console 에 Uncaught Error 가 찍히면 감점 요인이라 방어.
   */
  function safeSendMessage(msg, cb) {
    try {
      // 컨텍스트 유효성 체크 (chrome.runtime.id 가 없으면 invalidated 상태)
      if (!chrome?.runtime?.id) {
        console.log('[FlowFactory] sendMessage skipped — extension context invalidated');
        if (typeof cb === 'function') try { cb(undefined); } catch {}
        return Promise.resolve();
      }
      const p = chrome.runtime.sendMessage(msg, cb);
      // Promise 기반 반환값이 있으면 catch 로 rejection 흡수
      if (p && typeof p.catch === 'function') {
        return p.catch((err) => {
          console.log('[FlowFactory] sendMessage failed:', err?.message || err);
        });
      }
      return Promise.resolve();
    } catch (err) {
      // 동기 throw (context invalidated 시 발생 가능) 흡수
      console.log('[FlowFactory] sendMessage threw:', err?.message || err);
      return Promise.resolve();
    }
  }

  /**
   * ★ 동영상 프롬프트에 배경음악 금지 자동 추가
   * ★ 비활성화 — "music" 단어가 Flow 오디오 생성을 트리거해서
   *   "Audio generation failed" 에러를 유발함. 자동 첨부 중단.
   *   함수 시그니처는 유지 (호출처 호환성), pass-through 만 함.
   */
  function appendNoBackgroundMusic(prompt) {
    return prompt || '';
  }

  // ─── 비디오 업스케일 + 다운로드 파이프라인 (지침: FLOW_비디오_업스케일_다운로드_파이프라인.md) ───
  async function findMoreVertBtn(tile) {
    tile.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    tile.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    const rect = tile.getBoundingClientRect();
    tile.dispatchEvent(new MouseEvent('mousemove', {
      bubbles: true,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2
    }));
    await sleep(600);
    const btn = [...document.querySelectorAll('.google-symbols')]
      .filter(el => (el.textContent || '').trim() === 'more_vert')
      .map(el => el.closest('button'))
      .find(elementIsVisible);
    return btn ?? null;
  }

  async function clickMoreVertAndWaitOpen(tile) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const tileRect = tile.getBoundingClientRect();
      const tileCenterX = tileRect.left + tileRect.width / 2;
      const tileCenterY = tileRect.top + tileRect.height / 2;
      tile.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      tile.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      tile.dispatchEvent(new MouseEvent('mousemove', {
        bubbles: true,
        clientX: tileCenterX,
        clientY: tileCenterY
      }));
      await sleep(1000);

      const btns = [...document.querySelectorAll('.google-symbols')]
        .filter(el => (el.textContent || '').trim() === 'more_vert')
        .map(el => el.closest('button'))
        .filter(elementIsVisible);
      const btn = btns.length > 0
        ? btns.sort((a, b) => {
            const ra = a.getBoundingClientRect();
            const rb = b.getBoundingClientRect();
            return Math.hypot(ra.left - tileCenterX, ra.top - tileCenterY)
                 - Math.hypot(rb.left - tileCenterX, rb.top - tileCenterY);
          })[0]
        : null;

      if (btn) {
        log('VIDEO', `more_vert 발견 — 클릭 시도 (attempt ${attempt + 1})`);
        tile.dispatchEvent(new MouseEvent('mousemove', {
          bubbles: true,
          clientX: tileCenterX,
          clientY: tileCenterY
        }));
        await sleep(200);
        await humanMoveTo(btn);  // ★ v1.1.8 Tier1-A: ⋯ 메뉴 버튼까지 마우스 궤적
        btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        btn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        btn.click();
        await sleep(1000);

        const menuOpen = [...document.querySelectorAll('[role="menuitem"]')].length > 0;
        if (menuOpen) {
          log('VIDEO', `⋯ 클릭으로 메뉴 열림 (attempt ${attempt + 1})`);
          return;
        }
      }

      log('VIDEO', `⋯ 실패 — 우클릭 폴백 시도 (attempt ${attempt + 1})`);
      const targetEl = tile.querySelector('img') || tile.querySelector('video') || tile;
      targetEl.scrollIntoView({ behavior: 'instant', block: 'center' });
      await sleep(300);
      const targetRect = targetEl.getBoundingClientRect();
      const cx = targetRect.left + targetRect.width / 2;
      const cy = targetRect.top + targetRect.height / 2;
      log('VIDEO', `우클릭 좌표: (${Math.round(cx)}, ${Math.round(cy)}) — ${targetEl.tagName?.toLowerCase() || 'tile'} 기준`);
      targetEl.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: cx,
        clientY: cy
      }));
      await sleep(1000);

      const menuOpenAfterRightClick = [...document.querySelectorAll('[role="menuitem"]')].length > 0;
      if (menuOpenAfterRightClick) {
        log('VIDEO', `우클릭으로 메뉴 열림 (attempt ${attempt + 1})`);
        return;
      }

      log('VIDEO', `우클릭도 실패 — 재시도 ${attempt + 1}/3`);
      await sleep(500);
    }

    throw new Error('[VIDEO] ❌ ⋯ 메뉴 열기 실패 (hover + 우클릭 모두 실패)');
  }

  async function openDownloadSubmenu() {
    for (let attempt = 0; attempt < 3; attempt++) {
      const downloadItem = [...document.querySelectorAll('[role="menuitem"]')]
        .find(el => el.getAttribute('aria-haspopup') === 'menu');

      if (!downloadItem) {
        log('VIDEO', `다운로드 menuitem 없음 — 재시도 ${attempt + 1}/3`);
        await sleep(500);
        continue;
      }

      const r = downloadItem.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      log('VIDEO', `다운로드 클릭 좌표: (${Math.round(cx)}, ${Math.round(cy)})`);

      await humanMoveTo(downloadItem);  // ★ v1.1.8 Tier1-A
      downloadItem.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: cx, clientY: cy }));
      downloadItem.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: cx, clientY: cy }));
      downloadItem.click();
      await sleep(600);

      const has1080 = [...document.querySelectorAll('[role="menuitem"]')]
        .some(el => el.textContent?.includes?.('1080p'));

      if (has1080) {
        log('VIDEO', '서브메뉴 열림');
        return;
      }

      log('VIDEO', `서브메뉴 미열림 — 재시도 ${attempt + 1}/3`);
      await sleep(500);
    }

    throw new Error('[VIDEO] ❌ 다운로드 서브메뉴 열기 실패');
  }

  /**
   * 1080p 항목 내부 업그레이드 버튼 존재 여부로 플랜 판별
   * 매 호출마다 DOM 직접 확인 (캐싱 없음)
   */
  function isPaidPlan() {
    const item1080 = [...document.querySelectorAll('[role="menuitem"]')]
      .find(el => el.textContent?.includes?.('1080p'));
    if (!item1080) return false;
    const hasUpgradeByDom = !!item1080.querySelector('[role="button"][data-inner-slot="true"]');
    const hasUpgradeByText =
      item1080.textContent?.includes?.('업그레이드') || item1080.textContent?.includes?.('Upgrade');
    return !hasUpgradeByDom && !hasUpgradeByText && item1080.getAttribute('aria-disabled') !== 'true';
  }

  /**
   * 유료: 1080p 클릭 → 'upscale' 반환
   * 무료: 메뉴 조작 없이 'direct' 반환
   */
  async function clickBestResolution() {
    if (isPaidPlan()) {
      const item1080 = [...document.querySelectorAll('[role="menuitem"]')]
        .find(el => el.textContent?.includes?.('1080p'));
      const r = item1080.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      item1080.dispatchEvent(new MouseEvent('pointerenter', { bubbles: true, clientX: cx, clientY: cy }));
      item1080.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, clientX: cx, clientY: cy }));
      item1080.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: cx, clientY: cy }));
      await sleep(200);
      await humanMoveTo(item1080);  // ★ v1.1.8 Tier1-A
      item1080.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: cx, clientY: cy }));
      item1080.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: cx, clientY: cy }));
      item1080.click();
      await sleep(300);
      log('VIDEO', '✅ 1080p 클릭 (유료 플랜 — 업스케일 시작)');
      return 'upscale';
    }
    log('VIDEO', '✅ 무료 플랜 감지 (720p/SD 직접 다운로드)');
    return 'direct';
  }

  /**
   * @param {number} timeout - ms
   * @param {number} initialSuccessCount - 업스케일 시작 전 li[data-type="success"] 개수 (새 토스트만 인정)
   */
  async function waitForUpscaleComplete(timeout = 300000, initialSuccessCount = 0) {
    const start = performance.now();
    while (true) {
      await waitWhilePaused();
      const elapsed = performance.now() - start;
      if (elapsed > timeout) {
        log('VIDEO', '업스케일 타임아웃');
        return false;
      }
      const errorToast = document.querySelector('li[data-type="error"]');
      if (errorToast) {
        log('VIDEO', '업스케일 실패 토스트 감지 → SD 폴백');
        return false;
      }
      const successToasts = document.querySelectorAll('li[data-type="success"]');
      const toast = [...successToasts].find(t => {
        const icon = t?.querySelector?.('.google-symbols');
        return icon?.textContent?.trim() === 'check_circle';
      });
      if (toast && successToasts.length > initialSuccessCount) {
        log('VIDEO', `업스케일 완료 — ${Math.round(elapsed)}ms`);
        await sleep(500);
        return true;
      }
      await sleep(1000);
    }
  }

  /**
   * Flow 실행 화살표 대신 나타나는 주황 스티커(flow_alert_sphere) — 크레딧 소진 확정
   * ★ 언어 비의존: 이미지 파일명(flow_alert_sphere)·info 아이콘 합자는 모든 UI 언어에서 동일.
   *   → 전 다국어 사용자(ko/en/ja/zh/pt/es/id/vi)에서 그대로 작동.
   */
  function hasCreditExhaustionSticker() {
    // ★ v1.1.8 회귀수정: sphere 이미지 단독으로는 판정하지 않음(상시 표시되는 크레딧 정보 버튼일 수 있어 오탐).
    //   반드시 sphere + 'info' 아이콘이 같은 컨테이너에 있을 때만 소진 확정. 파일명·아이콘 합자는 전 언어 동일.
    const imgs = document.querySelectorAll('img[src*="flow_alert_sphere"]');
    for (const img of imgs) {
      if (img.offsetParent === null && !(img.getClientRects && img.getClientRects().length > 0)) continue; // 숨김 무시
      const container = img.closest('div') || img.parentElement;
      const infoIcon = container?.querySelector('.google-symbols, i.material-icons, i.material-icons-outlined');
      if (infoIcon && (infoIcon.textContent || '').trim() === 'info') return true;
    }
    return false;
  }

  /**
   * "AI 크레딧 소진" 배너 감지 (오탐 방지)
   * 0순위: flow_alert_sphere+info 스티커 1순위: 명시 문구 2순위: open_in_new+업그레이드 컨텍스트
   */
  function detectCreditExhausted() {
    // ★ v1.1.8 회귀수정: flow_alert_sphere+info 스티커는 크레딧이 충분해도(예: 980 크레딧) 상시 표시되는
    //   "동영상 1생성당 20크레딧" 비용 안내 인디케이터임이 확인됨 → 소진 신호로 쓰면 항상 오탐.
    //   따라서 스티커 기반 판정은 제거하고, 실제 소진 시에만 나타나는 텍스트 팝업으로만 판정한다.
    //   (제출 버튼 자체가 사라지는 경우는 호출부의 !submitBtn 경로가 언어 비의존으로 처리)
    const body = document.body?.textContent || '';
    // 1순위(언어 의존 폴백): "크레딧 단어"와 "부족/소진 단어"가 15자 이내로 인접할 때만 (오탐 방지).
    const CREDIT = '크레딧|credit|crédit|クレジット|积分|點數|额度|額度|配额|配額|crédito|kredit|tín\\s*dụng';
    const SHORT = '부족|소진|충분하지\\s*않|insufficient|not\\s+enough|have\\s+enough|run\\s+out\\s+of|足り(ない|ません)|不足|不够|不夠|用完|用尽|用盡|insuficiente|tidak\\s+cukup|kehabisan|habis|không\\s+đủ|đã\\s*hết';
    const nearRe = new RegExp(`(?:${CREDIT})[\\s\\S]{0,15}(?:${SHORT})|(?:${SHORT})[\\s\\S]{0,15}(?:${CREDIT})`, 'i');
    const nm = body.match(nearRe);
    if (nm) { log('CREDIT', '소진 감지: 1순위 인접 문구', { snippet: nm[0].slice(0, 40) }); return true; }
    // 2순위(open_in_new 업그레이드 링크): ★ v1.1.8 회귀수정 — Flow가 상시 표시하는 업그레이드/크레딧 CTA 링크가
    //   오탐의 원인이었음. 이제 링크 주변에 "부족/소진" 의미 단어가 함께 있을 때만 소진으로 판정.
    const SHORT_KW = /부족|소진|충분하지\s*않|insufficient|not\s+enough|have\s+enough|exhausted|足り(ない|ません)|不足|不够|tidak\s+cukup|habis|không\s+đủ/i;
    const icons = document.querySelectorAll('.google-symbols, i.material-icons, i.material-icons-outlined');
    for (const el of icons) {
      if ((el.textContent || '').trim() !== 'open_in_new') continue;
      const parent = el.closest('button, a, [role="button"], [role="link"]') || el.parentElement;
      if (!parent) continue;
      const parentText = (parent.textContent || '') + (parent.getAttribute?.('aria-label') || '');
      if (SHORT_KW.test(parentText)) { log('CREDIT', '소진 감지: 2순위 open_in_new+부족문구', { txt: parentText.slice(0, 40) }); return true; }
    }
    return false;
  }

  /**
   * 생성 버튼 확인 — 없으면 2초 대기 후 재시도 2회, 그래도 없으면 detectCreditExhausted로 최종 확인
   * (동영상 생성 직후 버튼이 잠깐 사라지는 타이밍의 CREDIT_EXHAUSTED 오탐 방지)
   */
  async function checkSubmitButtonWithRetry() {
    if (findSubmitButton()) return true;

    for (let attempt = 1; attempt <= 2; attempt++) {
      log('SUBMIT', `생성 버튼 없음 — ${attempt}회 재시도 대기 (2초)`);
      await sleep(2000);
      if (findSubmitButton()) return true;
    }

    const isCreditExhausted = detectCreditExhausted();
    log('SUBMIT', `생성 버튼 최종 없음 — 크레딧 소진 여부: ${isCreditExhausted}`);
    return false;
  }

  /**
   * v1.1.3: Flow "Prompt must be provided" validation 에러 감지
   * - submit 후 짧은 시간(~2초) 내에 Flow가 표시하는 경고 메시지
   * - 발견 시: Flow가 prompt를 못 읽었음 → 빠른 거절 → 12s timeout 기다릴 필요 없음
   * - 다국어 대응: "must be provided", "프롬프트 필요" 류 텍스트
   * - window 노출: flow-automation.js의 submitWithVerification 에서 호출
   */
  function detectPromptMustBeProvided() {
    // ★ v1.1.3: selector 범위 확장 — Flow는 Sonner toast 라이브러리 사용
    //   <ol data-sonner-toaster> > <li data-sonner-toast> 구조
    const containers = document.querySelectorAll(
      // ★ Sonner toast (Flow 실제 사용) — 사용자가 DOM 검사로 확인
      '[data-sonner-toaster], [data-sonner-toast], ol[data-sonner-toaster] li, ' +
      // 일반적인 toast / notification selectors
      '[role="alert"], [role="status"], [role="alertdialog"], [aria-live], ' +
      '[class*="snackbar"], [class*="toast"], [class*="notification"], ' +
      '[class*="message"], [class*="error"], [class*="warning"], [class*="alert"], ' +
      '[class*="Snackbar"], [class*="Toast"], [class*="Notification"], ' +
      'li[data-type="error"], li[data-type="warning"]'
    );
    const matchText = (text) => {
      if (!text) return false;
      const lower = text.toLowerCase();
      if (lower.includes('must be provided')) return true;
      if (lower.includes('prompt') && lower.includes('required')) return true;
      if (text.includes('프롬프트') && (text.includes('필요') || text.includes('입력'))) return true;
      if (text.includes('プロンプト') && text.includes('必要')) return true;
      if (text.includes('提示') && text.includes('必')) return true;
      return false;
    };
    for (const c of containers) {
      if (matchText(c.textContent || '')) return true;
    }
    // ★ Fallback 1: body 전체 textContent 검사 (모든 selector 실패 시 안전망)
    const bodyText = document.body?.textContent || '';
    if (matchText(bodyText)) return true;
    // ★ Fallback 2: Shadow DOM 검사 (Flow가 web component 사용 시 selector 우회)
    //   모든 element를 순회하며 shadowRoot 내부도 검사
    try {
      const allElements = document.querySelectorAll('*');
      for (const el of allElements) {
        if (el.shadowRoot) {
          const shadowText = el.shadowRoot.textContent || '';
          if (matchText(shadowText)) return true;
        }
      }
    } catch (e) { /* shadowRoot 접근 불가능한 경우 무시 */ }
    return false;
  }
  // ★ window 노출 — flow-automation.js 의 submitWithVerification 에서 호출 가능하도록
  window.detectPromptMustBeProvided = detectPromptMustBeProvided;

  /**
   * "unusual activity" / "비정상적인 활동" 감지
   * Flow 사이트가 자동화를 탐지하면 경고 다이얼로그/배너를 표시함
   */
  /**
   * "unusual activity" / "비정상적인 활동" 감지
   * ★ body.textContent 전체 스캔 금지 — false positive 방지 (프롬프트·UI 텍스트 오탐)
   *    dialog / alertdialog / alert / 에러 토스트 / 배너 등 경고 요소만 스캔
   */
  // ★ v1.1.3: 다국어 "unusual activity" 텍스트 매칭 (Google Flow의 봇 차단 메시지)
  //   - 셀렉터 의존 X — 의미 기반 텍스트 매칭 (Flow UI 변경에도 강건)
  //   - 타일 내부에 표시되는 경우 + 다이얼로그/배너로 표시되는 경우 모두 감지
  const UNUSUAL_ACTIVITY_PATTERNS = [
    /unusual\s*activity/i,                       // English
    /automated\s*(behavior|request|access)/i,    // English
    /actividad\s*(inusual|sospechosa)/i,         // Spanish
    /activit[éè]\s*(inhabituelle|suspecte)/i,    // French
    /ungew[öo]hnliche\s*aktivit[äa]t/i,          // German
    /atividade\s*(incomum|suspeita)/i,           // Portuguese
    /активность.*необычн/i,                      // Russian (necessary→sufficient pattern)
    /異常.*活動/,                                  // Japanese
    /異常活動|可疑活動|不尋常活動/,                  // Chinese (Traditional/Simplified)
    /异常活动|可疑活动|不寻常活动/,                  // Simplified Chinese
    /hoạt\s*động\s*bất\s*thường/i,                // Vietnamese
    /aktivitas\s*(tidak\s*biasa|mencurigakan)/i,  // Indonesian
    /faaliyet.*(olağan\s*dışı|şüpheli)/i,         // Turkish
    /असामान्य\s*गतिविधि/,                          // Hindi
  ];
  const isUnusualActivityText = (text) => {
    if (!text) return false;
    // 한글: 정확한 표현만 (false positive 방지)
    if (text.includes('비정상적인 활동') || text.includes('비정상 활동')) return true;
    if (text.includes('자동화') && (text.includes('감지') || text.includes('탐지'))) return true;
    for (const p of UNUSUAL_ACTIVITY_PATTERNS) if (p.test(text)) return true;
    return false;
  };

  // ★ v1.1.3: 타일 컨텍스트 마커 — 정상 프롬프트의 false positive 방지
  //   Google 차단 타일은 반드시 "Failed" 헤더 또는 "Help Center" 링크 동반
  //   사용자 프롬프트에 "unusual activity"가 들어있어도 이 마커 없으면 무시
  const HAS_GOOGLE_BLOCK_CONTEXT = (text) => {
    if (!text) return false;
    // 영어 / 다국어 Failed/Error 마커
    if (/\b(Failed|Error|Blocked)\b/.test(text)) return true;
    if (/(실패|오류|차단됨)/.test(text)) return true;
    if (/(失敗|エラー|失败|错误)/.test(text)) return true;
    if (/\b(Fallido|Error|Bloqueado)\b/i.test(text)) return true;
    if (/\b(Échec|Erreur|Bloqué)\b/i.test(text)) return true;
    // Help Center 링크 (Google 차단 메시지 고유)
    if (/Help\s*Cent(er|re)/i.test(text)) return true;
    if (/고객\s*센터|도움말\s*센터/.test(text)) return true;
    if (/(ヘルプ\s*センター|帮助中心|幫助中心)/.test(text)) return true;
    if (/(centro\s*de\s*ayuda)/i.test(text)) return true;
    return false;
  };

  /**
   * Unusual activity 상세 감지 — 타일 + 다이얼로그/배너
   * 타일 매칭은 Google 차단 마커 동반 시에만 인정 (정상 프롬프트 오탐 방지)
   * @returns {{detected, tileCount, tileIds, signatureKey, source}}
   */
  function detectUnusualActivityDetails() {
    // 1순위: 타일 내부 — "unusual activity" + Google 차단 마커 동반 필수
    const tileIds = [];
    const tiles = getTiles();
    for (const tile of tiles) {
      const text = tile.textContent || '';
      if (!text) continue;
      // 두 조건 동시 만족 시에만 차단 타일로 인정
      if (isUnusualActivityText(text) && HAS_GOOGLE_BLOCK_CONTEXT(text)) {
        const tid = getTileId(tile);
        if (tid) tileIds.push(tid);
      }
    }
    if (tileIds.length > 0) {
      return { detected: true, tileCount: tileIds.length, tileIds, signatureKey: tileIds.slice().sort().join('|'), source: 'tile' };
    }
    // 2순위: 다이얼로그·알림 (마커 검증 불필요 — 다이얼로그는 거의 항상 시스템 메시지)
    const dialogs = document.querySelectorAll(
      '[role="dialog"], [role="alertdialog"], [role="alert"], ' +
      '[data-state="open"][class*="dialog"], [data-state="open"][class*="modal"]'
    );
    for (const dialog of dialogs) {
      if (isUnusualActivityText(dialog.textContent)) {
        return { detected: true, tileCount: 0, tileIds: [], signatureKey: 'dialog', source: 'dialog' };
      }
    }
    // 3순위: 에러 토스트·상태 배너
    const toasts = document.querySelectorAll(
      'li[data-type="error"], li[data-type="warning"], ' +
      '[role="status"], [role="banner"], [class*="snackbar"], [class*="toast"]'
    );
    for (const toast of toasts) {
      if (isUnusualActivityText(toast.textContent)) {
        return { detected: true, tileCount: 0, tileIds: [], signatureKey: 'toast', source: 'toast' };
      }
    }
    return { detected: false, tileCount: 0, tileIds: [], signatureKey: '', source: '' };
  }

  /**
   * 하위 호환 boolean — 다이얼로그/토스트만 감지 (기존 동작 유지)
   * 이전 호출자(line 2553, 2716)가 타일까지 보게 되면 오탐 위험 → 원래 스코프 보존
   * 타일 누적 감지는 신규 handleUnusualActivityIfDetected가 담당
   */
  function detectUnusualActivity() {
    const dialogs = document.querySelectorAll(
      '[role="dialog"], [role="alertdialog"], [role="alert"], ' +
      '[data-state="open"][class*="dialog"], [data-state="open"][class*="modal"]'
    );
    for (const dialog of dialogs) {
      if (isUnusualActivityText(dialog.textContent)) return true;
    }
    const toasts = document.querySelectorAll(
      'li[data-type="error"], li[data-type="warning"], ' +
      '[role="status"], [role="banner"], [class*="snackbar"], [class*="toast"]'
    );
    for (const toast of toasts) {
      if (isUnusualActivityText(toast.textContent)) return true;
    }
    return false;
  }

  /**
   * v1.1.6: "미디어를 로드하는 중에 문제가 발생했습니다" 실패 타일 감지 + ⟳ 자동 클릭
   *  - AI 생성은 성공했으나 CDN 로드 실패한 케이스 (재생성 불필요, URL 재호출만 필요)
   *  - 사용자가 수동으로 ⟳ 누르면 보통 1~3회 만에 복구되는 현상 자동화
   */
  const FAILED_TILE_TEXT_PATTERNS = [
    /미디어를?\s*로드.*문제/,
    /로드.*중에?\s*문제/,
    /^실패$/m,                              // 타일 헤더 "실패"
    /failed\s*to\s*load/i,
    /error\s*loading\s*(media|image)/i,
    /problem\s*loading/i
  ];
  function isFailedTileText(text) {
    if (!text) return false;
    return FAILED_TILE_TEXT_PATTERNS.some(p => p.test(text));
  }
  /** 실패 타일 + ⟳ 버튼 추출 — refresh 아이콘 기반 (스크린샷 콘솔로 확정) */
  function detectFailedTilesWithReloadBtn() {
    const out = [];
    const tiles = getTiles();
    for (const tile of tiles) {
      const text = tile.textContent || '';
      if (!isFailedTileText(text)) continue;
      const reloadBtn = [...tile.querySelectorAll('button')].find(btn => {
        const icon = btn.querySelector('.google-symbols')?.textContent?.trim() || '';
        return icon === 'refresh';
      });
      if (!reloadBtn) continue;
      const tileId = getTileId(tile);
      out.push({ tile, reloadBtn, tileId });
    }
    return out;
  }

  /**
   * Flow 속도 제한(rate-limit) 감지 — "생성을 너무 빨리 요청하고 있습니다" 류
   * 타일 내 에러 문구도 스캔. 실패 타일 수도 반환하여 강한 백오프 트리거 가능.
   *
   * @returns {{detected: boolean, tileCount: number, signatureKey: string}}
   *   - detected: rate-limit 감지 여부
   *   - tileCount: 에러 메시지가 표시된 타일 수 (0이면 다이얼로그/토스트만 있음)
   *   - signatureKey: 같은 감지를 중복 카운트 방지용 (탭/타일ID 해시)
   */
  const RATE_LIMIT_PATTERNS = [
    // Korean
    /너무\s*빨리\s*요청/,
    /잠시\s*후에?\s*다시\s*시도/,
    /일시적으로\s*이용\s*제한/,
    /요청이\s*너무\s*많/,
    // English (Flow 영문 UI 대응 — 실제 텍스트 확인 후 조정 필요)
    /too\s*(many|quickly|fast|frequent)/i,
    /rate[-\s]*limit/i,
    /slow\s*down/i,
    /try\s*again\s*(later|in\s*a\s*moment|shortly)/i,
    /requesting.*too\s*(quickly|fast)/i,
    /exceeded.*limit/i,
    // ── 다국어 확장 (Chrome 사이트번역 대응) ──
    // 각 언어의 "요청이 너무 많다" 구체 구문만 유지 (generic "나중에 시도" 류 제거 — 일반 에러 오탐 방지)
    /リクエスト.*多(すぎ|い)/,                                  // 日本語
    /请求.*(过于频繁|过多|太频繁)/,                              // 简体中文
    /請求.*(過於頻繁|過多|太頻繁)/,                              // 繁體中文
    /quá\s*nhiều\s*yêu\s*cầu/i,                                 // Vietnamese
    /طلبات\s*كثيرة/,                                            // Arabic
    /बहुत\s*अधिक\s*अनुरोध/,                                      // Hindi
    /அதிகமான\s*கோரிக்கை/,                                        // Tamil
    /অনেক\s*বেশি\s*অনুরোধ/,                                       // Bengali
    /คำขอ.*มากเกินไป/,                                           // Thai
    /muitas\s*(solicita[çc][õo]es|requisi[çc][õo]es|tentativas)/i, // Portuguese
    /demasiadas\s*(solicitudes|peticiones)/i,                    // Spanish
    /слишком\s*много\s*запросов/i,                               // Russian
    /zu\s*viele\s*anfragen/i,                                    // German
    /trop\s*de\s*(requ[êe]tes|demandes)/i,                       // French
    /[çc]ok\s*fazla\s*istek/i,                                   // Turkish
    /terlalu\s*banyak\s*permintaan/i,                            // Indonesian
    /masyadong\s*maraming\s*(kahilingan|request)/i               // Filipino
  ];
  const isRateLimitText = (text) => {
    if (!text) return false;
    for (const p of RATE_LIMIT_PATTERNS) {
      if (p.test(text)) return true;
    }
    return false;
  };
  function detectRateLimitDetails() {
    const tileIds = [];
    // 타일 내부 에러 문구 확인 (Flow가 타일에 직접 표시)
    const tiles = getTiles();
    for (const tile of tiles) {
      const text = tile.textContent || '';
      if (!text) continue;
      if (isRateLimitText(text)) {
        const tid = getTileId(tile);
        if (tid) tileIds.push(tid);
      }
    }
    let dialogMatch = false;
    if (tileIds.length === 0) {
      // 타일에 없으면 토스트/다이얼로그 확인
      const containers = document.querySelectorAll(
        '[role="dialog"], [role="alertdialog"], [role="alert"], ' +
        'li[data-type="error"], li[data-type="warning"], ' +
        '[role="status"], [role="banner"], [class*="snackbar"], [class*="toast"]'
      );
      for (const container of containers) {
        const text = container.textContent || '';
        if (!text) continue;
        if (isRateLimitText(text)) {
          dialogMatch = true;
          break;
        }
      }
    }
    const detected = tileIds.length > 0 || dialogMatch;
    return { detected, tileCount: tileIds.length, tileIds, signatureKey: tileIds.slice().sort().join('|') };
  }
  /** 간단 boolean 버전 (하위 호환) */
  function detectRateLimitMessage() {
    return detectRateLimitDetails().detected;
  }

  // ★ v1.1.4: AUTO_PAUSE 완전 비활성화 (사용자 요청 — 자동화 신뢰성 최우선)
  //   어떤 사유로도 파이프라인 자동 정지 안 함
  //   사용자가 필요 시 수동 ⏸ 일시정지 버튼 사용
  //   함수는 유지 (기존 호출 사이트 호환) — 단순 로그만 남김
  function triggerAutoPause(reason) {
    log('AUTO_PAUSE_DISABLED', `자동 정지 트리거 무시 — reason: ${reason} (사용자 설정: 자동화 유지)`);
  }
  /** 호환성 stub — AUTO_PAUSE 비활성으로 더 이상 사용 안 함 */
  function maybeResetAutoPauseFlag(settings) { /* no-op */ }

  async function waitForVideoSDComplete(timeout = 600000) {
    const start = performance.now();
    log('VIDEO', 'SD 생성 대기 시작');
    // ★ v1.1.6: 미디어 로드 실패 타일별 ⟳ 재시도 카운터 (CDN 로드 실패 자동 복구)
    const failedTileRetries = new Map();
    const MAX_FAILED_TILE_RETRIES = 5;
    let pollTick = 0;
    while (true) {
      await waitWhilePaused();
      const elapsed = performance.now() - start;
      // ★ 1·2·3순위(스티커/문구/아이콘) 미사용 — 생성버튼없음으로만 크레딧 소진 판단
      if (elapsed > timeout) {
        log('VIDEO', 'SD 생성 타임아웃');
        return null;
      }
      // ★ v1.1.8 Tier1: 영상 생성 대기 중에도 idle 마우스 무브 (이미지 모드와 동일)
      //   reCAPTCHA v3 세션 전체 마우스 활동 유지 — ★ anti-bot #2: 빈도 상향(0.4→0.7) fire-and-forget
      if (Math.random() < 0.7) {
        try { safeSendMessage({ type: 'CDP_IDLE_MOVE' }); } catch (_) { /* noop */ }
      }
      // ★ v1.1.6: "미디어를 로드하는 중에 문제가 발생했습니다" 자동 ⟳ 재시도
      //   AI 생성은 끝났지만 CDN 로드만 실패한 케이스 (이미지 모드와 동일)
      //   매 5회(~10초)마다만 체크 — 성능 부하 방지
      pollTick++;
      if (pollTick % 5 === 0) {
        try {
          const failedTiles = detectFailedTilesWithReloadBtn();
          for (const { reloadBtn, tileId } of failedTiles) {
            const prev = failedTileRetries.get(tileId) || 0;
            if (prev >= MAX_FAILED_TILE_RETRIES) {
              if (prev === MAX_FAILED_TILE_RETRIES) {
                log('TILE_RETRY', `[VIDEO] 타일 ${tileId} 최대 재시도(${MAX_FAILED_TILE_RETRIES}) 도달 — 추가 클릭 중단`);
                failedTileRetries.set(tileId, prev + 1);
              }
              continue;
            }
            reloadBtn.click();
            failedTileRetries.set(tileId, prev + 1);
            log('TILE_RETRY', `[VIDEO] 미디어 로드 실패 ⟳ 재시도 ${prev + 1}/${MAX_FAILED_TILE_RETRIES}`, { tileId });
            await sleep(gaussianDelay(300, 600));
          }
        } catch (e) {
          log('TILE_RETRY', '[VIDEO] 실패 타일 재시도 중 예외 (무시하고 계속)', { err: e?.message });
        }
      }
      const sdErrorToast = document.querySelector('li[data-type="error"]');
      if (sdErrorToast) {
        log('VIDEO', 'SD 생성 실패 토스트 감지 → 폴백');
        return null;
      }
      const isGenerating = [...getTiles()].flatMap(tile => [...tile.querySelectorAll('div')])
        .some(el =>
          el.children.length === 0 &&
          /^\d+%$/.test((el.textContent || '').trim())
        );
      if (isGenerating) {
        log('VIDEO', `생성 중... — ${Math.round(elapsed / 1000)}s`);
        await sleep(2000);
        continue;
      }
      const seen = new Set();
      const tiles = [...getTiles()]
        .filter(t => {
          const id = getTileId(t);
          if (seen.has(id)) return false;
          seen.add(id);
          return true;
        });
      // 이미지투비디오: 이미지타일(index0) + 비디오타일 → video 있는 타일 탐색
      // 텍스트투비디오: 비디오타일 1개만 → 동일 로직으로 video+Redirect 타일 반환
      const completedVideoTile = tiles.find(t => {
        const v = t.querySelector('video');
        return v?.src && v.src.includes('Redirect');
      });
      if (completedVideoTile) {
        log('VIDEO', `SD 완료 — ${Math.round(elapsed / 1000)}s`);
        await sleep(500);
        return completedVideoTile;
      }
      const latestTile = tiles[tiles.length - 1];
      const videoSrc = latestTile?.querySelector?.('video')?.src || '';
      log('VIDEO', `최신 타일 video src: ${videoSrc ? videoSrc.slice(-50) : '(없음)'}`, { tileCount: tiles.length });
      if (!videoSrc) {
        log('VIDEO', `video src 없음 — 대기 중 ${Math.round(elapsed / 1000)}s`);
      }
      await sleep(2000);
    }
  }

  /** SD(원본) 비디오를 video.src로 직접 다운로드 — 업스케일 실패/타임아웃 시 폴백용 */
  async function downloadSD(tile, filename) {
    const sdUrl = tile?.querySelector('video')?.src;
    if (!sdUrl) {
      log('VIDEO', '❌ SD 비디오 URL 없음');
      return;
    }
    safeSendMessage({ type: 'DOWNLOAD_FILE', url: sdUrl, filename });
    log('VIDEO', `SD 폴백 다운로드: ${filename}`);
  }

  async function upscaleAndDownload(tile, filename) {
    const sdUrl = tile?.querySelector('video')?.src;
    if (!sdUrl) {
      log('VIDEO', '⚠️ video URL 없음 → SD 폴백');
      await downloadSD(tile, filename);
      return;
    }

    // ── 1단계: 메뉴 열기 + 플랜 자동 감지 ──────────────────────
    let initialSuccessCount = 0;
    try {
      await clickMoreVertAndWaitOpen(tile);
      await openDownloadSubmenu();
      initialSuccessCount = document.querySelectorAll('li[data-type="success"]').length;
      const mode = await clickBestResolution();

      if (mode === 'direct') {
        // 무료 플랜: 메뉴 닫고 SD URL 직접 다운로드
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await sleep(300);
        safeSendMessage({ type: 'DOWNLOAD_FILE', url: sdUrl, filename });
        log('VIDEO', `✅ 720p(SD) 다운로드 요청 완료: ${filename}`);
        await sleep(1000);
        return;
      }

      // 유료 플랜: 업스케일 시작됨
      log('VIDEO', '✅ 업스케일 시작 (1차 클릭)');
    } catch (err) {
      log('VIDEO', `⚠️ 업스케일 시작 실패 → SD 폴백: ${err.message}`);
      await downloadSD(tile, filename);
      return;
    }

    // ── 2단계: 업스케일 완료 대기 (유료만) ─────────────────────────
    const upscaleDone = await waitForUpscaleComplete(300000, initialSuccessCount);
    if (!upscaleDone) {
      log('VIDEO', '⚠️ 업스케일 타임아웃 → SD 폴백');
      await downloadSD(tile, filename);
      return;
    }
    log('VIDEO', '✅ 업스케일 완료');

    // ── 3단계: HD URL (SD + _upsampled) 다운로드, 파일명 보호/규칙 적용 ─────────────────
    const hdUrl = sdUrl + '_upsampled';
    log('VIDEO', '✅ HD URL:', hdUrl);
    safeSendMessage({ type: 'DOWNLOAD_FILE', url: hdUrl, filename });
    log('VIDEO', `✅ 1080p 다운로드 요청 완료: ${filename}`);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await sleep(1000);
  }

  /**
   * v1.1.6: Flow 새 UI 의 "에이전트(Agent)" 버튼 비활성화
   *   - 새 프로젝트 마다 기본 활성 상태로 노출됨
   *   - 활성 상태에서는 모델 설정 버튼이 우측 패널로 이동 → findModelSettingsBtn 미발견
   *   - 따라서 매 새 프로젝트 진입 시 모델 관련 단계 전에 강제 비활성화 필요
   *   - 버튼 못 찾으면 스킵 (구 UI / 다국어 미지원 케이스 안전)
   *   - 이미 비활성이면 스킵 (idempotent)
   *   - 클릭 후 검증 + 1회 재시도
   */
  const AGENT_BTN_TEXT = /^(에이전트|Agent|エージェント|代理|代理人|代理工具|智能体|Agente|Агент)$/i;
  function findAgentButton() {
    // 1) Flow 官方专属类名优先定位 (跨语言、最稳定)
    const chip = document.querySelector('button.agent-mode-chip, .agent-mode-chip');
    if (chip && elementIsVisible(chip)) return chip;

    // 2) aria-pressed 候选按文本匹配（包含中文"智能体"）
    const candidates = document.querySelectorAll('button[aria-pressed]');
    for (const btn of candidates) {
      if (!elementIsVisible(btn)) continue;
      const inner = btn.querySelector('.content, span, .agent-mode-chip-label')?.textContent?.trim() ||
                    btn.textContent?.trim() || '';
      if (AGENT_BTN_TEXT.test(inner)) return btn;
    }
    return null;
  }
  async function deactivateAgentButton() {
    const btn = findAgentButton();
    if (!btn) {
      log('AGENT', '에이전트 버튼 없음 — 스킵 (구 UI 또는 다국어 미매칭)');
      return false;
    }
    const isPressed = btn.getAttribute('aria-pressed') === 'true' ||
                      btn.classList.contains('agent-mode-chip-checked');
    if (!isPressed) {
      log('AGENT', '이미 비활성 — 스킵');
      return true;
    }
    log('AGENT', '활성 → 비활성화 클릭');
    btn.click();
    await simulateClick(btn);
    await sleep(400);
    // 검증 — 같은 노드 재참조 (DOM 안 바뀌었으면 같은 노드, 바뀌었으면 새로 찾음)
    let post = btn;
    if (!document.body.contains(btn)) post = findAgentButton();
    const postPressed = post && (post.getAttribute('aria-pressed') === 'true' || post.classList.contains('agent-mode-chip-checked'));
    if (postPressed) {
      log('AGENT', '⚠️ 1차 클릭 후에도 활성 — 재시도');
      post.click();
      await simulateClick(post);
      await sleep(400);
    }
    return true;
  }

  /** 비디오 모드 설정 — RESUME 시 호출 */
  async function configureVideoModeStandalone(s) {
    // ★ v1.1.6: 모델 관련 단계 전 에이전트 비활성화 (새 UI 대응)
    await deactivateAgentButton();
    log('VIDEO', '모델 드롭업 열기');
    let modelSettingsBtn = null;
    for (let i = 0; i < 25; i++) {
      modelSettingsBtn = findModelSettingsBtn();
      if (modelSettingsBtn) break;
      await sleep(200);
    }
    if (!modelSettingsBtn) throw new Error('[视频] 未找到模型设置按钮');
    await simulateClick(modelSettingsBtn);
    await sleep(800);
    const videoTab = findModeButton('Video');
    if (!videoTab) throw new Error('[视频] 未找到视频(VIDEO)标签页');
    await simulateClick(videoTab);
    await sleep(300);
    const assetTab = document.querySelector('[aria-controls$="-content-VIDEO_REFERENCES"][role="tab"]') ?? document.querySelector('[aria-label="Assets"][role="tab"]') ?? document.querySelector('[aria-label="애셋"][role="tab"]') ?? document.querySelector('[aria-controls*="VIDEO_REFERENCES"]');
    if (assetTab) { await simulateClick(assetTab); await sleep(300); }
    const dirSuffix = s.direction === 'portrait' ? 'PORTRAIT' : 'LANDSCAPE';
    const videoAspectRatio = s.aspectRatio || (dirSuffix === 'PORTRAIT' ? '9:16' : '16:9');
    const dirTab = findVisibleChoiceByExactText(videoAspectRatio) ?? document.querySelector(`[aria-controls$="-content-${dirSuffix}"][role="tab"]`) ?? document.querySelector(`[aria-label="${dirSuffix === 'PORTRAIT' ? 'Portrait mode' : 'Landscape mode'}"][role="tab"]`) ?? document.querySelector(`button[id*="trigger-${dirSuffix}"]`);
    if (!dirTab) throw new Error(`[VIDEO] ${videoAspectRatio} 탭 없음`);
    await simulateClick(dirTab);
    await sleep(300);
    const userOC = Math.max(1, Math.min(4, Number(s.outputCount) || 1));
    const outputTab = findVisibleChoiceByExactText(`x${userOC}`) ?? document.querySelector(`[aria-controls$="-content-${userOC}"][role="tab"]`) ?? document.querySelector(`[aria-label="x${userOC}"][role="tab"]`) ?? document.querySelector(`button[id*="trigger-${userOC}"]`);
    if (!outputTab) throw new Error(`[VIDEO] x${userOC} 탭 없음`);
    await simulateClick(outputTab);
    await sleep(300);
    const modelDropdownBtn = findModelDropdownBtn();
    if (!modelDropdownBtn) throw new Error('[VIDEO] 모델 드롭다운 없음');
    await simulateClick(modelDropdownBtn);
    await sleep(500);
    const videoModel = s.flowVideoModel || s.model || 'Veo 3.1 Lite';
    const modelItems = document.querySelectorAll('[role="menuitem"], [role="option"], button');
    const modelBtn = pickVideoModelItem([...modelItems], videoModel);
    if (!modelBtn) throw new Error('[视频] 未找到指定模型: ' + videoModel);
    await simulateClick(modelBtn);
    await sleep(300);
    await selectVideoDuration(s);
    await clickEmptyAreaToClose();
    await waitForPanelClosed();
    await sleep(2000);
    log('VIDEO', 'configureVideoMode 완료');
  }

  function payloadHasInlineRefMentions(payload) {
    if (!payload?.useReference) return false;
    const hasSeg = Array.isArray(payload.promptSegments)
      && payload.promptSegments.some(s => s.type === 'ref' && s.name);
    const hasIdx = Array.isArray(payload.refAssetIndices) && payload.refAssetIndices.length > 0;
    const hasNames = Array.isArray(payload.refAssetNames) && payload.refAssetNames.length > 0;
    return !!(hasSeg || hasIdx || hasNames);
  }

  /** If @mention segments are missing, attach named refs then the prompt text (checkbox-era fallback). */
  function ensurePromptRefSegments(payload, fallbackText) {
    if (!payload) return;
    const segs = Array.isArray(payload.promptSegments) ? payload.promptSegments : [];
    if (segs.some(s => s.type === 'ref' && s.name)) {
      payload.promptSegments = segs;
      return;
    }
    const names = Array.isArray(payload.refAssetNames) ? payload.refAssetNames.filter(Boolean) : [];
    if (!names.length) return;
    const refs = names.map(name => ({
      type: 'ref',
      name,
      query: String(name).replace(/\.[^.]+$/, '').trim()
    }));
    const text = fallbackText || payload.prompt || '';
    payload.promptSegments = [...refs, ...(text ? [{ type: 'text', value: text }] : [])];
    payload.useReference = true;
  }

  function minifyVideoPayloadsForResume(payloads, settings) {
    const isImg2Vid = settings?.mode === 'imageToVideo';
    return (payloads || []).map((p, idx) => {
      const base = {
        scriptText: p?.scriptText || '',
        characters: p?.characters || '',
        number: p?.number || '',
        useReference: p?.useReference === true,
        refAssetIndices: Array.isArray(p?.refAssetIndices) ? p.refAssetIndices : [],
        refAssetNames: Array.isArray(p?.refAssetNames) ? p.refAssetNames : [],
        promptSegments: Array.isArray(p?.promptSegments) ? p.promptSegments : []
      };
      if (!isImg2Vid) return base;
      const indices = Array.isArray(p?.lazyImageIndices) && p.lazyImageIndices.length
        ? p.lazyImageIndices
        : (p?.hasLazyImage === true ? [p?.lazyImageIndex ?? idx] : []);
      const hasLazy = indices.length > 0;
      base.hasLazyImage = hasLazy;
      base.lazyImageIndices = hasLazy ? indices : [];
      base.lazyImageIndex = hasLazy ? indices[0] : undefined;
      base.originalFilenames = hasLazy
        ? (Array.isArray(p?.originalFilenames) && p.originalFilenames.length
            ? p.originalFilenames
            : [p?.originalFilename || p?.images?.[0]?.name || `img_${idx + 1}.jpg`])
        : [];
      base.originalFilename = hasLazy ? (base.originalFilenames[0] || '') : '';
      return base;
    });
  }

  function minifyVideoSettingsForResume(settings) {
    return {
      mode: settings?.mode,
      direction: settings?.direction,
      aspectRatio: settings?.aspectRatio,
      flowVideoModel: settings?.flowVideoModel,
      videoDuration: settings?.videoDuration,
      model: settings?.model,
      projectName: settings?.projectName,
      isFactoryVideoPhase: settings?.isFactoryVideoPhase ?? false,
      usePromptRefAssets: settings?.usePromptRefAssets ?? false,
      promptRefAssetCount: settings?.promptRefAssetCount ?? 0,
      promptRefAssetNames: Array.isArray(settings?.promptRefAssetNames) ? settings.promptRefAssetNames : []
    };
  }

  async function attachVideoPromptAssets(payload, promptText, settings, label, promptIndex) {
    const result = { promptText, filledInline: false };
    if (!payload) return result;
    const isI2v = settings?.mode === 'imageToVideo';
    const isT2v = settings?.mode === 'textToVideo';
    if (!isI2v && !isT2v) return result;

    if (payloadHasInlineRefMentions(payload)) {
      // Same as Image Generation "Use reference image": upload the whole
      // UPLOAD ASSETS pool (user-given names), then @-attach mentioned files.
      if (settings?.usePromptRefAssets) {
        log('IMG_REF', `${label} UPLOAD ASSETS 전체 업로드 (Use reference image)`);
        await uploadAllPromptRefAssets(settings);
      }
      ensurePromptRefSegments(payload, promptText);
      log('IMG_REF', `${label} @mention 레퍼런스 ${payload.refAssetIndices?.length || payload.refAssetNames?.length || 0}개 인라인 삽입`);
      await fillImageGenPrompt(payload, promptText, label);
      result.filledInline = true;
      return result;
    }

    if (!isI2v) return result;

    const wantsAsset = payload.hasLazyImage === true
      || !!(payload.images?.[0]?.base64)
      || (Array.isArray(payload.lazyImageIndices) && payload.lazyImageIndices.length > 0);
    if (!wantsAsset) {
      log('IMG2VID', `${label} asset 없음 — 텍스트만으로 생성`);
      return result;
    }
    const assets = await resolveI2vAssetFiles(payload, promptIndex);
    if (!assets.length) {
      throw new Error(`[IMG2VID] 이미지 ${promptIndex + 1} 데이터 없음`);
    }
    log('IMG2VID', `${label} asset ${assets.length}개 첨부 시작`);
    const ok = await uploadAndAttachI2vAssets(assets, label);
    if (!ok) {
      throw new Error(`[IMG2VID] 이미지 ${promptIndex + 1} 첨부 실패`);
    }
    return result;
  }

  async function runVideoPipeline(prompts, settings, payloads, sendProgress, doNewProjectAndConfigureVideo) {
    const projectName = settings?.projectName || 'my_project';
    const total = prompts.length;
    const videoPrompts = prompts.map(p => appendNoBackgroundMusic(p || ''));
    const failedPromptIndices = [];
    let successCount = 0;
    let failCount = 0;
    _videoPipelineRunning = true;
    try {
    log('VIDEO', `파이프라인 시작 — ${total}개 프롬프트 (매 프롬프트마다 새 프로젝트)`);
    for (let i = 0; i < total; i++) {
      try {
        await waitWhilePaused();
        // ★ v1.1.8: 2번째 프롬프트부터, 시작 전 크레딧 소진 선체크 — 직전 제출 실패로 남은 주황 스티커를 잡아
        //   다음 프롬프트가 새 프로젝트 생성·이미지 재첨부·모달 재오픈하는 것을 원천 차단.
        //   ★ i===0(첫 프롬프트)은 항상 시도 (감지 오탐이 첫 생성을 막지 않도록) — 진짜 소진이면 제출 시 fix B/C가 잡음.
        if (i > 0 && detectCreditExhausted()) {
          log('VIDEO', `[${i + 1}/${total}] ❌ 크레딧 소진 감지 (프롬프트 시작 전) — 파이프라인 중단`);
          safeSendMessage({ type: 'CREDIT_EXHAUSTED', data: { source: 'VIDEO' } }).catch(() => {});
          triggerAutoPause('CREDIT_EXHAUSTED');
          failedPromptIndices.push(i);
          failCount++;
          break;
        }
        // ★ 수동 일시정지 시 PAUSE_GENERATION 핸들러에서 SAVE_RESUME용으로 사용
        const payloadMin = minifyVideoPayloadsForResume(payloads, settings);
        const promptsClean = videoPrompts || prompts;
        const settingsMin = minifyVideoSettingsForResume(settings);
        _currentVideoPipelineResumeData = { index: i, prompts: promptsClean, payloads: payloadMin, settings: settingsMin, projectName, total };
        const promptText = videoPrompts[i] || prompts[i] || '';
        log('VIDEO', `===== 프롬프트 ${i + 1}/${total} =====`);

        if (typeof doNewProjectAndConfigureVideo === 'function') {
          await doNewProjectAndConfigureVideo(i);
        }

        let fullPromptText = promptText;
        let promptFilledInline = false;
        if (payloads?.[i] && (settings?.mode === 'imageToVideo' || settings?.mode === 'textToVideo')) {
          const attached = await attachVideoPromptAssets(
            payloads[i], fullPromptText, settings, `[${i + 1}/${total}]`, i
          );
          fullPromptText = attached.promptText;
          promptFilledInline = attached.filledInline;
        }

        if (settings?.mode === 'imageToVideo' || promptFilledInline) {
          log('IMG2VID', `[${i + 1}/${total}] 프롬프트 입력`, { len: fullPromptText.length, inline: promptFilledInline });
        }
        const editor = await waitForElement(PROMPT_EDITOR_SELECTOR);
        // 이미지투동영상·팩토리 비디오: replaceAll 미사용 (deleteFragment+insertText로 텍스트만 교체, 이미지 노드 유지)
        // 인라인 @mention 경로는 fillImageGenPrompt 가 이미 프롬프트+칩을 채웠으므로 재입력 생략
        if (!promptFilledInline) await fillPrompt(editor, fullPromptText, 3);
        // ★ v1.1.8 진단: 입력 후 에디터에 텍스트가 실제 반영됐는지 확인 ("Prompt must be provided" 원인 추적)
        const _edAfter = document.querySelector(PROMPT_EDITOR_SELECTOR)?.textContent?.trim() || '';
        log('IMG2VID', `프롬프트 입력 검증`, {
          입력시도: fullPromptText.slice(0, 40),
          에디터실제: _edAfter.slice(0, 40),
          반영됨: _edAfter.length > 0,
          이미지카드: document.querySelectorAll('[contenteditable="true"] img, [data-slate-editor="true"] img').length
        });
        // ★ v1.1.8: 텍스트 미반영 시 재입력 1회 (이미지 첨부로 에디터 selection 깨진 경우 복구)
        if (_edAfter.length === 0) {
          log('IMG2VID', `⚠️ 프롬프트 미반영 — 에디터 포커스 후 재입력`);
          try { editor.focus(); editor.click(); } catch (_) {}
          await sleep(gaussianDelay(300, 600));
          if (promptFilledInline && payloads?.[i]) await fillImageGenPrompt(payloads[i], fullPromptText, `[${i + 1}/${total}]`);
          else await fillPrompt(editor, fullPromptText, 3);
          const _edRetry = document.querySelector(PROMPT_EDITOR_SELECTOR)?.textContent?.trim() || '';
          log('IMG2VID', `프롬프트 재입력 결과`, { 반영됨: _edRetry.length > 0, preview: _edRetry.slice(0, 40) });
        }
        await waitForSubmitEnabled();
        const hasButton = await checkSubmitButtonWithRetry();
        let submitBtn = hasButton ? findSubmitButton() : null;
        // ★ v1.1.8: 크레딧 소진 텍스트 팝업(부족/소진)이 떠 있으면 버튼 유무와 무관하게 소진으로 분기 (헛클릭 방지)
        if (submitBtn && detectCreditExhausted()) {
          log('VIDEO', '크레딧 소진 팝업 감지 — 제출 중단');
          submitBtn = null;
        }
        if (!submitBtn) {
          log('VIDEO', '❌ 생성 버튼 없음 — 크레딧 소진');
          safeSendMessage({ type: 'CREDIT_EXHAUSTED', data: { source: 'VIDEO' } }).catch(() => {});
          triggerAutoPause('CREDIT_EXHAUSTED');
          const payloadMinPause = minifyVideoPayloadsForResume(payloads, settings);
          const promptsCleanPause = videoPrompts || prompts;
          const settingsMinPause = minifyVideoSettingsForResume(settings);
          const submitBtnNullData = { index: i, prompts: promptsCleanPause, payloads: payloadMinPause, settings: settingsMinPause, projectName, total, hadSubmitted: false };
          console.log('[DEBUG] SAVE_RESUME 호출 시작 (submitBtn null, runVideoPipeline)');
          safeSendMessage({ type: 'SAVE_RESUME', data: submitBtnNullData }, (r) => {
            if (chrome.runtime.lastError) log('VIDEO', 'SAVE_RESUME 실패', chrome.runtime.lastError);
            else if (!r?.success) log('VIDEO', 'SAVE_RESUME 실패', r?.error);
          });
          console.log('[DEBUG] SAVE_RESUME 호출 완료 (submitBtn null, runVideoPipeline)');
          await waitWhilePaused();
          submitBtn = findSubmitButton();
          if (!submitBtn) {
            log('VIDEO', '재개 후에도 생성 버튼 없음 — 폴백: 실패 처리 후 다음 비디오 진행');
            throw new Error('[VIDEO] ❌ 생성 버튼 없음');  // catch → failedPromptIndices.push(i), continue
          }
        }
        const videoSubmitResult = await submitWithVerification(submitBtn, {
          maxAttempts: 3, verifyTimeout: 15000, backoffBase: 2000
        });
        log('VIDEO', `프롬프트 ${i + 1} 제출 검증`, videoSubmitResult);
        if (!videoSubmitResult.success) {
          // ★ v1.1.8: 제출 실패 원인이 크레딧 소진(클릭 시 팝업)이면 재시도/다음프롬프트로 가지 말고 즉시 크레딧 소진 처리
          if (detectCreditExhausted()) {
            log('VIDEO', '❌ 제출 실패 — 크레딧 소진 팝업 감지, 파이프라인 중단');
            safeSendMessage({ type: 'CREDIT_EXHAUSTED', data: { source: 'VIDEO' } }).catch(() => {});
            triggerAutoPause('CREDIT_EXHAUSTED');
            failedPromptIndices.push(i);
            failCount++;
            break;  // for 루프 종료 — 모달 재오픈 방지
          }
          throw new Error(`[VIDEO] 제출 실패 (${i + 1}번째) — 클릭 미등록`);
        }
        if (typeof sendProgress === 'function') {
          sendProgress({
            phase: 'submitting',
            totalSuccess: i - failedPromptIndices.length,
            totalFail: failedPromptIndices.length,
            total,
            submittedCount: i + 1,
            chunkStart: i,
            chunkEnd: i,
            activePromptIndices: [i],
            failedPromptIndices
          });
        }
        await sleep(500);
        const completedTile = await waitForVideoSDComplete();
        if (!completedTile) {
          if (controlState === 'PAUSED') {
            log('VIDEO', '크레딧 소진 — 파이프라인 중단');
            failedPromptIndices.push(i);
            failCount++;
            const pauseFails = [...failedPromptIndices];
            const pauseCompleted = Array.from({ length: i }, (_, k) => k).filter(k => !pauseFails.includes(k));
            if (typeof sendProgress === 'function') {
              sendProgress({
                phase: 'chunk-downloading',
                totalSuccess: successCount,
                totalFail: failCount,
                total,
                submittedCount: i + 1,
                chunkStart: i,
                chunkEnd: i,
                activePromptIndices: [],
                completedPromptIndices: pauseCompleted,
                failedPromptIndices: pauseFails
              });
            } else {
              safeSendMessage({
                type: 'GENERATION_PROGRESS',
                data: { phase: 'chunk-downloading', progressSeq: Date.now(), totalSuccess: successCount, totalFail: failCount, total, submittedCount: i + 1, chunkStart: i, chunkEnd: i, activePromptIndices: [], completedPromptIndices: pauseCompleted, failedPromptIndices: pauseFails }
              }).catch(() => {});
            }
            const payloadMin = minifyVideoPayloadsForResume(payloads, settings);
            const promptsClean = videoPrompts || prompts;
            const settingsMin = minifyVideoSettingsForResume(settings);
            const pauseResumeData = { index: i, prompts: promptsClean, payloads: payloadMin, settings: settingsMin, projectName, total, hadSubmitted: true };
            console.log('[DEBUG] SAVE_RESUME 호출 시작 (runVideoPipeline)');
            safeSendMessage({ type: 'SAVE_RESUME', data: pauseResumeData }, (r) => {
              if (chrome.runtime.lastError) log('VIDEO', 'SAVE_RESUME 실패', chrome.runtime.lastError);
              else if (!r?.success) log('VIDEO', 'SAVE_RESUME 실패', r?.error);
              else {
                chrome.storage.local.get('videoPipelineResume', (s) => {
                  console.log('[DEBUG runVideoPipeline] SAVE_RESUME 직후 storage 확인:', s);
                });
              }
            });
            console.log('[DEBUG] SAVE_RESUME 호출 완료 (runVideoPipeline)');
            break;
          }
          throw new Error(`[VIDEO] ❌ SD 생성 타임아웃 (${i + 1}번째)`);
        }
        await waitWhilePaused();
        const payload = payloads?.[i] || {};
        const baseName = typeof window.generateFilename === 'function'
          ? window.generateFilename({
              mode: settings?.mode || 'textToVideo',
              promptIndex: i,
              imageIndex: 0,
              scriptText: payload.scriptText || '',
              promptText,
              characterCode: payload.characters || '',
              sceneNumber: payload.number || '',
              // ★ imageToVideo 모드만 업로드 이미지 파일명 사용 (.mp4 교체)
              //   팩토리 video phase 는 Gemini scriptText 기반 파일명 유지 → originalFilename 미전달
              originalFilename: settings?.isFactoryVideoPhase ? '' : (payload.originalFilename || '')
            })
          : `${String(i + 1).padStart(3, '0')}_${(promptText || 'video').replace(/[^a-zA-Z0-9가-힣\s]/g, '').trim().substring(0, 20).replace(/\s+/g, '_')}.mp4`;
        const filename = `${projectName}/${baseName}`;
        // ★ 업스케일 비활성화 — 모든 모드에서 SD 직접 다운로드
        //   사유: Google Flow SD 화질 충분, 업스케일 단계 시간·오류 리스크 제거
        try {
          await downloadSD(completedTile, filename);
          log('VIDEO', `✅ SD 직접 다운로드: ${filename}`);
        } catch (sdErr) {
          log('VIDEO', `⚠️ SD 다운로드 실패 (${i + 1}번째): ${sdErr?.message || sdErr}`);
          throw sdErr;
        }
        if (typeof sendProgress === 'function') {
          const completedIndices = Array.from({ length: i + 1 }, (_, k) => k).filter(k => !failedPromptIndices.includes(k));
          sendProgress({
            phase: 'chunk-downloading',
            totalSuccess: i + 1 - failedPromptIndices.length,
            totalFail: failedPromptIndices.length,
            total,
            submittedCount: i + 1,
            chunkStart: i,
            chunkEnd: i,
            completedPromptIndices: completedIndices,
            activePromptIndices: [],
            failedPromptIndices
          });
        } else {
          safeSendMessage({
            type: 'GENERATION_PROGRESS',
            data: {
              phase: 'chunk-downloading',
              totalSuccess: i + 1 - failedPromptIndices.length,
              totalFail: failedPromptIndices.length,
              total,
              submittedCount: i + 1,
              chunkStart: i,
              chunkEnd: i,
              activePromptIndices: [],
              failedPromptIndices
            }
          }).catch(() => {});
        }
        successCount++;
        log('VIDEO', `${i + 1}/${total} 완료`);
      } catch (err) {
        log('VIDEO', `${i + 1}번째 실패:`, err.message);
        failedPromptIndices.push(i);
        failCount++;
        const completedIndices = Array.from({ length: i }, (_, k) => k).filter(k => !failedPromptIndices.includes(k));
        if (typeof sendProgress === 'function') {
          sendProgress({
            phase: 'chunk-downloading',
            totalSuccess: completedIndices.length,
            totalFail: failedPromptIndices.length,
            total,
            submittedCount: i + 1,
            chunkStart: i,
            chunkEnd: i,
            activePromptIndices: [],
            completedPromptIndices: completedIndices,
            failedPromptIndices
          });
        } else {
          safeSendMessage({
            type: 'GENERATION_PROGRESS',
            data: {
              phase: 'chunk-downloading',
              totalSuccess: completedIndices.length,
              totalFail: failedPromptIndices.length,
              total,
              submittedCount: i + 1,
              chunkStart: i,
              chunkEnd: i,
              activePromptIndices: [],
              completedPromptIndices: completedIndices,
              failedPromptIndices
            }
          }).catch(() => {});
        }
        continue;
      }
    }
    if (controlState === 'PAUSED') {
      log('VIDEO', '파이프라인 일시정지로 중단 — 재개 대기 (GENERATION_COMPLETE 미전송)');
      return;
    }
    log('VIDEO', '파이프라인 완료');
    safeSendMessage({
      type: 'GENERATION_COMPLETE',
      data: {
        totalSuccess: successCount,
        totalFail: failCount,
        failedPromptIndices
      }
    }).catch(() => {});
    } finally {
      _videoPipelineRunning = false;
      _currentVideoPipelineResumeData = null;
    }
  }

  const getTileDebugName = (tile) => {
    const src = tile?.querySelector('img')?.src || '';
    return getMediaName(src, tile);
  };

  const summarizeTilesForDebug = (tiles, pairLimit = 6) => {
    const rows = tiles.map((tile, i) => {
      const src = tile.querySelector('img')?.src || '';
      const percent = (tile.innerText || '').match(/(\d+)%/)?.[1] || '';
      let state = 'waiting';
      if (isDoneUrl(src)) state = 'done';
      else if (percent) state = 'generating';
      return {
        i,
        state,
        percent: percent ? Number(percent) : 0,
        name: getTileDebugName(tile),
        srcTail: src ? src.slice(-80) : ''
      };
    });

    const uniqueNames = [...new Set(rows.map(r => r.name).filter(Boolean))];
    const pairPreview = [];
    for (let d = 0; d < Math.min(tiles.length, pairLimit * 2); d += 2) {
      pairPreview.push({
        pair: `${d},${d + 1}`,
        nameA: rows[d]?.name || '',
        nameB: rows[d + 1]?.name || '',
        sameName: !!rows[d]?.name && !!rows[d + 1]?.name && rows[d].name === rows[d + 1].name,
        stateA: rows[d]?.state || '',
        stateB: rows[d + 1]?.state || ''
      });
    }

    return {
      tileCount: rows.length,
      uniqueImageCount: uniqueNames.length,
      uniqueNames,
      doneDom: rows.filter(r => r.state === 'done').length,
      generatingDom: rows.filter(r => r.state === 'generating').length,
      waitingDom: rows.filter(r => r.state === 'waiting').length,
      firstNames: uniqueNames.slice(0, 6),
      lastNames: uniqueNames.slice(-6),
      pairPreview
    };
  };

  /** 경과시간 기준 최소 대기 — targetMs 경과할 때까지 sleep */
  async function sleepAtLeast(targetMs, since = Date.now()) {
    const elapsed = Date.now() - since;
    if (elapsed < targetMs) await sleep(targetMs - elapsed);
  }

  const diffTileSummary = (prevSummary, nextSummary) => {
    const prevNames = new Set(prevSummary?.uniqueNames || []);
    const nextNames = new Set(nextSummary?.uniqueNames || []);
    const added = [...nextNames].filter(name => !prevNames.has(name));
    const removed = [...prevNames].filter(name => !nextNames.has(name));
    return {
      prevTileCount: prevSummary?.tileCount ?? 0,
      nextTileCount: nextSummary?.tileCount ?? 0,
      prevUniqueImageCount: prevSummary?.uniqueImageCount ?? 0,
      nextUniqueImageCount: nextSummary?.uniqueImageCount ?? 0,
      addedCount: added.length,
      removedCount: removed.length,
      addedNames: added.slice(0, 8),
      removedNames: removed.slice(0, 8)
    };
  };

  // ★ 초기 레퍼런스 업로드 간격 — 정규분포 (프로젝트당 캐릭터 수만큼 반복)
  const CHAR_REF_PER_IMAGE_MS_MIN = 2800;
  const CHAR_REF_PER_IMAGE_MS_MAX = 4200;
  const CHAR_REF_PER_IMAGE_MS = 3500; // sleepAtLeast fallback용 (기존 호환)
  /** 본문 이미지 생성 시 캐릭터 레퍼런스 첨부 최대 개수 (기존 6 → 9 확장) */
  const MAX_CHAR_REF_ATTACH = 9;

  /** MCR → 0, SC1 → 1, SC2 → 2 … 순서 */
  function getCharOrder(code) {
    if (!code) return 999;
    if (code === 'MCR') return 0;
    const m = String(code).match(/^SC(\d+)$/i);
    return m ? parseInt(m[1], 10) : 999;
  }

  /**
   * REGEN 전용 파이프라인 — 새 프로젝트 없이 현재 화면에서 프롬프트만 제출.
   * 일반 캐릭터 레퍼런스 흐름과 완전 분리.
   */
  async function runCharRefRegenOnly(prompts, settings, payloads) {
    controlState = 'RUNNING';
    try {
      if (!window.location.href.includes('flow.google.com')) {
        log('REGEN', 'Flow 페이지 아님 — URL 이동 스킵 (이미 프로젝트 내부일 수 있음)');
      }
      log('REGEN', '현재 프로젝트 내 프롬프트 제출 — 새 프로젝트/설정 스킵');
      await waitForBridgeReady();
      const promptText = (prompts && prompts[0]) || (payloads && payloads[0]?.prompt) || '';
      if (!promptText) throw new Error('重新生成: 提示词为空');

      // ★ PRO 2.0 CRITICAL FIX: 스냅샷은 에디터 fill/submit 이전에 찍어야 함
      //   Flow는 프롬프트 제출 시점에 placeholder 타일을 즉시 생성함 → 이전에 찍어야 "새 tile-id" 감지 가능
      const preSubmitTileIds = new Set();
      const preSubmitSrcSet = new Set();
      const preSubmitDoms = [...getTiles()];
      preSubmitDoms.forEach(dom => {
        const id = getTileId(dom);
        if (id) preSubmitTileIds.add(id);
        const img = dom.querySelector('img[src]');
        const src = img?.getAttribute('src') || '';
        if (src) preSubmitSrcSet.add(src);
      });
      log('REGEN', `제출 전 스냅샷: 타일 ${preSubmitTileIds.size}개, src ${preSubmitSrcSet.size}개`);

      // 이제 에디터 fill + 제출
      const editor = await waitForElement(PROMPT_EDITOR_SELECTOR, true, 15000);
      await fillPrompt(editor, promptText);
      await sleep(200);
      const submitReady = await waitForSubmitEnabled();
      if (!submitReady) log('REGEN', 'submit 버튼 활성화 타임아웃');
      const submitBtn = findSubmitButton();
      if (!submitBtn) throw new Error('REGEN: 생성 버튼 없음');
      const regenSubmitResult = await submitWithVerification(submitBtn, {
        maxAttempts: 2, verifyTimeout: 12000
      });
      log('REGEN', '프롬프트 제출 검증', regenSubmitResult);
      if (!regenSubmitResult.success) log('REGEN', '제출 실패 (진행 계속)');

      const outputCount = Math.max(1, Math.min(4, Number(payloads?.[0]?.outputCount) || 1));

      // ★ PRO 2.0: 이미지가 실제로 로드되고 valid src를 가질 때까지 폴링 (최대 120초)
      //    기존 5초 고정 대기로는 Flow 생성 완료 전 타일만 캡처되어 base64 추출 실패
      const MAX_WAIT_MS = 120000;
      const POLL_INTERVAL = 1000;  // 2s→1s 단축 (완료 감지 딜레이 절반 감소)
      const FIRST_CHECK_DELAY = 500;  // 첫 체크는 0.5초 후 (거의 즉시)
      const startedAt = Date.now();
      let regenTiles = [];
      let initialTileCount = -1;
      let firstCheck = true;
      // ★ v1.1.6: CCR 재생성 폴링에 실패 타일 ⟳ 자동 재시도 (부가 효과만, 기존 로직 영향 0)
      //   기존 로직: isNewSrc 새 src 등장 대기 → 성공
      //   문제: AI 생성은 끝났지만 CDN 로드 실패 시 src 없음 → 타임아웃 가능
      //   해결: 매 5회 폴링마다 실패 타일 발견 시 ⟳ 클릭 (최대 5회) — break 조건 변경 없음
      const _regenFailedRetries = new Map();
      const _REGEN_MAX_RETRY = 5;
      let _regenPollTick = 0;
      while (Date.now() - startedAt < MAX_WAIT_MS) {
        await sleep(firstCheck ? FIRST_CHECK_DELAY : POLL_INTERVAL);
        firstCheck = false;
        // ★ v1.1.6: 폴링 5회마다 실패 타일 ⟳ 자동 클릭 (기존 흐름과 병렬)
        _regenPollTick++;
        if (_regenPollTick % 5 === 0) {
          try {
            const failedTiles = detectFailedTilesWithReloadBtn();
            for (const { reloadBtn, tileId } of failedTiles) {
              const prev = _regenFailedRetries.get(tileId) || 0;
              if (prev >= _REGEN_MAX_RETRY) continue;
              reloadBtn.click();
              _regenFailedRetries.set(tileId, prev + 1);
              log('TILE_RETRY', `[REGEN] 미디어 로드 실패 ⟳ ${prev + 1}/${_REGEN_MAX_RETRY}`, { tileId });
              await sleep(gaussianDelay(300, 600));
            }
          } catch (_) { /* 부가 로직 — 실패해도 메인 폴링 영향 없음 */ }
        }
        const allDoms = [...getTiles()];
        const seen = new Set();
        const tileList = [];
        allDoms.forEach((dom, domIndex) => {
          const id = getTileId(dom);
          if (!id || seen.has(id)) return;
          seen.add(id);
          const rect = dom.getBoundingClientRect();
          const img = dom.querySelector('img[src]');
          const src = img?.getAttribute('src') || '';
          tileList.push({
            dom, rect, tileId: id, domIndex,
            isNewId: !preSubmitTileIds.has(id),
            isNewSrc: src && !preSubmitSrcSet.has(src),
            src, hasImg: !!img,
            loaded: !!(img?.complete && img?.naturalWidth > 0)
          });
        });
        if (initialTileCount < 0) initialTileCount = tileList.length;

        // ★ PRO 2.0 REVISED v3: isNewSrc만으로 충분 (새 src가 있다 = 새 이미지가 로드됨)
        //   프로토콜 체크 제거 — Flow가 사용하는 src 형식에 관계없이 "스냅샷에 없던 src"면 새 이미지
        const freshTiles = tileList.filter(t => t.isNewSrc);

        // 정렬: 상단(최신) 우선
        const sortedFresh = [...freshTiles].sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left);
        const topTiles = sortedFresh.slice(0, outputCount);

        if (topTiles.length === outputCount) {
          regenTiles = topTiles;
          log('REGEN', `신규 이미지 로드 완료 — ${Math.round((Date.now() - startedAt) / 1000)}초 경과 (total=${tileList.length}, fresh=${freshTiles.length}, captured=${topTiles.length})`);
          break;
        }

        // ★ 상세 진단: newSrc 타일들의 실제 src 내용을 덤프 (원인 파악용)
        const newSrcTiles = tileList.filter(t => t.isNewSrc);
        const newIdDetails = newSrcTiles.slice(0, 4).map(t => ({
          id: t.tileId?.slice(-8),
          top: Math.round(t.rect.top),
          left: Math.round(t.rect.left),
          srcHead: t.src?.slice(0, 80) || '',
          srcTail: t.src?.slice(-30) || '',
          srcLen: t.src?.length || 0,
          loaded: t.loaded,
          imgCount: t.dom?.querySelectorAll?.('img').length || 0
        }));
        log('REGEN', `대기중… (${Math.round((Date.now() - startedAt) / 1000)}s, total=${tileList.length}, newId=${tileList.filter(t=>t.isNewId).length}, newSrc=${newSrcTiles.length}, fresh=${freshTiles.length}/${outputCount})`, newIdDetails);
      }

      // 타임아웃이어도 현재 상태의 상단 타일 전송 시도
      if (regenTiles.length === 0) {
        const fallbackDoms = [...getTiles()];
        const fallbackTiles = [];
        const seen = new Set();
        fallbackDoms.forEach((dom, domIndex) => {
          const id = getTileId(dom);
          if (!id || seen.has(id)) return;
          seen.add(id);
          fallbackTiles.push({ dom, rect: dom.getBoundingClientRect(), tileId: id, domIndex });
        });
        const sortedFallback = fallbackTiles.sort((a, b) => a.rect.top - b.rect.top);
        regenTiles = sortedFallback.slice(0, outputCount);
        log('REGEN', `⚠️ 폴링 타임아웃 — 현재 상태로 강제 전송 (tiles=${regenTiles.length})`);
      }

      if (regenTiles.length > 0) {
        sendCharRefImagesToSidepanel([regenTiles], { isSingleRegen: true, regenCode: payloads?.[0]?.code });
      } else {
        log('REGEN', '썸네일 0개 — 전송 스킵');
      }
      safeSendMessage({
        type: 'GENERATION_COMPLETE',
        data: { totalSuccess: outputCount, totalFail: 0, failedPromptIndices: [], downloadSessionId: '', expectedDownloadCount: 0 }
      }).catch(() => {});
    } catch (e) {
      log('REGEN_ERROR', e.message, { stack: e.stack });
      safeSendMessage({ type: 'FLOW_ERROR', data: { message: e.message } }).catch(() => {});
    } finally {
      controlState = 'IDLE';
    }
  }

  async function uploadCharRefViaFileInput(characterRefAssets) {
    try {
      const entries = Object.entries(characterRefAssets)
        .sort((a, b) => getCharOrder(a[0]) - getCharOrder(b[0]))
        .slice(0, MAX_CHAR_REF_ATTACH);
      for (let i = 0; i < entries.length; i++) {
        const startTime = Date.now();
        const [code, ref] = entries[i];
        const base64Data = ref.base64?.includes(',') ? ref.base64.split(',')[1] : ref.base64;
        if (!base64Data) continue;
        const fileInput = await ensureImageFileInput(5000);
        if (!fileInput) {
          console.log('[FLOW] file input not found');
          return false;
        }
        const binaryString = atob(base64Data);
        const bytes = new Uint8Array(binaryString.length);
        for (let k = 0; k < binaryString.length; k++) bytes[k] = binaryString.charCodeAt(k);
        const blob = new Blob([bytes], { type: 'image/jpeg' });
        const file = new File([blob], ref.filename, { type: 'image/jpeg' });
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);
        try {
          fileInput.files = dataTransfer.files;
        } catch (e) {
          const nativeSet = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'files')?.set;
          if (nativeSet) nativeSet.call(fileInput, dataTransfer.files);
          else return false;
        }
        fileInput.dispatchEvent(new Event('change', { bubbles: true }));
        // ★ 초기 업로드 간격도 정규분포 (2.8~4.2초, 기존 고정 3.5초 수준)
        const perImageDelay = gaussianDelay(CHAR_REF_PER_IMAGE_MS_MIN, CHAR_REF_PER_IMAGE_MS_MAX);
        console.log(`[CHAR_REF] ${code} (${i + 1}/${entries.length}) 첨부 → ${perImageDelay}ms 대기`);
        await sleepAtLeast(perImageDelay, startTime);
      }
      console.log(`[CHAR_REF] ${Object.keys(characterRefAssets).length}장 업로드 완료`);
      return true;
    } catch (e) {
      console.log('[CHAR_REF] uploadCharRefViaFileInput:', e);
      return false;
    }
  }

  async function clearAttachedImageFromInput() {
    const cancelBtn = [...document.querySelectorAll('button[data-card-open]')]
      .find(btn => btn.querySelector('.google-symbols')?.textContent?.trim() === 'cancel');
    if (cancelBtn) {
      cancelBtn.click();
      await sleep(300);
      console.log('[CHAR_REF] 잔여 이미지 삭제 완료');
    }
  }

  /** 이미지투비디오 전용: File 1장을 file input으로 업로드 (캐릭터 레퍼런스 로직 재사용) */
  async function uploadSingleImageViaFileInput(file) {
    if (!file || !(file instanceof File)) {
      console.log('[IMG2VID] uploadSingleImageViaFileInput: 유효한 File 필요');
      return false;
    }
    try {
      const fileInput = await ensureImageFileInput(5000);
      if (!fileInput) {
        console.log('[IMG2VID] file input 없음');
        return false;
      }
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      try {
        fileInput.files = dataTransfer.files;
      } catch (e) {
        const nativeSet = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'files')?.set;
        if (nativeSet) nativeSet.call(fileInput, dataTransfer.files);
        else return false;
      }
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
      log('IMG2VID', `이미지 첨부: ${file.name}`);
      return true;
    } catch (e) {
      console.log('[IMG2VID] uploadSingleImageViaFileInput:', e);
      return false;
    }
  }

  function base64ToImageFile(base64, name = 'img.jpg') {
    const b64 = String(base64 || '').includes(',') ? String(base64).split(',')[1] : String(base64 || '');
    const binaryString = atob(b64);
    const bytes = new Uint8Array(binaryString.length);
    for (let k = 0; k < binaryString.length; k++) bytes[k] = binaryString.charCodeAt(k);
    const blob = new Blob([bytes], { type: 'image/jpeg' });
    return new File([blob], name || 'img.jpg', { type: 'image/jpeg' });
  }

  async function requestLazyImageByIndex(imgIdx) {
    return new Promise((resolve) => {
      safeSendMessage({ type: 'REQUEST_LAZY_IMAGE', imageIndex: imgIdx }, (r) => {
        if (chrome.runtime.lastError) resolve(null);
        else resolve(r);
      });
    });
  }

  function getI2vAssetIndexList(payload, fallbackIdx = 0) {
    if (Array.isArray(payload?.lazyImageIndices) && payload.lazyImageIndices.length) {
      return payload.lazyImageIndices.map(n => Number(n)).filter(n => Number.isInteger(n) && n >= 0);
    }
    if (payload?.lazyImageIndex !== undefined && payload?.lazyImageIndex !== null) {
      return [Number(payload.lazyImageIndex)].filter(n => Number.isInteger(n) && n >= 0);
    }
    if (payload?.hasLazyImage) return [fallbackIdx];
    return [];
  }

  async function resolveI2vAssetFiles(payload, promptIndex) {
    const assets = [];
    if (Array.isArray(payload?.images) && payload.images.length) {
      for (const img of payload.images) {
        if (!img?.base64) continue;
        assets.push({
          base64: img.base64,
          name: img.name || payload.originalFilename || `img_${assets.length + 1}.jpg`
        });
      }
    }
    if (assets.length) return assets;

    const indices = getI2vAssetIndexList(payload, promptIndex);
    const names = Array.isArray(payload?.originalFilenames) ? payload.originalFilenames : [];
    for (let k = 0; k < indices.length; k++) {
      const imgIdx = indices[k];
      log('IMG2VID', `이미지 lazy 로드`, { promptIndex: promptIndex + 1, imgIdx, slot: k + 1, total: indices.length });
      const imgRes = await requestLazyImageByIndex(imgIdx);
      if (imgRes?.success && imgRes.base64) {
        assets.push({
          base64: imgRes.base64,
          name: imgRes.name || names[k] || payload?.originalFilename || `img_${imgIdx + 1}.jpg`
        });
      }
    }
    return assets;
  }

  /** Image generation: resolve @mention reference assets (lazy, by pool index). */
  async function resolveRefAssetFiles(payload) {
    const out = [];
    const indices = Array.isArray(payload?.refAssetIndices) ? payload.refAssetIndices : [];
    const names = Array.isArray(payload?.refAssetNames) ? payload.refAssetNames : [];
    const MAX_REF = 4;
    for (let k = 0; k < indices.length && out.length < MAX_REF; k++) {
      const imgIdx = Number(indices[k]);
      if (!Number.isInteger(imgIdx) || imgIdx < 0) continue;
      const r = await requestLazyImageByIndex(imgIdx);
      if (r?.success && r.base64) {
        out.push({ base64: r.base64, name: r.name || names[k] || `ref_${imgIdx + 1}.jpg` });
      }
    }
    return out;
  }

  /**
   * Image generation: upload every UPLOAD ASSETS image into the new Flow project
   * using the user-given names. Same first step as character-ref / "Use reference image".
   */
  async function uploadAllPromptRefAssets(settings) {
    const count = Math.max(0, Number(settings?.promptRefAssetCount) || 0);
    const names = Array.isArray(settings?.promptRefAssetNames) ? settings.promptRefAssetNames : [];
    if (!count) return false;
    let uploaded = 0;
    for (let i = 0; i < count; i++) {
      const startTime = Date.now();
      const r = await requestLazyImageByIndex(i);
      if (!r?.success || !r.base64) {
        log('IMG_REF', `풀 이미지 로드 실패`, { index: i });
        continue;
      }
      const name = names[i] || r.name || `ref_${i + 1}.jpg`;
      const file = base64ToImageFile(r.base64, name);
      const ok = await uploadSingleImageViaFileInput(file);
      log('IMG_REF', `레퍼런스 업로드 ${i + 1}/${count}`, { success: ok, name });
      if (ok) uploaded += 1;
      if (i < count - 1) {
        await sleepAtLeast(gaussianDelay(CHAR_REF_PER_IMAGE_MS_MIN, CHAR_REF_PER_IMAGE_MS_MAX), startTime);
      }
    }
    if (!uploaded) return false;
    await clearAttachedImageFromInput();
    await waitForCharRefTilesInGallery(uploaded);
    log('IMG_REF', `레퍼런스 tile ${uploaded}개 등록 완료`);
    return true;
  }

  function focusPromptEditor() {
    const editor = document.querySelector(PROMPT_EDITOR_SELECTOR);
    if (!editor) return null;
    try {
      editor.focus();
      editor.click();
    } catch (_) {}
    return editor;
  }

  /** Type "@" at the caret so Flow opens its mention / asset picker. */
  async function typeAtSignInEditor() {
    const editor = focusPromptEditor();
    if (!editor) return false;
    await sleep(gaussianDelay(120, 280));
    await fillPrompt(editor, '@');
    await sleep(gaussianDelay(250, 500));
    return true;
  }

  async function waitForAssetMentionUi(timeout = 4000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const dialog = document.querySelector('div[role="dialog"][data-state="open"]');
      if (dialog) return { type: 'dialog', el: dialog };
      const listbox = [...document.querySelectorAll('[role="listbox"], [role="menu"]')]
        .find(el => elementIsVisible(el) && el.querySelector('[role="option"], [data-item-index], button, li'));
      if (listbox) return { type: 'listbox', el: listbox };
      await sleep(80);
    }
    return null;
  }

  function assetNameMatchesEl(el, name, query) {
    const imgAlt = (el.querySelector?.('img')?.alt ?? '').trim();
    const label = (el.textContent || '').trim();
    const hay = `${imgAlt} ${label}`.toLowerCase();
    const baseName = String(name || '').replace(/\.[^.]+$/, '').trim().toLowerCase();
    const q = String(query || baseName).trim().toLowerCase();
    const file = String(name || '').trim().toLowerCase();
    if (file && hay.includes(file)) return true;
    if (baseName && hay.includes(baseName)) return true;
    if (q && hay.includes(q)) return true;
    return false;
  }

  async function filterAssetPickerSearch(query) {
    const q = String(query || '').trim();
    if (!q) return;
    const modal = document.querySelector('div[role="dialog"][data-state="open"]');
    if (!modal) return;
    const input = [...modal.querySelectorAll('input')]
      .find(el => elementIsVisible(el) && el.type !== 'hidden' && el.type !== 'checkbox' && el.type !== 'radio');
    if (!input) return;
    input.focus();
    input.value = q;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(gaussianDelay(250, 450));
  }

  async function selectMentionFromListbox(listbox, name, query) {
    const options = [...listbox.querySelectorAll('[role="option"], [data-item-index], button, li')]
      .filter(elementIsVisible);
    const target = options.find(el => assetNameMatchesEl(el, name, query));
    if (!target) {
      log('IMG_REF', '인라인 @ 목록에서 이름 없음', { name, query, count: options.length });
      return false;
    }
    target.click();
    await sleep(gaussianDelay(200, 400));
    return true;
  }

  /**
   * Native Flow mention: type "@" at the caret, find the named asset, select it.
   */
  async function attachSinglePromptRef(name, label = '', query = '') {
    if (!name) return false;
    const iterStart = Date.now();
    const matchQuery = query || String(name).replace(/\.[^.]+$/, '');
    log('IMG_REF', `${label} @ 입력 후 레퍼런스 선택`, { name, query: matchQuery });

    await typeAtSignInEditor();
    let ui = await waitForAssetMentionUi(3500);
    if (!ui) {
      log('IMG_REF', `${label} @ 피커 미오픈 — + 버튼 폴백`, { name });
      const opened = await openAssetPickerModal();
      if (!opened) {
        log('IMG_REF', `${label} 모달 오픈 실패 (${name})`);
        return false;
      }
      ui = { type: 'dialog', el: document.querySelector('div[role="dialog"][data-state="open"]') };
    }

    if (ui?.type === 'listbox') {
      const ok = await selectMentionFromListbox(ui.el, name, matchQuery);
      await sleepAtLeast(gaussianDelay(400, 800), iterStart);
      focusPromptEditor();
      if (typeof stripMentionTriggerAt === 'function') await stripMentionTriggerAt();
      return ok;
    }

    await filterAssetPickerSearch(matchQuery);
    const selOk = await selectSingleImageInModal(name);
    if (selOk) {
      await waitForAssetModalClosed(5000);
      await sleepAtLeast(gaussianDelay(500, 900), iterStart);
      focusPromptEditor();
      if (typeof stripMentionTriggerAt === 'function') await stripMentionTriggerAt();
      return true;
    }
    closeAssetModal();
    await sleep(gaussianDelay(400, 700));
    focusPromptEditor();
    if (typeof stripMentionTriggerAt === 'function') await stripMentionTriggerAt();
    return false;
  }

  /**
   * Walk the prompt: type text until a mention, type "@", select that asset,
   * then continue until the next mention.
   */
  async function fillImageGenPrompt(payload, fallbackText, label = '') {
    ensurePromptRefSegments(payload, fallbackText);
    const segs = Array.isArray(payload?.promptSegments) ? payload.promptSegments : [];
    const hasRefs = !!(payload?.useReference && segs.some(s => s.type === 'ref' && s.name));
    const editor = await waitForElement(PROMPT_EDITOR_SELECTOR);
    if (!hasRefs) {
      await fillPrompt(editor, fallbackText);
      return;
    }
    for (const seg of segs) {
      if (seg.type === 'text' && seg.value) {
        const ed = focusPromptEditor() || editor;
        await fillPrompt(ed, seg.value);
        await sleep(gaussianDelay(80, 180));
      } else if (seg.type === 'ref' && seg.name) {
        await attachSinglePromptRef(seg.name, label, seg.query || '');
      }
    }
  }

  /** Upload N assets then attach each via @ modal (order preserved). */
  async function uploadAndAttachI2vAssets(assets, label = '') {
    if (!assets?.length) return false;
    for (let k = 0; k < assets.length; k++) {
      const startTime = Date.now();
      const file = base64ToImageFile(assets[k].base64, assets[k].name);
      const ok = await uploadSingleImageViaFileInput(file);
      log('IMG2VID', `${label} file input 업로드 ${k + 1}/${assets.length}`, { success: ok, name: assets[k].name });
      if (!ok) return false;
      if (k < assets.length - 1) {
        await sleepAtLeast(gaussianDelay(2800, 4200), startTime);
      }
    }

    log('IMG2VID', `${label} 타일 완료 대기 (${assets.length}개)`);
    await waitForCharRefTilesInGallery(assets.length, 60000);
    let attached = 0;
    for (let k = 0; k < assets.length; k++) {
      const atWorkflowStart = Date.now();
      const name = assets[k].name;
      log('IMG2VID', `${label} + 버튼으로 모달 열기 ${k + 1}/${assets.length}`, { imageName: name });
      const opened = await openAssetPickerModal();
      if (!opened) {
        log('IMG2VID', `${label} ⚠️ 모달 열기 실패 (${k + 1}/${assets.length})`);
        continue;
      }
      const selOk = await selectSingleImageInModal(name);
      log('IMG2VID', `${label} 모달 선택 ${k + 1}/${assets.length}`, { success: !!selOk, name });
      if (selOk) {
        await waitForAssetModalClosed(5000);
        attached += 1;
      } else {
        closeAssetModal();
        await sleep(gaussianDelay(400, 700));
      }
      await sleepAtLeast(gaussianDelay(1200, 2000), atWorkflowStart);
    }
    log('IMG2VID', `${label} 첨부 완료`, { attached, total: assets.length });
    return attached > 0;
  }

  async function waitForCharRefTilesInGallery(expectedCount, timeout = 60000) {
    const start = performance.now();
    while (true) {
      const elapsed = performance.now() - start;
      if (elapsed > timeout) {
        return false;
      }
      const tileCount = window.countFlowTiles?.() ?? getTiles().length;
      if (tileCount < expectedCount) {
        console.log(`[CHAR_REF] 타일 ${tileCount}/${expectedCount} 대기 중...`);
        await sleep(300);
        continue;
      }
      const isGenerating = [...getTiles()].flatMap(tile => [...tile.querySelectorAll('div')])
        .some(el => {
          const t = el.textContent.trim();
          if (el.children.length !== 0 || !t) return false;
          const m = t.match(/^(\d+)%$/);
          return m && parseInt(m[1], 10) < 100;
        });
      if (isGenerating) {
        console.log(`[CHAR_REF] 타일 ${tileCount}/${expectedCount} — 마지막 생성 중...`);
        await sleep(300);
        continue;
      }
      console.log(`[CHAR_REF] ✅ 전체 ${tileCount}개 완료 — ${Math.round(elapsed)}ms | 0.5초 안정화 대기`);
      await sleep(500);
      return true;
    }
  }

  /** DOM에 이미 로드된 img → canvas → base64 (401 인증 리다이렉트 URL 회피) */
  function imgToBase64(img) {
    if (!img || !img.complete || img.naturalWidth === 0) return null;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(img, 0, 0);
      return canvas.toDataURL('image/jpeg', 0.9);
    } catch (e) {
      return null;
    }
  }

  /** fetch → base64 (씬 이미지 등 공용, 캐릭터레퍼런스는 imgToBase64 사용) */
  async function fetchAsBase64(url) {
    if (!url) return null;
    try {
      const response = await fetch(url, { credentials: 'include', cache: 'no-store' });
      if (!response.ok) {
        console.log('[CHAR_REF] fetch 실패', { status: response.status, urlTail: url?.slice(-50) });
        return null;
      }
      const blob = await response.blob();
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(blob);
      });
    } catch (e) {
      console.log('[CHAR_REF] fetchAsBase64', { msg: e?.message, urlTail: url?.slice(-50) });
      return null;
    }
  }

  async function sendCharRefImagesToSidepanel(imageItems, opts = {}) {
    const base64Images = [];
    // ★ PRO 2.0 임시 디버그 — 배포 시 () => {} 로 원복
    const log = (tag, msg, extra) => {
      try {
        if (extra !== undefined) console.log(`[FLOW:${tag}]`, msg, extra);
        else console.log(`[FLOW:${tag}]`, msg);
      } catch (_) {}
    };

    log('CHAR_REF_BASE64', `[6/6] base64 변환 시작`, { 총슬롯: imageItems.length, isSingleRegen: !!opts.isSingleRegen, regenCode: opts.regenCode || '-' });

    for (let idx = 0; idx < imageItems.length; idx++) {
      const itemOrItems = imageItems[idx];
      const items = Array.isArray(itemOrItems) ? itemOrItems : [itemOrItems];
      let base64 = null;
      for (const item of items) {
        const img = item?.dom?.querySelector?.('img[src]');
        base64 = imgToBase64(img);
        if (base64) {
          log('CHAR_REF_BASE64', `슬롯 ${idx + 1} canvas 성공`, { base64Len: base64?.length || 0 });
          break;
        }
        const url = img?.src ? new URL(img.src, window.location.origin).href : null;
        if (url) {
          base64 = await fetchAsBase64(url);
          if (base64) {
            log('CHAR_REF_BASE64', `슬롯 ${idx + 1} fetch 성공`, { urlTail: url?.slice(-50) });
            break;
          }
        }
        log('CHAR_REF_BASE64', `슬롯 ${idx + 1} 후보 실패`, { img있음: !!img, complete: img?.complete });
      }
      if (!base64 && items.length > 0) {
        log('CHAR_REF_BASE64', `슬롯 ${idx + 1} 전부 실패`);
      }
      base64Images.push(base64);
    }

    const okCount = base64Images.filter(Boolean).length;
    log('CHAR_REF_BASE64', `변환 완료 → sidepanel 전송`, { 성공: okCount, 전체: base64Images.length, regenCode: opts.regenCode || '-' });

    const payload = { base64Images };
    if (opts.isSingleRegen && opts.regenCode) {
      payload.isSingleRegen = true;
      payload.regenCode = opts.regenCode;
    }

    safeSendMessage({
      type: 'CHAR_REF_IMAGES_READY',
      payload
    }).then(() => {
      log('CHAR_REF_BASE64', `CHAR_REF_IMAGES_READY 전송 완료`);
    }).catch((e) => {
      log('CHAR_REF_BASE64', `CHAR_REF_IMAGES_READY 전송 실패`, { error: e?.message });
    });
  }

  function closeAssetModal() {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  }

  async function openAssetPickerModal() {
    const plusBtn = [...document.querySelectorAll('button[aria-haspopup="dialog"]')]
      .find(btn => btn.querySelector('.google-symbols')?.textContent?.trim() === 'add_2');
    if (!plusBtn) {
      log('CHAR_REF', '+ 버튼 없음 — @ 모달 오픈 불가');
      return false;
    }
    plusBtn.click();  // ★ v1.1.8: 모달 열기는 순수 click (궤적 지연이 모달 열기 방해)
    const modal = await waitForElement('div[role="dialog"][data-state="open"]', true, 5000);
    return !!modal;
  }

  /** 모달 닫힘 짧은 폴링 — v1.1.6 selectCharacterInModal 보조 */
  async function pollModalClosed(timeout = 300) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (!document.querySelector('div[role="dialog"][data-state="open"]')) return true;
      await sleep(50);
    }
    return false;
  }

  async function selectCharacterInModal(charCode) {
    const modal = document.querySelector('div[role="dialog"][data-state="open"]');
    if (!modal) {
      log('CHAR_REF', '@ 모달 없음 — 스킵');
      return false;
    }
    // ★ v1.1.8 fix: 모달 항목 로드 대기 (모달 열린 직후 항목 미준비 → 클릭 빗나감)
    await waitForAssetModalItems(4000);
    const items = modal.querySelectorAll('div[data-item-index]');
    const target = [...items].find(item => {
      const imgAlt = item.querySelector('img')?.alt ?? '';
      return imgAlt.startsWith(charCode + '_');
    });
    if (!target) {
      log('CHAR_REF', `모달에서 ${charCode} 항목 없음 — 폴백 스킵 (일부만 첨부 가능)`, { itemCount: items.length });
      return false;
    }
    const clickable = target.querySelector('div') ?? target;

    // ★ v1.1.8 fix: 항목 클릭 재시도 루프 (img2vid 와 동일) — 미리보기/버튼 로드 전 클릭 빗나감 대응
    //   각 시도: 항목 클릭 → 1-click 닫힘?(활성 카드) → 아니면 '프롬프트에 추가' 버튼 활성화 대기 후 클릭
    //   버튼 1.2초 내 미활성 시 항목 재클릭 (최대 5회)
    for (let attempt = 1; attempt <= 5; attempt++) {
      clickable.click();
      if (await pollModalClosed(400)) {
        log('CHAR_REF', `${charCode} 1-click 첨부 (시도 ${attempt})`);
        await sleep(gaussianDelay(200, 400));
        return true;
      }
      const added = await clickAddToPromptButton(1200);
      if (added) {
        log('CHAR_REF', `${charCode} '프롬프트에 추가' 버튼 클릭 (시도 ${attempt})`);
        await sleep(gaussianDelay(300, 600));
        return true;
      }
      log('CHAR_REF', `${charCode} 미리보기 미로드 — 항목 재클릭 (${attempt}/5)`);
      await sleep(gaussianDelay(400, 700));
    }
    log('CHAR_REF', `⚠️ ${charCode} 첨부 실패 (5회 시도)`);
    return false;
  }

  /** 이미지투비디오 전용: @ 모달에서 단일 이미지(파일명) 클릭 선택 — 캐릭터레퍼런스와 달리 1개만
   *  v1.1.6: 새 Flow UI 2-click 활성화 패턴 대응 (selectCharacterInModal 와 동일 로직)
   *    - 활성 카드: 1-click → 첨부 + 모달 닫힘
   *    - 비활성 카드: 1-click → 활성화만 / 2-click → 첨부 + 닫힘
   *    이 패치 없으면 silent failure 위험 (이미지 없이 프롬프트만 제출되어 잘못된 비디오 생성) */
  async function selectSingleImageInModal(imageFilename) {
    log('IMG2VID', 'selectSingleImageInModal 시작', { imageFilename });
    const modal = document.querySelector('div[role="dialog"][data-state="open"]');
    if (!modal) {
      log('IMG2VID', '❌ @ 모달 없음');
      return false;
    }
    // ★ v1.1.8 fix: 모달 항목이 로드될 때까지 대기 (업로드 직후 모달 열면 항목 미준비 → 클릭 빗나감)
    // ★★ 근본 수정: 로컬 타일 "완료"(303ms)는 서버 에셋 인덱싱과 별개라, 방금 업로드한 그 파일명이
    //    모달에 실제 노출될 때까지 폴링(최대 12초). 안 그러면 "일치하는 결과 없음" 또는 엉뚱한 항목 클릭.
    if (imageFilename) {
      await waitForNamedAssetInModal(imageFilename, 12000);
    } else {
      await waitForAssetModalItems(4000);
    }
    const items = modal.querySelectorAll('div[data-item-index]');
    log('IMG2VID', '@ 모달 항목 수', { count: items.length });
    const baseName = (imageFilename || '').replace(/\.[^.]+$/, '');
    let target = null;
    let matchReason = '';
    if (imageFilename) {
      target = [...items].find(item => {
        const imgAlt = (item.querySelector('img')?.alt ?? '').trim();
        const label = (item.textContent || '').trim();
        return imgAlt.includes(imageFilename) || imgAlt.includes(baseName) ||
          label.includes(imageFilename) || label.includes(baseName);
      });
      if (target) matchReason = '파일명/alt 매칭';
    }
    if (!target && items.length === 1) {
      target = items[0];
      matchReason = '단일 항목';
    }
    if (!target) {
      target = [...items].find(item => item.querySelector('img'));
      if (target) matchReason = '첫 번째 이미지 항목';
    }
    if (!target) {
      log('IMG2VID', '❌ 모달에서 이미지 항목 없음', { itemCount: items.length });
      return false;
    }
    log('IMG2VID', `@ 모달에서 이미지 선택 (${matchReason})`, { imageFilename: imageFilename || '(첫 항목)' });
    const clickable = target.querySelector('div') ?? target;

    // ★ v1.1.8 fix: 항목 클릭 재시도 루프 — 미리보기/버튼 로드 전 클릭이 빗나가는 문제 대응
    //   각 시도: 항목 클릭 → 모달 닫힘?(1-click 첨부) → 아니면 '프롬프트에 추가' 버튼 활성화 대기 후 클릭
    //   버튼이 1.2초 내 활성화 안 되면(미리보기 미로드) 항목 재클릭 (최대 5회)
    for (let attempt = 1; attempt <= 5; attempt++) {
      clickable.click();
      // 1-click 즉시 닫힘 (이미지 모드 활성 카드)
      if (await pollModalClosed(400)) {
        log('IMG2VID', `✅ ${imageFilename || '이미지'} 1-click 첨부 (시도 ${attempt})`);
        await sleep(gaussianDelay(200, 400));
        return true;
      }
      // '프롬프트에 추가' 버튼 활성화 대기 후 클릭 (동영상 모드)
      const added = await clickAddToPromptButton(1200);
      if (added) {
        log('IMG2VID', `✅ '프롬프트에 추가' 버튼 클릭 (시도 ${attempt})`);
        await sleep(gaussianDelay(300, 600));
        return true;
      }
      // 버튼 미활성/미리보기 미로드 → 항목 재클릭
      log('IMG2VID', `${imageFilename || '이미지'} 미리보기 미로드 — 항목 재클릭 (${attempt}/5)`);
      await sleep(gaussianDelay(400, 700));
    }
    log('IMG2VID', `⚠️ ${imageFilename || '이미지'} 첨부 실패 (5회 시도)`);
    return false;
  }

  /** ★ v1.1.8: @ 모달의 "프롬프트에 추가" 버튼 — 활성화될 때까지 폴링 후 클릭
   *   배경: 항목 클릭 후 우측 미리보기 로드 전엔 버튼이 비활성(disabled) → 즉시 클릭 시 안 먹음
   *   해결: 버튼이 나타나고 활성화(not disabled)될 때까지 최대 timeout 폴링 후 클릭
   *   다국어 + 모달 내부 한정. 클릭 성공 시 true, 없으면 false */
  async function clickAddToPromptButton(timeout = 3000) {
    const ADD_TEXT = /프롬프트에\s*추가|add\s*to\s*prompt|프롬프트\s*추가/i;
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const modal = document.querySelector('div[role="dialog"][data-state="open"]');
      if (!modal) return false;  // 모달 이미 닫힘 (1-click 첨부됨)
      const btn = [...modal.querySelectorAll('button')].find(b => {
        if (!elementIsVisible(b)) return false;
        return ADD_TEXT.test((b.textContent || '').trim());
      });
      if (btn && !btn.disabled && btn.getAttribute('aria-disabled') !== 'true' && btn.getAttribute('data-disabled') == null) {
        btn.click();
        return true;
      }
      await sleep(150);  // 버튼 활성화 대기
    }
    return false;
  }

  const CHAR_REF_AT_MODAL_PER_CHAR_MS = 1500;

  /** ★ v1.1.8 근본수정: 방금 업로드한 "그 파일명" 항목이 @ 모달에 실제 노출될 때까지 대기.
   *   배경: waitForCharRefTilesInGallery의 "완료"는 로컬 타일 렌더 신호(≈303ms)일 뿐, @ 모달이 읽는
   *         서버 에셋 라이브러리 인덱싱과 별개다. 고정 sleep만으론 서버 타이밍을 보장 못 함.
   *   동작: 파일명/baseName이 항목 alt·label에 나타나면 즉시 반환. timeout(12s) 내 안 나타나면
   *         항목이 1개 이상이라도 폴백 매칭하도록 현재 존재 여부 반환. */
  async function waitForNamedAssetInModal(imageFilename, timeout = 12000) {
    const baseName = (imageFilename || '').replace(/\.[^.]+$/, '');
    const start = performance.now();
    while (true) {
      const elapsed = performance.now() - start;
      const modal = document.querySelector('div[role="dialog"][data-state="open"]');
      if (!modal) return false;  // 모달 닫힘
      const items = [...modal.querySelectorAll('div[data-item-index]')];
      const hit = items.find(item => {
        const imgAlt = (item.querySelector('img')?.alt ?? '').trim();
        const label = (item.textContent || '').trim();
        return imgAlt.includes(imageFilename) || imgAlt.includes(baseName) ||
          label.includes(imageFilename) || label.includes(baseName);
      });
      if (hit) {
        log('IMG2VID', '✅ @ 모달 해당 이미지 노출 확인', { elapsed: Math.round(elapsed), itemCount: items.length });
        await sleep(300);  // 미리보기 클릭 가능 상태 안정화
        return true;
      }
      if (elapsed > timeout) {
        log('IMG2VID', '⚠️ @ 모달 해당 이미지 미노출 타임아웃 — 폴백 매칭 진행', { elapsed: Math.round(elapsed), itemCount: items.length });
        return items.length >= 1;
      }
      if (Math.floor(elapsed / 1500) > Math.floor((elapsed - 250) / 1500)) {
        log('IMG2VID', `@ 모달 해당 이미지 인덱싱 대기 중... (${items.length}개 노출)`, { elapsed: Math.round(elapsed) });
      }
      await sleep(250);
    }
  }

  /** @ 모달 내 항목 로드 대기 (캐릭터레퍼런스와 동일 — 선택 전 항목 준비) */
  async function waitForAssetModalItems(timeout = 3000) {
    const start = performance.now();
    while (true) {
      const elapsed = performance.now() - start;
      if (elapsed > timeout) {
        log('IMG2VID', '⚠️ @ 모달 항목 로드 타임아웃', { elapsed: Math.round(elapsed) });
        return false;
      }
      const modal = document.querySelector('div[role="dialog"][data-state="open"]');
      const count = modal?.querySelectorAll('div[data-item-index]')?.length ?? 0;
      if (count >= 1) {
        log('IMG2VID', '✅ @ 모달 항목 로드 완료', { count, elapsed: Math.round(elapsed) });
        await sleep(300);
        return true;
      }
      await sleep(200);
    }
  }

  /** @ 모달 닫힘 대기 (이미지투비디오용 — charCode 없이) */
  async function waitForAssetModalClosed(timeout = 5000) {
    const start = performance.now();
    log('IMG2VID', 'waitForAssetModalClosed 시작', { timeout });
    while (true) {
      const elapsed = performance.now() - start;
      if (elapsed > timeout) {
        log('IMG2VID', '⚠️ @ 모달 닫힘 타임아웃', { elapsed: Math.round(elapsed) });
        return false;
      }
      const modalOpen = document.querySelector('div[role="dialog"][data-state="open"]');
      if (!modalOpen) {
        log('IMG2VID', '✅ @ 모달 닫힘 확인', { elapsed: Math.round(elapsed) });
        await sleep(300);
        return true;
      }
      if (Math.floor(elapsed / 1000) > Math.floor((elapsed - 200) / 1000)) {
        log('IMG2VID', '@ 모달 닫힘 대기 중...', { elapsed: Math.round(elapsed) });
      }
      await sleep(200);
    }
  }

  /** @ 에셋 선택 시 모달 닫힘 = 선택 완료 (DOM 카드 미생성) */
  async function waitForCharRefAttached(charCode, timeout = 5000) {
    const start = performance.now();
    while (true) {
      const elapsed = performance.now() - start;
      if (elapsed > timeout) {
        log('CHAR_REF', `${charCode} 모달 닫힘 대기 타임아웃 — 폴백 스킵`, { elapsed: Math.round(elapsed) });
        return false;
      }
      const modalOpen = document.querySelector('div[role="dialog"][data-state="open"]');
      if (!modalOpen) {
        log('CHAR_REF', `${charCode} 첨부 완료`, { elapsed: Math.round(elapsed) });
        await sleep(300);
        return true;
      }
      await sleep(200);
    }
  }

  async function attachAllCharacterRefs(sceneOrPayload, availableCharCodes) {
    const chars = ((sceneOrPayload?.characters ?? '') || (sceneOrPayload?.scene?.characters ?? ''))
      .split(',').map(c => c.trim()).filter(Boolean)
      .sort((a, b) => getCharOrder(a) - getCharOrder(b));
    if (chars.length === 0) return;

    // ★ 실제 업로드된 캐릭터 레퍼런스가 있는 코드만 첨부 시도
    //    SC3/SC4/SC5가 장면에 있지만 ref 이미지가 없으면 모달을 열지 않음 → 불필요한 DOM 조작 회피
    const validChars = availableCharCodes
      ? chars.filter(c => availableCharCodes.has(c))
      : chars;

    if (validChars.length < chars.length) {
      const skipped = chars.filter(c => !availableCharCodes?.has(c));
      log('CHAR_REF', `레퍼런스 없는 캐릭터 스킵`, { skipped, available: [...(availableCharCodes || [])] });
    }
    if (validChars.length === 0) return;

    for (const charCode of validChars) {
      const iterStart = Date.now();
      // ★ 첨부 전 정규분포 지터 — 균일 패턴 회피 (300~1200ms, 중앙 750ms)
      await sleep(gaussianDelay(300, 1200));

      const opened = await openAssetPickerModal();
      if (!opened) {
        log('CHAR_REF', `${charCode} 모달 오픈 실패 — 폴백 스킵`);
        continue;
      }
      const selected = await selectCharacterInModal(charCode);
      if (!selected) {
        closeAssetModal();
        await sleep(gaussianDelay(400, 700));  // ★ v1.1.8: 고정 500 → 가우시안
        continue;
      }
      await waitForCharRefAttached(charCode);
      // ★ 이미지 간 최소 대기도 정규분포 — 고정 1500ms 대신 1200~2000ms
      await sleepAtLeast(gaussianDelay(1200, 2000), iterStart);
    }
  }

  async function runFlowPipeline(prompts, settings, payloads) {
    controlState = 'RUNNING';
    // ★ v1.1.4: 새 작업이면 AUTO_PAUSE 플래그 리셋 (활동 관련 AUTO_PAUSE 다시 1회 허용)
    maybeResetAutoPauseFlag(settings);
    let progressSeq = 0;
    const downloadSessionId = `flow-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    let lastPromptTileSummary = null;
    const isRetryRun = !!settings.isRetry;
    const CHUNK_SIZE = 2;  // ★ v1.1.4: 4→2로 축소. Google reCAPTCHA 점수 누적 차단 대응
                            //   동시 generation 2개 = 백엔드 최저 부하
                            //   PROJECT_BATCH_SIZE=4 와 조합 → 2 chunks/project
    // ★ v1.1.8: 봇 감지 강화 대응 — 프롬프트 사이 간격 하한/상한 확대 (4~8s → 6~12s)
    //   사용자 설정값을 기존보다 50% 가산 (rough scale)
    const _baseDelay = Math.min(12, Math.max(6, Math.round(Number(settings?.promptDelay) * 1.5 || 6)));
    const promptDelaySec = _baseDelay;
    const promptDelayMs = promptDelaySec * 1000;
    const projectName = settings.projectName || 'my_project';
    const isVideoMode = settings.mode === 'promptToVideo' || settings.mode === 'textToVideo' ||
      settings.mode === 'imageToVideo';
    const total = prompts.length;
    const downloadedImageNames = new Set();
    const confirmedPromptIndices = new Set();
    const pendingRetryPromptIndices = new Set();
    let queuedDownloadCount = 0;
    const domTracking = {
      epoch: 0,
      epochBase: 0,
      prevKeys: [],
      prevCount: 0,
      lastResetAt: 0
    };
    const sendProgress = (data) => {
      const payload = { ...data, progressSeq: ++progressSeq };
      log('PROGRESS_SEND', `${payload.phase}#${payload.progressSeq}`, {
        totalSuccess: payload.totalSuccess,
        submittedCount: payload.submittedCount ?? null,
        chunkStart: payload.chunkStart ?? null,
        chunkEnd: payload.chunkEnd ?? null,
        activePromptIndices: payload.activePromptIndices ?? null,
        completedPromptIndices: payload.completedPromptIndices ?? null,
        retryPendingPromptIndices: payload.retryPendingPromptIndices ?? null,
        total: payload.total
      });
      return safeSendMessage({
        type: 'GENERATION_PROGRESS',
        data: payload
      }).catch(() => {});
    };
    const getPayloadPromptIndex = (payload, fallback) => {
      const promptIndex = Number(payload?.promptIndex);
      return Number.isFinite(promptIndex) && promptIndex >= 0 ? Math.floor(promptIndex) : fallback;
    };
    const toSortedArray = (set) => [...set].sort((a, b) => a - b);
    const emitExactProgress = (phase, extra = {}) => {
      const activePromptIndices = Array.isArray(extra.activePromptIndices)
        ? [...new Set(extra.activePromptIndices)].sort((a, b) => a - b)
        : [];
      return sendProgress({
        phase,
        totalSuccess: confirmedPromptIndices.size * 2,
        totalFail: 0,
        total: prompts.length * 2,
        completedPromptIndices: toSortedArray(confirmedPromptIndices),
        retryPendingPromptIndices: toSortedArray(pendingRetryPromptIndices),
        activePromptIndices,
        ...extra
      });
    };
    const captureTileRecords = () => {
      const tiles = [...getTiles()];
      const rawRecords = tiles.map((tile, domIndex) => {
        const src = tile.querySelector('img')?.src || '';
        const percentText = (tile.innerText || '').match(/(\d+)%/)?.[1] || '';
        const name = getMediaName(src, tile);
        let state = 'waiting';
        if (isDoneUrl(src)) state = 'done';
        else if (percentText) state = 'generating';
        // ★ v1.1.8 fix: 차단 타일 (Google "비정상 활동" placeholder) 명시 감지
        //   slot 할당에서 제외하기 위함 — 차단 타일이 슬롯을 빼앗으면 실제 성공 타일이 orphan 됨
        const tileText = tile.textContent || '';
        const blocked = isUnusualActivityText(tileText) || /실패\s*비정상/i.test(tileText) || /비정상적인\s*활동/i.test(tileText);
        return {
          domIndex,
          tileId: getTileId(tile),
          src,
          url: isDoneUrl(src) ? src : '',
          name,
          state,
          percent: percentText ? Number(percentText) : 0,
          blocked
        };
      });
      const currentKeys = rawRecords.map(record => record.tileId || `dom-${record.domIndex}`);
      const prevKeySet = new Set(domTracking.prevKeys);
      const overlapCount = currentKeys.filter(key => prevKeySet.has(key)).length;
      const minSize = Math.min(domTracking.prevCount, currentKeys.length);
      const lowOverlap = domTracking.prevCount >= 20 && currentKeys.length > 0 && overlapCount <= Math.floor(minSize * 0.25);
      const enoughTimePassed = (Date.now() - domTracking.lastResetAt) > 1000;
      if (lowOverlap && enoughTimePassed) {
        domTracking.epoch += 1;
        domTracking.epochBase += Math.max(domTracking.prevCount, 1);
        domTracking.lastResetAt = Date.now();
        log('DOM_EPOCH', 'DOM reset 감지', {
          epoch: domTracking.epoch,
          epochBase: domTracking.epochBase,
          prevCount: domTracking.prevCount,
          currentCount: currentKeys.length,
          overlapCount
        });
      }
      const records = rawRecords.map(record => ({
        ...record,
        epoch: domTracking.epoch,
        virtualDomIndex: domTracking.epochBase + record.domIndex
      }));
      domTracking.prevKeys = currentKeys;
      domTracking.prevCount = currentKeys.length;
      return records;
    };
    const buildTileGroupMap = (records) => {
      const map = new Map();
      for (const record of records) {
        const key = record.tileId || `dom-${record.domIndex}`;
        if (!map.has(key)) {
          map.set(key, {
            key,
            tileId: record.tileId || '',
            minDomIndex: record.domIndex,
            maxDomIndex: record.domIndex,
            minVirtualDomIndex: record.virtualDomIndex,
            maxVirtualDomIndex: record.virtualDomIndex,
            epoch: record.epoch,
            states: new Set(),
            url: '',
            name: '',
            records: [],
            blocked: false  // ★ v1.1.8: 차단 타일 플래그 (group 내 한 record라도 blocked면 true)
          });
        }
        const group = map.get(key);
        group.records.push(record);
        group.minDomIndex = Math.min(group.minDomIndex, record.domIndex);
        group.maxDomIndex = Math.max(group.maxDomIndex, record.domIndex);
        group.minVirtualDomIndex = Math.min(group.minVirtualDomIndex, record.virtualDomIndex);
        group.maxVirtualDomIndex = Math.max(group.maxVirtualDomIndex, record.virtualDomIndex);
        group.epoch = Math.min(group.epoch, record.epoch);
        group.states.add(record.state);
        if (!group.url && record.url) group.url = record.url;
        if (!group.name && record.name) group.name = record.name;
        if (record.blocked) group.blocked = true;  // ★ v1.1.8: 차단 마킹 전파
      }
      return map;
    };
    const createChunkEntry = (payload, fallbackIndex) => {
      const originalPromptIndex = getPayloadPromptIndex(payload, fallbackIndex);
      const oc = Math.max(1, Math.min(4, Number(payload?.outputCount) || 1));
      const slots = {};
      ['A', 'B', 'C', 'D'].slice(0, oc).forEach(letter => {
        slots[letter] = { key: null, status: 'unbound', url: '', name: '', downloaded: false, observedState: 'missing' };
      });
      return {
        originalPromptIndex,
        payload,
        slots
      };
    };
    const getEntrySlotNames = (entry) => Object.keys(entry.slots);
    const isSlotDone = (slot) => slot.status === 'done';
    const isSlotFailed = (slot) => slot.status === 'fail';
    const getEntryPromptDone = (entry) => getEntrySlotNames(entry).some(slotName => isSlotDone(entry.slots[slotName]));
    const getEntryPromptFail = (entry) => getEntrySlotNames(entry).every(slotName => isSlotFailed(entry.slots[slotName]));
    const getChunkProgressSnapshot = (entries) => {
      const donePromptIndices = [];
      const activePromptIndices = [];
      const failedPromptIndices = [];
      for (const entry of entries) {
        if (getEntryPromptDone(entry)) donePromptIndices.push(entry.originalPromptIndex);
        else if (getEntryPromptFail(entry)) failedPromptIndices.push(entry.originalPromptIndex);
        else activePromptIndices.push(entry.originalPromptIndex);
      }
      return { donePromptIndices, activePromptIndices, failedPromptIndices };
    };
    const reservePromptSlots = async (beforeGroupMap, entry, context) => {
      const beforeKeys = new Set(beforeGroupMap.keys());
      let reservedGroups = [];
      const slotNames = getEntrySlotNames(entry);
      const slotCount = slotNames.length;
      for (let attempt = 1; attempt <= 10; attempt++) {
        await waitWhilePaused();
        const afterGroupMap = buildTileGroupMap(captureTileRecords());
        // ★ v1.1.8 fix: 차단 타일(Google "비정상 활동" placeholder) 슬롯 할당에서 제외
        //   기존: 차단 타일이 DOM 상단(최신)이라 슬롯에 먼저 할당됨 → 실제 성공 타일 orphan
        //   수정: blocked 인 group 필터링 → 진짜 생성 타일만 슬롯에 매핑
        const freshGroups = [...afterGroupMap.values()]
          .filter(group => group.tileId && !beforeKeys.has(group.key))
          .filter(group => !group.blocked)
          .sort((a, b) => a.minVirtualDomIndex - b.minVirtualDomIndex);
        if (freshGroups.length > reservedGroups.length) {
          reservedGroups = freshGroups.slice(0, slotCount);
        }
        if (freshGroups.length >= slotCount) break;
        await sleep(250);
      }
      slotNames.forEach((slotName, idx) => {
        const slot = entry.slots[slotName];
        if (!slot) return;  // 안전 가드
        const group = reservedGroups[idx] || null;
        slot.key = group?.key || null;
        slot.status = group ? 'reserved' : 'pending';
        slot.observedState = group ? 'reserved' : 'missing';
      });
      log('SLOT_RESERVE', `${context.label} prompt ${entry.originalPromptIndex + 1}`, {
        chunkIndex: context.chunkIndex + 1,
        promptNo: entry.originalPromptIndex + 1,
        reserved: reservedGroups.map(group => ({
          key: group.key,
          tileId: group.tileId,
          minDomIndex: group.minDomIndex,
          minVirtualDomIndex: group.minVirtualDomIndex,
          epoch: group.epoch
        }))
      });
    };
    const updateChunkEntriesFromGroups = (entries, groupMap) => {
      let changed = false;
      for (const entry of entries) {
        for (const slotName of getEntrySlotNames(entry)) {
          const slot = entry.slots[slotName];
          if (slot.status === 'done' || slot.status === 'fail') continue;
          const group = slot.key ? groupMap.get(slot.key) : null;
          const observedState = group
            ? (group.url ? 'done' : (group.states.has('generating') ? 'generating' : 'pending'))
            : 'missing';
          slot.observedState = observedState;
          if (group?.url) {
            if (slot.status !== 'done' || slot.url !== group.url) {
              slot.status = 'done';
              slot.url = group.url;
              slot.name = group.name || '';
              changed = true;
            }
          } else if (group && observedState === 'generating') {
            if (slot.status !== 'generating') {
              slot.status = 'generating';
              changed = true;
            }
          } else if (group) {
            if (slot.status !== 'pending') {
              slot.status = 'pending';
              changed = true;
            }
          } else {
            // ★ v1.1.8: slot.key 가 있는데 groupMap 에서 사라짐 = stale (Flow tileId 재발급)
            //   → key 리셋하여 applyChunkFallbackAssignments 가 새 done group 으로 재할당 가능하게 함
            if (slot.key) {
              slot.key = null;
              slot.fallbackAssigned = false;
            }
            if (slot.status !== 'pending') {
              slot.status = 'pending';
              changed = true;
            }
          }
        }
      }
      return changed;
    };
    const applyChunkFallbackAssignments = (entries, groupMap, context) => {
      const assignedKeys = new Set();
      for (const entry of entries) {
        for (const slotName of getEntrySlotNames(entry)) {
          const key = entry.slots[slotName].key;
          if (key) assignedKeys.add(key);
        }
      }
      const candidateGroups = [...groupMap.values()]
        .filter(group => !context.baselineGroupKeys.has(group.key))
        .filter(group => !assignedKeys.has(group.key))
        .filter(group => group.tileId)
        .filter(group => !group.blocked)  // ★ v1.1.8 fix: 차단 타일 fallback 할당에서도 제외
        .sort((a, b) => a.minVirtualDomIndex - b.minVirtualDomIndex);
      if (!candidateGroups.length) return false;
      let changed = false;
      for (const entry of entries) {
        for (const slotName of getEntrySlotNames(entry)) {
          const slot = entry.slots[slotName];
          if (slot.key || slot.status === 'done' || slot.status === 'fail') continue;
          const nextGroup = candidateGroups.shift();
          if (!nextGroup) return changed;
          slot.key = nextGroup.key;
          slot.status = nextGroup.url ? 'done' : (nextGroup.states.has('generating') ? 'generating' : 'pending');
          slot.observedState = 'fallback-assigned';
          slot.fallbackAssigned = true;
          changed = true;
          log('SLOT_FALLBACK_ASSIGN', `${context.label} prompt ${entry.originalPromptIndex + 1} ${slotName}`, {
            chunkIndex: context.chunkIndex + 1,
            promptNo: entry.originalPromptIndex + 1,
            slot: slotName,
            key: nextGroup.key,
            tileId: nextGroup.tileId,
            epoch: nextGroup.epoch,
            minVirtualDomIndex: nextGroup.minVirtualDomIndex
          });
        }
      }
      return changed;
    };
    // ★ v1.1.8 fix: 최종 done 복구 안전망 — DOM에 done URL 타일이 있으면 미완료 슬롯에 강제 매칭
    //   배경: Flow가 placeholder→완성 전환 시 tileId를 재발급 → 예약한 slot.key가 stale →
    //         groupMap 매칭 실패 → 영원히 pending → markRemainingSlotsFailed가 fail 처리
    //   결과: 화면엔 성공 이미지 보이는데 큐는 '전부 실패' + 다운로드 안 됨
    //   해결: fail 마킹 직전, 미할당 done group을 미완료 슬롯에 순서대로 강제 할당
    const recoverDoneSlots = (entries, groupMap, context) => {
      const assignedKeys = new Set();
      for (const entry of entries) {
        for (const slotName of getEntrySlotNames(entry)) {
          const k = entry.slots[slotName].key;
          if (k) assignedKeys.add(k);
        }
      }
      // baseline(이전 프로젝트 잔존) 제외 + done URL 보유 + 차단 아님 + 아직 미할당
      const doneGroups = [...groupMap.values()]
        .filter(g => g.tileId && g.url && !g.blocked)
        .filter(g => !context.baselineGroupKeys.has(g.key))
        .filter(g => !assignedKeys.has(g.key))
        .sort((a, b) => a.minVirtualDomIndex - b.minVirtualDomIndex);
      // ★ v1.1.8 진단: 복구 가능한 done group 현황
      const allDoneInDom = [...groupMap.values()].filter(g => g.tileId && g.url && !g.blocked).length;
      log('SLOT_DONE_RECOVERY_SCAN', `${context.label} 복구 스캔`, {
        domDoneTotal: allDoneInDom,
        baselineExcluded: [...groupMap.values()].filter(g => g.url && context.baselineGroupKeys.has(g.key)).length,
        alreadyAssigned: assignedKeys.size,
        recoverable: doneGroups.length
      });
      if (!doneGroups.length) return false;
      let changed = false;
      for (const entry of entries) {
        for (const slotName of getEntrySlotNames(entry)) {
          const slot = entry.slots[slotName];
          if (slot.status === 'done') continue;
          // 현재 slot.key 가 유효한 done group 을 이미 가리키면 스킵
          const curGroup = slot.key ? groupMap.get(slot.key) : null;
          if (curGroup && curGroup.url) continue;
          // stale 또는 url 없는 슬롯 → 미할당 done group 으로 교체
          const next = doneGroups.shift();
          if (!next) { return changed; }
          slot.key = next.key;
          slot.url = next.url;
          slot.name = next.name || '';
          slot.status = 'done';
          slot.recoveredDone = true;
          changed = true;
          log('SLOT_DONE_RECOVERY', `${context.label} prompt ${entry.originalPromptIndex + 1} ${slotName} — stale key 복구 → done`, {
            promptNo: entry.originalPromptIndex + 1,
            slot: slotName,
            tileId: next.tileId,
            url: (next.url || '').slice(-40)
          });
        }
      }
      return changed;
    };
    const markRemainingSlotsFailed = (entries, reason) => {
      for (const entry of entries) {
        for (const slotName of getEntrySlotNames(entry)) {
          const slot = entry.slots[slotName];
          if (slot.status !== 'done') {
            slot.status = 'fail';
            slot.failReason = reason;
          }
        }
      }
    };
    const enqueueChunkDownloads = async (assignments, context) => {
      if (!assignments.length) return;
      queuedDownloadCount += assignments.length;
      safeSendMessage({
        type: 'REGISTER_DOWNLOAD_BATCH',
        data: {
          sessionId: downloadSessionId,
          delta: assignments.length
        }
      }).catch(() => {});
      emitExactProgress('chunk-downloading', {
        chunkStart: context.chunkStart,
        chunkEnd: context.chunkEnd,
        expectedDownloadCount: queuedDownloadCount,
        currentChunkDownloadCount: assignments.length
      });
      for (let i = 0; i < assignments.length; i++) {
        const item = assignments[i];
        safeSendMessage({
          type: 'DOWNLOAD_FILE',
          url: item.url,
          filename: item.filename,
          folder: projectName ? `AI4Next/${projectName}/preview` : 'AI4Next/preview',
          sessionId: downloadSessionId
        }).catch(() => {});
        log('CHUNK_DOWNLOAD_ENQUEUE', `${context.label} ${i + 1}/${assignments.length}`, {
          chunkIndex: context.chunkIndex + 1,
          promptNo: item.promptNo,
          slot: item.slot,
          filename: item.filename
        });
        // ★ 다운로드 간격 정규분포 (2~4초, 기존 고정 3초 수준 유지)
        await sleep(gaussianDelay(2000, 4000));
      }
    };
    const finalizeChunk = async (chunkEntries, context) => {
      const assignments = [];
      const chunkConfirmed = [];
      const chunkRetry = [];

      for (const entry of chunkEntries) {
        const originalIdx = entry.originalPromptIndex;
        if (getEntryPromptDone(entry)) {
          confirmedPromptIndices.add(originalIdx);
          pendingRetryPromptIndices.delete(originalIdx);
          chunkConfirmed.push(originalIdx);
          for (const slotName of getEntrySlotNames(entry)) {
            const slot = entry.slots[slotName];
            if (!slot.url || slot.downloaded || downloadedImageNames.has(slot.name || slot.url)) continue;
            downloadedImageNames.add(slot.name || slot.url);
            assignments.push({
              url: slot.url,
              filename: buildFilename({ promptNo: originalIdx + 1, slot: slotName }, prompts, projectName, payloads || [], settings, entry.payload),
              promptNo: originalIdx + 1,
              slot: slotName,
              name: slot.name || ''
            });
            slot.downloaded = true;
          }
        } else {
          pendingRetryPromptIndices.add(originalIdx);
          chunkRetry.push(originalIdx);
        }
      }

      const summary = chunkEntries.map(entry => ({
        promptNo: entry.originalPromptIndex + 1,
        ...Object.fromEntries(getEntrySlotNames(entry).map(slotName => [slotName, entry.slots[slotName]?.status || '-']))
      }));
      log('CHUNK_MAPPING', context.label, {
        chunkIndex: context.chunkIndex + 1,
        promptStart: context.promptStart + 1,
        promptEnd: context.promptEnd,
        completedPromptIndices: chunkConfirmed,
        retryPromptIndices: chunkRetry,
        summary
      });

      await enqueueChunkDownloads(assignments, context);
      emitExactProgress('chunk-downloading', {
        chunkStart: context.promptStart,
        chunkEnd: context.promptEnd
      });

      // ★ Factory 모드: 완료된 프롬프트별 imageBase64 → sidepanel 전송 (canvas 우선, CORS 회피)
      if (settings.mode === 'factory' && chunkConfirmed.length > 0) {
        const findImgForSlot = (s) => {
          if (!s?.url && !s?.name) return null;
          const imgs = [...getTiles()].flatMap(tile => [...tile.querySelectorAll('img[src]')]);
          for (const img of imgs) {
            if (!img.src) continue;
            if (s.url && img.src === s.url) return img;
            if (s.name && img.src.includes(s.name)) return img;
          }
          return null;
        };
        for (const originalIdx of chunkConfirmed) {
          const entry = chunkEntries.find(e => e.originalPromptIndex === originalIdx);
          if (!entry || !getEntryPromptDone(entry)) continue;
          const slotName = getEntrySlotNames(entry).find(name => entry.slots[name]?.url);
          const slot = slotName ? entry.slots[slotName] : null;
          if (!slot?.url) continue;
          const filename = buildFilename(
            { promptNo: originalIdx + 1, slot: slotName },
            prompts, projectName, payloads || [], settings, entry.payload
          );
          try {
            const imgEl = findImgForSlot(slot);
            let base64 = imgEl ? imgToBase64(imgEl) : null;
            if (!base64 && slot.url) base64 = await fetchAsBase64(slot.url);
            if (base64 && base64.length > 100) {
              await safeSendMessage({
                type: 'GENERATION_PROGRESS',
                data: {
                  promptIndex: originalIdx,
                  status: 'completed',
                  imageBase64: base64,
                  imageFilename: filename,
                  displayNum: String(originalIdx + 1).padStart(2, '0'),
                  total: prompts.length
                }
              }).catch(() => {});
              log('FACTORY_BASE64', `prompt ${originalIdx + 1} 전송`, { filename: filename?.slice(-30) });
            }
          } catch (e) {
            console.log('[FLOW Factory] imageBase64 fetch 실패:', originalIdx + 1, e?.message);
          }
        }
      }
    };
    const warmupBridge = async (label) => {
      log('STEP 14', `bridge 워밍업 (${label})`);
      await new Promise((resolve) => {
        window.addEventListener('__flowFillPromptDone', resolve, { once: true });
        window.dispatchEvent(new CustomEvent('__flowFillPrompt', { detail: { text: '' } }));
        setTimeout(resolve, 1000);
      });
      await sleep(200);
      log('STEP 14', `bridge 워밍업 완료 (${label})`);
    };
    const runBatch = async (batchPayloads, batchLabel) => {
      const isVideo = settings.mode === 'promptToVideo' || settings.mode === 'textToVideo';
      const batchPrompts = batchPayloads.map(p => {
        const t = p.prompt || '';
        return isVideo ? appendNoBackgroundMusic(t) : t;
      });
      if (!batchPrompts.length) return;
      const MAX_CONSECUTIVE_FAILS = 3;
      let consecutiveFailCount = 0;
      let consecutiveChunkFails = 0;
      // ★ Rate-limit 감지 — 누적 실패 타일 집합 기반 단계형 백오프
      //    임계값: 3개 누적될 때부터 순차적으로 쿨다운 강화
      //    1~2개: 짧은 쿨다운만 (일시적 오류일 수 있음)
      //    3~4개: 본격 백오프 시작 (1단계)
      //    5~9개: 2단계 (x1.10)
      //    10~14개: 3단계 (x1.20)
      //    15+개: 4단계 (x1.25, 최대)
      const seenFailedTileIds = new Set();
      const getRateLimitStage = () => {
        const n = seenFailedTileIds.size;
        if (n >= 15) return 4;
        if (n >= 10) return 3;
        if (n >= 5) return 2;
        if (n >= 3) return 1;
        return 0;
      };
      const getRateLimitMultiplier = () => {
        const s = getRateLimitStage();
        if (s >= 4) return 1.25;
        if (s >= 3) return 1.20;
        if (s >= 2) return 1.10;
        return 1.0;
      };
      const scaledGaussianDelay = (min, max) => {
        const m = getRateLimitMultiplier();
        return gaussianDelay(Math.round(min * m), Math.round(max * m));
      };
      /**
       * Rate-limit 감지 처리 — 누적 실패 개수 기반 단계형
       * @returns {{triggered: boolean, cooldownMs: number}}
       */
      const handleRateLimitIfDetected = async (phase) => {
        const details = detectRateLimitDetails();
        if (!details.detected) return { triggered: false, cooldownMs: 0 };
        const currentFailedIds = details.tileIds || [];
        const newFailedIds = currentFailedIds.filter(id => !seenFailedTileIds.has(id));
        if (newFailedIds.length === 0 && details.tileCount > 0) {
          // 이미 본 타일만 있음 → 스킵 (중복 감지 방지)
          return { triggered: false, cooldownMs: 0 };
        }
        newFailedIds.forEach(id => seenFailedTileIds.add(id));
        const total = seenFailedTileIds.size;
        const stage = getRateLimitStage();
        const mult = getRateLimitMultiplier();
        // 단계별 쿨다운 (3개 누적부터 본격 증가)
        let base;
        if (stage === 0) base = [8000, 14000];       // 1~2개
        else if (stage === 1) base = [15000, 25000]; // 3~4개
        else if (stage === 2) base = [25000, 40000]; // 5~9개
        else if (stage === 3) base = [40000, 60000]; // 10~14개
        else base = [60000, 90000];                  // 15+개
        const cooldown = gaussianDelay(Math.round(base[0] * mult), Math.round(base[1] * mult));
        log('RATE_LIMIT', `⚠️ [${phase}] 신규 ${newFailedIds.length}개 / 누적 ${total}개 / 단계 ${stage} — ${cooldown}ms 쿨다운, 지연배율 x${mult}`);

        // ★ v1.1.3: 사이드패널에 사용자 안내 토스트 전송 — 원인 + 권장 액션
        safeSendMessage({
          type: 'RATE_LIMIT_STATUS',
          data: {
            stage,
            accumulated: total,
            newFailures: newFailedIds.length,
            cooldownMs: cooldown,
            cooldownSec: Math.round(cooldown / 1000),
            multiplier: mult,
            phase
          }
        }).catch(() => {});

        await sleep(cooldown);
        return { triggered: true, cooldownMs: cooldown };
      };

      // ★ v1.1.3: Google 봇 차단 ("unusual activity") 감지 + 사용자 안내 + 패턴 분류
      //   rate-limit과 동일 패턴 — 누적 실패 타일 집합 기반, 임계점 도달 시 AUTO_PAUSE
      //   임계값: 누적 5개 차단 타일 → AUTO_PAUSE (rate-limit보다 엄격 — reCAPTCHA 악화 방지)
      //
      //   패턴 분류 (사용자에게 정확한 원인 추정 안내):
      //   1) 'automation' — 시작 직후 전체 차단 → 자동화 의심 (1~2시간 휴식 권장)
      //   2) 'content'    — 부분 차단, 일부 성공 → 콘텐츠 정책 의심 (프롬프트 수정 권장)
      //   3) 'gradual'    — 초기 성공 후 점진 차단 → reCAPTCHA 누적 (잠시 휴식 권장)
      //   4) 'unknown'    — 데이터 부족 (기본 안내)
      const seenUnusualTileIds = new Set();
      const UNUSUAL_AUTO_PAUSE_THRESHOLD = 5;
      const UNUSUAL_DIALOG_THROTTLE_MS = 60000;  // 다이얼로그/토스트 알림 60초 throttle (spam 방지)
      const runStartTime = Date.now();
      let firstUnusualDetectedAt = 0;
      let firstUnusualSuccessCount = -1;  // 최초 차단 시점의 성공 타일 수
      let unusualContentNoticeShown = false;  // 콘텐츠 정책 안내 1회만
      let lastDialogAlertTime = 0;            // 마지막 다이얼로그/토스트 알림 시각 (throttle)

      const classifyUnusualPattern = () => {
        const blocked = seenUnusualTileIds.size;
        const succeeded = confirmedPromptIndices.size;
        const totalProcessed = blocked + succeeded;
        const elapsedFromStartSec = (Date.now() - runStartTime) / 1000;
        const successesBeforeFirstBlock = firstUnusualSuccessCount;

        if (totalProcessed < 2) return 'unknown';

        // Pattern A: 시작 직후 거의 전부 차단 (성공 0~1개 + 차단 시점 빠름)
        if (successesBeforeFirstBlock <= 1 && elapsedFromStartSec < 120 && blocked >= 3) {
          return 'automation';
        }
        // Pattern C: 초기 정상 후 점진 차단 (5개 이상 성공 후 차단 시작)
        if (successesBeforeFirstBlock >= 5) {
          return 'gradual';
        }
        // Pattern B: 부분 차단 + 일부 성공 (콘텐츠 정책 의심)
        const successRatio = succeeded / Math.max(1, totalProcessed);
        if (successRatio >= 0.2 && successRatio <= 0.7) {
          return 'content';
        }
        return 'unknown';
      };

      const handleUnusualActivityIfDetected = async (phase) => {
        const details = detectUnusualActivityDetails();
        if (!details.detected) return { triggered: false };

        const newTileIds = (details.tileIds || []).filter(id => !seenUnusualTileIds.has(id));
        // tile source: 신규 tileId 없으면 스킵 (중복 감지 방지)
        if (details.source === 'tile' && newTileIds.length === 0) {
          return { triggered: false };
        }
        // dialog/toast source: throttle 60초 (5초 폴링이 spam 되지 않도록)
        if (details.source !== 'tile') {
          const now = Date.now();
          if (now - lastDialogAlertTime < UNUSUAL_DIALOG_THROTTLE_MS) {
            return { triggered: false };
          }
          lastDialogAlertTime = now;
        }
        const isFirstDetection = seenUnusualTileIds.size === 0 && firstUnusualDetectedAt === 0;
        newTileIds.forEach(id => seenUnusualTileIds.add(id));
        const total = seenUnusualTileIds.size;

        // 최초 감지 시점의 성공 카운트 스냅샷 (gradual vs automation 판별용)
        if (isFirstDetection) {
          firstUnusualDetectedAt = Date.now();
          firstUnusualSuccessCount = confirmedPromptIndices.size;
        }

        const pattern = classifyUnusualPattern();
        log('UNUSUAL', `🛑 [${phase}] Google 차단 — 신규 ${newTileIds.length} / 누적 ${total} / 성공 ${confirmedPromptIndices.size} / 패턴=${pattern} / source=${details.source}`);

        // 사이드패널에 토스트 전송 (패턴별 메시지 + 콘텐츠 정책 안내)
        safeSendMessage({
          type: 'UNUSUAL_ACTIVITY_STATUS',
          data: {
            accumulated: total,
            newBlocks: newTileIds.length,
            successCount: confirmedPromptIndices.size,
            successBeforeFirstBlock: firstUnusualSuccessCount,
            source: details.source,
            pattern,                                              // 'automation' | 'content' | 'gradual' | 'unknown'
            showContentPolicy: !unusualContentNoticeShown,        // 콘텐츠 정책 안내 1회만
            phase,
            willAutoPause: total >= UNUSUAL_AUTO_PAUSE_THRESHOLD
          }
        }).catch(() => {});
        unusualContentNoticeShown = true;

        // 임계점 도달 시 AUTO_PAUSE — 추가 요청 시 reCAPTCHA 점수 더 악화 방지
        if (total >= UNUSUAL_AUTO_PAUSE_THRESHOLD || details.source === 'dialog') {
          log('AUTO_PAUSE', `Google 차단 임계점 (${total} ≥ ${UNUSUAL_AUTO_PAUSE_THRESHOLD}) 또는 다이얼로그 → 자동 일시정지`);
          triggerAutoPause('UNUSUAL_ACTIVITY_DETECTED');
          await waitWhilePaused();
          // ★ v1.1.4 fix: 재개 후 단순 리셋 X — DOM에 남아있는 OLD 차단 타일을 "이미 본 것"으로 마킹
          //   버그: 단순 clear() 시 DOM에 남은 OLD 타일이 다시 "신규 차단"으로 인식 → 빠르게 또 AUTO_PAUSE
          //   해결: 재개 시 현재 DOM의 모든 차단 타일 ID를 seenUnusualTileIds에 미리 등록
          //         → 진짜 신규 차단(재개 후 새로 발생한 것)만 카운트
          seenUnusualTileIds.clear();
          firstUnusualSuccessCount = -1;
          firstUnusualDetectedAt = 0;
          unusualContentNoticeShown = false;
          lastDialogAlertTime = 0;
          // 재개 시점의 기존 차단 타일을 "본 것"으로 마킹 (재카운트 방지)
          const existingUnusual = detectUnusualActivityDetails();
          if (existingUnusual.detected && Array.isArray(existingUnusual.tileIds)) {
            existingUnusual.tileIds.forEach(id => seenUnusualTileIds.add(id));
            log('UNUSUAL', `재개 시 기존 차단 타일 ${existingUnusual.tileIds.length}개 "이미 본 것"으로 마킹 — 재카운트 방지`);
          }
          return { triggered: true, paused: true };
        }
        return { triggered: true, paused: false };
      };
      await warmupBridge(batchLabel);

      // ★ v1.1.3: Adaptive chunk size with fallback mode
      //   - 정상: 4 prompts/chunk
      //   - Rate-limit Stage 1+ 감지 시: 2 prompts/chunk (폴백 모드, 회복할 때까지 유지)
      //   - 한 번 폴백 진입하면 프로젝트 끝까지 폴백 유지 (안전 우선)
      const FALLBACK_CHUNK_SIZE = 1;  // ★ v1.1.4: 정상 CHUNK_SIZE=2 → 폴백은 1 (one-at-a-time)
      let currentChunkSize = CHUNK_SIZE;  // 시작은 정상 (2)
      const estimatedTotalChunks = Math.ceil(batchPrompts.length / CHUNK_SIZE);

      log('STEP 15', `${batchLabel} 청크 모드 (adaptive)`, {
        chunkSizeNormal: CHUNK_SIZE,
        chunkSizeFallback: FALLBACK_CHUNK_SIZE,
        promptDelaySec,
        estimatedTotalChunks,
        total: batchPrompts.length
      });

      let chunk = 0;
      let start = 0;
      while (start < batchPrompts.length) {
        await waitWhilePaused();

        // ★ Rate-limit 감지 시 폴백 모드 전환 (한 번 전환되면 유지)
        if (currentChunkSize > FALLBACK_CHUNK_SIZE && getRateLimitStage() >= 1) {
          log('JITTER', `★ Rate-limit Stage ${getRateLimitStage()} 감지 (누적 실패 ${seenFailedTileIds.size}개) → 안전 폴백 모드 전환 (chunk size ${currentChunkSize} → ${FALLBACK_CHUNK_SIZE})`);
          currentChunkSize = FALLBACK_CHUNK_SIZE;
        }

        const end = Math.min(start + currentChunkSize, batchPrompts.length);
        // 동적 totalChunks: 지금까지 처리한 + 남은 청크 (현재 chunk size 기준)
        const totalChunks = chunk + Math.ceil((batchPrompts.length - start) / currentChunkSize);
        const chunkPayloads = batchPayloads.slice(start, end);
        const activePromptIndices = chunkPayloads.map((payload, idx) => getPayloadPromptIndex(payload, start + idx));
        const chunkEntries = chunkPayloads.map((payload, idx) => createChunkEntry(payload, start + idx));
        const baselineRecords = captureTileRecords();
        const baselineGroupMap = buildTileGroupMap(baselineRecords);
        const baselineSummary = summarizeTilesForDebug([...getTiles()], 8);
        const context = {
          label: batchLabel,
          chunkIndex: chunk,
          promptStart: start,
          promptEnd: end,
          chunkStart: activePromptIndices[0] ?? 0,
          chunkEnd: (activePromptIndices[activePromptIndices.length - 1] ?? -1) + 1,
          baselineGroupKeys: new Set(baselineGroupMap.keys())
        };

        log('CHUNK_BASELINE', `${batchLabel} 청크 ${chunk + 1}/${totalChunks}`, {
          promptRange: `${context.chunkStart + 1}-${context.chunkEnd}`,
          baselineSummary
        });

        for (let i = start; i < end; i++) {
          await waitWhilePaused();

          // ★ v1.1.3: CHUNK_SIZE = 4로 줄여서 자연스럽게 청크-end 완료 대기 활용
          //   기존 chunk-end 로직(STEP 16)이 자동으로 전체 청크 완료까지 대기 → 다음 청크 시작
          //   별도 사전 대기 로직 불필요 (단순화)

          let submitted = false;
          let attempts = 0;
          let submitAt = 0;
          const promptText = batchPrompts[i];
          const batchPromptNo = i + 1;
          const localSubmittedIndices = chunkPayloads
            .slice(0, Math.max(0, (i - start) + 1))
            .map((payload, idx) => getPayloadPromptIndex(payload, start + idx));

          const entry = chunkEntries[i - start];
          const payload = batchPayloads[i];
          // ★ availableCharCodes를 루프 밖에서 1회만 생성
          const availableCharCodes = (useCharRef && settings.characterRefAssets)
            ? new Set(Object.keys(settings.characterRefAssets))
            : null;
          // ★ v1.1.3 fix: outer 시도 3 → 1로 축소 (중복 submit 완전 차단)
          //   - 1회 시도 실패 시 즉시 다음 프롬프트로 진행
          //   - 실패한 프롬프트는 pendingRetryPromptIndices에 자동 추가 (line 2306)
          //   - 청크 완료 후 batch retry로 자동 재처리 (line 3345 ~ runBatch)
          //   - 사용자: "1회 시도면 충분, 실패해도 나중에 재생성 로직 있으니 OK"
          while (!submitted && attempts < 1) {
            attempts++;
            log('STEP 15', `${batchLabel} 프롬프트 ${batchPromptNo}/${batchPrompts.length} 입력`, {
              chunk: `${chunk + 1}/${totalChunks}`,
              preview: promptText.substring(0, 50) + '...'
            });
            if (useCharRef && payload && (payload.characters || payload.scene?.characters)) {
              await attachAllCharacterRefs(payload.scene || payload, availableCharCodes);
              // ★ v1.1.8: 첨부 후 대기 확대 — Flow 봇 감지 강화 대응 (1.5~3 → 2.5~5초)
              await sleep(gaussianDelay(2500, 5000));
            }
            await fillImageGenPrompt(payload, promptText, batchLabel);
            log('STEP 15', `${batchLabel} 프롬프트 ${batchPromptNo}/${batchPrompts.length} 입력 완료`);

            const editorText = document.querySelector(PROMPT_EDITOR_SELECTOR)?.textContent?.trim();
            if (!editorText) {
              console.log('[FLOW] 에디터 비어있음 — submit 건너뜀, 재시도');
              await sleep(gaussianDelay(400, 700));
              continue;
            }

            log('STEP 15', `${batchLabel} 프롬프트 ${batchPromptNo} submit 버튼 활성화 대기`);
            const submitReady = await waitForSubmitEnabled();
            if (!submitReady) log('STEP 15', `${batchLabel} 프롬프트 ${batchPromptNo} submit 버튼 타임아웃`);

            // ★ v1.1.3: 누적 DOM 부하 대응 Slate.js commit 대기 시간 동적 증가
            //   ★ v1.1.8: 봇 감지 강화 대응 — 전 구간 ~1.5x 확대 (인간적 입력 타이밍)
            //   - 초기:                  250~700ms (구 150~400)
            //   - 누적 타일 50개 이상:   500~1000ms (구 300~600)
            //   - 누적 타일 100개 이상:  800~1500ms (구 500~900)
            const currentTileCount = getTiles().length;
            let preSubmitMin, preSubmitMax;
            if (currentTileCount >= 100) { preSubmitMin = 800;  preSubmitMax = 1500; }
            else if (currentTileCount >= 50) { preSubmitMin = 500; preSubmitMax = 1000; }
            else { preSubmitMin = 250; preSubmitMax = 700; }
            await sleep(gaussianDelay(preSubmitMin, preSubmitMax));

            // ★ submit 직전 에디터 텍스트 재검증 — Slate state 누락 시 즉시 재입력 (refill)
            //   waitForSubmitEnabled 후 추가 대기 동안 Flow의 자동 clear 등으로 비워졌을 가능성 차단
            const editorCheck = document.querySelector(PROMPT_EDITOR_SELECTOR);
            const editorTextNow = editorCheck?.textContent?.trim() || '';
            if (!editorTextNow) {
              log('STEP 15', `${batchLabel} 프롬프트 ${batchPromptNo} submit 직전 에디터 비어있음 → 재입력`);
              await fillImageGenPrompt(payload, promptText, batchLabel);
              await sleep(gaussianDelay(200, 400));
            }

            // ★ submit 전 unusual activity 감지 — 3회 연속 시 AUTO_PAUSE
            if (detectUnusualActivity()) {
              consecutiveFailCount++;
              log('UNUSUAL', `비정상 활동 감지 (연속 ${consecutiveFailCount}/${MAX_CONSECUTIVE_FAILS})`, { prompt: batchPromptNo });
              if (consecutiveFailCount >= MAX_CONSECUTIVE_FAILS) {
                log('AUTO_PAUSE', '비정상 활동 연속 감지 → 자동 일시정지');
                triggerAutoPause('UNUSUAL_ACTIVITY_DETECTED');
                await waitWhilePaused();
                consecutiveFailCount = 0;
                attempts = 0;  // ★ AUTO_PAUSE resume 후 attempts 리셋 → 프롬프트 누락 방지
              } else {
                // ★ v1.1.8: unusual activity 감지 후 쿨다운 확대 (5~10s → 12~25s)
                //   봇 감지 강화 시기 — reCAPTCHA 점수 회복 시간 충분히 확보
                const cooldown = gaussianDelay(12000, 25000);
                log('UNUSUAL', `비정상 활동 쿨다운 ${cooldown}ms (v1.1.8 확대)`);
                await sleep(cooldown);
              }
              continue;
            }

            const beforeGroupMap = buildTileGroupMap(captureTileRecords());
            let submitBtn = findSubmitButton();
            if (!submitBtn) {
              // ★ 이미지 모드에서도 submit 버튼 없음 시 AUTO_PAUSE (기존: 즉시 throw)
              log('SUBMIT', '생성 버튼 없음 — 재시도 및 AUTO_PAUSE 확인');
              const hasButton = await checkSubmitButtonWithRetry();
              submitBtn = hasButton ? findSubmitButton() : null;
              if (!submitBtn) {
                const isCreditExhausted = detectCreditExhausted();
                const isUnusual = detectUnusualActivity();
                const reason = isCreditExhausted ? 'CREDIT_EXHAUSTED'
                  : isUnusual ? 'UNUSUAL_ACTIVITY_DETECTED'
                  : 'SUBMIT_BUTTON_MISSING';
                log('AUTO_PAUSE', `생성 버튼 없음 → ${reason}`);
                triggerAutoPause(reason);
                await waitWhilePaused();
                attempts = 0;  // ★ AUTO_PAUSE resume 후 attempts 리셋 → 프롬프트 누락 방지
                await sleep(500);  // ★ resume 후 DOM 안정화 대기
                submitBtn = findSubmitButton();
                if (!submitBtn) {
                  consecutiveFailCount++;
                  log('SUBMIT', `resume 후에도 버튼 없음 (연속 실패 ${consecutiveFailCount}/${MAX_CONSECUTIVE_FAILS})`);
                  if (consecutiveFailCount >= MAX_CONSECUTIVE_FAILS) {
                    log('AUTO_PAUSE', '연속 실패 한계 도달 → 자동 일시정지');
                    triggerAutoPause('CONSECUTIVE_FAILURES');
                    await waitWhilePaused();
                    consecutiveFailCount = 0;
                    attempts = 0;  // ★ 2차 AUTO_PAUSE 후에도 attempts 리셋
                  }
                  continue;
                }
                consecutiveFailCount = 0;
              }
            }
            // ★ submit 전 정규분포 미세 지터 (100~500ms)
            await sleep(gaussianDelay(100, 500));
            submitAt = Date.now();
            // ★ v1.1.3 fix: 이미지 배치 1회 시도만 사용 — 중복 submit 완전 차단
            //   이유: Flow가 1번 클릭으로도 정상 처리 (사용자 확인)
            //   - 12s 안에 타일 placeholder 안 보여도 silent 처리 중일 수 있음
            //   - 재시도 시 같은 프롬프트 중복 생성 → 6 tile 문제
            //   - verifyTimeout 25s로 확대 → silent 처리 충분히 대기 (placeholder 보통 1~15초 내 등장)
            //   - 진짜 실패면 outer while 루프(attempts < 3)가 자동 재시도 (재입력부터 새로)
            const submitResult = await submitWithVerification(submitBtn, {
              maxAttempts: 1, verifyTimeout: 25000
            });
            log('STEP 15', `${batchLabel} 프롬프트 ${batchPromptNo}/${batchPrompts.length} 제출 검증`, submitResult);

            // ★ submit 후 unusual activity 감지 — 누적 임계 도달 시 AUTO_PAUSE + 사용자 안내 토스트
            //   (제출은 됐지만 경고가 떴다면, 다음 프롬프트 전에 일시정지해야 함)
            //   타일 차단 임계: 5개 누적 → AUTO_PAUSE (reCAPTCHA 점수 악화 방지)
            const unusualResult = await handleUnusualActivityIfDetected('submit');
            if (unusualResult.paused) {
              attempts = 0;  // ★ resume 후 attempts 리셋
            }

            if (submitResult.success) {
              submitted = true;
              consecutiveFailCount = 0;
              await reservePromptSlots(beforeGroupMap, entry, context);
            }
            else {
              log('STEP 15', `${batchLabel} 프롬프트 ${batchPromptNo} 제출 실패 (${submitResult.signal}) — 재시도`);
              await sleep(500);
            }
          }

          const promptTiles = [...getTiles()];
          const promptTileSummary = summarizeTilesForDebug(promptTiles);
          const promptTileDiff = diffTileSummary(lastPromptTileSummary, promptTileSummary);
          log('STEP 15 DOM', `${batchLabel} 프롬프트 ${batchPromptNo}/${batchPrompts.length} 제출 후 DOM`, {
            promptIndex: batchPromptNo,
            chunk: `${chunk + 1}/${totalChunks}`,
            summary: {
              tileCount: promptTileSummary.tileCount,
              uniqueImageCount: promptTileSummary.uniqueImageCount,
              doneDom: promptTileSummary.doneDom,
              generatingDom: promptTileSummary.generatingDom,
              waitingDom: promptTileSummary.waitingDom,
              firstNames: promptTileSummary.firstNames,
              lastNames: promptTileSummary.lastNames
            },
            diff: promptTileDiff
          });
          if (lastPromptTileSummary && promptTileDiff.removedCount > 0) {}
          lastPromptTileSummary = promptTileSummary;

          const progressSnapshot = getChunkProgressSnapshot(chunkEntries);
          // ★ submitting: 현재 처리 중인 단일 인덱스만 active (청크 전체 아님)
          // ★ BUGFIX: i는 batchPrompts 내 로컬 인덱스 → 글로벌 promptIndex로 변환
          // (프로젝트 분할 2차 이후 배치에서 큐 스피너가 엉뚱한 위치에 표시되던 버그 수정)
          const globalPromptIdx = entry?.originalPromptIndex ?? getPayloadPromptIndex(payload, i);
          emitExactProgress('submitting', {
            chunkStart: context.chunkStart,
            chunkEnd: context.chunkEnd,
            submittedCount: localSubmittedIndices.length,
            activePromptIndices: [globalPromptIdx],
            completedPromptIndices: [...new Set([
              ...toSortedArray(confirmedPromptIndices),
              ...progressSnapshot.donePromptIndices
            ])].sort((a, b) => a - b)
          });

          // ★ 속도 제한 감지 시 추가 쿨다운 + 점진적 백오프 (중복 방지)
          await handleRateLimitIfDetected('submit');

          // ★ 프롬프트 간 대기 중에도 일시정지 감지 (일시정지 눌렀는데 다음 프롬프트 진행되는 버그 방지)
          // ★ 정규분포 지터 — 균일 패턴 회피 (1.5~3.5초, rate-limit 감지 시 x1.1~x1.25 스케일)
          // ★ v1.1.3: 3번째 청크(chunk index 2)부터 inter-prompt 추가 2초
          //   - 정상 4-per-chunk: 9번째 프롬프트부터 (누적 부하 시점)
          //   - 폴백 2-per-chunk: 5번째 프롬프트부터 (이미 rate-limit 발생 = 더 일찍 보수적)
          //   chunk index 기반으로 두 모드 모두에서 자동으로 더 안전하게 작동
          if (i < end - 1) {
            const chunkExtraMs = chunk >= 2 ? 2000 : 0;
            const jitter = scaledGaussianDelay(1500, 3500) + chunkExtraMs;
            const remaining = submitAt > 0
              ? Math.max(0, promptDelayMs - (Date.now() - submitAt))
              : promptDelayMs;
            const delayEnd = Date.now() + remaining + jitter;
            log('JITTER', `프롬프트 ${i + 1} → ${i + 2} 대기`, { base: remaining, jitter, total: remaining + jitter });
            while (Date.now() < delayEnd) {
              await waitWhilePaused();
              await sleep(500);
            }
          }
        }

        const _userOutputCount = Math.max(1, Math.min(4, Number(chunkPayloads[0]?.outputCount) || 1));
        log('STEP 16', `${batchLabel} 청크 ${chunk + 1}/${totalChunks} 생성 대기`, {
          expectedImages: chunkPayloads.length * _userOutputCount,
          promptRange: `${context.chunkStart + 1}-${context.chunkEnd}`
        });
        const genStart = Date.now();
        const GEN_BASE_TIMEOUT_MS = 120000;        // 기본 2분
        const GEN_HARD_CAP_MS = 600000;            // 무한루프 방지 하드캡 10분
        const MAX_RATE_LIMIT_IN_LOOP = 5;          // 한 청크에서 rate-limit 5회 초과 시 포기
        let genLoopCount = 0;
        let lastChunkTileSummary = null;
        let lastLedgerDigest = '';
        let stableNoGeneratingTicks = 0;
        let cooldownBudgetMs = 0;                   // 누적 쿨다운 시간 (타임아웃 연장용)
        let rateLimitTriggersInLoop = 0;            // 이 청크에서 rate-limit 발동 횟수
        const expectedImages = chunkPayloads.length * _userOutputCount;
        // ★ v1.1.6: 실패 타일별 ⟳ 재시도 카운터 (CDN 로드 실패 자동 복구)
        const failedTileRetries = new Map();
        const MAX_FAILED_TILE_RETRIES = 5;
        while (true) {
          const realElapsed = Date.now() - genStart;
          const effectiveElapsed = realElapsed - cooldownBudgetMs;
          // 하드 캡: 어떤 상황이든 10분 넘으면 종료 (무한루프 방지)
          if (realElapsed >= GEN_HARD_CAP_MS) {
            log('STEP 16', `${batchLabel} 청크 ${chunk + 1} 하드캡 종료 (10분 초과)`, { realElapsed, cooldownBudgetMs });
            break;
          }
          // 유효 경과 시간 (쿨다운 제외) 기준 타임아웃
          if (effectiveElapsed >= GEN_BASE_TIMEOUT_MS) break;

          await waitWhilePaused();
          genLoopCount++;
          // ★ v1.1.8 Tier1: 생성 대기 중 idle 마우스 무브 — 불규칙 주기로 마우스 살려둠
          //   reCAPTCHA v3 가 세션 전체 마우스 활동을 봄 → 대기 중에도 사람처럼 미세 이동
          //   루프 1틱 = 2초. ★ v1.1.8 anti-bot #2: 빈도 상향(0.4→0.7) → 평균 ~2.8초 간격으로 마우스 활동 유지.
          //   idle move 는 skipIfBusy=true 라 클릭/제출과 충돌 없음 (busy면 자동 스킵).
          if (Math.random() < 0.7) {
            try {
              safeSendMessage({ type: 'CDP_IDLE_MOVE' });  // fire-and-forget (응답 대기 안 함)
            } catch (_) { /* idle move 실패는 무시 */ }
          }
          // ★ 생성 대기 중 unusual activity 감지 — 매 5회(~10초)마다만 확인 (성능 부하 방지)
          if (genLoopCount % 5 === 0 && detectUnusualActivity()) {
            consecutiveFailCount++;
            log('UNUSUAL', `생성 대기 중 비정상 활동 감지 (연속 ${consecutiveFailCount}/${MAX_CONSECUTIVE_FAILS})`);
            if (consecutiveFailCount >= MAX_CONSECUTIVE_FAILS) {
              log('AUTO_PAUSE', '비정상 활동 연속 감지 → 자동 일시정지');
              triggerAutoPause('UNUSUAL_ACTIVITY_DETECTED');
              await waitWhilePaused();
              consecutiveFailCount = 0;
            }
          }
          // ★ 생성 대기 중 속도 제한 감지 — 쿨다운은 타임아웃에서 제외, 과도 발동 시 AUTO_PAUSE
          if (genLoopCount % 5 === 0) {
            const rl = await handleRateLimitIfDetected('generating');
            if (rl.triggered) {
              cooldownBudgetMs += rl.cooldownMs;
              rateLimitTriggersInLoop++;
              if (rateLimitTriggersInLoop >= MAX_RATE_LIMIT_IN_LOOP) {
                log('AUTO_PAUSE', `rate-limit 루프 내 ${MAX_RATE_LIMIT_IN_LOOP}회 초과 → 자동 일시정지`);
                triggerAutoPause('RATE_LIMIT_PERSISTENT');
                await waitWhilePaused();
                rateLimitTriggersInLoop = 0;
                // 재개 후 타임아웃 리셋 (genStart는 그대로 두고 cooldown budget 확장)
                cooldownBudgetMs = Date.now() - genStart;
              }
            }
            // ★ v1.1.3: 생성 중 Google 차단 감지 — 실패 타일 누적 시 AUTO_PAUSE + 사용자 안내
            const ua = await handleUnusualActivityIfDetected('generating');
            if (ua.paused) {
              cooldownBudgetMs = Date.now() - genStart;
            }
            // ★ v1.1.6: "미디어를 로드하는 중에 문제가 발생했습니다" 자동 ⟳ 재시도
            //   AI 생성은 끝났지만 CDN 로드만 실패한 케이스 (사용자 수동 경험: 3회 안에 보통 복구)
            try {
              const failedTiles = detectFailedTilesWithReloadBtn();
              for (const { reloadBtn, tileId } of failedTiles) {
                const prev = failedTileRetries.get(tileId) || 0;
                if (prev >= MAX_FAILED_TILE_RETRIES) {
                  if (prev === MAX_FAILED_TILE_RETRIES) {
                    log('TILE_RETRY', `타일 ${tileId} 최대 재시도(${MAX_FAILED_TILE_RETRIES}) 도달 — 추가 클릭 중단`);
                    failedTileRetries.set(tileId, prev + 1);  // 로그 1회만 찍게 +1
                  }
                  continue;
                }
                reloadBtn.click();
                failedTileRetries.set(tileId, prev + 1);
                log('TILE_RETRY', `미디어 로드 실패 타일 ⟳ 재시도 ${prev + 1}/${MAX_FAILED_TILE_RETRIES}`, { tileId });
                await sleep(gaussianDelay(300, 600));
              }
            } catch (e) {
              log('TILE_RETRY', '실패 타일 재시도 중 예외 (무시하고 계속)', { err: e?.message });
            }
          }
          const records = captureTileRecords();
          const groupMap = buildTileGroupMap(records);
          const tiles = [...getTiles()];
          const tileDebug = summarizeTilesForDebug(tiles);
          const tileDiff = diffTileSummary(lastChunkTileSummary, tileDebug);
          let ledgerChanged = updateChunkEntriesFromGroups(chunkEntries, groupMap);
          ledgerChanged = applyChunkFallbackAssignments(chunkEntries, groupMap, context) || ledgerChanged;
          ledgerChanged = updateChunkEntriesFromGroups(chunkEntries, groupMap) || ledgerChanged;
          const ledgerSnapshot = chunkEntries.map(entry => ({
            promptNo: entry.originalPromptIndex + 1,
            ...Object.fromEntries(getEntrySlotNames(entry).map(slotName => [slotName, entry.slots[slotName]?.status || '-']))
          }));
          const ledgerDigest = JSON.stringify(ledgerSnapshot);
          const progressSnapshot = getChunkProgressSnapshot(chunkEntries);
          const generating = chunkEntries.reduce((count, entry) => count + getEntrySlotNames(entry).filter(slotName => entry.slots[slotName].status === 'generating').length, 0);
          const pending = chunkEntries.reduce((count, entry) => count + getEntrySlotNames(entry).filter(slotName => ['reserved', 'pending', 'unbound'].includes(entry.slots[slotName].status)).length, 0);

          if (
            !lastChunkTileSummary ||
            tileDiff.nextUniqueImageCount !== tileDiff.prevUniqueImageCount ||
            tileDiff.nextTileCount !== tileDiff.prevTileCount ||
            tileDebug.doneDom !== lastChunkTileSummary.doneDom ||
            tileDebug.generatingDom !== lastChunkTileSummary.generatingDom ||
            tileDebug.waitingDom !== lastChunkTileSummary.waitingDom ||
            ledgerChanged
          ) {
            log('STEP 16 DOM', `${batchLabel} 청크 ${chunk + 1}/${totalChunks} DOM 변화`, {
              chunk: chunk + 1,
              expectedImages,
              ledgerSnapshot,
              summary: {
                tileCount: tileDebug.tileCount,
                uniqueImageCount: tileDebug.uniqueImageCount,
                doneDom: tileDebug.doneDom,
                generatingDom: tileDebug.generatingDom,
                waitingDom: tileDebug.waitingDom,
                firstNames: tileDebug.firstNames,
                lastNames: tileDebug.lastNames
              },
              diff: tileDiff
            });
          }

          emitExactProgress('generating', {
            chunkStart: context.chunkStart,
            chunkEnd: context.chunkEnd,
            activePromptIndices: progressSnapshot.activePromptIndices,
            completedPromptIndices: [...new Set([
              ...toSortedArray(confirmedPromptIndices),
              ...progressSnapshot.donePromptIndices
            ])].sort((a, b) => a - b)
          });

          if (genLoopCount === 1 || genLoopCount % 5 === 0) {
            log('STEP 16', `${batchLabel} 진행`, {
              chunk: chunk + 1,
              progressSnapshot,
              generating,
              pending,
              expectedImages,
              tileDebug,
              ledgerSnapshot
            });
          }
          lastChunkTileSummary = tileDebug;
          // ★ v1.1.8 핵심 fix v2: Flow가 % 진행률 없이 placeholder(waiting)→done 전환하는 케이스 대응
          //   배경: slot.key stale + Flow가 % 안 보여줌 → generating(%) 기준 대기가 조기 종료 유발
          //         → 종료 시점에 done 타일 0개 → 복구 실패 → fail (실제론 곧 완성됨)
          //   해결: DOM의 "fresh 미결정(waiting) 타일"이 있으면 대기 — done/blocked 로 결정될 때까지
          //   fresh = baseline(이전 청크/프로젝트) 제외한 이번 청크 생성분
          const domGenerating = (tileDebug.generatingDom || 0) > 0;
          const freshNow = [...groupMap.values()].filter(g => g.tileId && !context.baselineGroupKeys.has(g.key));
          const freshUndecided = freshNow.filter(g => !g.url && !g.blocked).length;  // waiting placeholder
          const freshDecided = freshNow.length - freshUndecided;                      // done 또는 blocked
          // 안정 상태 = 슬롯 generating 0 + DOM generating(%) 0 + fresh 미결정 0
          const isStable = generating === 0 && !domGenerating && freshUndecided === 0;
          if (ledgerDigest !== lastLedgerDigest) {
            stableNoGeneratingTicks = 0;
            lastLedgerDigest = ledgerDigest;
          } else if (isStable) {
            stableNoGeneratingTicks++;
          } else {
            stableNoGeneratingTicks = 0;
          }
          // 완료: 예상 타일이 모두 나타나고 전부 결정됨(done/blocked)
          if (freshDecided >= expectedImages && freshUndecided === 0) {
            log('STEP 16', `${batchLabel} 청크 ${chunk + 1} 생성 완료`, {
              chunk: chunk + 1,
              expectedImages,
              freshDecided,
              freshUndecided,
              ledgerSnapshot,
              tileDebug
            });
            break;
          }
          // 안정화 종료: 미결정 타일 없고 안정 상태 3틱 지속 (expected 못 채워도 — 차단 등)
          if (isStable && stableNoGeneratingTicks >= 3) {
            log('STEP 16', `${batchLabel} 청크 ${chunk + 1} 안정화 종료`, {
              chunk: chunk + 1,
              pending,
              domGenerating,
              freshDecided,
              freshUndecided,
              ledgerSnapshot,
              tileDebug
            });
            break;
          }
          await sleep(2000);
        }

        // ★ v1.1.8: fail 마킹 직전, DOM의 done URL 타일을 stale 슬롯에 복구 (false fail 방지)
        const finalGroupMap = buildTileGroupMap(captureTileRecords());
        recoverDoneSlots(chunkEntries, finalGroupMap, context);
        markRemainingSlotsFailed(chunkEntries, 'chunk_stabilized');
        await finalizeChunk(chunkEntries, context);

        // ★ 연속 청크 실패 감지 — 2회 연속 전체 실패 시 AUTO_PAUSE
        const allFailed = chunkEntries.every(e => Object.values(e.slots).every(s => s.status === 'fail'));
        if (allFailed) {
          consecutiveChunkFails++;
          log('CHUNK_FAIL', `청크 ${chunk + 1} 전체 실패 (연속 ${consecutiveChunkFails}회)`);
        } else {
          consecutiveChunkFails = 0;
        }
        if (consecutiveChunkFails >= 2) {
          log('AUTO_PAUSE', '연속 청크 실패 → 자동 일시정지');
          triggerAutoPause('GENERATION_STALLED');
          await waitWhilePaused();
          consecutiveChunkFails = 0;
        }

        // ★ 청크 간 정규분포 지터 — Flow 속도 제한 회피 (5~8초, 누적 실패에 따라 x1.1~x1.25)
        if (end < batchPrompts.length) {
          const chunkJitter = scaledGaussianDelay(5000, 8000);
          log('JITTER', `청크 ${chunk + 1} → ${chunk + 2} 대기`, { delay: chunkJitter, accumulatedFails: seenFailedTileIds.size, stage: getRateLimitStage(), currentChunkSize });
          await sleep(chunkJitter);
        }

        // ★ 다음 청크 진입
        start = end;
        chunk++;
      }
    };
    log('START', 'runFlowPipeline', {
      promptsCount: prompts.length,
      mode: settings?.mode,
      direction: settings?.direction,
      isRetryRun
    });

    const isCharRefRun = (payloads || []).length > 0 && (payloads || []).every(p => p.type === 'characterRef');
    const useCharRef =
      (settings?.mode === 'scriptToImage' || settings?.mode === 'factory' || settings?.mode === 'textToImage') &&
      !!settings.useCharRef &&
      !!settings.characterRefAssets &&
      !isCharRefRun;
    try {
      if (!window.location.href.includes('flow.google.com')) {
        log('STEP 0', 'URL 이동 → flow.google.com');
        window.location.href = 'https://flow.google.com/';
        await sleep(2000);
      } else {
        log('STEP 0', '이미 Flow 페이지');
      }

      log('BRIDGE', 'waitForBridgeReady 시작');
      await waitForBridgeReady();
      log('BRIDGE', 'waitForBridgeReady 완료');

      if (!isRetryRun) {
        if (isVideoMode) {
          log('STEP 1', '비디오 모드 — runVideoPipeline 내 매 프롬프트마다 새 프로젝트 생성', { mode: settings?.mode, isFactoryVideoPhase: !!settings?.isFactoryVideoPhase });
        } else {
          // ★ 如果已经在项目画板页面（/project/.../edit/...），直接在当前画板继续生成
          const isAlreadyInProject = window.location.href.includes('/project/') && window.location.href.includes('/edit/');
          if (isAlreadyInProject) {
            log('STEP 1', '已在 Flow 项目画板中，直接复用当前项目');
          } else {
            log('STEP 1', '새 프로젝트 버튼 대기');
            const newProjBtn = await waitForNewProjectButton();
            newProjBtn.scrollIntoView({ behavior: 'instant', block: 'center' });
            await sleep(gaussianDelay(1500, 2500));  // ★ 안정화 대기 — 평균 2초, 1.5~2.5초 분포
            await simulateClick(newProjBtn);
            log('STEP 1', '새 프로젝트 클릭');
            await waitForNewProjectReady();
            await sleep(500);
            log('STEP 1', '새 프로젝트 준비 완료');
          }

          if (useCharRef) {
            log('CHAR_REF', '캐릭터 레퍼런스 file input 업로드');
            const ok = await uploadCharRefViaFileInput(settings.characterRefAssets);
            if (ok) {
              await clearAttachedImageFromInput();
              const charCount = Object.keys(settings.characterRefAssets || {}).length;
              const expectedTiles = charCount;
              await waitForCharRefTilesInGallery(expectedTiles);
              log('CHAR_REF', `레퍼런스 tile ${expectedTiles}개(캐릭터 ${charCount}명) 등록 완료 → 다음 단계`);
            }
          }
          if (settings?.mode === 'textToImage' && settings?.usePromptRefAssets) {
            log('IMG_REF', 'UPLOAD ASSETS 전체 업로드 (Use reference image)');
            await uploadAllPromptRefAssets(settings);
          }
          await configureImageMode(settings);
        }
      }

      async function configureVideoMode(s) {
        // ★ v1.1.6: 모델 설정 버튼 찾기 전 에이전트 비활성화 (새 UI 대응)
        await deactivateAgentButton();
        log('VIDEO', '모델 드롭업 열기');
        let modelSettingsBtn = null;
        for (let i = 0; i < 25; i++) {
          modelSettingsBtn = findModelSettingsBtn();
          if (modelSettingsBtn) break;
          await sleep(200);
        }
        if (!modelSettingsBtn) throw new Error('[视频] 未找到模型设置按钮');
        await simulateClick(modelSettingsBtn);
        await sleep(800);

        const videoTab = findModeButton('Video');
        if (!videoTab) throw new Error('[视频] 未找到视频(VIDEO)标签页');
        log('VIDEO', 'VIDEO 탭 선택');
        await simulateClick(videoTab);
        await sleep(300);

        const assetTab = (
          document.querySelector('[aria-controls$="-content-VIDEO_REFERENCES"][role="tab"]') ??
          document.querySelector('[aria-label="Assets"][role="tab"]') ??
          document.querySelector('[aria-label="애셋"][role="tab"]') ??
          document.querySelector('[aria-controls*="VIDEO_REFERENCES"]')
        );
        if (assetTab) {
          await simulateClick(assetTab);
          await sleep(300);
          log('VIDEO', '에셋 탭 선택');
        }

        const dirSuffix = s.direction === 'portrait' ? 'PORTRAIT' : 'LANDSCAPE';
        const dirLabelEn = dirSuffix === 'PORTRAIT' ? 'Portrait mode' : 'Landscape mode';
        const dirLabelKo = dirSuffix === 'PORTRAIT' ? '세로 모드' : '가로 모드';
        const videoAspectRatio = s.aspectRatio || (dirSuffix === 'PORTRAIT' ? '9:16' : '16:9');
        const dirTab = findVisibleChoiceByExactText(videoAspectRatio) ??
          document.querySelector(`[aria-controls$="-content-${dirSuffix}"][role="tab"]`) ??
          document.querySelector(`[aria-label="${dirLabelEn}"][role="tab"]`) ??
          document.querySelector(`[aria-label="${dirLabelKo}"][role="tab"]`) ??
          document.querySelector(`button[id*="trigger-${dirSuffix}"]`);
        if (!dirTab) throw new Error(`[VIDEO] ${videoAspectRatio} 탭 없음`);
        log('VIDEO', `${dirSuffix} 선택`);
        await simulateClick(dirTab);
        await sleep(300);

        const _payloadOC = (payloads || [])[0]?.outputCount;
        const userOC = Math.max(1, Math.min(4, Number(_payloadOC) || Number(s.outputCount) || 1));
        const outputTab = (
          findVisibleChoiceByExactText(`x${userOC}`) ??
          document.querySelector(`[aria-controls$="-content-${userOC}"][role="tab"]`) ??
          document.querySelector(`[aria-label="x${userOC}"][role="tab"]`) ??
          document.querySelector(`button[id*="trigger-${userOC}"]`)
        );
        if (!outputTab) throw new Error(`[VIDEO] x${userOC} 탭 없음`);
        log('VIDEO', `x${userOC} 선택 (outputCount=${userOC})`);
        await simulateClick(outputTab);
        await sleep(300);

        const modelDropdownBtn = findModelDropdownBtn();
        if (!modelDropdownBtn) throw new Error('[VIDEO] 모델 드롭다운 없음');
        await simulateClick(modelDropdownBtn);
        await sleep(500);

        const videoModel = s.flowVideoModel || s.model || 'Veo 3.1 Lite';
        const modelItems = document.querySelectorAll('[role="menuitem"], [role="option"], button');
        const modelBtn = pickVideoModelItem([...modelItems], videoModel);
        if (!modelBtn) throw new Error('[视频] 未找到指定模型: ' + videoModel);
        await simulateClick(modelBtn);
        await sleep(300);
        log('VIDEO', `${videoModel} 선택`);
        await selectVideoDuration(s);

        await clickEmptyAreaToClose();
        await waitForPanelClosed();
        await sleep(2000);
        log('VIDEO', 'configureVideoMode 완료');
      }

      async function configureImageMode(s) {
        // ★ v1.1.3: 다국어 사용자(스페인어 등) 대응 — 설정 패널 내 버튼 못 찾아도 진행
        //   우리 로직에 자체 프롬프트 지우기/Slate 리셋이 있어 Flow 설정 미적용이어도 작동
        //   설정 버튼 자체를 못 찾으면 패널 전체 스킵, 개별 탭 누락은 로그만 남기고 계속
        log('STEP 2', '설정 버튼 찾기');
        const settingsBtn = findSettingsBtn();
        let settingsOpened = false;
        if (settingsBtn) {
          await simulateClick(settingsBtn);
          await sleep(500);
          settingsOpened = true;
          log('STEP 2', '설정 열림');
        } else {
          log('STEP 2', '⚠️ 설정 버튼 없음 — 설정 패널 스킵 (자체 로직으로 진행)');
        }

        if (settingsOpened) {
          log('STEP 3', 'Grid 선택');
          const gridTab = findGridTab();
          if (gridTab) {
            await simulateClick(gridTab);
            await sleep(300);
          } else {
            log('STEP 3', '⚠️ Grid 탭 못 찾음 — 스킵 (기본값 사용)');
          }

          log('STEP 4', '그리드 S(작게/Small) 선택');
          const smallTab = findSmallTab();
          if (smallTab) {
            await simulateClick(smallTab);
            await sleep(300);
          } else {
            log('STEP 4', '⚠️ S(작게/Small) 탭 못 찾음 — 스킵 (기본값 사용)');
          }

          log('STEP 5', '제출 시 프롬프트 지우기 → 사용/Use');
          const clearTab = findClearPromptTab();
          if (clearTab) {
            await simulateClick(clearTab);
            await sleep(300);
          } else {
            // ★ Spanish/타국어 사용자 케이스 — Flow의 다국어 라벨 매칭 실패 시
            //   우리 로직(ensureEditorClean + Slate 리셋)이 매 submit 전후 처리하므로 안전
            log('STEP 5', '⚠️ 프롬프트 지우기 탭 못 찾음 — 자체 로직으로 진행');
          }

          log('STEP 6', '설정 닫기');
          await simulateClick(settingsBtn);
          await sleep(500);
        }

        // ★ v1.1.6: STEP 6/7 사이 — Flow 새 UI "에이전트" 버튼 비활성화
        //   활성 상태면 STEP 7 의 모델 설정 버튼이 우측 패널로 이동해 못 찾음
        await deactivateAgentButton();

        log('STEP 7', '모델 설정 버튼 클릭');
        let modelSettingsBtn = null;
        for (let i = 0; i < 25; i++) {
          modelSettingsBtn = findModelSettingsBtn();
          if (modelSettingsBtn) break;
          await sleep(200);
        }
        if (!modelSettingsBtn) throw new Error('未找到模型设置按钮');
        await simulateClick(modelSettingsBtn);
        await sleep(800);

        const modeTab = findModeButton('Image');
        if (!modeTab) throw new Error('未找到图片(IMAGE)标签页');
        log('STEP 8', 'IMAGE 탭 선택');
        await simulateClick(modeTab);
        await sleep(300);

        const aspectSelected = await selectAspectRatio(s);
        if (!aspectSelected) {
          const portraitRatios = new Set(['9:16', '3:4']);
          const dirSuffix = portraitRatios.has(s.aspectRatio) || s.direction === 'portrait' ? 'PORTRAIT' : 'LANDSCAPE';
          const dirLabelEn = dirSuffix === 'PORTRAIT' ? 'Portrait mode' : 'Landscape mode';
          const dirLabelKo = dirSuffix === 'PORTRAIT' ? '세로 모드' : '가로 모드';
          const dirTab = (
            document.querySelector(`[aria-controls$="-content-${dirSuffix}"][role="tab"]`) ??
            document.querySelector(`[aria-label="${dirLabelEn}"][role="tab"]`) ??
            document.querySelector(`[aria-label="${dirLabelKo}"][role="tab"]`) ??
            document.querySelector(`button[id*="trigger-${dirSuffix}"]`)
          );
          if (!dirTab) throw new Error(`${s.aspectRatio || dirSuffix} 탭 없음`);
          log('STEP 9', '방향 선택');
          await simulateClick(dirTab);
          await sleep(300);
        }

        const _payloadOC = (payloads || [])[0]?.outputCount;
        const userOC = Math.max(1, Math.min(4, Number(_payloadOC) || Number(s.outputCount) || 1));
        const outputTab = (
          findVisibleChoiceByExactText(`x${userOC}`) ??
          document.querySelector(`[aria-controls$="-content-${userOC}"][role="tab"]`) ??
          document.querySelector(`[aria-label="x${userOC}"][role="tab"]`) ??
          document.querySelector(`button[id*="trigger-${userOC}"]`)
        );
        if (!outputTab) throw new Error(`x${userOC} 탭 없음`);
        log('STEP 10', `x${userOC} 선택 (outputCount=${userOC})`);
        await simulateClick(outputTab);
        await sleep(300);

        const modelDropdownBtn = findModelDropdownBtn();
        if (!modelDropdownBtn) throw new Error('未找到模型下拉菜单按钮');
        await simulateClick(modelDropdownBtn);
        await sleep(500);

        const modelName = s.flowImageModel || s.model || 'Nano Banana 2';
        const modelBtn = findModelByName(modelName);
        if (!modelBtn) throw new Error('未找到指定模型: ' + modelName);
        await simulateClick(modelBtn);
        await sleep(300);
        log('STEP 12', '모델 선택', { modelName });

        await clickEmptyAreaToClose();
        await waitForPanelClosed();
        await sleep(2000);
        log('STEP 13', 'configureImageMode 완료');
      }

      if (isVideoMode) {
        async function doNewProjectAndConfigureVideo(index) {
          if (index === 0) {
            // ★ 첫 번째(i=0): 이미 Flow 홈에 있음 — 이미지 모드와 동일하게 새 프로젝트 클릭 (URL 이동 없이)
            log('VIDEO', `새 프로젝트 클릭 — 프롬프트 1/${total} (이미지 모드와 동일)`);
            const newProjBtn = await waitForNewProjectButton();
            newProjBtn.scrollIntoView({ behavior: 'instant', block: 'center' });
            await sleep(gaussianDelay(1500, 2500));  // ★ 안정화 대기 — 평균 2초, 1.5~2.5초 분포
            await simulateClick(newProjBtn);
            log('STEP 1', '새 프로젝트 클릭');
            await waitForNewProjectReady();
            await sleep(500);
            log('STEP 1', '새 프로젝트 준비 완료');
            await configureVideoModeStandalone(settings);
          } else {
            // ★ 두 번째 이상: 프로젝트 페이지 → Flow 홈으로 URL 이동 후 RESUME (storage는 background 경유)
            const payloadMin = minifyVideoPayloadsForResume(payloads, settings);
            const promptsClean = prompts.map(p => appendNoBackgroundMusic(p || ''));
            const settingsMin = minifyVideoSettingsForResume(settings);
            const resumeData = { index, prompts: promptsClean, payloads: payloadMin, settings: settingsMin, projectName: settings.projectName || 'my_project', total: prompts.length };
            await new Promise((resolve, reject) => {
              safeSendMessage({ type: 'SAVE_RESUME', data: resumeData }, (r) => {
                if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
                else if (r?.success) resolve();
                else reject(new Error(r?.error || 'SAVE_RESUME 실패'));
              });
            });
            log('VIDEO', `새 프로젝트 전환 (URL 이동) — 프롬프트 ${index + 1}/${total}`);
            safeSendMessage({ type: 'NAVIGATE_TAB_TO_FLOW' });
          }
        }
        await runVideoPipeline(prompts, settings, payloads, sendProgress, doNewProjectAndConfigureVideo);
      } else {
      // ★ 扩大项目批次上限（设为100），保持同批任务在同一个 Flow 项目中连续生成，不再自动拆解跳转，避免死锁
      const PROJECT_BATCH_SIZE = 100;
      const allPayloads = payloads || [];

      // ★ 이전 프로젝트 배치에서 누적된 상태 복원 (RESUME_IMAGE_PIPELINE 경유 시)
      const imageResumeState = settings._imageResumeState;
      if (imageResumeState) {
        (imageResumeState.confirmedPromptIndices || []).forEach(i => confirmedPromptIndices.add(i));
        (imageResumeState.downloadedImageNames || []).forEach(n => downloadedImageNames.add(n));
        queuedDownloadCount = imageResumeState.queuedDownloadCount || 0;
        log('PROJECT', '이전 프로젝트 누적 상태 복원', {
          confirmed: confirmedPromptIndices.size,
          downloaded: downloadedImageNames.size,
          queuedDownloads: queuedDownloadCount
        });
      }

      const projectBatchIndex = settings._projectBatchIndex || 0;
      const shouldSplit = allPayloads.length > PROJECT_BATCH_SIZE && !isRetryRun && !isCharRefRun;
      const currentBatchPayloads = shouldSplit ? allPayloads.slice(0, PROJECT_BATCH_SIZE) : allPayloads;
      const remainingPayloads = shouldSplit ? allPayloads.slice(PROJECT_BATCH_SIZE) : [];
      const totalProjectBatches = shouldSplit
        ? projectBatchIndex + Math.ceil(allPayloads.length / PROJECT_BATCH_SIZE)
        : 1;

      if (shouldSplit) {
        const firstIdx = currentBatchPayloads[0]?.promptIndex ?? 0;
        log('PROJECT', `프로젝트 ${projectBatchIndex + 1}/${totalProjectBatches}: ${currentBatchPayloads.length}개 처리 (#${firstIdx + 1}~)`, {
          remaining: remainingPayloads.length
        });
        safeSendMessage({
          type: 'PROJECT_BATCH_PROGRESS',
          data: { current: projectBatchIndex + 1, total: totalProjectBatches, startIndex: firstIdx }
        }).catch(() => {});
      }

      // 현재 배치 실행
      await runBatch(currentBatchPayloads, isRetryRun ? 'retry' : (shouldSplit ? `project-${projectBatchIndex + 1}` : 'main'));

      // 현재 배치 내 실패 재시도
      if (!isRetryRun && pendingRetryPromptIndices.size > 0) {
        const retryPayloads = currentBatchPayloads.filter((payload, idx) => pendingRetryPromptIndices.has(getPayloadPromptIndex(payload, idx)));
        if (retryPayloads.length > 0) {
          log('RETRY', '자동 실패 재생성 시작', {
            retryCount: retryPayloads.length,
            retryPromptIndices: toSortedArray(pendingRetryPromptIndices)
          });
          emitExactProgress('retry-preparing', {
            chunkStart: 0,
            chunkEnd: 0,
            activePromptIndices: []
          });
          await runBatch(retryPayloads, 'retry');
        }
      }

      // ★ 남은 배치가 있으면: 누적 상태 저장 → Flow 홈 이동 → 새 content script에서 이어서 진행
      if (remainingPayloads.length > 0) {
        const cooldown = gaussianDelay(8000, 15000);  // 8~15초 정규분포 (기존 수준 유지)
        log('PROJECT', `프로젝트 ${projectBatchIndex + 1} 완료 → ${cooldown}ms 쿨다운 후 다음 프로젝트`);
        await sleep(cooldown);

        // settings에서 characterRefAssets 제외 — base64 이미지 수 MB, storage 부하 방지
        // characterRefAssets는 이미 chrome.storage.local에 별도 저장됨 → 새 인스턴스에서 직접 복원
        const { characterRefAssets: _excluded, ...settingsWithoutAssets } = settings;
        const resumeSettings = {
          ...settingsWithoutAssets,
          _projectBatchIndex: projectBatchIndex + 1,
          _hasCharacterRefAssets: !!_excluded,  // 새 인스턴스에서 storage에서 복원 필요 여부
          _imageResumeState: {
            confirmedPromptIndices: [...confirmedPromptIndices],
            pendingRetryPromptIndices: [...pendingRetryPromptIndices],
            downloadedImageNames: [...downloadedImageNames],
            queuedDownloadCount
          }
        };

        const resumeData = {
          prompts,                     // 전체 프롬프트 배열 (파일명 생성용)
          payloads: remainingPayloads,  // 남은 payloads (각각 promptIndex 보유)
          settings: resumeSettings
        };

        await new Promise((resolve, reject) => {
          safeSendMessage({ type: 'SAVE_IMAGE_RESUME', data: resumeData }, (r) => {
            if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
            else if (r?.success) resolve();
            else reject(new Error(r?.error || 'SAVE_IMAGE_RESUME 실패'));
          });
        });

        log('PROJECT', `Flow 홈으로 이동 → 다음 프로젝트 (NAVIGATE_TAB_TO_FLOW_IMAGE)`);
        safeSendMessage({ type: 'NAVIGATE_TAB_TO_FLOW_IMAGE' });
        controlState = 'IDLE';
        return;  // ★ 이 content script 인스턴스 종료 — 새 인스턴스에서 RESUME_IMAGE_PIPELINE으로 이어감
      }

      // ★ 마지막 배치 (또는 분할 없음): 이미지 resume 데이터 정리
      if (imageResumeState) {
        safeSendMessage({ type: 'CLEAR_IMAGE_RESUME' }).catch(() => {});
      }

      if (isCharRefRun) {
        const STABILIZE_MS = 5000;
        const TILE_WAIT_MAX_MS = 60000; // 1분 (캐릭터 최대 9명 시 타일 도착 대기)
        const TILE_POLL_INTERVAL_MS = 1500;
        const outputCount = Math.max(1, Math.min(4, Number(payloads?.[0]?.outputCount) || 1));
        const charRefPayloads = (payloads || []).filter(p => p?.type === 'characterRef');
        const expectedTileCount = (charRefPayloads.length || 1) * outputCount;

        log('CHAR_REF', `[1/6] 썸네일 파싱 전 안정화 대기 ${STABILIZE_MS}ms`);
        await sleep(STABILIZE_MS);

        // ★ v1.1.6: CCR 초기 생성 폴링에 실패 타일 ⟳ 자동 재시도 (부가 효과만, 기존 로직 영향 0)
        //   기존 로직: tileCount >= expectedTileCount 이면 break — 변경 없음
        //   부가: 폴링 매 사이클마다 실패 타일 발견 시 ⟳ 클릭 (타일당 최대 5회)
        const _ccrFailedRetries = new Map();
        const _CCR_MAX_RETRY = 5;
        const deadline = Date.now() + TILE_WAIT_MAX_MS;
        while (Date.now() < deadline) {
          const tileCount = getTiles().length;
          if (tileCount >= expectedTileCount) break;
          // ★ v1.1.6: 실패 타일 ⟳ 자동 클릭 (기존 흐름과 병렬)
          try {
            const failedTiles = detectFailedTilesWithReloadBtn();
            for (const { reloadBtn, tileId } of failedTiles) {
              const prev = _ccrFailedRetries.get(tileId) || 0;
              if (prev >= _CCR_MAX_RETRY) continue;
              reloadBtn.click();
              _ccrFailedRetries.set(tileId, prev + 1);
              log('TILE_RETRY', `[CCR] 미디어 로드 실패 ⟳ ${prev + 1}/${_CCR_MAX_RETRY}`, { tileId });
              await sleep(gaussianDelay(300, 600));
            }
          } catch (_) { /* 부가 로직 — 실패해도 메인 폴링 영향 없음 */ }
          log('CHAR_REF', `[1.5/6] 타일 대기 (${tileCount}/${expectedTileCount})`);
          await sleep(TILE_POLL_INTERVAL_MS);
        }

        const allDoms = [...getTiles()];
        const seen = new Set();
        const tileList = [];
        allDoms.forEach((dom, domIndex) => {
          const id = getTileId(dom);
          if (!id || seen.has(id)) return;
          seen.add(id);
          const rect = dom.getBoundingClientRect();
          tileList.push({ dom, rect, tileId: id, domIndex });
        });

        log('CHAR_REF_PARSE', `[2/6] DOM 수집 완료`, {
          전체DOM: allDoms.length,
          타일수: tileList.length,
          비율: tileList.length > 0 ? (allDoms.length / tileList.length).toFixed(1) : '-'
        });

        const charCount = charRefPayloads.length || Math.ceil(tileList.length / outputCount);
        // ★ 우에서 좌로, 하에서 상으로: top 내림차순(아래 먼저) + left 내림차순(같은 행에서 오른쪽 먼저) → MCR/SC1… 순서 매칭
        const sortedTiles = [...tileList].sort((a, b) =>
          b.rect.top - a.rect.top || b.rect.left - a.rect.left
        );
        const finalCells = [];
        for (let i = 0; i < charCount; i++) {
          const start = i * outputCount;
          const slice = sortedTiles.slice(start, start + outputCount);
          if (slice.length > 0) finalCells.push(slice);
        }

        log('CHAR_REF_PARSE', `[3/6] outputCount 기반 그룹화 완료`, {
          outputCount,
          charCount,
          sortedTiles수: sortedTiles.length,
          finalCells수: finalCells.length
        });

        const thumbItems = [];
        for (let i = 0; i < finalCells.length; i++) {
          const candidates = finalCells[i];
          const first = candidates[0];
          const img = first?.dom?.querySelector?.('img[src]');
          if (img || first) {
            thumbItems.push(candidates);
            log('CHAR_REF_PARSE', `[4/6] 캐릭터 ${i + 1} DOM 추출`, {
              top: Math.round(first.rect.top),
              left: Math.round(first.rect.left),
              후보수: candidates.length,
              img있음: !!img
            });
          }
        }

        log('CHAR_REF_PARSE', `[5/6] 파싱 완료 → base64 변환·전송 시작`, { thumbItems수: thumbItems.length });
        if (thumbItems.length > 0) {
          sendCharRefImagesToSidepanel(thumbItems, {});
        } else if (settings?.mode === 'factory') {
          // 팩토리 모드: thumbItems 0개여도 CHAR_REF_IMAGES_READY 전송 → charRefReadyResolve 호출로 스피너 해제
          log('CHAR_REF_PARSE', `[팩토리] thumbItems 0개 — 빈 배열로 전송 (resolve 신호)`);
          sendCharRefImagesToSidepanel([], {});
        } else {
          log('CHAR_REF_PARSE', `[ERR] thumbItems 0개 — 전송 스킵`);
        }
      }

      const failedPromptIndices = toSortedArray(pendingRetryPromptIndices);
      const totalSuccessTiles = confirmedPromptIndices.size * 2;
      const totalFailTiles = failedPromptIndices.length * 2;
      emitExactProgress('chunk-downloading', {
        chunkStart: 0,
        chunkEnd: 0,
        activePromptIndices: []
      });
      log('DONE', '파이프라인 완료', {
        confirmedPromptIndices: toSortedArray(confirmedPromptIndices),
        failedPromptIndices,
        queuedDownloadCount,
        downloadSessionId
      });
      safeSendMessage({
        type: 'GENERATION_COMPLETE',
        data: {
          totalSuccess: totalSuccessTiles,
          totalFail: totalFailTiles,
          failedPromptIndices,
          downloadSessionId,
          expectedDownloadCount: queuedDownloadCount
        }
      }).catch(() => {});
      }
    } catch (e) {
      log('ERROR', e.message, { stack: e.stack });
      if (e.message !== 'USER_STOPPED') {
        try {
          safeSendMessage({
            type: 'FLOW_ERROR',
            data: { message: e.message }
          }).catch(() => {});
        } catch (sendErr) {
          // Extension context invalidated (확장 재로드 등) — sendMessage 불가, 무시
        }
      }
    }

    controlState = 'IDLE';
  }

  /**
   * 이미지투비디오 재개 시 이미지 없을 때 전체 재시작 (계정 변경 등으로 DOM 리셋된 경우)
   * 새 프로젝트 → 이미지 첨부 → @ 워크플로우까지 수행
   * @returns {{ resumePromptText: string } | null} 성공 시 resumePromptText, 실패 시 null
   */
  async function attachImageAndProceed(data, i) {
    try {
    safeSendMessage({ type: 'RESET_LAST_PROGRESS_SEQ' }).catch(() => {});
    await sleep(300);
    console.log('[IMG2VID RESTART] attachImageAndProceed 시작', { i });
    const { prompts = [], payloads = [], settings, total = 1 } = data;
    const promptText = prompts[i] || '';
    const p = payloads[i] || {};
    const wantsAsset = p.hasLazyImage === true
      || !!(p.images?.[0]?.base64)
      || (Array.isArray(p.lazyImageIndices) && p.lazyImageIndices.length > 0);
    if (!wantsAsset) {
      // Text-only prompt: still reset project + configure video, skip image upload
      console.log('[IMG2VID RESTART] asset 없음 — 텍스트만 경로');
      await waitForBridgeReady();
      const newProjBtn = await waitForNewProjectButton();
      newProjBtn.scrollIntoView({ behavior: 'instant', block: 'center' });
      await sleep(gaussianDelay(1500, 2500));
      await simulateClick(newProjBtn);
      await waitForNewProjectReady();
      await sleep(500);
      await configureVideoModeStandalone(settings);
      return { resumePromptText: promptText };
    }
    await waitForBridgeReady();
    console.log('[IMG2VID RESTART] bridge 준비 완료');
    log('STEP 1', '새 프로젝트 버튼 대기');
    const newProjBtn = await waitForNewProjectButton();
    newProjBtn.scrollIntoView({ behavior: 'instant', block: 'center' });
    await sleep(gaussianDelay(1500, 2500));  // ★ 안정화 대기 — 평균 2초, 1.5~2.5초 분포
    await simulateClick(newProjBtn);
    console.log('[IMG2VID RESTART] 새 프로젝트 클릭 완료');
    log('STEP 1', '새 프로젝트 클릭');
    await waitForNewProjectReady();
    await sleep(500);
    log('STEP 1', '새 프로젝트 준비 완료');
    await configureVideoModeStandalone(settings);
    const assets = await resolveI2vAssetFiles(p, i);
    if (!assets.length) {
      console.log(`[IMG2VID RESUME] 이미지 데이터 없음 — index ${i}`);
      safeSendMessage({
        type: 'GENERATION_PROGRESS',
        data: {
          phase: 'chunk-downloading',
          totalSuccess: 0,
          totalFail: 1,
          total,
          submittedCount: i + 1,
          chunkStart: i,
          chunkEnd: i,
          activePromptIndices: [],
          failedPromptIndices: [i],
          progressSeq: Date.now()
        }
      }).catch(() => {});
      return null;
    }
    log('IMG2VID', `[RESUME 전체재시작] asset ${assets.length}개 첨부`);
    const ok = await uploadAndAttachI2vAssets(assets, `[RESUME ${i + 1}/${total}]`);
    if (!ok) {
      console.log(`[IMG2VID RESUME] 이미지 ${i + 1} 첨부 실패`);
      return null;
    }
    return { resumePromptText: promptText };
    } catch (err) {
      log('VIDEO', `[IMG2VID RESTART] 로그: ${err?.message || err}`);
      return null;
    }
  }

// ★ 청크 조립용 저장소 (START_GENERATION_CHUNK 대응)
const chunkStore = {};

if (!window.__flowContentListenerRegistered) {
  window.__flowContentListenerRegistered = true;

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'PING') {
      sendResponse({ alive: true, state: controlState });
      return true;
    }

    // ★ 사이드패널이 보내는 START_GENERATION 처리 → runFlowPipeline 실행
    if (message.type === 'START_GENERATION') {
      if (controlState === 'RUNNING') {
        sendResponse({ success: false, reason: 'already_running' });
        return true;
      }
      const { payloads, settings } = message;
      const prompts = (payloads || []).map(p => p.prompt || '').filter(Boolean);
      if (prompts.length === 0) {
        sendResponse({ success: false, reason: 'no_prompts' });
        return true;
      }
      const s = settings || {};
      const normalizedSettings = {
        ...s,
        direction: s.direction || (s.aspectRatio === '9:16' || s.aspectRatio === '3:4' ? 'portrait' : 'landscape')
      };
      if (s.isCharRefRegen === true && (payloads || []).length === 1 && (payloads || [])[0]?.type === 'characterRef') {
        runCharRefRegenOnly(prompts, normalizedSettings, payloads);
      } else {
        runFlowPipeline(prompts, normalizedSettings, payloads);
      }
      sendResponse({ success: true });
      return true;
    }

    if (message.type === 'START_GENERATION_CHUNK') {
      const { groupId, chunkIndex, totalChunks, chunk, settings } = message;
      if (!chunkStore[groupId]) {
        chunkStore[groupId] = {
          chunks: new Array(totalChunks).fill(''),
          settings
        };
      }
      chunkStore[groupId].chunks[chunkIndex] = chunk;
      const received = chunkStore[groupId].chunks.filter(c => c !== '').length;
      if (received === totalChunks) {
        const payloads = JSON.parse(chunkStore[groupId].chunks.join(''));
        delete chunkStore[groupId];
        const prompts = (payloads || []).map(p => p.prompt || '').filter(Boolean);
        if (prompts.length > 0 && controlState !== 'RUNNING') {
          const s = settings || {};
          const normalizedSettings = {
            ...s,
            direction: s.direction || (s.aspectRatio === '9:16' || s.aspectRatio === '3:4' ? 'portrait' : 'landscape')
          };
          // ★ PRO 2.0 BUGFIX: CHUNK 경로에서도 isCharRefRegen 분기 처리
          // 커스텀 캐릭터 업로드 시 settings.characterRefAssets(base64)로 메시지가 1MB 초과 → CHUNK 경로 진입
          // → 여기서도 runFlowPipeline 대신 runCharRefRegenOnly로 라우팅해야 "새 프로젝트 타임아웃" 방지
          if (s.isCharRefRegen === true && (payloads || []).length === 1 && (payloads || [])[0]?.type === 'characterRef') {
            runCharRefRegenOnly(prompts, normalizedSettings, payloads);
          } else {
            runFlowPipeline(prompts, normalizedSettings, payloads);
          }
        }
      }
      sendResponse({ success: true, received, totalChunks });
      return true;
    }

    if (message.type === 'START_FLOW') {
      if (controlState === 'RUNNING') {
        sendResponse({ success: false, reason: 'already_running' });
        return true;
      }
      const { prompts, settings, payloads } = message;
      const p = payloads || prompts.map((p, i) => ({ promptIndex: i, prompt: p, rawPrompt: p }));
      runFlowPipeline(prompts, settings, p || []);
      sendResponse({ success: true });
      return true;
    }

    if (message.type === 'STOP_FLOW' || message.type === 'STOP_GENERATION') {
      controlState = 'STOPPED';
      sendResponse({ success: true });
      return true;
    }

    // ★ PRO 2.0: 캐릭터 레퍼런스 생성 수동 정지
    if (message.type === 'STOP_CHAR_REF_GEN') {
      log('STOP', '캐릭터 레퍼런스 생성 수동 정지 요청');
      controlState = 'IDLE';
      window._charRefGenStopRequested = true;  // 내부 체크 플래그
      sendResponse({ success: true });
      return true;
    }

    if (message.type === 'PAUSE_GENERATION') {
      // ★ 수동 일시정지: 이미 submit됨 → hadSubmitted: true로 저장 (재개 시 fillPrompt/submit 생략)
      if (_videoPipelineRunning && _currentVideoPipelineResumeData) {
        const d = { ..._currentVideoPipelineResumeData, hadSubmitted: true };
        log('VIDEO', '수동 일시정지 — SAVE_RESUME 저장 (hadSubmitted: true)');
        safeSendMessage({ type: 'SAVE_RESUME', data: d }).catch(() => {});
      }
      controlState = 'PAUSED';
      sendResponse({ success: true });
      return true;
    }

    if (message.type === 'RESUME_GENERATION') {
      controlState = 'RUNNING';  // PAUSED 대기 루프 탈출 후 이어서 진행
      sendResponse({ success: true, hasState: false });
      return true;
    }

    if (message.type === 'CHECK_PAUSED_STATE') {
      sendResponse({ isPaused: controlState === 'PAUSED' });
      return true;
    }

    if (message.type === 'RESUME_VIDEO_PIPELINE') {
      (async () => {
        let isFactoryResume = false; // ★ Factory 동영상 재개 시에만 로그/분기 사용 (다른 모드 무영향)
        try {
          log('VIDEO', 'RESUME_VIDEO_PIPELINE 수신');
          // ★ Factory 경로: background에서 data와 함께 보낸 경우 message.data 사용 (GET_RESUME 생략)
          let data = message.data;
          if (!data) {
            const result = await new Promise((resolve) => {
              safeSendMessage({ type: 'GET_RESUME' }, (r) => {
                if (chrome.runtime.lastError) resolve({ data: null });
                else resolve(r || { data: null });
              });
            });
            console.log('[DEBUG RESUME_VIDEO_PIPELINE] GET_RESUME 응답:', result);
            data = result?.data;
          }
          if (!data || data.index === undefined) {
            log('VIDEO', '실패: videoPipelineResume 없음');
            return;
          }
          const i = data.index;
          isFactoryResume = data?.settings?.isFactoryVideoPhase === true;
          const { prompts = [], payloads = [], settings, projectName, total } = data;
          const promptText = prompts[i] || '';
          const p = payloads[i] || {};
          if (settings?.mode === 'textToVideo') {
            safeSendMessage({ type: 'RESET_LAST_PROGRESS_SEQ' }).catch(() => {});
            await sleep(300);
          }
          if (settings?.isFactoryVideoPhase) {
            safeSendMessage({ type: 'RESET_LAST_PROGRESS_SEQ' }).catch(() => {});
            await sleep(300);
          }
          // [IMG2VID DEBUG] payloads 이미지 데이터 존재 여부 확인 (FLOW_imgToVideo_큐저장_카운터패치2)
          console.log(`[IMG2VID DEBUG] index=${i}, total=${total}`);
          console.log(`[IMG2VID DEBUG] payloads.length=${payloads.length}`);
          console.log(`[IMG2VID DEBUG] payloads[${i}] 존재:`, !!p);
          console.log(`[IMG2VID DEBUG] payloads[${i}].images:`, p?.images?.length ?? 'undefined');
          console.log(`[IMG2VID DEBUG] images[0] 존재:`, !!(p?.images?.[0]));
          console.log(`[IMG2VID DEBUG] images[0] base64 길이:`, p?.images?.[0]?.base64?.length ?? 0);
          const payloadMin = { scriptText: p.scriptText || '', characters: p.characters || '', number: p.number || '', originalFilename: p.originalFilename || p.images?.[0]?.name || '' };
          log('VIDEO', `재개 — 프롬프트 ${i + 1}/${total}`);

          // ─── 이미지투비디오 단독 모드만 적용 (조건 절대 제거 금지, 다른 모드 영향 없음) ───
          let resumePromptText = promptText;
          let skipNewProjectAndUpload = false;
          let resumePromptFilledInline = false;
          if (settings?.mode === 'imageToVideo' && !settings?.isFactoryVideoPhase) {
            const tileWithImage = [...getTiles()].find(tile => tile.querySelector('img'))?.querySelector('img');
            const isImageAttached = !!tileWithImage;
            if (!isImageAttached) {
              console.log(`[IMG2VID RESUME] 이미지 없음 → 전체 재시작 (index ${i})`);
              const attachResult = await attachImageAndProceed(data, i);
              if (!attachResult) return;
              resumePromptText = attachResult.resumePromptText;
              skipNewProjectAndUpload = true;
            } else {
              console.log(`[IMG2VID RESUME] 이미지 존재 확인 → 생성 재시도 (index ${i})`);
              skipNewProjectAndUpload = true;
            }
          }

          // ★ Factory 전용: 페이지/브릿지 준비 대기 후 bridge 재시도 (다른 모드 무영향)
          if (isFactoryResume) {
            await sleep(1500);
            console.log('[FLOW RESUME] waitForBridgeReady 시작');
          }
          await waitForBridgeReady();
          if (isFactoryResume) {
            await sleep(1000);
            await waitForBridgeReady();
            console.log('[FLOW RESUME] waitForBridgeReady 완료, 새 프로젝트 버튼 대기');
          }
          if (!skipNewProjectAndUpload) {
          // ★ 이미지 모드와 동일: 새 프로젝트 버튼 대기 → 클릭 → 에디터 로드 대기
          log('STEP 1', '새 프로젝트 버튼 대기');
          let newProjBtn;
          if (isFactoryResume) {
            try {
              newProjBtn = await waitForNewProjectButton(22000);
            } catch (e1) {
              await sleep(2000);
              newProjBtn = await waitForNewProjectButton(22000);
            }
          } else {
            newProjBtn = await waitForNewProjectButton();
          }
          newProjBtn.scrollIntoView({ behavior: 'instant', block: 'center' });
          await sleep(gaussianDelay(1500, 2500));  // ★ 안정화 대기 — 평균 2초, 1.5~2.5초 분포
          await simulateClick(newProjBtn);
          log('STEP 1', '새 프로젝트 클릭');
          await waitForNewProjectReady();
          await sleep(500);
          log('STEP 1', '새 프로젝트 준비 완료');
          await configureVideoModeStandalone(settings);

          resumePromptText = promptText;
          if ((settings?.mode === 'imageToVideo' || settings?.mode === 'textToVideo') && p) {
            const attached = await attachVideoPromptAssets(
              p, resumePromptText, settings, `[RESUME ${i + 1}/${total}]`, i
            );
            resumePromptText = attached.promptText;
            resumePromptFilledInline = attached.filledInline;
          }
          }

          // ★ 수동 일시정지 재개 + 이미지 존재: 이미 submit됨 → fillPrompt/submit 생략, 바로 SD 완료 대기
          // ★ 크레딧 소진 재개: hadSubmitted=false → 반드시 fillPrompt/submit 수행
          const skipFillPromptAndSubmit = skipNewProjectAndUpload && data.hadSubmitted === true;
          if (skipFillPromptAndSubmit) {
            log('IMG2VID', `[RESUME ${i + 1}/${total}] 수동 일시정지 재개 — fillPrompt/submit 생략, SD 완료 대기`);
          } else {
          log('IMG2VID', `[RESUME ${i + 1}/${total}] 프롬프트 입력`, { len: resumePromptText.length, inline: resumePromptFilledInline });
          const editor = await waitForElement(PROMPT_EDITOR_SELECTOR);
          // 인라인 @mention 경로는 fillImageGenPrompt 가 이미 채웠으므로 재입력 생략
          if (!resumePromptFilledInline) await fillPrompt(editor, resumePromptText, 3);
          await waitForSubmitEnabled();
          const hasButton = await checkSubmitButtonWithRetry();
          let submitBtn = hasButton ? findSubmitButton() : null;
          if (!submitBtn) {
            log('VIDEO', '❌ 생성 버튼 없음 — 크레딧 소진');
            safeSendMessage({ type: 'CREDIT_EXHAUSTED', data: { source: 'VIDEO' } }).catch(() => {});
            triggerAutoPause('CREDIT_EXHAUSTED');
            const settingsWithFactory = { ...settings, isFactoryVideoPhase: settings?.isFactoryVideoPhase ?? false };
            const submitBtnNullData = { index: i, prompts, payloads, settings: settingsWithFactory, projectName, total, hadSubmitted: false };
            console.log('[DEBUG] SAVE_RESUME 호출 시작 (submitBtn null, RESUME)');
            safeSendMessage({ type: 'SAVE_RESUME', data: submitBtnNullData }, (r) => {
              if (chrome.runtime.lastError) log('VIDEO', 'SAVE_RESUME 실패', chrome.runtime.lastError);
              else if (!r?.success) log('VIDEO', 'SAVE_RESUME 실패', r?.error);
            });
            console.log('[DEBUG] SAVE_RESUME 호출 완료 (submitBtn null, RESUME)');
            await waitWhilePaused();
            submitBtn = findSubmitButton();
            if (!submitBtn) {
              log('VIDEO', '재개 후에도 생성 버튼 없음 — 폴백: 실패 처리');
              console.log('[FLOW RESUME] 생성 버튼 없음 — 로그만 기록, 에러 미발생');
              return;
            }
          }
          const resumeSubmitResult = await submitWithVerification(submitBtn, {
            maxAttempts: 3, verifyTimeout: 15000, backoffBase: 2000
          });
          log('IMG2VID', `[RESUME ${i + 1}/${total}] 제출 검증`, resumeSubmitResult);
          if (!resumeSubmitResult.success) {
            throw new Error(`[VIDEO] RESUME 제출 실패 (${i + 1}번째) — 클릭 미등록`);
          }
          safeSendMessage({
            type: 'GENERATION_PROGRESS',
            data: {
              phase: 'submitting',
              totalSuccess: i,
              totalFail: 0,
              total,
              submittedCount: i + 1,
              chunkStart: i,
              chunkEnd: i,
              activePromptIndices: [i],
              failedPromptIndices: [],
              progressSeq: Date.now()
            }
          }).catch(() => {});
          }
          await sleep(500);
          const completedTile = await waitForVideoSDComplete();
            if (!completedTile) {
            if (controlState === 'PAUSED') {
              log('VIDEO', '크레딧 소진 — RESUME 일시정지 (재개 대기)');
              const settingsWithFactory = { ...settings, isFactoryVideoPhase: settings?.isFactoryVideoPhase ?? false };
              const pauseData = { index: i, prompts, payloads, settings: settingsWithFactory, projectName, total, hadSubmitted: true };
              console.log('[DEBUG] SAVE_RESUME 호출 시작 (RESUME)');
              await new Promise((resolve, reject) => {
                safeSendMessage({ type: 'SAVE_RESUME', data: pauseData }, (r) => {
                  if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
                  else if (r?.success) {
                    chrome.storage.local.get('videoPipelineResume', (s) => {
                      console.log('[DEBUG RESUME] SAVE_RESUME 직후 storage 확인:', s);
                    });
                    resolve();
                  } else reject(new Error(r?.error || 'SAVE_RESUME 실패'));
                });
              }).catch((e) => log('VIDEO', 'SAVE_RESUME 실패', { err: e?.message }));
              console.log('[DEBUG] SAVE_RESUME 호출 완료 (RESUME)');
              safeSendMessage({
                type: 'GENERATION_PROGRESS',
                data: { phase: 'chunk-downloading', totalSuccess: i, totalFail: 1, total, submittedCount: i + 1, chunkStart: i, chunkEnd: i, activePromptIndices: [], completedPromptIndices: Array.from({ length: i }, (_, k) => k), failedPromptIndices: [i], progressSeq: Date.now() }
              }).catch(() => {});
              return;
            }
            throw new Error(`[VIDEO] ❌ SD 타임아웃 (${i + 1}번째)`);
          }
          const baseName = typeof window.generateFilename === 'function'
            ? window.generateFilename({ mode: settings?.mode || 'textToVideo', promptIndex: i, imageIndex: 0, scriptText: payloadMin.scriptText || '', promptText, characterCode: payloadMin.characters || '', sceneNumber: payloadMin.number || '', originalFilename: settings?.isFactoryVideoPhase ? '' : (payloadMin.originalFilename || '') })
            : `${String(i + 1).padStart(3, '0')}_${(promptText || 'video').replace(/[^a-zA-Z0-9가-힣\s]/g, '').trim().substring(0, 20).replace(/\s+/g, '_')}.mp4`;
          const filename = `${projectName}/${baseName}`;
          // ★ 업스케일 비활성화 — 모든 모드 SD 직접 (재개 경로도 동일)
          try {
            await downloadSD(completedTile, filename);
            log('VIDEO', `✅ SD 직접 다운로드 (재개): ${filename}`);
          } catch (sdErr) {
            log('VIDEO', `⚠️ SD 다운로드 실패: ${sdErr?.message || sdErr}`);
            throw sdErr;
          }
          // ★ 다운로드 완료 후 totalSuccess 증가하여 PROGRESS 전송 (이미지 모드와 동일)
          const completedIndices = Array.from({ length: i + 1 }, (_, k) => k);
          const progressPayload = { phase: 'chunk-downloading', totalSuccess: i + 1, totalFail: 0, total, submittedCount: i + 1, chunkStart: i, chunkEnd: i, completedPromptIndices: completedIndices, activePromptIndices: [], failedPromptIndices: [], progressSeq: Date.now() };
          log('PROGRESS_SEND', `chunk-downloading#RESUME`, { totalSuccess: i + 1, total });
          safeSendMessage({ type: 'GENERATION_PROGRESS', data: progressPayload }).catch(() => {});
          if (i + 1 < total) {
            const nextSettings = { ...settings, isFactoryVideoPhase: settings?.isFactoryVideoPhase ?? false };
            const nextData = { index: i + 1, prompts, payloads, settings: nextSettings, projectName, total };
            await new Promise((resolve, reject) => {
              safeSendMessage({ type: 'SAVE_RESUME', data: nextData }, (r) => {
                if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
                else if (r?.success) resolve();
                else reject(new Error(r?.error || 'SAVE_RESUME 실패'));
              });
            });
            safeSendMessage({ type: 'NAVIGATE_TAB_TO_FLOW' });
          } else {
            safeSendMessage({ type: 'CLEAR_RESUME' }, () => {});
            safeSendMessage({
              type: 'GENERATION_COMPLETE',
              data: {
                totalSuccess: i + 1,
                totalFail: 0,
                failedPromptIndices: []
              }
            }).catch(() => {});
          }
        } catch (err) {
          log('VIDEO', '재개 실패 — 파이프라인 중단', { message: err.message });
          safeSendMessage({ type: 'CLEAR_RESUME' }, () => {});
          const t = typeof total !== 'undefined' ? total : 1;
          for (let k = 0; k < t; k++) {
            safeSendMessage({
              type: 'GENERATION_PROGRESS',
              data: {
                phase: 'chunk-downloading',
                status: 'error',
                displayNum: String(k + 1).padStart(2, '0'),
                promptIndex: k,
                error: err.message,
                totalSuccess: 0,
                totalFail: t,
                total: t,
                submittedCount: t,
                failedPromptIndices: [...Array(t).keys()]
              }
            }).catch(() => {});
          }
          safeSendMessage({
            type: 'GENERATION_COMPLETE',
            data: {
              totalSuccess: 0,
              totalFail: t,
              failedPromptIndices: [...Array(t).keys()],
              downloadSessionId: '',
              expectedDownloadCount: t
            }
          }).catch(() => {});
        }
      })();
      sendResponse({ success: true });
      return true;
    }

    // ★ 이미지 프로젝트 분할 재개 — Flow 홈 이동 후 새 content script에서 수신
    if (message.type === 'RESUME_IMAGE_PIPELINE') {
      // ★ 이중 전달 방지 — NAVIGATE_TAB_TO_FLOW_IMAGE + FLOW_CONTENT_READY 둘 다 보낼 수 있음
      if (controlState === 'RUNNING') {
        log('PROJECT', 'RESUME_IMAGE_PIPELINE 무시 — 이미 실행 중');
        sendResponse({ success: false, reason: 'already_running' });
        return true;
      }
      (async () => {
        try {
          log('PROJECT', 'RESUME_IMAGE_PIPELINE 수신');
          const result = await new Promise((resolve) => {
            safeSendMessage({ type: 'GET_IMAGE_RESUME' }, (r) => {
              if (chrome.runtime.lastError) resolve({ data: null });
              else resolve(r || { data: null });
            });
          });
          const data = result?.data;
          if (!data || !data.payloads?.length) {
            log('PROJECT', 'RESUME_IMAGE_PIPELINE 실패: 저장된 데이터 없음');
            // ★ 데이터 없으면 storage 정리 (이미 소비된 경우)
            safeSendMessage({ type: 'CLEAR_IMAGE_RESUME' }).catch(() => {});
            return;
          }

          // ★ storage 즉시 소비 — FLOW_CONTENT_READY 폴백에서 중복 재개 방지
          safeSendMessage({ type: 'CLEAR_IMAGE_RESUME' }).catch(() => {});

          const { prompts, payloads: remainingPayloads, settings: resumeSettings } = data;

          // ★ characterRefAssets 복원 — resume 데이터에서 제외됨 (base64 용량), storage에서 직접 읽기
          if (resumeSettings?._hasCharacterRefAssets && !resumeSettings.characterRefAssets) {
            try {
              const stored = await new Promise((resolve) => {
                chrome.storage.local.get('characterRefAssets', (r) => resolve(r));
              });
              if (stored?.characterRefAssets) {
                resumeSettings.characterRefAssets = stored.characterRefAssets;
                log('PROJECT', 'characterRefAssets storage에서 복원', {
                  keys: Object.keys(stored.characterRefAssets)
                });
              }
            } catch (e) {
              log('PROJECT', 'characterRefAssets 복원 실패', { error: e?.message });
            }
          }

          log('PROJECT', `이미지 파이프라인 재개`, {
            prompts: prompts?.length,
            remainingPayloads: remainingPayloads?.length,
            projectBatchIndex: resumeSettings?._projectBatchIndex,
            hasCharRefAssets: !!resumeSettings?.characterRefAssets
          });

          // ★ 사이드패널 progressSeq 리셋 + 큐 스피너 갱신
          // _projectBatchIndex는 0-based (1차 배치 = 0, 2차 배치 = 1...)
          // 화면 표시용 current는 1-based이므로 +1
          const batchIdx = resumeSettings?._projectBatchIndex ?? 1;
          const firstPayloadIdx = remainingPayloads[0]?.promptIndex ?? 0;
          const remainingBatchCount = Math.ceil(remainingPayloads.length / 20);
          const totalBatches = batchIdx + remainingBatchCount;
          safeSendMessage({
            type: 'PROJECT_BATCH_PROGRESS',
            data: { current: batchIdx + 1, total: totalBatches, startIndex: firstPayloadIdx }
          }).catch(() => {});

          // runFlowPipeline 호출 — 새 프로젝트 생성 + 설정 + 다음 배치 처리
          // isRetry=false로 실행되므로 STEP 0/1/CHAR_REF/configureImageMode 자동 수행
          await runFlowPipeline(prompts, resumeSettings, remainingPayloads);
        } catch (err) {
          log('PROJECT', '이미지 파이프라인 재개 실패', { message: err.message, stack: err.stack });
          safeSendMessage({ type: 'CLEAR_IMAGE_RESUME' }).catch(() => {});
          safeSendMessage({
            type: 'FLOW_ERROR',
            data: { message: `프로젝트 분할 재개 실패: ${err.message}` }
          }).catch(() => {});
        }
      })();
      sendResponse({ success: true });
      return true;
    }
  });
}

// ★ v1.1.3: 메인 탭 우발 파일 드롭 방어 — file:// URL 이동 차단
//   사용자가 사이드패널 슬롯에 드롭하려다 메인 탭에 미스 드롭 → 브라우저 기본동작으로 파일 URL 이동되던 버그 해결
//   Flow 자체 drop zone은 자체 preventDefault로 정상 작동 (target 핸들러 먼저 실행 후 bubble)
//   파일 타입(types에 'Files' 포함) 드래그만 방어 — 텍스트/링크 드래그는 정상 통과
window.addEventListener('dragover', (e) => {
  if (e.dataTransfer && e.dataTransfer.types && e.dataTransfer.types.indexOf('Files') !== -1) {
    e.preventDefault();
  }
}, false);
window.addEventListener('drop', (e) => {
  if (e.dataTransfer && e.dataTransfer.types && e.dataTransfer.types.indexOf('Files') !== -1) {
    e.preventDefault();
  }
}, false);

// ★ content script 로드 완료 신호 (이미지투비디오 재개 시 RESUME_VIDEO_PIPELINE 재전송용)
setTimeout(() => {
  safeSendMessage({ type: 'FLOW_CONTENT_READY' }).catch(() => {});
}, 800);

})();
