if(typeof console!=="undefined" && (typeof globalThis!=="undefined" && globalThis.__FLOW_SILENT__ === true)){console.log=function(){};console.warn=function(){};console.error=function(){};}
/**
 * background.js — FLOW Factory Background Service Worker
 */

// ★ 다운로드 파일명 보호 — 하이브리드: Map(1차) + storage.session(2차 폴백)
const pendingDownloads = new Map();
const PENDING_DOWNLOADS_KEY = 'pendingDownloads';
const downloadSessions = new Map();

// ★ SW 재시작 시 storage.session에서 pendingDownloads 복원
chrome.storage.session.get(PENDING_DOWNLOADS_KEY).then((res) => {
    const pending = res[PENDING_DOWNLOADS_KEY] || {};
    for (const [id, meta] of Object.entries(pending)) {
        const numId = Number(id);
        if (!pendingDownloads.has(numId)) {
            pendingDownloads.set(numId, meta);
        }
    }
}).catch(() => {});

// ★ RESUME 중복 실행 방지 (NAVIGATE_TAB_TO_FLOW → onUpdated complete)
const processedResumeTabIds = new Set();

// ★ v1.1.8 Tier1: 마지막 CDP 마우스 위치 추적 (탭별) — 다음 이동의 시작점
//   사람은 이전 위치에서 다음 위치로 이어서 움직임 (매번 화면 밖에서 시작하지 않음)
const _lastMousePos = new Map();  // tabId → {x, y}

// ★ v1.1.8: 정규분포(가우시안) 난수 — 사람의 마우스 움직임 통계 특성에 부합
//   중앙값 근처에 몰리고 가끔 극단값 (균일분포보다 자연스러움). Box-Muller 변환.
function _gauss(min, max) {
    const u1 = Math.random() || 1e-9;
    const u2 = Math.random();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    const mean = (min + max) / 2;
    const std = (max - min) / 4;  // 95% 가 min~max 범위
    return Math.max(min, Math.min(max, mean + z * std));
}

// ★ v1.1.8 fix: CDP attach 전역 뮤텍스 — "Another debugger is already attached" 충돌 방지
//   idle move(fire-and-forget)와 submit/click 의 attach 가 겹치면 충돌 → submit 이 native 폴백(isTrusted=false)
//   해결: 모든 CDP 작업을 이 큐로 직렬화. attach→작업→detach 가 원자적으로 실행됨.
let _cdpBusy = false;
const _cdpQueue = [];
async function _withCdp(tabId, fn, { skipIfBusy = false } = {}) {
    // idle move 처럼 "바쁘면 그냥 건너뜀"이 나은 작업은 skipIfBusy=true (대기 큐 적체 방지)
    if (skipIfBusy && _cdpBusy) return { ok: false, skipped: true };
    // 큐 진입 — 앞 작업 완료까지 대기
    while (_cdpBusy) {
        await new Promise(r => _cdpQueue.push(r));
    }
    _cdpBusy = true;
    const target = { tabId };
    let attached = false;
    try {
        await chrome.debugger.attach(target, '1.3');
        attached = true;
        return await fn(target);
    } catch (e) {
        return { ok: false, error: e?.message };
    } finally {
        if (attached) { try { await chrome.debugger.detach(target); } catch (_) {} }
        _cdpBusy = false;
        const next = _cdpQueue.shift();
        if (next) next();
    }
}

/**
 * ★ v1.1.8 Tier1-#1: 사람 같은 마우스 이동 궤적 생성 + CDP 발사
 *   - 시작점: 이전 마우스 위치 (없으면 화면 임의 지점)
 *   - 경로: 2차 베지어 곡선 + 제어점 불규칙 오프셋 → 곡선/휘어짐
 *   - 각 스텝: 불규칙 좌표 지터 + 가변 딜레이 (사람의 미세 떨림/속도 변화)
 *   - 오버슈트: 가끔 목표를 살짝 지나쳤다 되돌아옴 (사람 특성)
 *   reCAPTCHA v3 의 마우스 궤적 분석 대응 — 직선/순간이동 패턴 회피
 */
async function _cdpHumanMouseMove(target, tx, ty) {
    const tabId = target.tabId;
    const prev = _lastMousePos.get(tabId);
    // ★ v1.1.8 다양성강화: 시작점 = 이전 위치 ± 랜덤 오프셋 (같은 클릭 쌍이라도 경로 시작 분산)
    let sx, sy;
    if (prev) {
        sx = prev.x + _gauss(-20, 20);  // ±20px 흔들림 (가우시안 — 보통 작고 가끔 큼)
        sy = prev.y + _gauss(-20, 20);
    } else {
        sx = tx + _gauss(-300, 300);
        sy = ty + _gauss(-200, 200);
    }
    sx = Math.max(0, sx); sy = Math.max(0, sy);

    const sendMove = async (mx, my) => {
        try {
            await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
                type: 'mouseMoved', x: Math.round(mx), y: Math.round(my), buttons: 0
            });
        } catch (_) { /* 이동 실패는 무시 */ }
    };
    const bezier = (t, p0, p1, p2) => {
        const mt = 1 - t;
        return mt * mt * p0 + 2 * mt * t * p1 + t * t * p2;
    };

    // ★ 다양성강화: 한 점→목표를 단일 곡선이 아니라 1~3개 세그먼트로 나눠 이동
    //   가끔(8%) 엉뚱한 경유점을 들렀다 옴 (사람의 비효율적 움직임)
    const waypoints = [];
    if (Math.random() < 0.08) {
        // 경유점: 시작~목표 사이 + 큰 수직 이탈
        const wpT = 0.3 + Math.random() * 0.4;
        const wmx = sx + (tx - sx) * wpT + (Math.random() * 300 - 150);
        const wmy = sy + (ty - sy) * wpT + (Math.random() * 200 - 100);
        waypoints.push({ x: Math.max(0, wmx), y: Math.max(0, wmy) });
    }
    waypoints.push({ x: tx, y: ty });

    let curX = sx, curY = sy;
    for (let w = 0; w < waypoints.length; w++) {
        const dx = waypoints[w].x, dy = waypoints[w].y;
        const dist = Math.hypot(dx - curX, dy - curY);
        // ★ 스텝 수 (가우시안 — 거리 비례, 6~48)
        const steps = Math.max(6, Math.min(48, Math.round(dist / _gauss(6, 18))));
        const midX = (curX + dx) / 2, midY = (curY + dy) / 2;
        const perpAngle = Math.atan2(dy - curY, dx - curX) + Math.PI / 2;
        // ★ 곡률 강도 (가우시안 0.05~0.6 — 보통 곡선 多, 가끔 큰 곡선), 부호만 균일 랜덤
        const bow = _gauss(0.05, 0.6) * dist * (Math.random() < 0.5 ? 1 : -1);
        const cpx = midX + Math.cos(perpAngle) * bow;
        const cpy = midY + Math.sin(perpAngle) * bow;

        for (let i = 1; i <= steps; i++) {
            const tRaw = i / steps;
            const t = tRaw < 0.5 ? 2 * tRaw * tRaw : 1 - Math.pow(-2 * tRaw + 2, 2) / 2;
            // ★ 좌표 지터 (가우시안 — 대부분 미세, 가끔 큼)
            const jx = _gauss(-2, 2);
            const jy = _gauss(-2, 2);
            await sendMove(bezier(t, curX, cpx, dx) + jx, bezier(t, curY, cpy, dy) + jy);
            const edge = Math.abs(0.5 - tRaw) * 2;
            // ★ 딜레이 (가우시안 베이스 + 양끝 가중 — 사람 속도 곡선)
            let delay = _gauss(4, 14) + edge * _gauss(0, 14);
            // 가끔(5%) 중간 망설임 멈춤 (가우시안 80~250ms)
            if (Math.random() < 0.05) delay += _gauss(80, 250);
            await new Promise(r => setTimeout(r, delay));
        }
        curX = dx; curY = dy;
    }

    // 가끔(30%) 오버슈트 후 복귀 (가우시안 이탈량)
    if (Math.random() < 0.3) {
        await sendMove(tx + _gauss(-8, 8), ty + _gauss(-8, 8));
        await new Promise(r => setTimeout(r, _gauss(30, 80)));
    }
    // 최종 정착 (미세 흔들림 → 정확히)
    await sendMove(tx + _gauss(-1, 1), ty + _gauss(-1, 1));
    await new Promise(r => setTimeout(r, _gauss(10, 40)));
    await sendMove(tx, ty);

    _lastMousePos.set(tabId, { x: tx, y: ty });
}

// ★ 이미지투비디오 재개: content script 로드 대기 (FLOW_CONTENT_READY 시 재전송)
let pendingResumeImageToVideoTabId = null;

// ★ Factory 동영상 재개 전용 (RELOAD 경로 — pendingResumeImageToVideoTabId와 완전 분리)
// in-memory만 쓰면 SW 재시작 후 null → FLOW_CONTENT_READY에서 매칭 실패. chrome.storage.session 사용.
let factoryResumeTabId = null;

function getDownloadSession(sessionId) {
    if (!sessionId) return null;
    if (!downloadSessions.has(sessionId)) {
        downloadSessions.set(sessionId, {
            total: 0,
            completed: 0,
            failed: 0,
            finalSent: false
        });
    }
    return downloadSessions.get(sessionId);
}

function emitDownloadProgress(sessionId) {
    if (!sessionId) return;
    const session = downloadSessions.get(sessionId);
    if (!session) return;

    const total = Number.isFinite(session.total) ? session.total : null;
    const processed = session.completed + session.failed;
    const isFinal = total !== null && processed >= total;
    if (isFinal && session.finalSent) return;

    chrome.runtime.sendMessage({
        type: 'DOWNLOAD_PROGRESS',
        data: {
            sessionId,
            completed: session.completed,
            failed: session.failed,
            total,
            isFinal
        }
    }).catch(() => {});

    if (isFinal) {
        session.finalSent = true;
    }
}

// ── 메시지 리스너 ──
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

    // Service Worker 깨우기 ping
    if (message.type === 'PING') {
        sendResponse({ alive: true });
        return true;
    }

    // ★ v1.1.8 Tier1: CDP idle 마우스 무브 — 생성 대기 중 사람처럼 마우스 미세 이동
    //   reCAPTCHA v3 가 세션 전체 마우스 활동을 봄 → 대기 중에도 마우스 살려둠
    //   content script(STEP 16 폴링)에서 가끔 호출. isTrusted=true.
    if (message.type === 'CDP_IDLE_MOVE') {
        const tabId = sender.tab?.id;
        if (!tabId) { sendResponse({ ok: false }); return true; }
        (async () => {
            // ★ idle move 는 바쁘면 그냥 건너뜀 (submit/click 우선, 큐 적체 방지)
            const r = await _withCdp(tabId, async (target) => {
                const prev = _lastMousePos.get(tabId) || {
                    x: 200 + Math.random() * 600,
                    y: 200 + Math.random() * 400
                };
                const big = Math.random() < 0.25;
                const range = big ? (200 + Math.random() * 400) : (15 + Math.random() * 60);
                const tx = Math.max(10, prev.x + (Math.random() * 2 - 1) * range);
                const ty = Math.max(10, prev.y + (Math.random() * 2 - 1) * range);
                await _cdpHumanMouseMove(target, Math.round(tx), Math.round(ty));
                return { ok: true };
            }, { skipIfBusy: true });
            sendResponse(r);
        })();
        return true;
    }

    // ★ v1.1.8 #3 재설계: CDP 마우스 궤적 이동만 (클릭 없음) — 일반 클릭 직전 호출
    if (message.type === 'CDP_MOVE_TO') {
        const tabId = sender.tab?.id;
        if (!tabId) { sendResponse({ ok: false }); return true; }
        (async () => {
            const r = await _withCdp(tabId, async (target) => {
                await _cdpHumanMouseMove(target, Math.round(message.x), Math.round(message.y));
                return { ok: true };
            }, { skipIfBusy: true });  // 궤적은 부가적 — 바쁘면 건너뜀
            sendResponse(r);
        })();
        return true;
    }

    // ★ v1.1.3: CDP 실제 마우스 클릭 — attach 후 좌표 재측정으로 알림바 레이아웃 시프트 대응
    if (message.type === 'CDP_CLICK') {
        const tabId = sender.tab?.id;
        if (!tabId) { sendResponse({ ok: false, error: 'no tab' }); return true; }
        const { x, y, selector } = message;
        (async () => {
            // ★ submit/click 은 절대 건너뛰면 안 됨 → 큐 대기 (skipIfBusy 미사용)
            const r = await _withCdp(tabId, async (target) => {
                await new Promise(r2 => setTimeout(r2, selector ? 350 : 80));
                let fx = x, fy = y;
                if (selector) {
                    try {
                        const evalResult = await chrome.debugger.sendCommand(target, 'Runtime.evaluate', {
                            expression: `(() => { const icons = [...document.querySelectorAll('${selector}')]; const icon = icons.find(i => i.textContent.trim() === 'arrow_forward'); const btn = icon?.closest('button'); if (!btn) return null; const r = btn.getBoundingClientRect(); return JSON.stringify({ x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2), w: Math.round(r.width), h: Math.round(r.height) }); })()`,
                            returnByValue: true
                        });
                        const parsed = evalResult?.result?.value ? JSON.parse(evalResult.result.value) : null;
                        if (parsed && parsed.x > 0 && parsed.y > 0) {
                            // ★ v1.1.8 anti-bot #1: 버튼 정중앙만 매번 누르면 동일 픽셀 = 봇 신호.
                            //   버튼 내부에서 랜덤 지점 클릭 (반경은 버튼 크기의 ~25%, 최대 ±8/±5px로 클램프).
                            const jx = Math.min(8, Math.floor((parsed.w || 0) * 0.25));
                            const jy = Math.min(5, Math.floor((parsed.h || 0) * 0.25));
                            const ox = jx > 0 ? (Math.floor(Math.random() * (jx * 2 + 1)) - jx) : 0;
                            const oy = jy > 0 ? (Math.floor(Math.random() * (jy * 2 + 1)) - jy) : 0;
                            fx = parsed.x + ox; fy = parsed.y + oy;
                            console.log(`[CDP] 좌표 보정+지터: (${x},${y}) → 중앙(${parsed.x},${parsed.y}) → 클릭(${fx},${fy})`);
                        }
                    } catch (coordErr) {
                        console.warn('[CDP] 좌표 재측정 실패, 원래 좌표 사용', coordErr?.message);
                    }
                }
                // 사람 같은 마우스 이동 궤적
                await _cdpHumanMouseMove(target, fx, fy);
                console.log(`[CDP] 클릭 발사: (${fx},${fy})`);
                await new Promise(r2 => setTimeout(r2, 40 + Math.random() * 120));
                await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
                    type: 'mousePressed', x: fx, y: fy, button: 'left', clickCount: 1
                });
                await new Promise(r2 => setTimeout(r2, 50 + Math.random() * 90));
                await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
                    type: 'mouseReleased', x: fx, y: fy, button: 'left', clickCount: 1
                });
                return { ok: true, corrected: (fx !== x || fy !== y), coords: { original: {x,y}, used: {x:fx,y:fy} } };
            });
            if (!r.ok) console.error('[CDP] 클릭 오류:', r.error);
            sendResponse(r);
        })();
        return true;
    }

    // ★ v1.1.2: 외부 URL fetch 프록시 (CORS 우회 — host_permissions 추가 없이)
    if (message.type === 'FETCH_PROXY') {
        (async () => {
            try {
                const resp = await fetch(message.url, message.options || {});
                const text = await resp.text();
                sendResponse({ ok: resp.ok, status: resp.status, body: text });
            } catch (e) {
                sendResponse({ ok: false, error: e?.message });
            }
        })();
        return true;
    }

    // ★ FETCH_IMAGE_BASE64: 背景服务工作线程抓取图片并转为 Base64（无 CORS 限制）
    if (message.type === 'FETCH_IMAGE_BASE64') {
        const url = message.url;
        (async () => {
            try {
                if (!url) {
                    sendResponse({ ok: false, error: 'Empty URL' });
                    return;
                }
                const resp = await fetch(url);
                if (!resp.ok) {
                    sendResponse({ ok: false, status: resp.status, error: `HTTP ${resp.status}` });
                    return;
                }
                const blob = await resp.blob();
                const buffer = await blob.arrayBuffer();
                const bytes = new Uint8Array(buffer);
                let binary = '';
                const chunkSize = 8192;
                for (let i = 0; i < bytes.length; i += chunkSize) {
                    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
                }
                const base64 = btoa(binary);
                const mime = blob.type || 'image/jpeg';
                sendResponse({ ok: true, base64: `data:${mime};base64,${base64}` });
            } catch (e) {
                sendResponse({ ok: false, error: e?.message });
            }
        })();
        return true;
    }

    // videoPipelineResume 저장 (content script → background 경유, storage.local만 사용)
    // ★ Factory 전용: isFactoryVideoPhase일 때 factoryVideoPipelineResume에도 저장 (다른 모드 덮어쓰기 방지)
    if (message.type === 'SAVE_RESUME') {
        const data = message.data;
        (async () => {
            try {
                await chrome.storage.local.set({ videoPipelineResume: data });
                if (data?.settings?.isFactoryVideoPhase === true) {
                    await chrome.storage.local.set({ factoryVideoPipelineResume: data });
                }
                sendResponse({ success: true });
            } catch (e) {
                sendResponse({ success: false, error: e?.message });
            }
        })();
        return true;
    }

    // videoPipelineResume 읽기
    if (message.type === 'GET_RESUME') {
        (async () => {
            try {
                const result = await chrome.storage.local.get('videoPipelineResume');
                const data = result?.videoPipelineResume;
                sendResponse({ data: data || null });
            } catch (e) {
                sendResponse({ data: null, error: e?.message });
            }
        })();
        return true;
    }

    // videoPipelineResume 삭제 (Factory 전용 키도 함께 삭제, 다른 모드 무영향)
    if (message.type === 'CLEAR_RESUME') {
        (async () => {
            await chrome.storage.local.remove(['videoPipelineResume', 'factoryVideoPipelineResume']);
            sendResponse({ success: true });
        })().catch(() => sendResponse({ success: false }));
        return true;
    }

    // ★ 이미지 프로젝트 분할 resume 저장 (동영상 resume와 별도 키 사용)
    if (message.type === 'SAVE_IMAGE_RESUME') {
        const data = message.data;
        (async () => {
            try {
                await chrome.storage.local.set({ imagePipelineResume: data });
                sendResponse({ success: true });
            } catch (e) {
                sendResponse({ success: false, error: e?.message });
            }
        })();
        return true;
    }

    if (message.type === 'GET_IMAGE_RESUME') {
        (async () => {
            try {
                const result = await chrome.storage.local.get('imagePipelineResume');
                sendResponse({ data: result?.imagePipelineResume || null });
            } catch (e) {
                sendResponse({ data: null, error: e?.message });
            }
        })();
        return true;
    }

    if (message.type === 'CLEAR_IMAGE_RESUME') {
        (async () => {
            await chrome.storage.local.remove('imagePipelineResume');
            sendResponse({ success: true });
        })().catch(() => sendResponse({ success: false }));
        return true;
    }

    // ★ 이미지 프로젝트 분할: Flow 홈으로 이동 + RESUME_IMAGE_PIPELINE 전송
    if (message.type === 'NAVIGATE_TAB_TO_FLOW_IMAGE') {
        const tabId = sender.tab?.id;
        if (!tabId) {
            sendResponse({ success: false });
            return true;
        }
        processedResumeTabIds.delete(tabId);
        const FLOW_HOME_URL = 'https://flow.google.com/';
        chrome.tabs.update(tabId, { url: FLOW_HOME_URL });
        const listener = (tid, changeInfo) => {
            if (tid === tabId && changeInfo.status === 'complete') {
                if (processedResumeTabIds.has(tabId)) return;
                processedResumeTabIds.add(tabId);
                chrome.tabs.onUpdated.removeListener(listener);
                (async () => {
                    const MIN_WAIT_MS = 3000;
                    const POLL_INTERVAL_MS = 500;
                    const MAX_POLL_ITER = 40;
                    await new Promise(r => setTimeout(r, MIN_WAIT_MS));
                    for (let i = 0; i < MAX_POLL_ITER; i++) {
                        try {
                            const resp = await chrome.tabs.sendMessage(tabId, { type: 'PING' });
                            if (resp?.alive) {
                                await new Promise(r => setTimeout(r, 1000));
                                chrome.tabs.sendMessage(tabId, { type: 'RESUME_IMAGE_PIPELINE' }).catch(() => {});
                                return;
                            }
                        } catch {
                            await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
                        }
                    }
                    // 타임아웃: 마지막 시도
                    chrome.tabs.sendMessage(tabId, { type: 'RESUME_IMAGE_PIPELINE' }).catch(() => {});
                })();
            }
        };
        chrome.tabs.onUpdated.addListener(listener);
        setTimeout(() => chrome.tabs.onUpdated.removeListener(listener), 60000);
        sendResponse({ success: true });
        return true;
    }

    // RESET_LAST_PROGRESS_SEQ: fire-and-forget 응답 (채널 닫힘 에러 방지)
    if (message.type === 'RESET_LAST_PROGRESS_SEQ') {
        sendResponse({ ok: true });
        return true;
    }

    // ★ content script 로드 완료 시 — 두 경로 완전 분리 (솔루션 문서 기준)
    // imageToVideo/textToVideo: pending만 (storage 조회 없음)
    // Factory: storage에서 videoPipelineResume 조회 → isFactoryVideoPhase일 때만 전송
    if (message.type === 'FLOW_CONTENT_READY') {
        const tabId = sender.tab?.id;
        const tabUrl = sender.tab?.url || '';
        const isFlowToolsFlow = tabUrl.includes('flow.google.com');
        (async () => {
            if (!tabId || !isFlowToolsFlow) return;
            // 경로 1: imageToVideo/textToVideo — pending만, storage 조회 없음
            if (pendingResumeImageToVideoTabId === tabId) {
                pendingResumeImageToVideoTabId = null;
                chrome.tabs.sendMessage(tabId, { type: 'RESUME_VIDEO_PIPELINE' }).catch((e) => {
                });
                return;
            }
            // 경로 2: Factory 전용 — storage.local 사용 (session은 SW 재시작 시 유실될 수 있음)
            const localRes = await chrome.storage.local.get('pendingFactoryResumeTabId');
            const pendingFactoryTabId = localRes?.pendingFactoryResumeTabId;
            const factoryMatch = pendingFactoryTabId != null && Number(pendingFactoryTabId) === Number(tabId);
            if (factoryMatch) {
                await chrome.storage.local.remove('pendingFactoryResumeTabId');
                factoryResumeTabId = null;
                // ★ Factory 전용: 덮어쓰기 방지용 키만 사용 (다른 모드 무영향)
                const res = await chrome.storage.local.get('factoryVideoPipelineResume');
                const data = res?.factoryVideoPipelineResume;
                const isFactory = !!(data && data.settings?.isFactoryVideoPhase === true);
                if (isFactory) {
                    await new Promise(r => setTimeout(r, 300));
                    chrome.tabs.sendMessage(tabId, { type: 'RESUME_VIDEO_PIPELINE', data }).catch((e) => {
                    });
                } else {
                }
                return;
            }
            // 경로 3: 이미지 프로젝트 분할 resume — imagePipelineResume 존재 시 전송
            const imgRes = await chrome.storage.local.get('imagePipelineResume');
            if (imgRes?.imagePipelineResume) {
                await new Promise(r => setTimeout(r, 300));
                chrome.tabs.sendMessage(tabId, { type: 'RESUME_IMAGE_PIPELINE' }).catch(() => {});
                return;
            }
        })();
        sendResponse({ ok: true });
        return true;
    }

    // ★ 이미지투비디오 재개: URL이 이미 Flow일 때 — 강제 리로드 후 FLOW_CONTENT_READY 시 전송
    if (message.type === 'RELOAD_AND_RESUME_VIDEO') {
        const tabId = message.tabId;
        if (!tabId) {
            sendResponse({ success: false });
            return true;
        }
        pendingResumeImageToVideoTabId = tabId;
        chrome.tabs.reload(tabId);
        setTimeout(() => {
            if (pendingResumeImageToVideoTabId === tabId) pendingResumeImageToVideoTabId = null;
        }, 120000);
        sendResponse({ success: true });
        return true;
    }

    // ★ Factory 동영상 재개 전용: storage.local 사용 (session은 SW 재시작 시 유실됨)
    if (message.type === 'FACTORY_RELOAD_AND_RESUME') {
        const tabId = message.tabId;
        if (!tabId) {
            sendResponse({ success: false });
            return true;
        }
        (async () => {
            try {
                await chrome.storage.local.set({ pendingFactoryResumeTabId: tabId });
                factoryResumeTabId = tabId;
                chrome.tabs.reload(tabId);
                setTimeout(() => {
                    factoryResumeTabId = null;
                    chrome.storage.local.remove('pendingFactoryResumeTabId').catch(() => {});
                }, 120000);
                sendResponse({ success: true });
            } catch (e) {
                sendResponse({ success: false });
            }
        })();
        return true;
    }

    // ★ Factory 동영상 재개 전용: Flow 탭이 없을 때 현재 탭을 Flow로 이동 (pendingResumeImageToVideoTabId 미사용)
    if (message.type === 'FACTORY_NAVIGATE_AND_RESUME') {
        const tabId = message.tabId;
        if (!tabId) {
            sendResponse({ success: false });
            return true;
        }
        (async () => {
            try {
                await chrome.storage.local.set({ pendingFactoryResumeTabId: tabId });
                factoryResumeTabId = tabId;
                const FLOW_URL = 'https://flow.google.com/';
                chrome.tabs.update(tabId, { url: FLOW_URL });
                setTimeout(() => {
                    factoryResumeTabId = null;
                    chrome.storage.local.remove('pendingFactoryResumeTabId').catch(() => {});
                }, 120000);
                sendResponse({ success: true });
            } catch (e) {
                sendResponse({ success: false });
            }
        })();
        return true;
    }

    // ★ 이미지투비디오 재개: sidepanel에서 호출 (tabId 전달, URL이 Flow가 아닐 때)
    if (message.type === 'NAVIGATE_AND_RESUME_VIDEO') {
        const tabId = message.tabId;
        if (!tabId) {
            sendResponse({ success: false });
            return true;
        }
        pendingResumeImageToVideoTabId = tabId;
        processedResumeTabIds.delete(tabId);
        const FLOW_URL = 'https://flow.google.com/';
        chrome.tabs.update(tabId, { url: FLOW_URL });
        const listener = (tid, changeInfo) => {
            if (tid === tabId && changeInfo.status === 'complete') {
                if (processedResumeTabIds.has(tabId)) return;
                processedResumeTabIds.add(tabId);
                chrome.tabs.onUpdated.removeListener(listener);
                (async () => {
                    const completeAt = Date.now();
                    const MIN_WAIT_MS = 3000;
                    const POLL_INTERVAL_MS = 500;
                    const MAX_POLL_ITER = 40;
                    const elapsed = Date.now() - completeAt;
                    if (elapsed < MIN_WAIT_MS) {
                        await new Promise(r => setTimeout(r, MIN_WAIT_MS - elapsed));
                    }
                    for (let i = 0; i < MAX_POLL_ITER; i++) {
                        if (pendingResumeImageToVideoTabId !== tabId) return;
                        try {
                            const resp = await chrome.tabs.sendMessage(tabId, { type: 'PING' });
                            if (resp?.alive) {
                                await new Promise(r => setTimeout(r, 1000));
                                if (pendingResumeImageToVideoTabId === tabId) {
                                    pendingResumeImageToVideoTabId = null;
                                    chrome.tabs.sendMessage(tabId, { type: 'RESUME_VIDEO_PIPELINE' }).catch(() => {});
                                }
                                return;
                            }
                        } catch {
                            await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
                        }
                    }
                    if (pendingResumeImageToVideoTabId === tabId) {
                        pendingResumeImageToVideoTabId = null;
                        chrome.tabs.sendMessage(tabId, { type: 'RESUME_VIDEO_PIPELINE' }).catch(() => {});
                    }
                })();
            }
        };
        chrome.tabs.onUpdated.addListener(listener);
        setTimeout(() => {
            chrome.tabs.onUpdated.removeListener(listener);
            if (pendingResumeImageToVideoTabId === tabId) pendingResumeImageToVideoTabId = null;
        }, 120000);
        sendResponse({ success: true });
        return true;
    }

    // 탭을 Flow URL로 이동 (비디오 파이프라인 새 프로젝트 전환용)
    // ★ navigateToFlowHomeAndWait·ensureContentScriptLoaded와 동일: 최소 대기 + PING 폴링으로 실제 준비 확인
    if (message.type === 'NAVIGATE_TAB_TO_FLOW') {
        const tabId = sender.tab?.id;
        if (!tabId) {
            sendResponse({ success: false });
            return true;
        }
        processedResumeTabIds.delete(tabId);
        const FLOW_HOME_URL = 'https://flow.google.com/';
        chrome.tabs.update(tabId, { url: FLOW_HOME_URL });
        const listener = (tid, changeInfo) => {
            if (tid === tabId && changeInfo.status === 'complete') {
                if (processedResumeTabIds.has(tabId)) return;
                processedResumeTabIds.add(tabId);
                chrome.tabs.onUpdated.removeListener(listener);
                (async () => {
                    const completeAt = Date.now();
                    const MIN_WAIT_MS = 3000;
                    const POLL_INTERVAL_MS = 500;
                    const MAX_POLL_ITER = 40;
                    const elapsed = Date.now() - completeAt;
                    if (elapsed < MIN_WAIT_MS) {
                        await new Promise(r => setTimeout(r, MIN_WAIT_MS - elapsed));
                    }
                    for (let i = 0; i < MAX_POLL_ITER; i++) {
                        try {
                            const resp = await chrome.tabs.sendMessage(tabId, { type: 'PING' });
                            if (resp?.alive) {
                                await new Promise(r => setTimeout(r, 1000));
                                chrome.tabs.sendMessage(tabId, { type: 'RESUME_VIDEO_PIPELINE' }).catch(() => {});
                                return;
                            }
                        } catch {
                            await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
                        }
                    }
                    chrome.tabs.sendMessage(tabId, { type: 'RESUME_VIDEO_PIPELINE' }).catch(() => {});
                })();
            }
        };
        chrome.tabs.onUpdated.addListener(listener);
        setTimeout(() => chrome.tabs.onUpdated.removeListener(listener), 60000);
        sendResponse({ success: true });
        return true;
    }

    // 파일 다운로드 (fire-and-forget — content script가 응답 대기하지 않음)
    if (message.type === 'DOWNLOAD_FILE') {
        (async () => {
            try {
                // Windows 예약 이름(nul, con, prn 등) 방지 — 해당 시 FlowFactory 사용
                const RESERVED_WIN = /^(nul|con|prn|aux|com[1-9]|lpt[1-9])$/i;
                const safeFolder = (v) => (!v || typeof v !== 'string' || RESERVED_WIN.test(v.trim())) ? 'FlowFactory' : v.trim();

                let fullPath = message.filename;
                const sessionId = message.sessionId || '';
                if (sessionId) getDownloadSession(sessionId);

                const stored = await chrome.storage.local.get(['downloadFolder']);
                const folder = safeFolder(message.folder || stored.downloadFolder);

                if (!fullPath) {
                    try {
                        const urlObj = new URL(message.url);
                        fullPath = urlObj.pathname.split('/').pop() || `flow_${Date.now()}`;
                    } catch {
                        fullPath = `flow_${Date.now()}`;
                    }
                }
                const safeName = (s) => (!s || RESERVED_WIN.test(String(s).trim())) ? `flow_${Date.now()}` : s;
                fullPath = [folder, safeName(fullPath)].filter(Boolean).join('/');

                chrome.downloads.download({
                    url: message.url,
                    filename: fullPath,
                    saveAs: false
                }, (downloadId) => {
                    if (chrome.runtime.lastError) {
                        const session = getDownloadSession(sessionId);
                        if (session) {
                            session.failed += 1;
                            emitDownloadProgress(sessionId);
                        }
                    } else {
                        pendingDownloads.set(downloadId, { fullPath, sessionId });
                        // 2차 폴백: SW 재시작 시 storage.session에서 복구
                        chrome.storage.session.get(PENDING_DOWNLOADS_KEY).then((res) => {
                            const cur = res[PENDING_DOWNLOADS_KEY] || {};
                            cur[String(downloadId)] = { fullPath, sessionId };
                            return chrome.storage.session.set({ [PENDING_DOWNLOADS_KEY]: cur });
                        }).catch(() => {});
                    }
                });
            } catch (err) {
            }
        })();
        return false; // 응답 없음 — message channel closed 에러 방지
    }

    if (message.type === 'REGISTER_DOWNLOAD_SESSION' || message.type === 'REGISTER_DOWNLOAD_BATCH') {
        const sessionId = message.data?.sessionId || '';
        const total = Number(message.data?.total);
        const delta = Number(message.data?.delta);
        const session = getDownloadSession(sessionId);
        if (session) {
            if (message.type === 'REGISTER_DOWNLOAD_BATCH') {
                session.total = Math.max(0, Number(session.total) || 0) + (Number.isFinite(delta) ? Math.max(0, delta) : 0);
            } else {
                session.total = Number.isFinite(total) ? Math.max(0, total) : 0;
            }
            if ((session.completed + session.failed) < session.total) {
                session.finalSent = false;
            }
            emitDownloadProgress(sessionId);
        }
        return false;
    }

    // 다운로드 설정 (storage에 영구 저장)
    if (message.type === 'SETUP_DOWNLOAD') {
        const RESERVED_WIN = /^(nul|con|prn|aux|com[1-9]|lpt[1-9])$/i;
        const raw = message.folder || 'FlowFactory';
        const folder = (!raw || typeof raw !== 'string' || RESERVED_WIN.test(String(raw).trim())) ? 'FlowFactory' : raw.trim();
        const subfolder = message.subfolder || '';

        chrome.storage.local.set({
            downloadFolder: folder,
            downloadSubfolder: subfolder
        }, () => {
            sendResponse({ success: true });
        });
        return true;
    }

    // 페이지 줌
    if (message.type === 'SET_ZOOM') {
        if (sender.tab) {
            chrome.tabs.setZoom(sender.tab.id, message.zoomFactor || 0.8);
        }
        sendResponse({ success: true });
        return true;
    }

    // Side Panel 열기
    if (message.type === 'OPEN_SIDE_PANEL') {
        if (sender.tab) {
            chrome.sidePanel.open({ tabId: sender.tab.id });
        }
    }

    // 메시지 포워딩: Side Panel → Content Script
    if (message.type === 'FORWARD_TO_CONTENT') {
        chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
            if (tab) {
                chrome.tabs.sendMessage(tab.id, message.data, sendResponse);
            }
        });
        return true;
    }

    // Content Script → Side Panel: 이미지 lazy loading 포워딩
    if (message.type === 'REQUEST_LAZY_IMAGE') {
        chrome.runtime.sendMessage(message, (resp) => {
            sendResponse(resp);
        });
        return true;
    }

    // 메시지 포워딩: Content Script → Side Panel (FLOW Factory)
    if (['SUBMIT_PROGRESS', 'GENERATION_PROGRESS', 'DOWNLOAD_PROGRESS', 'ALL_COMPLETE', 'FLOW_ERROR',
         'GENERATION_COMPLETE', 'PROMPT_STATUS', 'CHAR_REF_IMAGES_READY', 'AUTO_PAUSE', 'CREDIT_EXHAUSTED',
         'PROJECT_BATCH_PROGRESS'].includes(message.type)) {
        chrome.runtime.sendMessage(message).catch(() => {});
    }
});

// ── 다운로드 상태 추적 ──
chrome.downloads.onChanged.addListener((delta) => {
    if (delta.state && (delta.state.current === 'complete' || delta.state.current === 'interrupted')) {
        const meta = pendingDownloads.get(delta.id);
        if (delta.state.current === 'interrupted') {
        }
        if (meta?.sessionId) {
            const session = getDownloadSession(meta.sessionId);
            if (session) {
                if (delta.state.current === 'complete') session.completed += 1;
                else session.failed += 1;
                emitDownloadProgress(meta.sessionId);
            }
        }
        pendingDownloads.delete(delta.id);
        // storage.session에서도 삭제 (3단계 정리)
        chrome.storage.session.get(PENDING_DOWNLOADS_KEY).then((res) => {
            const pending = res[PENDING_DOWNLOADS_KEY] || {};
            if (String(delta.id) in pending) {
                delete pending[String(delta.id)];
                return chrome.storage.session.set({ [PENDING_DOWNLOADS_KEY]: pending });
            }
        }).catch(() => {});
    }
});

// ── 확장프로그램 아이콘 클릭 시 Side Panel 열기 ──
chrome.action.onClicked.addListener((tab) => {
    chrome.sidePanel.open({ tabId: tab.id });
});

// ── 설치/업데이트 시 ──
chrome.runtime.onInstalled.addListener((details) => {
    if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
        chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    }
});
