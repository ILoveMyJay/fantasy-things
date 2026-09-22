if(typeof console!=="undefined" && window.__FLOW_SILENT__ === true){console.log=function(){};console.warn=function(){};console.error=function(){};}
/**
 * sidepanel.js — AI4Next Side Panel Logic
 */

// =============================================
// PASSWORD CONFIGURATION
// =============================================

const PASSWORD_CONFIG = {
    apiUrl: 'https://script.google.com/macros/s/AKfycbyBRXjXgO5jKRHGC570KO-ZCMTjKzTbRkmFWd68ruJo3c37LK4dXtPH5uNAKrTp3xpA/exec',
    sessionHours: 24,
    sessionKey: 'gf_auth_session'
};

const MOCK_SCRIPT_EN = `Dubai Doesn't Know Dubai Cookies — An Economy Only Korea Understands
"Dubai chewy cookies? Never heard of them."
A Korean who's lived in Dubai for ten years asked a local.
It's called a 'Dubai' cookie, but people in Dubai have no idea.
Meanwhile in Korea, people line up at five in the morning.
A seven-thousand-won cookie sells for fifty thousand.
One point four two million monthly searches.
What on earth is going on?
Let me start with the shocking truth.
Dubai chewy cookies don't exist in Dubai.
Nobody there knows about them.
A Korean living in Dubai asked a local.
"What is this? I've never seen it."
The ingredients are easier to find in Dubai, but you need Korean YouTube for the recipe.
And here's something even more surprising.
It's not even a cookie.
There's not a single grain of flour in it.
It's made with marshmallow dough.
The texture is closer to rice cake.
It's not from Dubai, and it's not a cookie.
So why the name?
The answer lies in the word 'Dubai.'
What comes to mind when you hear Dubai?
Burj Khalifa. Palm Islands.
It's a symbol of luxury and premium.
Attach that name, and something ordinary becomes special.
This is called brand borrowing.
Then scarcity was added to the mix.
Starbucks sells only forty-four per day.
A Twosome Place reservation sold out in five minutes.
The harder it is to get, the more you want it.
This is the Veblen effect.
The more expensive it is, the more you want to buy it.
That's how seven thousand won becomes fifty thousand.
Now here's the real question.
Dubai chocolate went viral worldwide.
But only Korea reinvented it as the 'Dubai chewy cookie.'
Not Japan, not America, not even Dubai itself.
Why could only Korea pull this off?
Korea has a unique system.
When someone eats it, you have to try it too.
This is the bandwagon effect.
"What if I'm the only one who hasn't tried it?"
The fear of missing out — FOMO — kicks in.
Once you succeed in the morning rush, it's straight to the Instagram post.
That becomes social capital.
When all three combine, it explodes.
Korea is a country that amplifies trends.
Right now, something fascinating is happening in Dubai.
In Dubai apartments, people watch Korean YouTube to make the cookies.
The ingredients are easier to find in Dubai, but the recipe comes from Korea.
The original and the copy have switched places.
We only borrowed the name.
K-pop changed music. K-beauty changed cosmetics.
Now it's K-dessert's turn.
Korea is no longer a country that follows trends.
It has become a country that invents them.
What do you think?
Leave your thoughts in the comments.
Likes and subscribes mean a lot.`;

// =============================================
// MOCK PROMPT (default example for prompt→image mode)
// =============================================

const MOCK_PROMPT_EN = `Hero walking through a rainy neon street

Premium product shot of Product under minimal studio lighting

Hero and Product together on a futuristic workstation`;

// =============================================
// MONETIZATION (FACTORY MODE PRO)
// =============================================

const MONETIZATION_CONFIG = {
    // 플로우팩토리용 구글 시트 암호 API (수강생 프리패스용)
    sheetApiUrl: 'https://script.google.com/macros/s/AKfycbz7W7-f8WVGyQS63ccXoEvJufZe3wGRs1-5y9ZuNBEz_jH5c9aZ9SMDSbYJFriEDcwa1Q/exec',
    // License validation is kept for existing keys; promotional checkout links are intentionally disabled in AI4Next UI.
    lemonSqueezyApiUrl: 'https://api.lemonsqueezy.com/v1/licenses/validate',
    checkoutUrlMonthly: '',
    checkoutUrlYearly: '',
    // 로컬 스토리지 키
    licenseKey: 'gf_pro_license',
    usageKey: 'gf_monthly_usage',
    // 월간 무료 한도 (팩토리+대본투이미지 통합 7회)
    freeLimit: 7,
    // ★ 커스텀 캐릭터 레퍼런스(CCR) 월 7회 추가 제한
    //   - 7회 한도와 독립 카운트 (이중 카운트). 즉 CCR 사용 시 7회 + 7회 둘 다 체크
    //   - 적용 모드: factory, scriptToImage, textToImage(P2I) 모두
    //   - "CCR 토글 ON 상태에서 생성 시작" = 1회 (프로젝트 단위, 생성 이미지 개수 무관)
    ccrUsageKey: 'gf_ccr_monthly_usage',
    ccrFreeLimit: 7
};

// 1. 월간 카운터 (매월 1일 00:00 UTC 리셋)
// 리셋 기준: YYYY-MM 변경 시 (예: 1월 31일 3회 사용 → 2월 1일 00:00 UTC부터 0으로 리셋)
async function getMonthlyUsage() {
    const data = await chrome.storage.sync.get(MONETIZATION_CONFIG.usageKey);
    const saved = data[MONETIZATION_CONFIG.usageKey];
    const thisMonth = new Date().toISOString().slice(0, 7);

    if (!saved || saved.month !== thisMonth) {
        const d = new Date();
        d.setUTCMonth(d.getUTCMonth() + 1, 1);
        const resetDate = d.toISOString().slice(0, 10); // 다음 달 1일
        return { month: thisMonth, count: 0, resetDate };
    }
    return { ...saved };
}

async function incrementUsage() {
    const usage = await getMonthlyUsage();
    await chrome.storage.sync.set({
        [MONETIZATION_CONFIG.usageKey]: {
            month: usage.month,
            count: usage.count + 1,
            resetDate: usage.resetDate || null
        }
    });
}

// ─────────────────────────────────────────────────────────────
// CCR(커스텀 캐릭터 레퍼런스) 월 3회 카운터 — 5회 한도와 독립
// ─────────────────────────────────────────────────────────────
async function getCcrMonthlyUsage() {
    const data = await chrome.storage.sync.get(MONETIZATION_CONFIG.ccrUsageKey);
    const saved = data[MONETIZATION_CONFIG.ccrUsageKey];
    const thisMonth = new Date().toISOString().slice(0, 7);
    if (!saved || saved.month !== thisMonth) {
        const d = new Date();
        d.setUTCMonth(d.getUTCMonth() + 1, 1);
        const resetDate = d.toISOString().slice(0, 10);
        return { month: thisMonth, count: 0, resetDate };
    }
    return { ...saved };
}

async function incrementCcrUsage() {
    const usage = await getCcrMonthlyUsage();
    await chrome.storage.sync.set({
        [MONETIZATION_CONFIG.ccrUsageKey]: {
            month: usage.month,
            count: usage.count + 1,
            resetDate: usage.resetDate || null
        }
    });
}

/**
 * CCR 접근 권한 체크 (유료 키 있으면 무제한, 없으면 월 3회)
 * @returns {{allowed: boolean, type: 'paid'|'sheet'|'free', remaining?: number}}
 */
async function checkCcrAccess() {
    // 유료 라이선스 있으면 무제한
    const stored = await chrome.storage.local.get(MONETIZATION_CONFIG.licenseKey);
    const savedKeyInfo = stored[MONETIZATION_CONFIG.licenseKey];
    if (savedKeyInfo && savedKeyInfo.key && (savedKeyInfo.type === 'paid' || savedKeyInfo.type === 'sheet')) {
        return { allowed: true, type: savedKeyInfo.type };
    }
    const usage = await getCcrMonthlyUsage();
    if (usage.count < MONETIZATION_CONFIG.ccrFreeLimit) {
        return { allowed: true, type: 'free', remaining: MONETIZATION_CONFIG.ccrFreeLimit - usage.count };
    }
    return { allowed: false, type: 'free' };
}

/**
 * 현재 활성 모드에서 CCR 토글이 ON 인지 판정
 * - factory / scriptToImage → APP.useCustomCharRefs
 * - 나머지 모드는 CCR 해당 없음 → false
 */
function isCcrEnabledForCurrentMode() {
    if (APP.mode === 'factory' || APP.mode === 'scriptToImage') {
        return !!APP.useCustomCharRefs;
    }
    return false;
}

/**
 * 현재 활성 모드의 CCR 슬롯 중 이미지가 하나라도 업로드된 슬롯이 있는지
 * factory / scriptToImage → APP.customCharRefs
 * textToImage (P2I)      → APP.p2iCustomCharRefs
 */
function _ccrSlotsHaveAnyImage() {
    const codes = ['MCR', 'SC1', 'SC2', 'SC3', 'SC4', 'SC5'];
    const refs = (APP.mode === 'textToImage') ? APP.p2iCustomCharRefs : APP.customCharRefs;
    if (!refs) return false;
    return codes.some(c => refs[c] && refs[c].image);
}

// 2. 구글 시트 암호 (수강생 무제한 키) 검증
// 취약점 2: 네트워크 오류 시 'network_error' 반환 → checkFactoryAccess에서 키 삭제하지 않음
async function validateSheetKey(inputPw) {
    try {
        const url = `${MONETIZATION_CONFIG.sheetApiUrl}?pw=${encodeURIComponent(inputPw)}`;
        // ★ v1.1.2: background service worker 경유 fetch (CORS 우회, host_permissions 추가 불필요)
        const resp = await chrome.runtime.sendMessage({ type: 'FETCH_PROXY', url });
        if (!resp?.ok) return 'network_error';
        const data = JSON.parse(resp.body);
        return data.success === true;
    } catch (error) {
        return 'network_error';
    }
}

// 3. Flow Studio Pro — Lifetime Unlocked
async function validatePaidKey(key) {
    return true;
}

// 4. FACTORY & PRO Permission Check — Completely Unlocked
async function checkFactoryAccess() {
    return { allowed: true, type: 'paid', remaining: 999999, isLifetime: true };
}

// ═════════════════════════════════════════════════════════════════════
// 브랜드 프로파일 내보내기 / 가져오기 (유료 전용 해제)
// ═════════════════════════════════════════════════════════════════════
async function hasPaidLicenseLocal() {
    return true;
}

async function exportBrandProfilesToFile() {
    if (!await hasPaidLicenseLocal()) {
        // ★ upgrade modal은 SCRIPT 모드 섹션 안에 있어 타 모드에서 안 보일 수 있음
        //   토스트로 확실한 피드백 + SCRIPT 탭 전환해 모달 노출 보장
        showProGateFeedback('brandExport');
        return;
    }
    const profiles = Array.isArray(APP.brandProfiles) ? APP.brandProfiles : [];
    if (profiles.length === 0) {
        showToast("暂无可导出的角色品牌库。请先保存一个角色库。", 'warning');
        return;
    }

    const payload = {
        schema: 'flowfactory-brand-profiles',
        schemaVersion: 1,
        exportedAt: new Date().toISOString(),
        extensionVersion: chrome.runtime.getManifest().version,
        count: profiles.length,
        brandProfiles: profiles
    };
    const jsonStr = JSON.stringify(payload, null, 2);

    // data URL 로 변환 (background 의 chrome.downloads.download 가 처리)
    const dataUrl = 'data:application/json;charset=utf-8,' + encodeURIComponent(jsonStr);

    // 파일명: 타임스탬프 포함, 메인 폴더에 바로 저장 (서브폴더 없음)
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `flowfactory-brands-${stamp}.json`;

    chrome.runtime.sendMessage({
        type: 'DOWNLOAD_FILE',
        url: dataUrl,
        filename: filename,  // 서브폴더 없이 파일명만 → 메인 폴더 직속에 저장됨
        folder: APP.settings?.downloadFolder || 'AI4Next'
    });

    showToast(
        "📤 Exported {n} brands: {filename}"
            .replace('{n}', profiles.length)
            .replace('{filename}', filename),
        'success'
    );
}

async function importBrandProfilesFromFile(file) {
    if (!await hasPaidLicenseLocal()) {
        showProGateFeedback('brandImport');
        return;
    }
    if (!file) return;

    let text;
    try {
        text = await file.text();
    } catch {
        showToast("⚠️ 文件格式错误（JSON 解析失败）", 'error');
        return;
    }

    let data;
    try {
        data = JSON.parse(text);
    } catch {
        showToast("⚠️ 文件格式错误（JSON 解析失败）", 'error');
        return;
    }

    // 스키마 검증
    const profiles = Array.isArray(data) ? data : (Array.isArray(data.brandProfiles) ? data.brandProfiles : null);
    if (!profiles) {
        showToast("⚠️ 不是有效的角色品牌库文件", 'error');
        return;
    }
    const valid = profiles.filter(p => p && typeof p === 'object' && p.name && p.characters);
    if (valid.length === 0) {
        showToast("⚠️ 不是有效的角色品牌库文件", 'error');
        return;
    }

    // 병합 전략: 동일 이름 처리 — 사용자에게 묻기
    const msg = "Importing {n} brands.\\nOverwrite existing brands with the same name?\\n(Cancel to append with numeric suffix)"
        .replace('{n}', valid.length)
        .replace(/\\n/g, '\n');
    const overwrite = confirm(msg);

    if (!Array.isArray(APP.brandProfiles)) APP.brandProfiles = [];
    const existingNames = new Set(APP.brandProfiles.map(p => p.name));

    let added = 0;
    for (const p of valid) {
        const clean = {
            id: p.id || ('brand_' + Date.now() + '_' + Math.floor(Math.random() * 10000)),
            name: p.name,
            characters: p.characters,
            createdAt: p.createdAt || Date.now(),
            updatedAt: Date.now()
        };
        if (existingNames.has(clean.name)) {
            if (overwrite) {
                const idx = APP.brandProfiles.findIndex(x => x.name === clean.name);
                APP.brandProfiles[idx] = clean;
            } else {
                // 이름 뒤에 숫자 suffix
                let n = 2;
                while (existingNames.has(`${clean.name} (${n})`)) n++;
                clean.name = `${clean.name} (${n})`;
                APP.brandProfiles.push(clean);
                existingNames.add(clean.name);
            }
        } else {
            APP.brandProfiles.push(clean);
            existingNames.add(clean.name);
        }
        added++;
    }

    try {
        await chrome.storage.local.set({ brandProfiles: APP.brandProfiles });
    } catch (e) {
        showToast('Save failed: ' + (e?.message || e), 'error');
        return;
    }

    showToast(
        "📥 Imported {n} brands".replace('{n}', added),
        'success'
    );
}

function initBrandExportImportButtons() {
    const bind = (btnId, handler) => {
        const btn = document.getElementById(btnId);
        if (!btn || btn._boundExp) return;
        btn._boundExp = true;
        btn.addEventListener('click', handler);
    };
    const bindImport = (btnId, fileInputId) => {
        const btn = document.getElementById(btnId);
        const fileInput = document.getElementById(fileInputId);
        if (!btn || !fileInput || btn._boundImp) return;
        btn._boundImp = true;
        btn.addEventListener('click', async () => {
            if (!await hasPaidLicenseLocal()) {
                showProGateFeedback('brandImport');
                return;
            }
            fileInput.value = '';  // 같은 파일 재선택 허용
            fileInput.click();
        });
        if (!fileInput._boundImp) {
            fileInput._boundImp = true;
            fileInput.addEventListener('change', async (e) => {
                const f = e.target.files && e.target.files[0];
                if (f) await importBrandProfilesFromFile(f);
            });
        }
    };

    bind('exportBrandsBtn', exportBrandProfilesToFile);
    bindImport('importBrandsBtn', 'brandImportFileInput');
}

// 5. 결제 페이지 열기 (지침 v4: 월/연 구독 체크아웃)
// UX: 결제 탭 열린 후 "이메일 확인하세요" 안내 표시 → 이탈률 감소
function openCheckout() {
    const plan = APP.upgradePlan || 'monthly';
    const url = plan === 'yearly'
        ? MONETIZATION_CONFIG.checkoutUrlYearly
        : MONETIZATION_CONFIG.checkoutUrlMonthly;
    if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.create) {
        chrome.tabs.create({ url });
    } else {
        window.open(url, '_blank', 'noopener');
    }
    const guide = document.getElementById('payment-guide');
    const guideText = document.getElementById('payment-guide-text');
    if (guide && guideText) {
        const html = "Enter your access key below to activate.";
        guideText.innerHTML = html;
        guide.classList.add('show');
    }
    const input = document.getElementById('pw-input');
    if (input) input.focus();
}

// 6. 모달 제어 및 뱃지 업데이트
function updateFactoryBadge(access) {
    const badge = document.getElementById('factoryBadge');
    if (!badge) return;

    badge.className = 'factory-badge'; // reset
    const isPro = access.type === 'paid' || access.type === 'sheet';
    if (isPro) {
        badge.textContent = `PRO`;
        badge.style.display = 'block';
        badge.classList.remove('hidden');
    } else {
        badge.textContent = '';
        badge.style.display = 'none';
        badge.classList.add('hidden');
    }
}

async function refreshFactoryBadge() {
    const access = await checkFactoryAccess();
    if (!access.allowed) {
        updateFactoryBadge({ type: 'exhausted' });
    } else {
        updateFactoryBadge(access);
    }
}

/** 팩토리 전자동 단계 표시 (프롬프트 생성중 → 완료 → 캐릭터 레퍼런스 생성중 → 완료 → 이미지 생성 시작 → 완료) */
function updateFactoryPhaseStatus(step, count) {
    if ((APP.mode !== 'factory' && APP.mode !== 'scriptToImage') || !APP.factory.isFullAuto) return;
    const el = $('#factoryPhaseStatus');
    if (!el) return;
    const messages = {
        prompt_generating: "正在生成 AI 分镜提示词...",
        prompt_done: ("分镜提示词已生成" + (count != null ? ` (${count}条)` : '')),
        char_ref_generating: "正在生成角色参考图...",
        char_ref_done: ("角色参考图已就绪" + (count != null ? ` (${count}张)` : '')),
        image_start: "开始批量生成图像...",
        image_done: "图像批量生成完成！"
    };
    el.textContent = messages[step] || '';
    el.classList.remove('hidden');
}

function showUpgradeModal() {
    const modal = document.getElementById('password-screen');
    const input = document.getElementById('pw-input');
    const errorMsg = document.getElementById('pw-error');
    if (modal) {
        modal.classList.remove('hidden');
        // ★ 모달 자체를 시야로 스크롤 (인라인 배치여서 숨겨진 모드 패널에 있을 경우 대비)
        //   이전엔 .prompt-gen-buttons 로 스크롤했지만, P2I 모드/CCR 섹션에서 호출 시
        //   해당 앵커가 숨겨진 패널에 있으면 모달이 뷰포트 밖으로 벗어남
        try {
            modal.scrollIntoView({ block: 'center', behavior: 'smooth' });
        } catch {
            const btnAnchor = document.querySelector('.prompt-gen-buttons');
            if (btnAnchor) btnAnchor.scrollIntoView({ block: 'start', behavior: 'smooth' });
        }
    }
    if (input) {
        input.value = '';
        input.focus();
    }
    if (errorMsg) errorMsg.classList.add('hidden');
    const paymentGuide = document.getElementById('payment-guide');
    if (paymentGuide) paymentGuide.classList.remove('show');
}

function hideUpgradeModal() {
    const modal = document.getElementById('password-screen');
    if (modal) modal.classList.add('hidden');
}

// PRO 전용 기능 클릭 시 유료 안내 — 모드 무관 확실한 피드백
//   #password-screen 모달은 SCRIPT 모드 섹션 내부에 인라인 배치되어
//   P2I/다른 모드에서 호출 시 숨은 부모 때문에 안 보이는 문제 해결
//   → 1) 토스트 즉시 표시 (위치 fixed, 모드 무관) 2) CONTROL 탭 + SCRIPT 섹션으로
//   전환 후 모달 노출
function showProGateFeedback(feature) {
    const labelMap = {
        'brandExport': "EXPORT BRAND LIST",
        'brandImport': "IMPORT BRAND LIST",
    };
    const label = labelMap[feature] || '';
    const msg = "🔒 PRO-only feature: {feature}"
        .replace('{feature}', label);
    showToast(msg, 'warning', 5000);

    // CONTROL(Workflow) 뷰 활성화 (모달이 CONTROL > SCRIPT 섹션 안에 있음)
    try {
        if (typeof showWorkflowView === 'function') showWorkflowView();
        // SCRIPT 모드 라디오/버튼 활성화 (필요 시)
        const scriptModeBtn = document.querySelector('[data-mode="scriptToImage"], #mode-scriptToImage');
        if (scriptModeBtn && typeof scriptModeBtn.click === 'function' && !scriptModeBtn.classList.contains('active')) {
            scriptModeBtn.click();
        }
    } catch {}

    // 200ms 지연 후 모달 노출 — DOM 전환이 반영된 뒤 스크롤 / 표시
    setTimeout(() => showUpgradeModal(), 200);
}

// Promotional checkout CTA is intentionally hidden in the AI4Next UI.
function renderUpgradePlan() {
    const ctaBtn = document.getElementById('btn-purchase-pro');
    if (ctaBtn) ctaBtn.textContent = 'Open access page';
}

// ── Essential setup guide modal ──────────────────────────────
function initEssentialSetupModal() {
    const overlay = document.getElementById('essential-setup-modal');
    const closeBtn = document.getElementById('essential-setup-close');
    const dontShow = document.getElementById('essential-setup-dont-show');
    if (!overlay || !closeBtn) return;

    function hide() {
        overlay.style.display = 'none';
    }

    // 다시 보지 않기: 체크 후 닫으면 이후 모달 미표시
    closeBtn.addEventListener('click', () => {
        if (dontShow?.checked) chrome.storage.local.set({ essentialSetupModalDontShow: true });
        hide();
    });
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            if (dontShow?.checked) chrome.storage.local.set({ essentialSetupModalDontShow: true });
            hide();
        }
    });

    chrome.storage.local.get('essentialSetupModalDontShow', (result) => {
        if (result.essentialSetupModalDontShow) return;
        overlay.style.display = 'flex';
    });
}

function initCreditModal() {
    const overlay = document.getElementById('credit-exhausted-modal');
    const closeBtn = document.getElementById('credit-modal-close');
    const dontShow = document.getElementById('credit-modal-dont-show');
    if (!overlay) return;

    closeBtn?.addEventListener('click', () => {
        if (dontShow?.checked) {
            chrome.storage.local.set({ creditModalDontShow: true });
        }
        overlay.style.display = 'none';
    });

    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.style.display = 'none';
    });
}

function showCreditModal() {
    chrome.storage.local.get('creditModalDontShow', (result) => {
        if (result.creditModalDontShow) return;
        const overlay = document.getElementById('credit-exhausted-modal');
        if (!overlay) return;
        overlay.style.display = 'flex';
    });
}

function initUpgradeModal() {
    const input = document.getElementById('pw-input');
    const btnUnlock = document.getElementById('btn-unlock');
    const btnClose = document.getElementById('btn-close-upgrade');
    const errorMsg = document.getElementById('pw-error');
    const loadingMsg = document.getElementById('pw-loading');

    const btnPurchase = document.getElementById('btn-purchase-pro');
    if (btnPurchase) {
        btnPurchase.addEventListener('click', (e) => {
            e.preventDefault();
            openCheckout();
            if (input) input.focus();
        });
    }

    renderUpgradePlan();

    const pwToggle = document.getElementById('pw-toggle');
    pwToggle?.addEventListener('click', () => {
        const eyeOff = pwToggle.querySelector('.eye-off');
        const eyeOn = pwToggle.querySelector('.eye-on');
        if (input.type === 'password') {
            input.type = 'text';
            eyeOff?.classList.add('hidden');
            eyeOn?.classList.remove('hidden');
        } else {
            input.type = 'password';
            eyeOff?.classList.remove('hidden');
            eyeOn?.classList.add('hidden');
        }
        input.focus();
    });

    btnClose?.addEventListener('click', hideUpgradeModal);
    document.getElementById('btn-close-modal-x')?.addEventListener('click', hideUpgradeModal);

    btnUnlock?.addEventListener('click', handleKeySubmit);
    input?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleKeySubmit();
    });
    input?.addEventListener('input', () => {
        errorMsg?.classList.add('hidden');
        input?.classList.remove('input-error');
    });

    async function handleKeySubmit() {
        const key = input?.value.trim();
        if (!key) { input?.focus(); return; }

        const activatingHtml = `<span class="spinner"><span class="outer"></span><span class="inner"></span></span> Checking...`;
        const activateHtml = `<span>Activate</span>`;
        let successHandled = false;

        if (btnUnlock) {
            btnUnlock.disabled = true;
            btnUnlock.innerHTML = activatingHtml;
        }
        errorMsg?.classList.add('hidden');

        try {
            // 1) Lemon 검증 먼저
            // ※ network_error 시 새 키 입력에서는 승인하지 않음 (오프라인·장애 시 잘못된 키 통과 방지)
            //    관대한 허용은 checkFactoryAccess(기존 저장 키 재검증)에서만 적용
            let isPaid = await validatePaidKey(key);
            if (isPaid === true) {
                await chrome.storage.local.set({
                    [MONETIZATION_CONFIG.licenseKey]: {
                        key,
                        type: 'paid',
                        savedAt: Date.now(),
                        licenseValid: true,
                        licenseStatus: 'pro'
                    }
                });
                successHandled = true;
                btnUnlock?.classList.add('btn-success');
                if (btnUnlock) btnUnlock.innerHTML = "✓  PRO Activated!";
                refreshFactoryBadge();
                setTimeout(() => {
                    hideUpgradeModal();
                    if (btnUnlock) {
                        btnUnlock.disabled = false;
                        btnUnlock.classList.remove('btn-success');
                        btnUnlock.innerHTML = activateHtml;
                    }
                }, 1500);
                return;
            }

            // 2) Lemon 실패 시 구글 시트 검증
            let isSheet = await validateSheetKey(key);
            if (isSheet === true) {
                await chrome.storage.local.set({ [MONETIZATION_CONFIG.licenseKey]: { key, type: 'sheet', savedAt: Date.now() } });
                successHandled = true;
                btnUnlock?.classList.add('btn-success');
                if (btnUnlock) btnUnlock.innerHTML = "✓  PRO Activated!";
                refreshFactoryBadge();
                setTimeout(() => {
                    hideUpgradeModal();
                    if (btnUnlock) {
                        btnUnlock.disabled = false;
                        btnUnlock.classList.remove('btn-success');
                        btnUnlock.innerHTML = activateHtml;
                    }
                }, 1500);
                return;
            }

            // 둘 다 실패 → v4.1: 흔들림 + 빨간 입력창 + 에러 메시지
            const isNetworkError = isPaid === 'network_error' || isSheet === 'network_error';
            if (errorMsg) {
                errorMsg.textContent = isNetworkError
                    ? "Server connection failed. Please check your network and try again."
                    : "Enter a valid access key.";
                errorMsg.classList.remove('hidden');
            }
            if (input) {
                input.classList.add('input-error', 'pw-shake');
                setTimeout(() => {
                    input?.classList.remove('pw-shake');
                    input?.classList.remove('input-error');
                }, 380);
                input.value = '';
                input.focus();
            }
        } catch (error) {
            if (errorMsg) {
                errorMsg.textContent = "Server connection failed. Please check your network and try again.";
                errorMsg.classList.remove('hidden');
            }
        } finally {
            if (!successHandled && btnUnlock) {
                btnUnlock.disabled = false;
                btnUnlock.innerHTML = activateHtml;
            }
        }
    }
}

// =============================================
// MAIN APP
// =============================================

function debounce(fn, ms) {
    let timer;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), ms);
    };
}

// ========== STATE ==========
const APP = {
    mode: 'textToImage',
    isRunning: false,
    isPaused: false,
    stoppedWithPendingItems: false,  // ★ 정지 후 미완료 항목 있음 (재시작 시 이어서 진행용)
    isGeneratingPrompts: false,  // ★ Gemini API로 프롬프트 생성 중 (모드 전환 차단용)
    queue: [],          // { text, status, file?, base64? }
    imageFiles: [],     // File objects for imageToVideo
    assetNames: {},     // { [file.name]: customName } — user-given names for UPLOAD ASSETS, referenced via @mention in prompts
    styleImage: null,   // Base64 style image
    customStyles: [],   // [{ id, name, prompt, imageData }] — chrome.storage 'customStyles'와 동기화
    prompts: [],        // V3 prompt 객체 배열
    resumeState: null,           // 429 중단 시 재개 상태
    resumeExistingPrompts: null, // 429 중단 시 기존 프롬프트
    // FACTORY MODE STATE
    factory: {
        isAutoMode: false,          // AUTO GENERATION 모드 여부 (이미지 생성부터 끝까지)
        isFullAuto: false,          // ★ FULL AUTO 모드 (프롬프트 생성부터 끝까지 전체 자동)
        isVideoAuto: false,         // ★ VIDEO AUTO 모드 (동영상 프롬프트 생성부터 끝까지 자동)
        isProcessing: false,        // ★ Factory 전체 프로세스 진행 중 (모드 전환 차단용)
        batch1Images: [],           // 배치1 이미지 저장 [{ number, base64, thumbnail }]
        batch1Prompts: [],          // 배치1 이미지 프롬프트 저장
        videoPrompts: [],           // Gemini가 생성한 동영상 프롬프트
        videoQueue: [],             // 동영상 생성 큐 [{ number, imageBase64, prompt, status, editMode }]
        imageGenerationComplete: false,
        videoGenerationComplete: false
    },
    characterRefs: [],  // V3 캐릭터 레퍼런스 배열
    characterRefAssets: null,  // { MCR: { filename, base64, name }, ... } — 메인 생성 시 file input 업로드용
    isGeneratingRefs: false,
    // ★ PRO 2.0: 커스텀 캐릭터 레퍼런스 (사용자 직접 업로드)
    customCharRefs: {  // 6슬롯: MCR, SC1~SC5. 각 슬롯 = { image, prompt, name } or null
        MCR: null, SC1: null, SC2: null, SC3: null, SC4: null, SC5: null
    },
    useCustomCharRefs: false,  // 마스터 체크박스 상태
    brandProfiles: [],  // [{ id, name, characters, createdAt }, ...] ★ 대본+P2I 공유
    // ★ P2I v1.6: 프롬프트→이미지 모드 전용 커스텀 캐릭터 레퍼런스 (독립 슬롯)
    p2iCustomCharRefs: {
        MCR: null, SC1: null, SC2: null, SC3: null, SC4: null, SC5: null
    },
    p2iUseCustomCharRefs: false,  // P2I 마스터 체크박스 상태 (독립)
    promptSplitterMode: 'literal',
    promptSplitterSeparator: '###',
    // ★ PRO 2.0: 대본 분할 방식 (5종)
    splitMode: 'giseungjeongyeol',  // 'giseungjeongyeol' | 'sentence' | 'paragraph' | 'semantic' | 'lyrics'
    lastUserNumPrompts: '4',  // 사용자가 마지막으로 고른 균일 분할 개수 (모드 전환 시 복원용)
    // ★ PRO: 음악 가사 분할 모드 — 9종 장르 + 훅 변주 + 기승전결
    musicGenre: 'cinematic_ballad',         // 9종 중 기본값
    hookVariationIntensity: 'medium',       // 'low' | 'medium' | 'high'
    applyNarrativeArc: true,                // 기승전결 토글
    settings: {},
    lang: 'en',
    pendingCustomImage: null,
    editingCustomStyleId: null,
    flowUi: {
        lastProgressSeq: -1,
        maxCompletedPrompts: 0,
        lastAutoScrollIndex: -1,
        downloadSessionId: '',
        expectedDownloadCount: 0,
        downloadedCount: 0,
        downloadFailedCount: 0,
        downloadVerified: false,
        generationSuccessCount: 0,
        generationFailCount: 0
    }
};

// 커스텀 스타일 제한 (Whisk와 동일)
const CUSTOM_STYLE_LIMITS = {
    maxCount: 6,
    maxImageSize: 400,
    maxUploadSize: 5 * 1024 * 1024,
    imageQuality: 0.9
};

const CUSTOM_STYLE_ERRORS = {
    maxCount: 'Maximum 6 styles allowed. Solution: Delete an existing style first or keep 6 or fewer.',
    noImage: 'No image attached. Solution: Click the + area or paste with Ctrl+V.',
    noName: 'Style name is empty. Solution: Enter a name in the style name field.',
    noPrompt: 'Style prompt is empty. Solution: Enter style/mood in English.',
    imageError: 'Image processing failed. Solution: Try a JPG or PNG file, or choose a different image.',
    imageTooLarge: 'Image too large (max 5MB). Solution: Compress the image or choose a smaller file.',
    invalidFormat: 'JPG and PNG only. Solution: Select a JPG or PNG file.',
    saveError: 'Save failed. Solution: Check name and prompt, then try saving again.',
    styleNotFound: 'Style not found. Solution: Choose another style in Settings or re-add the custom style.'
};

function getCustomStyleError(errorKey) {
    return CUSTOM_STYLE_ERRORS[errorKey] || errorKey;
}

// ========== DOM CACHE ==========
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

function normalizeVisibleMode(mode) {
    const validModes = ['textToImage', 'scriptToImage', 'factory', 'textToVideo', 'imageToVideo'];
    if (validModes.includes(mode)) return mode;
    return 'textToImage';
}

function initStudioModeBar() {
    const btns = $$('.studio-tab-btn');
    btns.forEach(btn => {
        btn.addEventListener('click', () => {
            const targetMode = btn.dataset.studioMode;
            if (APP.mode === targetMode) return;
            APP.mode = targetMode;
            APP.settings.lastMode = APP.mode;
            saveSettings();
            updateModeUI();
        });
    });
}

// ========== INITIALIZATION ==========
async function initMainApp() {
    await loadSettings();
    APP.lang = 'zh';
    if (APP.settings) APP.settings.language = 'zh';
    initTabs();
    initTheme();
    initModeCards();
    initStudioModeBar();
    enhanceVisualLabels();
    initInputHandlers();
    initSettingsHandlers();
    initControlHandlers();
    initStyleGallery();
    refreshDynamicUi();
    updateModeUI();
    await loadSession();
    await loadScriptDraftOrMock();
    await loadPromptInputDraft();
    updateModeUI();
    initFlowOnlyModal();
    await checkFlowTabAndShowModal();
    initCharRefCheckbox();

    // ★ 저장된 characterRefAssets 복원 (새 프로젝트 2회 시 업로드용)
    const stored = await chrome.storage.local.get('characterRefAssets');
    if (stored.characterRefAssets && typeof stored.characterRefAssets === 'object') {
        APP.characterRefAssets = stored.characterRefAssets;
        renderCharRefThumbnails(APP.characterRefAssets);
    }

    // ★ PRO 2.0: 커스텀 캐릭터 레퍼런스 + 브랜드 프로필 초기화
    await initCustomCharRefs();

    APP.p2iUseCustomCharRefs = false;

    // ★ 1.1.0: 브랜드 내보내기/가져오기 버튼 (유료 전용)
    if (typeof initBrandExportImportButtons === 'function') {
        initBrandExportImportButtons();
    }

    // ★ PRO 2.0: 대본 분할 방식 초기화 + 세션 복원
    await initSplitMode();
    // ★ PRO: 음악 가사 분할 9종 장르 옵션 초기화
    await initMusicOptions();

    // ★ 저장된 일시정지 상태 복원 (팝업 닫았다 열어도 일시정지 유지)
    await restorePausedState();

    // ★ 429 재개 상태 복원 (페이지 새로고침 시)
    try {
        const sessionData = await chrome.storage.session.get(['resumeState', 'resumeExistingPrompts']);
        if (sessionData.resumeState) {
            APP.resumeState = sessionData.resumeState;
            APP.resumeExistingPrompts = sessionData.resumeExistingPrompts || [];
            _updateResumeButton();

            // ★ 배지를 partial 상태로 업데이트 (loadSession에서 이미 프롬프트 표시됨)
            if (APP.prompts && APP.prompts.length > 0) {
                const remaining = (sessionData.resumeState.remainingBatches || [])
                    .reduce((a, b) => a + b.reduce((x, s) => x + s.numPrompts, 0), 0);
                showGeneratedPrompts(APP.prompts, true, APP.prompts.length + remaining);
            }
        }
    } catch (_) { /* session storage 미지원 환경 무시 */ }
}

// ★ 저장된 일시정지 상태 복원
async function restorePausedState() {
    const result = await chrome.storage.local.get(['isPaused', 'pausedMode']);
    if (!result.isPaused) {
        // ★ storage에 일시정지 상태 없으면 버튼도 초기화
        resetPauseButtonUI();
        return;
    }

    // ★ content script에 실제 일시정지 상태인지 확인
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id || !isFlowTabUrl(tab.url)) {
            // flow.google.com 탭이 아니면 저장된 상태 제거
            chrome.storage.local.remove(['isPaused', 'pausedMode']);
            resetPauseButtonUI();
            return;
        }

        // content script에 상태 확인 요청 (3초 타임아웃)
        const response = await Promise.race([
            chrome.tabs.sendMessage(tab.id, { type: 'CHECK_PAUSED_STATE' }),
            new Promise(resolve => setTimeout(() => resolve(null), 3000))
        ]).catch(() => null);

        // content script가 응답하지 않거나 일시정지 상태가 아니면 저장된 상태 제거
        if (!response || !response.isPaused) {
            chrome.storage.local.remove(['isPaused', 'pausedMode']);
            resetPauseButtonUI();
            return;
        }


        if (result.pausedMode === 'factory-video') {
            APP.factory.videoPaused = true;
            APP.factory.isProcessing = false;
            const btn = $('#btn-factory-pause');
            if (btn) {
                btn.textContent = "▶ RESUME";
                btn.classList.remove('btn-secondary');
                btn.classList.add('btn-primary');
            }
        } else {
            APP.isPaused = true;
            const btn = $('#btn-pause');
            if (btn) {
                btn.textContent = "▶ RESUME";
                btn.classList.remove('btn-secondary');
                btn.classList.add('btn-primary');
            }
        }

        // ★ 완료 섹션의 재개 버튼 표시 (일시정지 상태에서 팝업 열었을 때)
        const completionResumeBtn = $('#btn-completion-resume');
        if (completionResumeBtn) {
            completionResumeBtn.classList.remove('hidden');
        }
    } catch (err) {
        chrome.storage.local.remove(['isPaused', 'pausedMode']);
        resetPauseButtonUI();
    }
}

// ★ 일시정지 버튼 UI 초기화 (일시정지 상태로)
function resetPauseButtonUI() {
    const pauseBtn = $('#btn-pause');
    if (pauseBtn) {
        pauseBtn.textContent = "⏸ PAUSE";
        pauseBtn.classList.remove('btn-primary');
        pauseBtn.classList.add('btn-secondary');
    }
    const factoryPauseBtn = $('#btn-factory-pause');
    if (factoryPauseBtn) {
        factoryPauseBtn.textContent = "⏸ PAUSE";
        factoryPauseBtn.classList.remove('btn-primary');
        factoryPauseBtn.classList.add('btn-secondary');
    }
}

// ========== Flow 페이지 안내 모달 ==========
/** flow.google.com 페이지인지 확인 */
function isFlowTabUrl(url) {
    if (!url || typeof url !== 'string') return false;
    return url.includes('flow.google.com');
}

/** Flow 프로젝트/화판 URL인지 확인 (flow.google.com/project/..., /projects/..., /canvas/...) */
function isFlowProjectUrl(url) {
    if (!url || typeof url !== 'string') return false;
    return /flow\.google\.com\/(?:project|projects|canvas)\//i.test(url) ||
           (url.includes('flow.google.com') && url.includes('/project/'));
}

/** 实时检测并更新顶栏 Google Flow 画板连接状态指示条 */
async function updateFlowCanvasStatus() {
    const chip = document.getElementById('flowCanvasStatusChip');
    const textEl = document.getElementById('flowCanvasStatusText');
    if (!chip || !textEl) return;

    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const url = tab?.url || '';
        if (!isFlowTabUrl(url)) {
            chip.className = 'flow-status-chip disconnected';
            textEl.textContent = '未连接 Flow';
            chip.title = '未在当前标签页打开 Flow，点击打开 flow.google.com';
            return;
        }

        let isProject = isFlowProjectUrl(url);
        if (!isProject && tab?.id) {
            try {
                const res = await chrome.tabs.sendMessage(tab.id, { type: 'CHECK_IN_PROJECT' });
                if (res?.inProject) isProject = true;
            } catch (_) {}
        }

        const closedLoopDetail = document.getElementById('closedLoopDetailText');
        if (isProject) {
            const m = url.match(/\/project\/([a-zA-Z0-9_-]+)/);
            const shortId = m ? m[1].slice(0, 8) : '画板中';
            chip.className = 'flow-status-chip connected-project';
            textEl.textContent = `画板已就绪 (${shortId})`;
            chip.title = '已连接 Flow 项目画板：角色定妆图与场景分镜将在同一画板中闭环生成';
            if (closedLoopDetail) {
                closedLoopDetail.textContent = `已锁定 Flow 画板 (${shortId})。分镜将在此画板内连续生成，自动复用画板角色资产，无需跨项目重复上传。`;
            }
        } else {
            chip.className = 'flow-status-chip connected-home';
            textEl.textContent = 'Flow 首页就绪';
            chip.title = '当前位于 Flow 首页，启动任务将自动创建画板并全程闭环';
            if (closedLoopDetail) {
                closedLoopDetail.textContent = '当前位于 Flow 首页。启动任务将自动创建新画板，并在后续生成中全程闭环锁定。';
            }
        }
    } catch (_) {
        chip.className = 'flow-status-chip disconnected';
        textEl.textContent = '检测画板中...';
    }
}

/** Flow 첫 화면 URL (로케일 없음 — 접속 시 사용자 언어로 자동 전환) */
const FLOW_HOME_URL = 'https://flow.google.com/';

/**
 * 탭을 Flow 첫 화면으로 이동하고 로드 완료까지 대기
 * @param {{ id: number }} tab
 * @returns {Promise<boolean>}
 */
async function navigateToFlowHomeAndWait(tab) {
    if (!tab?.id || !isFlowTabUrl(tab.url)) return false;
    try {
        await chrome.tabs.update(tab.id, { url: FLOW_HOME_URL });
        for (let i = 0; i < 40; i++) {
            await new Promise(r => setTimeout(r, 500));
            const updated = await chrome.tabs.get(tab.id);
            if (updated?.status === 'complete' && updated?.url?.includes('flow.google.com')) {
                return true;
            }
        }
    } catch (e) {
    }
    return false;
}

/** 마지막으로 검사한 활성 탭 URL (같은 Flow 내 이동 시 검사 생략용) */
let lastCheckedTabUrl = '';

async function checkFlowTabAndShowModal() {
    const mainScreen = document.getElementById('main-screen');
    const modal = document.getElementById('flow-only-modal');
    updateFlowCanvasStatus().catch(() => {});
    if (!modal || !mainScreen || mainScreen.classList.contains('hidden')) return;
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const url = tab?.url || '';
        lastCheckedTabUrl = url;
        if (isFlowTabUrl(url)) {
            modal.classList.add('hidden');
        } else {
            modal.classList.remove('hidden');
        }
    } catch {
        modal.classList.remove('hidden');
    }
}

function initFlowOnlyModal() {
    const modal = document.getElementById('flow-only-modal');
    const btnOpen = document.getElementById('flow-only-modal-open');
    const btnClose = document.getElementById('flow-only-modal-close');
    if (!modal || !btnOpen || !btnClose) return;

    btnOpen.addEventListener('click', () => {
        chrome.tabs.create({ url: 'https://flow.google.com/' });
        modal.classList.add('hidden');
    });
    btnClose.addEventListener('click', () => {
        modal.classList.add('hidden');
    });

    chrome.tabs.onActivated.addListener(() => {
        checkFlowTabAndShowModal();
        updateFlowCanvasStatus().catch(() => {});
    });
    chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
        if (!changeInfo.url) return;
        chrome.tabs.query({ active: true, currentWindow: true }).then(([active]) => {
            if (!active || active.id !== tabId) return;
            const newUrl = changeInfo.url;
            updateFlowCanvasStatus().catch(() => {});
            if (isFlowTabUrl(lastCheckedTabUrl) && isFlowTabUrl(newUrl)) return; // 같은 Flow 내 이동 → 검사 생략
            checkFlowTabAndShowModal();
        });
    });

    updateFlowCanvasStatus().catch(() => {});
}

// ========== 비디오 생성 전 초기 설정 안내 모달 (Prompt→Video, Image→Video에서만) ==========
function applySetupModalTexts() {
    $('#setup-modal-title').textContent = "Paid Feature";
    $('#setup-modal-desc').textContent = "Flow video generation consumes 20 credits per video.\n2–7 free videos per day per account (varies by account).";
    const step1 = $('#setup-modal-step1');
    const step2 = $('#setup-modal-step2');
    const step3 = $('#setup-modal-step3');
    if (step1) step1.textContent = "Google AI Free: 50–150 credits/day, resets daily (varies by account)";
    if (step2) step2.textContent = "Google AI Pro: 1000 credits/month";
    if (step3) {
        step3.textContent = '';
        step3.style.display = 'none';
    }
    $('#setup-modal-dismiss-label').textContent = "Don't show again";
    $('#setup-modal-confirm').textContent = "CLOSE";
}

function showSetupModal() {
    return new Promise((resolve) => {
        const overlay = $('#setup-modal-overlay');
        const confirmBtn = $('#setup-modal-confirm');
        const dismissCheck = $('#setup-modal-dismiss');
        if (!overlay || !confirmBtn || !dismissCheck) {
            resolve();
            return;
        }
        applySetupModalTexts();
        dismissCheck.checked = false;
        overlay.classList.remove('hidden');

        const handleConfirm = () => {
            if (dismissCheck.checked) {
                chrome.storage.local.set({ setupModalDismissed: true });
            }
            overlay.classList.add('hidden');
            confirmBtn.removeEventListener('click', handleConfirm);
            resolve();
        };

        confirmBtn.addEventListener('click', handleConfirm);
    });
}

function checkAndShowSetupModal() {
    return new Promise((resolve) => {
        chrome.storage.local.get(['setupModalDismissed'], (result) => {
            if (result.setupModalDismissed === true) {
                resolve();
            } else {
                showSetupModal().then(resolve);
            }
        });
    });
}

document.addEventListener('DOMContentLoaded', async () => {
    // ★ v1.1.3: 전역 드래그 차단 — 슬롯 외부에 파일 드롭 시 브라우저 기본 동작(파일 URL 이동) 방지
    //   슬롯 dropzone은 자체 preventDefault로 정상 처리됨 (capture 단계 우선)
    //   슬롯을 빗나가도 메인 탭이 file:// URL로 이동하는 버그 해결
    // ★ v1.1.6 FIX: imageToVideo 의 #dropZone, #imagePreview 도 허용 목록에 추가
    //   이전: 클래스가 'drop-zone'(하이픈)이라 '.slot-dropzone' 매칭 안 됨 → 전역 차단에 걸려 드롭 거부
    //   → 파일 탐색기에서 사이드패널로 이미지 드래그앤드롭 시 동작 안 했음 (버튼은 정상)
    const _ALLOW_DROP_SELECTOR = '.slot-dropzone, #dropZone, #imagePreview';
    window.addEventListener('dragover', (e) => {
        if (!e.target.closest(_ALLOW_DROP_SELECTOR)) {
            e.preventDefault();
            if (e.dataTransfer) e.dataTransfer.dropEffect = 'none';
        }
    });
    window.addEventListener('drop', (e) => {
        if (!e.target.closest(_ALLOW_DROP_SELECTOR)) {
            e.preventDefault();
        }
    });

    APP.lang = 'zh';
    refreshDynamicUi();

    document.getElementById('main-screen').classList.remove('hidden');
    initUpgradeModal();
    initCreditModal();
    initMainApp();
    refreshFactoryBadge(); // UI initialization
});

// ========== TABS ==========
function showWorkflowView() {
    $('#content-settings')?.classList.add('hidden');
    $('#content-control')?.classList.remove('hidden');
    $('.tabs-row')?.classList.remove('hidden');
    $('#btnOpenSettings')?.setAttribute('aria-pressed', 'false');
    document.querySelector('.container')?.scrollTo({ top: 0 });
    // Settings 뷰에서 돌아올 때 Flow 탭 재확인 (flow-only 모달 상태 갱신)
    checkFlowTabAndShowModal();
}

function showSettingsView() {
    $('#content-control')?.classList.add('hidden');
    $('#content-settings')?.classList.remove('hidden');
    $('.tabs-row')?.classList.add('hidden');
    $('#btnOpenSettings')?.setAttribute('aria-pressed', 'true');
    document.querySelector('.container')?.scrollTo({ top: 0 });
}

function initTabs() {
    $('#btnOpenSettings')?.addEventListener('click', showSettingsView);
    $('#btnCloseSettings')?.addEventListener('click', showWorkflowView);
}

// ========== THEME ==========
function initTheme() {
    $$('.theme-ico-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const theme = btn.dataset.theme === 'dark' ? 'dark' : 'light';
            applyTheme(theme);
            APP.settings.theme = theme;
            saveSettings();
        });
    });

    let theme = APP.settings.theme;
    if (theme === 'mint' || theme === 'purple') theme = 'dark';
    if (theme !== 'dark') theme = 'light';
    applyTheme(theme);
    if (theme !== APP.settings.theme) {
        APP.settings.theme = theme;
        saveSettings();
    }
}

function applyTheme(theme) {
    document.body.className = `${theme}-theme`;
    $$('.theme-ico-btn').forEach(b => {
        const on = b.dataset.theme === theme;
        b.classList.toggle('active', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
}

/** Refreshes dynamic UI text/state that depends on app state (mode, settings, key status). */
function refreshDynamicUi() {
    applyPromptInputPlaceholder();
    updateGeminiKeyStatus();
    if (typeof renderUpgradePlan === 'function') renderUpgradePlan();
}

function isCustomStyleId(id) {
    return typeof id === 'string' && id.startsWith('custom_');
}

function normalizeSelectedStyle(id) {
    return isCustomStyleId(id) ? id : '';
}

/** Prompt input textarea placeholder: video-specific copy only in prompt→video mode. */
function applyPromptInputPlaceholder() {
    const el = $('#promptInput');
    if (!el) return;
    const shortcut = getPromptSeparatorShortcutHint();
    const separator = getPromptSeparator();
    el.placeholder = APP.mode === 'textToVideo' ? `在此输入视频运动提示词。\n快捷键: ${shortcut}\n\n第一条视频提示词\n\n${separator}\n第二条视频提示词` : `在此输入提示词（支持批量粘贴）\n快捷键插入分隔符: ${shortcut}`;
    updatePromptSeparatorUi();
}

function isApplePlatform() {
    return /Mac|iPhone|iPad|iPod/i.test(navigator.platform || '');
}

function getPromptSeparatorShortcutLabel() {
    return isApplePlatform() ? '⌘ + ↵' : 'Ctrl + ↵';
}

function getPromptSeparatorShortcutHint() {
    return 'Mac ⌘ + ↵, (Windows/Linux) Ctrl + ↵ add separator.';
}

function normalizePromptSeparator(value, fallback = '###') {
    const normalized = String(value || '').replace(/\r?\n/g, '').trim();
    if (!normalized || normalized.includes('@')) return fallback;
    return normalized;
}

function getPromptSeparator() {
    return normalizePromptSeparator(APP.settings?.promptSeparator || APP.promptSplitterSeparator || '###');
}

function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function updatePromptSeparatorUi() {
    const separator = getPromptSeparator();
    const input = $('#promptSeparatorInput');
    if (input && input.value !== separator) input.value = separator;
    const splitterBtn = $('#btn-prompt-splitter');
    if (splitterBtn) {
        splitterBtn.dataset.tooltip = `Add ${separator} separator at cursor`;
        splitterBtn.setAttribute('aria-label', `Insert ${separator} prompt separator`);
    }
    $$('.prompt-splitter-hint code').forEach(code => {
        code.textContent = separator;
    });
    const shortcutKbd = $('#promptSplitterShortcutKbd');
    if (shortcutKbd) shortcutKbd.textContent = getPromptSeparatorShortcutLabel();
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

const TEXTAREA_MIRROR_PROPS = [
    'boxSizing', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
    'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'fontFamily', 'fontSize',
    'fontWeight', 'fontStyle', 'letterSpacing', 'textTransform', 'wordSpacing', 'lineHeight',
    'textIndent', 'textAlign', 'textRendering', 'whiteSpace', 'wordBreak', 'overflowWrap', 'tabSize'
];

/** Off-screen mirror whose wrapping matches a textarea (including scrollbar-narrowed width). */
function fillTextareaMirror(mirror, textarea) {
    const styles = window.getComputedStyle(textarea);
    TEXTAREA_MIRROR_PROPS.forEach(prop => {
        mirror.style[prop] = styles[prop];
    });
    const borderX = (parseFloat(styles.borderLeftWidth) || 0) + (parseFloat(styles.borderRightWidth) || 0);
    const padX = (parseFloat(styles.paddingLeft) || 0) + (parseFloat(styles.paddingRight) || 0);
    mirror.style.position = 'absolute';
    mirror.style.visibility = 'hidden';
    mirror.style.pointerEvents = 'none';
    mirror.style.overflow = 'hidden';
    mirror.style.whiteSpace = 'pre-wrap';
    mirror.style.overflowWrap = 'break-word';
    mirror.style.height = 'auto';
    mirror.style.top = '0';
    mirror.style.left = '-9999px';
    if ((styles.boxSizing || '') === 'border-box') {
        mirror.style.width = `${textarea.clientWidth + borderX}px`;
    } else {
        mirror.style.width = `${Math.max(0, textarea.clientWidth - padX)}px`;
    }
    return styles;
}

function updatePromptSplitterPosition() {
    const promptInput = $('#promptInput');
    const splitterBtn = $('#btn-prompt-splitter');
    if (!promptInput || !splitterBtn) return;

    const mirror = document.createElement('div');
    const span = document.createElement('span');
    const styles = fillTextareaMirror(mirror, promptInput);

    const caret = promptInput.selectionStart ?? 0;
    mirror.textContent = promptInput.value.slice(0, caret);
    span.textContent = promptInput.value.slice(caret, caret + 1) || '.';
    mirror.appendChild(span);
    document.body.appendChild(mirror);

    const shellRect = promptInput.parentElement.getBoundingClientRect();
    const inputRect = promptInput.getBoundingClientRect();
    const mirrorRect = mirror.getBoundingClientRect();
    const spanRect = span.getBoundingClientRect();
    const caretTop = spanRect.top - mirrorRect.top;
    mirror.remove();

    const lineHeight = Number.parseFloat(styles.lineHeight) || 20;
    const minTop = 12;
    const maxTop = Math.max(minTop, promptInput.clientHeight - 12);
    const inputOffsetTop = inputRect.top - shellRect.top;
    const rawTop = inputOffsetTop + caretTop - promptInput.scrollTop + (lineHeight / 2);
    const nextTop = Math.min(maxTop, Math.max(minTop, rawTop));
    splitterBtn.style.setProperty('--prompt-splitter-top', `${Math.round(nextTop)}px`);
}

function getTextareaCaretMetrics(textarea, caret = textarea.selectionStart ?? 0) {
    const mirror = document.createElement('div');
    const span = document.createElement('span');
    const styles = fillTextareaMirror(mirror, textarea);
    mirror.textContent = textarea.value.slice(0, caret);
    span.textContent = textarea.value.slice(caret, caret + 1) || '.';
    mirror.appendChild(span);
    document.body.appendChild(mirror);
    const caretTop = span.getBoundingClientRect().top - mirror.getBoundingClientRect().top;
    const lineHeight = Number.parseFloat(styles.lineHeight) || 20;
    const paddingBottom = Number.parseFloat(styles.paddingBottom) || 0;
    const paddingTop = Number.parseFloat(styles.paddingTop) || 0;
    mirror.remove();
    return { caretTop, lineHeight, paddingBottom, paddingTop };
}

function scrollTextareaCaretIntoView(textarea) {
    const caret = textarea.selectionStart ?? textarea.value.length;
    const { caretTop, lineHeight, paddingBottom, paddingTop } = getTextareaCaretMetrics(textarea, caret);
    const viewTop = textarea.scrollTop;
    const viewBottom = viewTop + textarea.clientHeight;
    const caretBottom = caretTop + lineHeight;
    const margin = Math.min(lineHeight, 24);

    if (caretBottom + paddingBottom > viewBottom - margin) {
        textarea.scrollTop = caretBottom + paddingBottom + margin - textarea.clientHeight;
    } else if (caretTop < viewTop + paddingTop) {
        textarea.scrollTop = Math.max(0, caretTop - paddingTop);
    }
}

function insertPromptSeparator() {
    const promptInput = $('#promptInput');
    if (!promptInput) return;

    const start = promptInput.selectionStart ?? promptInput.value.length;
    const end = promptInput.selectionEnd ?? start;
    const before = promptInput.value.slice(0, start);
    const after = promptInput.value.slice(end);
    const prefix = before.length === 0 || before.endsWith('\n') ? '' : '\n';
    const insert = `${prefix}${getPromptSeparator()}\n`;

    promptInput.value = `${before}${insert}${after}`;
    const nextCaret = before.length + insert.length;
    promptInput.focus();
    promptInput.setSelectionRange(nextCaret, nextCaret);
    promptInput.dispatchEvent(new Event('input', { bubbles: true }));
    scrollTextareaCaretIntoView(promptInput);
    updatePromptSplitterPosition();
}

function handlePromptInputShortcut(e) {
    const isMac = isApplePlatform();
    const wantsSeparator = e.key === 'Enter' && (isMac ? e.metaKey : e.ctrlKey);
    if (!wantsSeparator) return;
    e.preventDefault();
    insertPromptSeparator();
}

const FLOW_RATIO_META = {
    '16:9': 'Landscape',
    '4:3': 'Classic',
    '1:1': 'Square',
    '3:4': 'Portrait',
    '9:16': 'Vertical'
};

function parseFlowOptionText(text) {
    const clean = String(text || '').trim();
    const parts = clean.split('—').map(part => part.trim());
    return {
        title: parts[0] || clean,
        meta: parts.slice(1).join(' — ')
    };
}

function createFlowRatioIcon(value) {
    const icon = document.createElement('span');
    icon.className = 'flow-ratio-icon';
    icon.setAttribute('aria-hidden', 'true');

    const shape = document.createElement('span');
    shape.className = 'flow-ratio-shape';
    const [wRaw, hRaw] = String(value || '1:1').split(':').map(Number);
    const w = Number.isFinite(wRaw) && wRaw > 0 ? wRaw : 1;
    const h = Number.isFinite(hRaw) && hRaw > 0 ? hRaw : 1;
    const maxW = 22;
    const maxH = 20;
    const scale = Math.min(maxW / w, maxH / h);
    shape.style.width = `${Math.max(8, Math.round(w * scale))}px`;
    shape.style.height = `${Math.max(8, Math.round(h * scale))}px`;

    icon.appendChild(shape);
    return icon;
}

function createFlowModelIcon(value) {
    const icon = document.createElement('span');
    icon.className = 'flow-model-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = /veo/i.test(value) ? 'V' : (/omni/i.test(value) ? 'O' : 'B');
    return icon;
}

function getFlowSelectKind(select) {
    return select?.dataset?.enhanceSelect || 'model';
}

function renderFlowSelectContent(container, select, option) {
    const kind = getFlowSelectKind(select);
    const parsed = parseFlowOptionText(option?.textContent || option?.label || select.value);
    const value = option?.value || select.value;
    const metaText = kind === 'ratio' ? (FLOW_RATIO_META[value] || 'Custom ratio') : (parsed.meta || 'Ready');

    container.innerHTML = '';
    container.appendChild(kind === 'ratio' ? createFlowRatioIcon(value) : createFlowModelIcon(value));

    const main = document.createElement('span');
    main.className = 'flow-select-main';
    const title = document.createElement('span');
    title.className = 'flow-select-title';
    title.textContent = kind === 'ratio' ? value : parsed.title;
    const meta = document.createElement('span');
    meta.className = 'flow-select-meta';
    meta.textContent = metaText;
    main.append(title, meta);
    container.appendChild(main);

}

function closeFlowSelects(except = null) {
    $$('.flow-select').forEach(control => {
        if (control === except) return;
        control.classList.remove('is-open');
        control.querySelector('.flow-select-trigger')?.setAttribute('aria-expanded', 'false');
        control.querySelector('.flow-select-menu')?.classList.add('hidden');
    });
}

function syncEnhancedFlowSelect(select) {
    if (!select) return;
    const control = document.querySelector(`[data-select-target="${select.id}"]`);
    if (!control) return;
    const trigger = control.querySelector('.flow-select-trigger');
    const selectedOption = select.selectedOptions?.[0] || select.querySelector(`option[value="${CSS.escape(select.value)}"]`) || select.options[0];
    if (trigger && selectedOption) renderFlowSelectContent(trigger, select, selectedOption);

    control.querySelectorAll('.flow-select-option').forEach(btn => {
        const option = Array.from(select.options).find(opt => opt.value === btn.dataset.value);
        if (option) renderFlowSelectContent(btn, select, option);
        const isSelected = btn.dataset.value === select.value;
        btn.classList.toggle('is-selected', isSelected);
        btn.setAttribute('aria-selected', isSelected ? 'true' : 'false');
    });
}

function buildEnhancedFlowSelect(select) {
    const control = document.querySelector(`[data-select-target="${select.id}"]`);
    if (!control || control.dataset.enhanced === 'true') return;

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'flow-select-trigger';
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-label', select.labels?.[0]?.textContent || 'Select option');

    const menu = document.createElement('div');
    menu.className = 'flow-select-menu hidden';
    menu.setAttribute('role', 'listbox');

    Array.from(select.options).forEach(option => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'flow-select-option';
        item.dataset.value = option.value;
        item.setAttribute('role', 'option');
        if (option.disabled) {
            item.disabled = true;
            item.classList.add('is-disabled');
        }
        renderFlowSelectContent(item, select, option);
        item.addEventListener('click', () => {
            if (option.disabled) return;
            select.value = option.value;
            select.dispatchEvent(new Event('change', { bubbles: true }));
            closeFlowSelects();
        });
        menu.appendChild(item);
    });

    trigger.addEventListener('click', () => {
        const isOpen = trigger.getAttribute('aria-expanded') === 'true';
        closeFlowSelects(control);
        trigger.setAttribute('aria-expanded', isOpen ? 'false' : 'true');
        menu.classList.toggle('hidden', isOpen);
        control.classList.toggle('is-open', !isOpen);
    });

    trigger.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowDown' && e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        closeFlowSelects(control);
        trigger.setAttribute('aria-expanded', 'true');
        menu.classList.remove('hidden');
        control.classList.add('is-open');
        menu.querySelector('.flow-select-option:not(:disabled)')?.focus();
    });

    menu.addEventListener('keydown', (e) => {
        const options = Array.from(menu.querySelectorAll('.flow-select-option:not(:disabled)'));
        const currentIndex = options.indexOf(document.activeElement);
        if (e.key === 'Escape') {
            closeFlowSelects();
            trigger.focus();
            return;
        }
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
        e.preventDefault();
        const dir = e.key === 'ArrowDown' ? 1 : -1;
        const next = options[(currentIndex + dir + options.length) % options.length] || options[0];
        next?.focus();
    });

    control.append(trigger, menu);
    control.dataset.enhanced = 'true';
    syncEnhancedFlowSelect(select);
}

function refreshEnhancedFlowSelects() {
    $$('[data-enhance-select]').forEach(select => {
        buildEnhancedFlowSelect(select);
        syncEnhancedFlowSelect(select);
    });
}

document.addEventListener('click', (e) => {
    if (e.target.closest?.('.flow-select')) return;
    closeFlowSelects();
});

function syncFlowSettingControls() {
    const activeMode = (APP.mode === 'textToVideo') ? 'textToVideo' : 'textToImage';
    const isVideoMode = activeMode === 'textToVideo';
    $$('[data-prompt-mode]').forEach(btn => {
        const isActive = btn.dataset.promptMode === activeMode;
        btn.classList.toggle('active', isActive);
        btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });

    $$('[data-flow-panel]').forEach(panel => {
        panel.classList.toggle('hidden', panel.dataset.flowPanel !== (isVideoMode ? 'video' : 'image'));
    });

    $$('.mode-card').forEach(card => {
        card.classList.toggle('active', card.dataset.mode === APP.mode);
    });
    if (typeof updatePressedState === 'function') updatePressedState($$('.mode-card'));

    const currentRatio = APP.settings.aspectRatio || '16:9';
    const imageRatioSelect = $('#imageRatioSelect');
    if (imageRatioSelect) imageRatioSelect.value = currentRatio;
    const videoRatioSelect = $('#videoRatioSelect');
    if (videoRatioSelect) {
        videoRatioSelect.value = (currentRatio === '9:16' || currentRatio === '16:9') ? currentRatio : '16:9';
    }

    const currentOutputCount = Math.min(4, Math.max(1, Number(APP.settings.outputCount) || 1));
    $$('.output-count-btn').forEach(btn => {
        const isActive = Number(btn.dataset.outputCount) === currentOutputCount;
        btn.classList.toggle('active', isActive);
        btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });

    const currentImageModel = APP.settings.flowImageModel || 'Nano Banana 2 Lite';
    const imageModelSelect = $('#imageModelSelect');
    if (imageModelSelect) imageModelSelect.value = currentImageModel;

    const currentVideoModel = APP.settings.flowVideoModel || 'Veo 3.1 Lite';
    const VIDEO_MODEL_BASE_CREDITS = { 'Omni 1.1 Flash': 15, 'Veo 3.1 Lite': 10, 'Veo 3.1 Fast': 20, 'Veo 3.1 Quality': 100 };
    const VIDEO_MODEL_LABELS = { 'Omni 1.1 Flash': 'Omni 1.1 Flash', 'Veo 3.1 Lite': 'Veo Lite', 'Veo 3.1 Fast': 'Veo Fast', 'Veo 3.1 Quality': 'Veo Quality' };
    const videoModelSelect = $('#videoModelSelect');
    if (videoModelSelect) {
        $$('#videoModelSelect option[value]').forEach(opt => {
            const baseCredits = VIDEO_MODEL_BASE_CREDITS[opt.value];
            if (baseCredits == null) return;
            const label = VIDEO_MODEL_LABELS[opt.value] || opt.value;
            const lockedSuffix = opt.disabled ? ' (locked)' : '';
            opt.textContent = `${label} — ${baseCredits * currentOutputCount} credits${lockedSuffix}`;
        });
        videoModelSelect.value = currentVideoModel;
    }
    refreshEnhancedFlowSelects();

    const currentDuration = APP.settings.videoDuration || '6s';
    $$('[data-duration]').forEach(btn => {
        const isActive = btn.dataset.duration === currentDuration;
        btn.classList.toggle('active', isActive);
        btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });

    const showOmniDuration = isVideoMode && /omni/i.test(currentVideoModel);
    $$('[data-omni-duration]').forEach(el => el.classList.toggle('hidden', !showOmniDuration));
}

function activateOnKeyboard(el, handler) {
    el.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        handler(e);
    });
}

function getNodeText(el) {
    return (el?.textContent || '').replace(/\s+/g, ' ').trim();
}

function enhanceVisualLabels() {
    $$('.section').forEach((section, index) => {
        const label = section.querySelector('.label');
        const field = section.querySelector('input:not([type="hidden"]), textarea, select');
        if (!label || !field || field.getAttribute('aria-label') || field.getAttribute('aria-labelledby')) return;

        if (label.tagName === 'LABEL') {
            if (field.id && !label.htmlFor) label.htmlFor = field.id;
            return;
        }

        if (!label.id) label.id = `field-label-${index}`;
        field.setAttribute('aria-labelledby', label.id);
    });
}

function updatePressedState(items, activeClass = 'active') {
    items.forEach(item => {
        item.setAttribute('aria-pressed', item.classList.contains(activeClass) ? 'true' : 'false');
    });
}

// ========== MODE CARDS ==========
function initModeCards() {
    $$('.mode-card').forEach(card => {
        const icon = card.querySelector('.mode-icon');
        if (icon) icon.setAttribute('aria-hidden', 'true');
        const label = [
            getNodeText(card.querySelector('.mode-title')),
            getNodeText(card.querySelector('.mode-desc'))
        ].filter(Boolean).join('. ');
        card.setAttribute('role', 'button');
        card.setAttribute('tabindex', card.classList.contains('hidden') ? '-1' : '0');
        card.setAttribute('aria-pressed', card.classList.contains('active') ? 'true' : 'false');
        if (label) card.setAttribute('aria-label', label);

        const selectModeCard = () => {
            // ★ 진행 중인 작업이 있으면 모드 전환 차단 (단, 일시정지 상태에서는 허용)
            const isActivelyRunning = (APP.isRunning && !APP.isPaused) ||
                APP.runningMode ||
                (APP.factory.videoRunning && !APP.isPaused) ||
                APP.factory.isProcessing ||
                APP.isGeneratingPrompts ||
                APP.isGeneratingRefs;
            if (isActivelyRunning) {
                const runningModeName = getModeName(APP.runningMode || (APP.factory.isProcessing ? 'factory' : APP.mode));
                const message = "Task in progress in {mode} mode. Please switch after completion."
                    .replace('{mode}', runningModeName);
                showToast(message, 'warning');
                return;
            }

            $$('.mode-card').forEach(c => c.classList.remove('active'));
            card.classList.add('active');
            updatePressedState($$('.mode-card'));
            APP.mode = card.dataset.mode;
            APP.settings.lastMode = APP.mode;
            saveSettings();
            updateModeUI();
        };

        card.addEventListener('click', selectModeCard);
        activateOnKeyboard(card, selectModeCard);
    });
}

function getModeName(mode) {
    const labels = {
        'factory': 'FACTORY MODE',
        'scriptToImage': 'Script → Image',
        'textToImage': 'Image Generation',
        'textToVideo': 'Text → Video',
        'imageToVideo': 'Video Generation'
    };
    return labels[mode] || mode;
}

function switchStudioStep(stepNumber) {
    const step = parseInt(stepNumber, 10) || 1;
    APP.currentStudioStep = step;

    // Update stepper tabs
    document.querySelectorAll('.studio-pipeline-stepper .stepper-step').forEach(btn => {
        const btnStep = parseInt(btn.dataset.step, 10);
        const isActive = btnStep === step;
        btn.classList.toggle('active', isActive);
        btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });

    const isScriptMode = APP.mode === 'scriptToImage' || APP.mode === 'factory';
    const step1 = document.getElementById('stepContent1');
    const step2 = document.getElementById('stepContent2');
    const step3 = document.getElementById('stepContent3');

    const queueSec = document.getElementById('section-queue');
    const actionsSec = document.getElementById('section-actions');
    const progressSec = document.getElementById('section-progress');
    const completionSec = document.getElementById('section-completion');
    const flowSettingsSec = document.getElementById('section-flow-settings');
    const factoryVideoSec = document.getElementById('section-factory-video');

    const qSlot2 = document.getElementById('queueSlotStep2');
    const qSlot3 = document.getElementById('queueSlotStep3');
    const qSlotDef = document.getElementById('queueDefaultSlot');

    const aSlot3 = document.getElementById('actionsSlotStep3');
    const aSlotDef = document.getElementById('actionsDefaultSlot');

    const pSlot3 = document.getElementById('progressSlotStep3');
    const pSlotDef = document.getElementById('progressDefaultSlot');

    const cSlot3 = document.getElementById('completionSlotStep3');
    const cSlotDef = document.getElementById('completionDefaultSlot');

    const fsSlot2 = document.getElementById('flowSettingsSlotStep2');
    const fsSlotDef = document.getElementById('flowSettingsDefaultSlot');

    const vSlot3 = document.getElementById('videoSlotStep3');
    const vSlotDef = document.getElementById('videoDefaultSlot');

    if (isScriptMode) {
        if (step1) step1.classList.toggle('hidden', step !== 1);
        if (step2) step2.classList.toggle('hidden', step !== 2);
        if (step3) step3.classList.toggle('hidden', step !== 3);

        // Queue placement: in Step 2 for editing, Step 3 for live monitoring
        if (queueSec) {
            if (step === 2 && qSlot2) {
                qSlot2.appendChild(queueSec);
            } else if (step === 3 && qSlot3) {
                qSlot3.appendChild(queueSec);
            }
        }

        // Action Buttons placement (Hero Render Button): only in Step 3
        if (actionsSec) {
            if (step === 3 && aSlot3) {
                aSlot3.appendChild(actionsSec);
                actionsSec.classList.remove('hidden');
            } else {
                actionsSec.classList.add('hidden');
            }
        }

        // Flow Settings placement: in Step 2 for configuring parameters
        if (flowSettingsSec) {
            if (step === 2 && fsSlot2) {
                fsSlot2.appendChild(flowSettingsSec);
                flowSettingsSec.classList.remove('hidden');
            } else {
                flowSettingsSec.classList.add('hidden');
            }
        }

        // Progress & Completion & Video placement in Step 3
        if (progressSec && pSlot3) pSlot3.appendChild(progressSec);
        if (completionSec && cSlot3) cSlot3.appendChild(completionSec);
        if (factoryVideoSec && vSlot3) vSlot3.appendChild(factoryVideoSec);
    } else {
        if (step1) step1.classList.add('hidden');
        if (step2) step2.classList.add('hidden');
        if (step3) step3.classList.add('hidden');

        if (queueSec && qSlotDef) qSlotDef.appendChild(queueSec);
        if (actionsSec && aSlotDef) {
            aSlotDef.appendChild(actionsSec);
            actionsSec.classList.remove('hidden');
        }
        if (flowSettingsSec && fsSlotDef) {
            fsSlotDef.appendChild(flowSettingsSec);
            flowSettingsSec.classList.remove('hidden');
        }
        if (progressSec && pSlotDef) pSlotDef.appendChild(progressSec);
        if (completionSec && cSlotDef) cSlotDef.appendChild(completionSec);
        if (factoryVideoSec && vSlotDef) vSlotDef.appendChild(factoryVideoSec);
    }
}
window.switchStudioStep = switchStudioStep;

function updateModeUI() {
    // 同步顶层工作室导航按钮高亮状态 (Flow Studio Pro)
    $$('.studio-tab-btn').forEach(btn => {
        const sm = btn.dataset.studioMode;
        const isMatched = (APP.mode === sm) || (sm === 'textToImage' && (APP.mode === 'textToVideo' || APP.mode === 'imageToVideo'));
        btn.classList.toggle('active', isMatched);
        btn.setAttribute('aria-selected', isMatched ? 'true' : 'false');
    });

    // ★ 步骤条显示逻辑
    const stepper = document.getElementById('studioPipelineStepper');
    if (APP.mode === 'scriptToImage' || APP.mode === 'factory') {
        stepper?.classList.remove('hidden');
        switchStudioStep(APP.currentStudioStep || 1);
    } else {
        stepper?.classList.add('hidden');
        switchStudioStep(1);
    }

    // ★ P2I v1.6: input-styleImage 제거 (중복 UI 삭제). 설정 탭 스타일 자동 연동
    const inputs = ['input-scriptToImage', 'input-textPrompt', 'input-imageToVideo'];
    inputs.forEach(id => $(`#${id}`)?.classList.add('hidden'));

    // 이전 모드에서 남은 생성 결과 섹션 숨기기 (다른 모드일 때만)
    const isScriptMode = APP.mode === 'scriptToImage' || APP.mode === 'factory';
    if (!isScriptMode) {
        $('#charRefsSection')?.classList.add('hidden');
        $('#generatedPromptsSection')?.classList.add('hidden');
    }

    // ★ 다른 모드에서 진행 중인 작업이 있으면 해당 모드의 UI 숨김 (모드 독립성)
    if (APP.runningMode && APP.runningMode !== APP.mode) {
        $('#section-progress')?.classList.add('hidden');
        $('#section-completion')?.classList.add('hidden');
        $('#controlButtons')?.classList.add('hidden');
    }

    switch (APP.mode) {
        case 'scriptToImage':
            $('#input-scriptToImage')?.classList.remove('hidden');
            $('#btn-full-auto')?.classList.add('hidden');
            if (APP.characterRefs && APP.characterRefs.length > 0) {
                $('#charRefsSection')?.classList.remove('hidden');
                renderCharacterRefs(APP.characterRefs);
            }
            if (APP.prompts && APP.prompts.length > 0) {
                $('#generatedPromptsSection')?.classList.remove('hidden');
                showGeneratedPrompts(APP.prompts, !!APP.resumeState);
            }
            if (APP.queue && APP.queue.length > 0) {
                $('#section-queue')?.classList.remove('hidden');
                showQueue();
            }
            break;
        case 'textToImage':
            $('#input-textPrompt')?.classList.remove('hidden');
            // ★ P2I v1.6: 중복 스타일 UI 제거됨. 설정 탭의 selectedStyle 을 자동 사용.
            //   APP.styleImage 동기화는 설정 스타일 변경 시 applyStyleSelection()에서 처리됨.
            (() => {
                if (APP.settings?.selectedStyle && !APP.styleImage) {
                    const val = APP.settings.selectedStyle;
                    if (isCustomStyleId(val)) {
                        const style = APP.customStyles?.find(s => s.id === val);
                        if (style) APP.styleImage = { base64: style.imageData, name: style.name };
                    }
                }
            })();
            // ★ 모드 복귀 시 기존 데이터가 있으면 UI 복원
            if (APP.queue && APP.queue.length > 0) {
                $('#section-queue')?.classList.remove('hidden');
                showQueue();
            }
            break;
        case 'textToVideo':
            $('#input-textPrompt')?.classList.remove('hidden');
            // ★ 모드 복귀 시 기존 데이터가 있으면 UI 복원
            if (APP.queue && APP.queue.length > 0) {
                $('#section-queue')?.classList.remove('hidden');
                showQueue();
            }
            break;
        case 'imageToVideo':
            $('#input-imageToVideo')?.classList.remove('hidden');
            // ★ 모드 복귀 시 기존 데이터가 있으면 UI 복원
            if (APP.queue && APP.queue.length > 0) {
                $('#section-queue')?.classList.remove('hidden');
                showQueue();
            }
            break;
        case 'factory':
            // FACTORY 모드: scriptToImage와 동일한 UI + 추가 비디오 섹션
            $('#input-scriptToImage')?.classList.remove('hidden');
            // ★ 대본투이미지: 스타일 참조 이미지/스타일 선택 UI 미표시 (설정 탭 스타일 사용)
            $('#btn-full-auto')?.classList.remove('hidden');  // ★ FACTORY 모드에서 FULL AUTO 표시
            refreshFactoryBadge(); // ★ 팩토리 모드 진입 시 권한 및 카운트 배지 갱신
            // ★ 모드 복귀 시 기존 데이터가 있으면 UI 복원
            if (APP.characterRefs && APP.characterRefs.length > 0) {
                $('#charRefsSection')?.classList.remove('hidden');
                renderCharacterRefs(APP.characterRefs);
            }
            if (APP.prompts && APP.prompts.length > 0) {
                $('#generatedPromptsSection')?.classList.remove('hidden');
                showGeneratedPrompts(APP.prompts, !!APP.resumeState);
            }
            if (APP.queue && APP.queue.length > 0) {
                $('#section-queue')?.classList.remove('hidden');
                showQueue();
            }
            // ★ Factory 비디오 섹션 복원
            if (APP.factory.imageGenerationComplete) {
                $('#section-factory-video')?.classList.remove('hidden');
            }
            if (APP.factory.videoQueue && APP.factory.videoQueue.length > 0) {
                $('#factoryVideoList')?.classList.remove('hidden');
                $('#factoryVideoActions')?.classList.remove('hidden');
                $('#generatedVideoPromptsSection')?.classList.remove('hidden');
                updateGeneratedVideoPromptsText();
                renderVideoPromptList();
            }
            if (APP.factory.videoGenerationComplete) {
                $('#factoryVideoCompletion')?.classList.remove('hidden');
            }
            break;
    }
    if (APP.imageFiles && APP.imageFiles.length > 0) {
        renderImagePreview();
    }
    applyPromptInputPlaceholder();
    syncFlowSettingControls();
    updateControlStyleDisplay();
    updateStartButtonState();
    updateFactoryModeUI();
}

/**
 * FACTORY 모드 UI 업데이트
 */
function updateFactoryModeUI() {
    const factoryVideoSection = $('#section-factory-video');

    // FACTORY 모드가 아니면 비디오 섹션 숨김
    if (APP.mode !== 'factory') {
        factoryVideoSection?.classList.add('hidden');
        return;
    }

    // FACTORY 모드: 이미지 생성 완료 후에만 비디오 섹션 표시
    // (onFactoryImageGenerationComplete에서 처리)
}

function updateStartButtonState() {
    const btn = $('#btn-start-generation');
    const factoryButtons = $('#factoryButtons');

    // FACTORY 모드: 분할 버튼 표시
    if (APP.mode === 'factory') {
        btn?.classList.add('hidden');
        factoryButtons?.classList.remove('hidden');

        // FACTORY 버튼 상태 업데이트
        const hasPrompts = APP.prompts && APP.prompts.length > 0;
        const btnStart = $('#btn-factory-start');
        const btnAuto = $('#btn-factory-auto');
        if (btnStart) {
            btnStart.disabled = !hasPrompts;
            btnStart.style.opacity = hasPrompts ? '1' : '0.5';
        }
        if (btnAuto) {
            btnAuto.disabled = !hasPrompts;
            btnAuto.style.opacity = hasPrompts ? '1' : '0.5';
        }
        return;
    }

    // 기존 모드: 기본 버튼 표시
    btn?.classList.remove('hidden');
    factoryButtons?.classList.add('hidden');

    if (!btn) return;

    if (APP.mode === 'scriptToImage') {
        const hasPrompts = APP.prompts && APP.prompts.length > 0;
        btn.disabled = !hasPrompts;
        btn.style.opacity = hasPrompts ? '1' : '0.5';
    } else if (APP.mode === 'textToImage' || APP.mode === 'textToVideo') {
        const hasPromptText = !!($('#promptInput')?.value || '').trim();
        btn.disabled = !hasPromptText;
        btn.style.opacity = hasPromptText ? '1' : '0.5';
    } else {
        btn.disabled = false;
        btn.style.opacity = '1';
    }

    const isVideo = APP.mode === 'textToVideo' || APP.mode === 'imageToVideo';
    if (APP.mode === 'imageToVideo') {
        if (APP.videoQueueConfirmed) setStartButtonContent(btn, true);
        else btn.textContent = '预览并分配素材';
        return;
    }
    setStartButtonContent(btn, isVideo);
}

function setStartButtonContent(btn, isVideo) {
    if (!btn) return;
    btn.innerHTML = `
        <span class="prompt-flow-icon ${isVideo ? 'prompt-flow-icon-video' : 'prompt-flow-icon-image'}" aria-hidden="true"></span>
        <span>开始批量生成</span>
    `;
}

/** 설정에서 선택한 커스텀 스타일 기준으로 제어 탭 "현재 스타일" 표시 */
function updateControlStyleDisplay() {
    const thumb = $('#controlStyleThumb');
    const nameEl = $('#controlStyleName');
    const controlSelect = $('#controlStyleSelect');
    if (!thumb || !nameEl) return;

    const styleId = normalizeSelectedStyle(APP.settings.selectedStyle);

    if (controlSelect && Array.from(controlSelect.options).some(o => o.value === styleId)) {
        controlSelect.value = styleId;
    } else if (controlSelect) {
        controlSelect.value = styleId;
    }

    if (isCustomStyleId(styleId)) {
        const style = APP.customStyles.find(s => s.id === styleId);
        if (style) {
            thumb.innerHTML = `<img src="${style.imageData}" alt="${style.name}">`;
            nameEl.textContent = style.name;
            return;
        }
    }

    thumb.innerHTML = '';
    nameEl.textContent = "None (No Style Applied)";
}

// ========== INPUT HANDLERS ==========
let _draggedImageIdx = null;  // 이미지 프리뷰 드래그 순서 변경용

function initInputHandlers() {
    // Drop Zone
    const dropZone = $('#dropZone');
    const folderInput = $('#folderInput');
    const imageInput = $('#imageInput');

    const imageUploadSection = $('#section-upload-assets');

    if (dropZone) {
        dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropZone.classList.add('dragover');
        });
        dropZone.addEventListener('dragleave', () => {
            dropZone.classList.remove('dragover');
        });
        dropZone.addEventListener('drop', async (e) => {
            e.preventDefault();
            dropZone.classList.remove('dragover');
            setDropZoneLoading(true);
            try {
                const files = await extractFilesFromDrop(e.dataTransfer);
                const resolved = files.length > 0 ? files : Array.from(e.dataTransfer.files);
                if (APP.imageFiles && APP.imageFiles.length > 0) {
                    appendImageFiles(resolved);
                } else {
                    handleImageFiles(resolved);
                }
            } finally {
                setDropZoneLoading(false);
            }
        });
        dropZone.addEventListener('click', () => {
            imageInput?.click();
        });
        dropZone.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                imageInput?.click();
            }
        });
    }

    const previewGrid = $('#imagePreview');
    if (previewGrid && imageUploadSection) {
        const addDropBehavior = (el) => {
            el.addEventListener('dragover', (e) => {
                // 내부 이미지 드래그 중이면 무시 (순서 변경 처리)
                if (_draggedImageIdx !== null) return;
                e.preventDefault();
                e.stopPropagation();
                dropZone?.classList.add('dragover');
            });
            el.addEventListener('dragleave', (e) => {
                if (_draggedImageIdx !== null) return;
                e.stopPropagation();
                dropZone?.classList.remove('dragover');
            });
            el.addEventListener('drop', async (e) => {
                // 내부 이미지 드래그 중이면 무시 (순서 변경 처리)
                if (_draggedImageIdx !== null) return;
                e.preventDefault();
                e.stopPropagation();
                dropZone?.classList.remove('dragover');
                setDropZoneLoading(true);
                try {
                    const files = await extractFilesFromDrop(e.dataTransfer);
                    const resolved = files.length > 0 ? files : Array.from(e.dataTransfer.files);
                    if (APP.imageFiles && APP.imageFiles.length > 0) {
                        appendImageFiles(resolved);
                    } else {
                        handleImageFiles(resolved);
                    }
                } finally {
                    setDropZoneLoading(false);
                }
            });
        };
        addDropBehavior(previewGrid);
    }

    const btnUploadFolder = $('#btnUploadFolder');

    if (btnUploadFolder) {
        btnUploadFolder.addEventListener('click', (e) => {
            e.preventDefault();
            folderInput?.click();
        });
    }

    if (folderInput) {
        folderInput.addEventListener('change', (e) => {
            const files = e.target.files;
            if (APP.imageFiles && APP.imageFiles.length > 0) {
                appendImageFiles(files);
            } else {
                handleImageFiles(files);
            }
            folderInput.value = '';
        });
    }
    if (imageInput) {
        imageInput.addEventListener('change', (e) => {
            const files = e.target.files;
            // Always append when assets already exist (no separate + ADD button)
            if (APP.imageFiles && APP.imageFiles.length > 0) {
                appendImageFiles(files);
            } else {
                handleImageFiles(files);
            }
            imageInput.value = '';
        });
    }

    const clearImagesBtn = $('#clearImagesBtn');
    if (clearImagesBtn) {
        clearImagesBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const n = APP.imageFiles.length;
            if (n > 0 && !confirm(`Delete all ${n} uploaded image${n === 1 ? '' : 's'}? This cannot be undone.`)) return;
            APP.imageFiles = [];
            APP.assetNames = {};
            closeAssetMentionMenu();
            APP.videoQueueConfirmed = false;
            _previewUrls.forEach(u => URL.revokeObjectURL(u));
            _previewUrls = [];
            const preview = $('#imagePreview');
            if (preview) preview.innerHTML = '';
            clearImagesBtn.classList.add('hidden');
            updateUploadAssetsUI();
            // Keep prompts; only clear asset assignments
            if (APP.mode === 'imageToVideo' && APP.queue.length > 0) {
                APP.queue.forEach(item => clearI2vAssetAssignment(item));
                showQueue();
            }
            closeI2vAssetPicker();
            updateStartButtonState();
            showToast("所有素材图片已清空");
        });
    }

    const clearPromptBtn = $('#clearPromptBtn');
    const videoPromptInput = $('#videoPromptInput');
    if (clearPromptBtn && videoPromptInput) {
        videoPromptInput.addEventListener('input', () => {
            clearPromptBtn.classList.toggle('hidden', !videoPromptInput.value.trim());
            APP.videoQueueConfirmed = false;
            updateStartButtonState();
        });
        clearPromptBtn.addEventListener('click', () => {
            videoPromptInput.value = '';
            clearPromptBtn.classList.add('hidden');
            APP.videoQueueConfirmed = false;
            if (APP.mode === 'imageToVideo') {
                APP.queue = [];
                closeI2vAssetPicker();
                showQueue();
                $('#section-queue')?.classList.add('hidden');
            }
            updateStartButtonState();
        });
    }

    $('#btnPreviewI2vPrompts')?.addEventListener('click', () => {
        previewImageToVideoQueue();
    });

    initI2vAssetPicker();
}

const MAX_IMAGE_FILES = 90;

async function extractFilesFromDrop(dataTransfer) {
    const files = [];
    const items = dataTransfer.items;
    if (!items) return files;

    const entries = [];
    for (let i = 0; i < items.length; i++) {
        const entry = items[i].webkitGetAsEntry?.() || items[i].getAsEntry?.();
        if (entry) entries.push(entry);
    }

    async function readEntry(entry) {
        if (entry.isFile) {
            return new Promise((resolve) => {
                entry.file(f => {
                    if (f.type.startsWith('image/')) files.push(f);
                    resolve();
                }, () => resolve());
            });
        } else if (entry.isDirectory) {
            const reader = entry.createReader();
            const readBatch = () => new Promise((resolve) => {
                reader.readEntries(async (entries) => {
                    if (entries.length === 0) { resolve(); return; }
                    for (const e of entries) await readEntry(e);
                    await readBatch();
                    resolve();
                }, () => resolve());
            });
            await readBatch();
        }
    }

    for (const entry of entries) await readEntry(entry);
    return files;
}

function extractSceneNumber(filename) {
    const m = filename.match(/^(?:S(?:cene)?)(\d+)/i) || filename.match(/^(\d+)/);
    return m ? parseInt(m[1], 10) : null;
}

function extractSceneNumberRaw(filename) {
    const m = filename.match(/^(?:S(?:cene)?)(\d+)/i) || filename.match(/^(\d+)/);
    return m ? m[1] : null;
}

function isCharacterImage(filename) {
    return /character/i.test(filename);
}

function handleImageFiles(files) {
    let imageFiles = Array.from(files).filter(f =>
        f.type.startsWith('image/')
    );

    if (imageFiles.length === 0) {
        showToast("未检测到图片文件。请选择包含图片的文件夹或拖入图片文件上传。", 'error');
        return;
    }

    imageFiles.sort((a, b) => {
        const numA = extractSceneNumber(a.name) ?? Infinity;
        const numB = extractSceneNumber(b.name) ?? Infinity;
        return numA - numB || a.name.localeCompare(b.name);
    });

    const seen = new Set();
    const dedupedFiles = imageFiles.filter(f => {
        if (seen.has(f.name)) return false;
        seen.add(f.name);
        return true;
    });
    const dupSkipped = imageFiles.length - dedupedFiles.length;

    if (dedupedFiles.length > MAX_IMAGE_FILES) {
        showToast("最多支持上传 90 张图片，超出部分将被自动忽略。", 'error');
        dedupedFiles.splice(MAX_IMAGE_FILES);
    }

    APP.imageFiles = dedupedFiles;
    APP.videoQueueConfirmed = false;

    rematerializeI2vAssetUrls();
    if (APP.mode === 'imageToVideo' && APP.queue.length > 0) {
        autoAssignI2vAssets({ onlyEmpty: true });
        showQueue();
    }

    renderImagePreview();
    updateStartButtonState();

    let msg = `${dedupedFiles.length} ${" images loaded"}`;
    const details = [];
    if (dupSkipped > 0) {
        details.push(`${dupSkipped} duplicates excluded`);
    }
    if (details.length > 0) {
        msg += ` (${details.join(', ')})`;
    }
    showToast(msg);
}

function appendImageFiles(files) {
    const newFiles = Array.from(files).filter(f => f.type.startsWith('image/'));

    if (newFiles.length === 0) {
        showToast("No images to add. Solution: Select a folder that contains images or choose image files.", 'error');
        return;
    }

    const existingNames = new Set(APP.imageFiles.map(f => f.name));
    let added = 0;

    for (const f of newFiles) {
        if (existingNames.has(f.name)) continue;
        if (APP.imageFiles.length >= MAX_IMAGE_FILES) break;
        APP.imageFiles.push(f);
        added++;
    }

    APP.videoQueueConfirmed = false;
    rematerializeI2vAssetUrls();
    if (APP.mode === 'imageToVideo' && APP.queue.length > 0) {
        autoAssignI2vAssets({ onlyEmpty: true });
        showQueue();
    }

    renderImagePreview();
    updateStartButtonState();
    showToast(added + " images added (total " + APP.imageFiles.length + ")");
}

// ========== ASSET NAMING + @MENTION ==========
// Custom names are stored in APP.assetNames keyed by file.name (unique within the pool,
// since uploads are de-duplicated by filename). Keying by name means we never have to
// re-index on reorder/removal — the map just follows the file.

/** Default name for an asset = filename without extension. */
function assetDefaultName(filename) {
    return String(filename || '').replace(/\.[^.]+$/, '').trim() || 'asset';
}

/** Slugify a name into a mention token body: lowercase, spaces→_, drop @ and whitespace runs. */
function slugifyAssetName(s) {
    return String(s || '')
        .trim()
        .toLowerCase()
        .replace(/[@\s]+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '');
}

/** Effective display name for asset at pool index. */
function getAssetName(idx) {
    const file = APP.imageFiles[idx];
    if (!file) return '';
    const custom = APP.assetNames?.[file.name];
    return (custom && custom.trim()) ? custom.trim() : assetDefaultName(file.name);
}

/** Mention token a user types to reference this asset, e.g. "@hero". */
function getAssetToken(idx) {
    const slug = slugifyAssetName(getAssetName(idx));
    return slug ? '@' + slug : '';
}

/** Filename used when uploading this asset into Flow (exact user-given name + .jpg). */
function getAssetUploadFilename(idx) {
    const name = getAssetName(idx);
    const safe = String(name || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim() || `asset_${idx + 1}`;
    const base = safe.replace(/\.(jpe?g|png|webp|gif)$/i, '');
    return `${base}.jpg`;
}

/** Set/clear a custom name for the asset at pool index. */
function setAssetName(idx, name) {
    const file = APP.imageFiles[idx];
    if (!file) return;
    APP.assetNames = APP.assetNames || {};
    const clean = String(name || '').trim();
    if (!clean) delete APP.assetNames[file.name];
    else APP.assetNames[file.name] = clean;
}

/** Other asset indices whose @mention slug collides with this one's (buildAssetTokenMap only
 *  keeps the last writer, so a collision silently makes an earlier asset unmentionable — this
 *  lets the UI warn about it instead). Empty array if the asset is unnamed or has no collision. */
function findDuplicateAssetIndices(idx) {
    const slug = slugifyAssetName(getAssetName(idx));
    if (!slug) return [];
    const dupes = [];
    for (let i = 0; i < APP.imageFiles.length; i++) {
        if (i !== idx && slugifyAssetName(getAssetName(i)) === slug) dupes.push(i);
    }
    return dupes;
}

/** Characters allowed inside a mention token body (kept in sync with slugifyAssetName's output). */
const MENTION_TOKEN_BODY_SRC = '[^\\s@,.;:!?()\\[\\]{}"\']+';
/** Matches a complete "@token" anywhere in text. */
const MENTION_TOKEN_RE = new RegExp('@(' + MENTION_TOKEN_BODY_SRC + ')', 'g');
/** Matches an in-progress "@token" being typed right at the cursor (same boundary chars as
 *  MENTION_TOKEN_RE, so the autocomplete popup and the final resolved highlight never disagree
 *  about where a mention starts/ends). */
const MENTION_TRIGGER_RE = new RegExp('@(' + MENTION_TOKEN_BODY_SRC.replace('+', '*') + ')$');

/** Map of mention-slug → pool index for all current assets (last one wins on collision). */
function buildAssetTokenMap() {
    const map = {};
    for (let i = 0; i < APP.imageFiles.length; i++) {
        const slug = slugifyAssetName(getAssetName(i));
        if (slug) map[slug] = i;
    }
    return map;
}

/** Exact-match a typed mention body against the token map. Intentionally no fuzzy/prefix
 *  matching: a near-miss like "@herobag" must never silently resolve to an asset named "hero". */
function matchAssetSlug(map, rawBody) {
    const raw = slugifyAssetName(rawBody);
    return map[raw] != null ? raw : null;
}

/** Resolve @mentions in text → ordered unique array of pool indices they point to. */
function resolveMentionsToIndices(text) {
    if (!text) return [];
    const map = buildAssetTokenMap();
    if (!Object.keys(map).length) return [];
    const out = [];
    const seen = new Set();
    const re = new RegExp(MENTION_TOKEN_RE.source, 'g');
    let m;
    while ((m = re.exec(text)) !== null) {
        const matched = matchAssetSlug(map, m[1]);
        if (matched != null && !seen.has(map[matched])) {
            seen.add(map[matched]);
            out.push(map[matched]);
        }
    }
    return out;
}

/** Replace "@token" markers with the plain asset name so the model gets clean prose. */
function stripMentionMarkers(text) {
    if (!text || text.indexOf('@') === -1) return text || '';
    const map = buildAssetTokenMap();
    if (!Object.keys(map).length) return text;
    const re = new RegExp(MENTION_TOKEN_RE.source, 'g');
    return text.replace(re, (full, body) => {
        const matched = matchAssetSlug(map, body);
        if (matched == null) return full;
        return getAssetName(map[matched]);
    });
}

/** Keep @mentions, rewritten to the exact uploaded asset name (e.g. "@mohammad"). */
function rewriteMentionsToFlowRefs(text) {
    if (!text || text.indexOf('@') === -1) return text || '';
    const map = buildAssetTokenMap();
    if (!Object.keys(map).length) return text;
    const re = new RegExp(MENTION_TOKEN_RE.source, 'g');
    return text.replace(re, (full, body) => {
        const matched = matchAssetSlug(map, body);
        if (matched == null) return full;
        const stem = String(getAssetName(map[matched]) || '').replace(/\.(jpe?g|png|webp|gif)$/i, '').trim();
        return stem ? '@' + stem : full;
    });
}

/** Split a prompt into text + ref segments so Flow @-chips land where the user mentioned them. */
function buildPromptRefSegments(text) {
    const source = String(text || '');
    if (!source) return [];
    const map = buildAssetTokenMap();
    if (!Object.keys(map).length) return [{ type: 'text', value: source }];
    const re = new RegExp(MENTION_TOKEN_RE.source, 'g');
    const segments = [];
    let last = 0;
    let m;
    while ((m = re.exec(source)) !== null) {
        const matched = matchAssetSlug(map, m[1]);
        if (matched == null) continue;
        if (m.index > last) segments.push({ type: 'text', value: source.slice(last, m.index) });
        const stem = String(getAssetName(map[matched]) || '').replace(/\.(jpe?g|png|webp|gif)$/i, '').trim();
        segments.push({
            type: 'ref',
            name: getAssetUploadFilename(map[matched]),
            query: stem || m[1]
        });
        last = m.index + m[0].length;
    }
    if (last < source.length) segments.push({ type: 'text', value: source.slice(last) });
    if (!segments.length) segments.push({ type: 'text', value: source });
    return segments;
}

// ---------- @mention autocomplete for prompt textareas ----------
let _lastPromptTextarea = null;
let _mentionMenuEl = null;
let _mentionState = { textarea: null, start: -1, end: -1, items: [], active: 0, anchorRect: null };

function _ensureMentionMenu() {
    if (_mentionMenuEl) return _mentionMenuEl;
    const el = document.createElement('div');
    el.id = 'assetMentionMenu';
    el.className = 'asset-mention-menu hidden';
    el.setAttribute('role', 'listbox');
    document.body.appendChild(el);
    // Keep focus on the textarea; act on mousedown before blur.
    el.addEventListener('mousedown', (e) => {
        const item = e.target.closest('[data-mention-idx]');
        if (!item) return;
        e.preventDefault();
        _applyMentionChoice(parseInt(item.dataset.mentionIdx, 10));
    });
    _mentionMenuEl = el;
    return el;
}

function closeAssetMentionMenu() {
    if (_mentionMenuEl) _mentionMenuEl.classList.add('hidden');
    _mentionState.textarea = null;
    _mentionState.start = -1;
    _mentionState.end = -1;
    _mentionState.items = [];
    _mentionState.active = 0;
    _mentionState.anchorRect = null;
}

function _mentionMatches(query) {
    const q = slugifyAssetName(query);
    const items = [];
    for (let i = 0; i < APP.imageFiles.length; i++) {
        const slug = slugifyAssetName(getAssetName(i));
        if (!slug) continue;
        if (!q || slug.includes(q)) items.push(i);
    }
    return items;
}

function _renderMentionMenu() {
    const el = _ensureMentionMenu();
    const { items, active, textarea } = _mentionState;
    if (!items.length || !textarea) { closeAssetMentionMenu(); return; }
    el.innerHTML = items.map((assetIdx, i) => {
        const url = _previewUrls[assetIdx] || '';
        const name = getAssetName(assetIdx);
        const token = getAssetToken(assetIdx);
        const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
        return `<div class="asset-mention-item${i === active ? ' active' : ''}" role="option" data-mention-idx="${assetIdx}">
            ${url ? `<img src="${url}" alt="">` : '<span class="asset-mention-noimg">?</span>'}
            <span class="asset-mention-name">${esc(name)}</span>
            <span class="asset-mention-token">${esc(token)}</span>
        </div>`;
    }).join('');
    // Position near the active mention mark, or under the textarea while typing.
    const r = _mentionState.anchorRect || textarea.getBoundingClientRect();
    const textareaRect = textarea.getBoundingClientRect();
    const maxW = Math.min(textareaRect.width, 320);
    el.style.left = Math.round(r.left) + 'px';
    el.style.top = Math.round(r.bottom + 4) + 'px';
    el.style.width = Math.round(maxW) + 'px';
    el.classList.remove('hidden');
}

function _updateMentionForTextarea(textarea) {
    if (!textarea || !APP.imageFiles.length) { closeAssetMentionMenu(); return; }
    const caret = textarea.selectionStart;
    const before = textarea.value.slice(0, caret);
    const m = before.match(MENTION_TRIGGER_RE);
    if (!m) { closeAssetMentionMenu(); return; }
    const items = _mentionMatches(m[1]);
    if (!items.length) { closeAssetMentionMenu(); return; }
    _mentionState = { textarea, start: caret - m[0].length, end: caret, items, active: 0, anchorRect: null };
    _renderMentionMenu();
}

function _applyMentionChoice(assetIdx) {
    const { textarea, start } = _mentionState;
    if (!textarea || start < 0) return;
    const token = getAssetToken(assetIdx);
    if (!token) { closeAssetMentionMenu(); return; }
    const caret = _mentionState.end >= start ? _mentionState.end : textarea.selectionStart;
    const value = textarea.value;
    const insert = token + ' ';
    textarea.value = value.slice(0, start) + insert + value.slice(caret);
    const newCaret = start + insert.length;
    textarea.setSelectionRange(newCaret, newCaret);
    closeAssetMentionMenu();
    textarea.focus();
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

function getResolvedMentionRanges(text) {
    const source = String(text || '');
    if (!source || source.indexOf('@') === -1) return [];
    const map = buildAssetTokenMap();
    if (!Object.keys(map).length) return [];

    const ranges = [];
    const re = new RegExp(MENTION_TOKEN_RE.source, 'g');
    let m;
    while ((m = re.exec(source)) !== null) {
        const matched = matchAssetSlug(map, m[1]);
        if (matched == null) continue;
        ranges.push({
            start: m.index,
            end: m.index + m[0].length,
            text: m[0],
            assetIdx: map[matched],
            name: getAssetName(map[matched])
        });
    }
    return ranges;
}

/** Every prompt textarea that gets the live @mention highlight overlay. Both boxes share the
 *  exact same overlay/marker behavior so a mention resolves identically wherever it's typed. */
const MENTION_HIGHLIGHT_PAIRS = [
    { textareaId: 'promptInput', overlayId: 'promptMentionHighlights' },
    { textareaId: 'videoPromptInput', overlayId: 'i2vMentionHighlights' }
];

function renderPromptMentionHighlights() {
    MENTION_HIGHLIGHT_PAIRS.forEach(({ textareaId, overlayId }) => {
        renderMentionHighlightsFor($('#' + textareaId), $('#' + overlayId));
    });
}

function measureTextareaRangeRects(textarea, ranges) {
    if (!textarea || !ranges.length) return [];
    const mirror = document.createElement('div');
    fillTextareaMirror(mirror, textarea);
    const value = textarea.value || '';
    let last = 0;
    const spans = [];
    ranges.forEach(range => {
        if (range.start > last) {
            mirror.appendChild(document.createTextNode(value.slice(last, range.start)));
        }
        const span = document.createElement('span');
        span.textContent = value.slice(range.start, range.end);
        mirror.appendChild(span);
        spans.push(span);
        last = range.end;
    });
    document.body.appendChild(mirror);
    const origin = mirror.getBoundingClientRect();
    const styles = window.getComputedStyle(textarea);
    const borderLeft = parseFloat(styles.borderLeftWidth) || 0;
    const borderTop = parseFloat(styles.borderTopWidth) || 0;
    const rects = spans.map(span => {
        const r = span.getBoundingClientRect();
        return {
            top: r.top - origin.top - borderTop,
            left: r.left - origin.left - borderLeft,
            width: r.width,
            height: r.height
        };
    });
    mirror.remove();
    return rects;
}

function renderMentionHighlightsFor(textarea, overlay) {
    if (!textarea || !overlay) return;

    const ranges = getResolvedMentionRanges(textarea.value || '');
    overlay.replaceChildren();
    const taStyle = window.getComputedStyle(textarea);
    const borderLeft = parseFloat(taStyle.borderLeftWidth) || 0;
    const borderTop = parseFloat(taStyle.borderTopWidth) || 0;
    overlay.style.top = `${textarea.offsetTop + borderTop}px`;
    overlay.style.left = `${textarea.offsetLeft + borderLeft}px`;
    overlay.style.width = `${textarea.clientWidth}px`;
    overlay.style.height = `${textarea.clientHeight}px`;
    overlay.style.transform = '';
    overlay.style.fontFamily = taStyle.fontFamily;
    overlay.style.fontSize = taStyle.fontSize;
    overlay.style.fontWeight = taStyle.fontWeight;
    overlay.style.letterSpacing = taStyle.letterSpacing;
    overlay.style.lineHeight = taStyle.lineHeight;
    if (!ranges.length) return;

    const rects = measureTextareaRangeRects(textarea, ranges);
    const scrollTop = textarea.scrollTop;
    const scrollLeft = textarea.scrollLeft;
    ranges.forEach((range, i) => {
        const rect = rects[i];
        if (!rect) return;
        const tooltip = `Mention: ${range.name}. Click to change.`;
        const mark = document.createElement('mark');
        mark.className = 'prompt-mention-mark';
        mark.tabIndex = 0;
        mark.setAttribute('role', 'button');
        mark.setAttribute('aria-haspopup', 'listbox');
        mark.setAttribute('aria-label', `Mention: ${range.name}. Press Enter to change.`);
        mark.dataset.start = String(range.start);
        mark.dataset.end = String(range.end);
        mark.dataset.assetIdx = String(range.assetIdx);
        mark.dataset.textareaId = textarea.id;
        mark.dataset.tooltip = tooltip;
        // Background-only: the textarea already paints the token. A second copy of
        // the letters was causing a slight horizontal double-glyph overlap.
        const padX = 1;
        mark.style.top = `${rect.top - scrollTop}px`;
        mark.style.left = `${rect.left - scrollLeft - padX}px`;
        mark.style.width = `${Math.max(1, rect.width + padX * 2)}px`;
        mark.style.height = `${Math.max(1, rect.height)}px`;
        const open = () => openMentionReplacementMenu(mark, textarea);
        mark.addEventListener('mousedown', (e) => {
            e.preventDefault();
            open();
        });
        mark.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            e.preventDefault();
            open();
        });
        overlay.appendChild(mark);
    });
}

function openMentionReplacementMenu(mark, textarea) {
    textarea = textarea || document.getElementById(mark?.dataset.textareaId || '') || $('#promptInput');
    if (!textarea || !mark) return;
    const start = Number(mark.dataset.start);
    const end = Number(mark.dataset.end);
    if (!Number.isInteger(start) || !Number.isInteger(end)) return;
    const items = [];
    for (let i = 0; i < APP.imageFiles.length; i++) {
        if (getAssetToken(i)) items.push(i);
    }
    if (!items.length) return;
    const currentAssetIdx = Number(mark.dataset.assetIdx);
    const active = Math.max(0, items.indexOf(currentAssetIdx));
    textarea.focus();
    textarea.setSelectionRange(start, end);
    _mentionState = { textarea, start, end, items, active, anchorRect: mark.getBoundingClientRect() };
    _renderMentionMenu();
}

function refreshAssetMentionMenu() {
    if (_mentionState.textarea) _updateMentionForTextarea(_mentionState.textarea);
    renderPromptMentionHighlights();
}

/** Insert a mention token at the caret (or end) of the most recently focused prompt box.
 *  Falls back to whichever prompt box is actually visible right now (not just "#promptInput
 *  first") so clicking a mention chip before ever focusing a box doesn't silently write into a
 *  hidden textarea from the other generation mode. */
function insertMentionIntoLastPrompt(token) {
    let ta = _lastPromptTextarea;
    if (!ta || ta.offsetParent === null) {
        const candidates = [$('#promptInput'), $('#videoPromptInput')];
        ta = candidates.find(el => el && el.offsetParent !== null) || candidates.find(Boolean);
    }
    if (!ta) { showToast('Focus a prompt box first, then click the tag.', 'warning'); return; }
    const caret = (document.activeElement === ta) ? ta.selectionStart : ta.value.length;
    const value = ta.value;
    const needsSpaceBefore = caret > 0 && !/\s$/.test(value.slice(0, caret));
    const insert = (needsSpaceBefore ? ' ' : '') + token + ' ';
    ta.value = value.slice(0, caret) + insert + value.slice(caret);
    const newCaret = caret + insert.length;
    ta.focus();
    ta.setSelectionRange(newCaret, newCaret);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
}

/** Wire @mention autocomplete onto a prompt textarea. Safe to call once per element. */
function attachAssetMention(textarea) {
    if (!textarea || textarea._assetMentionWired) return;
    textarea._assetMentionWired = true;
    textarea.addEventListener('focus', () => { _lastPromptTextarea = textarea; });
    textarea.addEventListener('click', () => _updateMentionForTextarea(textarea));
    textarea.addEventListener('input', () => _updateMentionForTextarea(textarea));
    textarea.addEventListener('keydown', (e) => {
        if (_mentionState.textarea !== textarea || _mentionMenuEl?.classList.contains('hidden')) return;
        const n = _mentionState.items.length;
        if (!n) return;
        if (e.key === 'ArrowDown') {
            e.preventDefault(); _mentionState.active = (_mentionState.active + 1) % n; _renderMentionMenu();
        } else if (e.key === 'ArrowUp') {
            e.preventDefault(); _mentionState.active = (_mentionState.active - 1 + n) % n; _renderMentionMenu();
        } else if (e.key === 'Enter' || e.key === 'Tab') {
            e.preventDefault(); _applyMentionChoice(_mentionState.items[_mentionState.active]);
        } else if (e.key === 'Escape') {
            e.preventDefault(); closeAssetMentionMenu();
        }
    });
    textarea.addEventListener('blur', () => { setTimeout(closeAssetMentionMenu, 150); });
}

let _previewUrls = [];

/** Keeps the drop-zone size/label and the asset counter in sync with APP.imageFiles. */
function updateUploadAssetsUI() {
    const count = APP.imageFiles ? APP.imageFiles.length : 0;
    const dropZone = $('#dropZone');
    const dropZoneText = $('#dropZoneText');
    const countEl = $('#assetCount');

    if (dropZone) dropZone.classList.toggle('compact', count > 0);
    if (dropZoneText && !dropZone?.classList.contains('loading')) {
        dropZoneText.textContent = count > 0 ? '+ Add more images' : 'Drop images here, or click to browse';
    }
    if (countEl) {
        countEl.textContent = `${count} image${count === 1 ? '' : 's'}`;
        countEl.classList.toggle('hidden', count === 0);
    }
}

/** Shows a "Processing…" state while an async drag-drop folder read is in flight. */
function setDropZoneLoading(isLoading) {
    const dropZone = $('#dropZone');
    const dropZoneText = $('#dropZoneText');
    if (!dropZone) return;
    dropZone.classList.toggle('loading', isLoading);
    if (dropZoneText) {
        dropZoneText.textContent = isLoading
            ? 'Processing…'
            : (APP.imageFiles?.length > 0 ? '+ Add more images' : 'Drop images here, or click to browse');
    }
}

function renderImagePreview() {
    const container = $('#imagePreview');
    if (!container) return;

    _previewUrls.forEach(u => URL.revokeObjectURL(u));
    _previewUrls = [];

    const escAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

    container.innerHTML = APP.imageFiles.map((file, idx) => {
        const url = URL.createObjectURL(file);
        _previewUrls.push(url);
        const name = getAssetName(idx);
        const escName = escAttr(name);
        const token = getAssetToken(idx);
        const escToken = escAttr(token);
        const isDup = findDuplicateAssetIndices(idx).length > 0;
        const nameTitle = isDup
            ? escAttr(`"${token}" also names another asset — only the most recently edited one is reachable by this mention.`)
            : 'Name this asset to mention it in prompts';
        return `
      <div class="image-preview-item" draggable="true" data-idx="${idx}" title="${file.name}">
        <img src="${url}" alt="${file.name}" loading="lazy" draggable="false">
        <button class="remove-btn" data-idx="${idx}" aria-label="Remove ${escName}">×</button>
        <div class="asset-name-row">
          <input type="text" class="asset-name-input${isDup ? ' duplicate' : ''}" data-idx="${idx}" value="${escName}"
            placeholder="name…" title="${nameTitle}" aria-label="Name this asset to mention it in prompts" maxlength="40">
        </div>
        <span class="asset-token-preview${token ? '' : ' hidden'}${isDup ? ' duplicate' : ''}" data-idx="${idx}" title="${nameTitle}">${escToken}</span>
      </div>
    `;
    }).join('');

    updateUploadAssetsUI();

    rematerializeI2vAssetUrls();
    renderMentionList();
    renderPromptMentionHighlights();

    // 이름 입력 (asset naming → @mention)
    container.querySelectorAll('.asset-name-input').forEach(input => {
        // Prevent the surrounding draggable card from hijacking text selection / typing.
        input.addEventListener('mousedown', (e) => e.stopPropagation());
        input.addEventListener('pointerdown', (e) => e.stopPropagation());
        input.addEventListener('dragstart', (e) => { e.preventDefault(); e.stopPropagation(); });
        // Disable card drag while the name field is focused so text can be selected.
        input.addEventListener('focus', () => {
            const card = input.closest('.image-preview-item');
            if (card) card.setAttribute('draggable', 'false');
        });
        input.addEventListener('blur', () => {
            const card = input.closest('.image-preview-item');
            if (card) card.setAttribute('draggable', 'true');
        });
        input.addEventListener('input', (e) => {
            const idx = parseInt(input.dataset.idx, 10);
            setAssetName(idx, input.value);
            renderMentionList();
            renderPromptMentionHighlights();
            updateAssetTokenPreviews();
        });
        input.addEventListener('change', () => {
            const idx = parseInt(input.dataset.idx, 10);
            if (findDuplicateAssetIndices(idx).length > 0) {
                const token = getAssetToken(idx);
                showToast(`${token} already names another asset — only the most recently edited one will be reachable by that mention. Rename one to fix it.`, 'warning', 4000);
            }
            refreshAssetMentionMenu();
            saveSession();
        });
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
        });
    });

    // 삭제 버튼
    container.querySelectorAll('.remove-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const idx = parseInt(btn.dataset.idx, 10);
            APP.imageFiles.splice(idx, 1);
            APP.videoQueueConfirmed = false;
            reindexI2vAssetsAfterRemoval(idx);
            closeI2vAssetPicker();
            renderImagePreview();
            showQueue();
            updateStartButtonState();
        });
    });

    // 드래그 앤 드롭으로 순서 변경
    container.querySelectorAll('.image-preview-item[draggable="true"]').forEach(item => {
        item.addEventListener('dragstart', (e) => {
            _draggedImageIdx = parseInt(item.dataset.idx, 10);
            item.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', String(_draggedImageIdx));
        });

        item.addEventListener('dragend', () => {
            _draggedImageIdx = null;
            item.classList.remove('dragging');
            container.querySelectorAll('.image-preview-item').forEach(el => el.classList.remove('drag-over'));
        });

        item.addEventListener('dragover', (e) => {
            e.preventDefault();
            if (_draggedImageIdx === null) return;
            e.dataTransfer.dropEffect = 'move';
            item.classList.add('drag-over');
        });

        item.addEventListener('dragleave', () => {
            item.classList.remove('drag-over');
        });

        item.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();
            item.classList.remove('drag-over');

            if (_draggedImageIdx === null) return;

            const fromIdx = _draggedImageIdx;
            const toIdx = parseInt(item.dataset.idx, 10);

            if (fromIdx === toIdx) return;

            const [movedFile] = APP.imageFiles.splice(fromIdx, 1);
            APP.imageFiles.splice(toIdx, 0, movedFile);

            reindexI2vAssetsAfterReorder(fromIdx, toIdx);

            APP.videoQueueConfirmed = false;
            renderImagePreview();
            showQueue();
            updateStartButtonState();

            _draggedImageIdx = null;
        });
    });

    const clearBtn = $('#clearImagesBtn');
    if (clearBtn) {
        clearBtn.classList.toggle('hidden', APP.imageFiles.length === 0);
    }
}

/** Render the list of mentionable assets above each prompt box (between the
 *  "Split prompts by" splitter and the prompt textarea). Click a chip to insert
 *  its @token into the last-focused prompt. */
function renderMentionList() {
    const containers = [$('#promptMentionList'), $('#i2vMentionList')].filter(Boolean);
    if (!containers.length) return;

    const chips = [];
    for (let i = 0; i < APP.imageFiles.length; i++) {
        const token = getAssetToken(i);
        if (!token) continue;
        const name = getAssetName(i);
        const url = _previewUrls[i] || '';
        const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
        chips.push(`<button type="button" class="mention-chip" data-token="${esc(token)}"
            title="Insert ${esc(token)} into the prompt">
            ${url ? `<img src="${url}" alt="">` : ''}
            <span class="mention-chip-name">${esc(name)}</span>
            <span class="mention-chip-token">${esc(token)}</span>
        </button>`);
    }

    const html = chips.join('');
    containers.forEach(c => {
        c.innerHTML = html;
        c.classList.toggle('hidden', chips.length === 0);
        c.querySelectorAll('.mention-chip').forEach(chip => {
            chip.addEventListener('click', () => {
                const token = chip.dataset.token;
                if (token) insertMentionIntoLastPrompt(token);
            });
        });
    });
}

/** Refresh every asset card's "@token" preview text + duplicate-name warning state. Scans all
 *  cards (not just the one edited) because renaming one asset can also change whether *other*
 *  cards now collide with it. */
function updateAssetTokenPreviews() {
    const container = $('#imagePreview');
    if (!container) return;
    for (let i = 0; i < APP.imageFiles.length; i++) {
        const input = container.querySelector(`.asset-name-input[data-idx="${i}"]`);
        const preview = container.querySelector(`.asset-token-preview[data-idx="${i}"]`);
        if (!input && !preview) continue;
        const token = getAssetToken(i);
        const isDup = findDuplicateAssetIndices(i).length > 0;
        const title = isDup
            ? `"${token}" also names another asset — only the most recently edited one is reachable by this mention.`
            : 'Name this asset to mention it in prompts';
        if (input) {
            input.classList.toggle('duplicate', isDup);
            input.title = title;
        }
        if (preview) {
            preview.textContent = token;
            preview.classList.toggle('hidden', !token);
            preview.classList.toggle('duplicate', isDup);
            preview.title = title;
        }
    }
}

async function handleStyleImage(file) {
    const base64 = await fileToBase64(file);
    APP.styleImage = { base64, name: file.name };

    const preview = $('#styleImagePreview');
    if (preview) {
        preview.innerHTML = `
      <div style="display:flex; align-items:center; gap:8px; padding:8px; background:var(--bg-card); border:1px solid var(--border); border-radius:var(--radius-sm)">
        <img src="${base64}" style="width:40px; height:40px; object-fit:cover; border-radius:4px">
        <span style="flex:1; font-size:12px; color:var(--text-secondary)">${file.name}</span>
        <button class="btn-text" id="removeStyleImage" style="color:var(--error)">✕</button>
      </div>
    `;
        $('#removeStyleImage')?.addEventListener('click', () => {
            APP.styleImage = null;
            preview.innerHTML = '';
        });
    }
}

// ========== SETTINGS HANDLERS ==========
let settingsSaveStateTimer = null;

function markSettingsSaved(stateKey = 'settingsAutosaved') {
    const el = $('#settingsSaveState');
    if (!el) return;
    el.textContent = stateKey === 'settingsSaving' ? 'Saving...' : 'Autosaved';
    el.classList.toggle('is-saving', stateKey === 'settingsSaving');
    clearTimeout(settingsSaveStateTimer);
    if (stateKey === 'settingsSaving') {
        settingsSaveStateTimer = setTimeout(() => markSettingsSaved('settingsAutosaved'), 1400);
    }
}

async function persistSettingsChange(options = {}) {
    if (!options.quiet) markSettingsSaved('settingsSaving');
    await saveSettings();
    if (!options.quiet) markSettingsSaved('settingsAutosaved');
}

const OPENAI_PRESETS = {
    deepseek: {
        baseUrl: 'https://api.deepseek.com/v1',
        model: 'deepseek-chat'
    },
    openai: {
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4o-mini'
    },
    siliconflow: {
        baseUrl: 'https://api.siliconflow.cn/v1',
        model: 'deepseek-ai/DeepSeek-V3'
    },
    dashscope: {
        baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        model: 'qwen-plus'
    },
    zhipu: {
        baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
        model: 'glm-4-flash'
    },
    moonshot: {
        baseUrl: 'https://api.moonshot.cn/v1',
        model: 'moonshot-v1-8k'
    },
    openrouter: {
        baseUrl: 'https://openrouter.ai/api/v1',
        model: 'deepseek/deepseek-chat'
    },
    groq: {
        baseUrl: 'https://api.groq.com/openai/v1',
        model: 'llama-3.3-70b-versatile'
    },
    ollama: {
        baseUrl: 'http://localhost:11434/v1',
        model: 'qwen2.5:7b'
    },
    custom: {
        baseUrl: '',
        model: ''
    }
};

function initSettingsHandlers() {
    // ── AI Provider Switcher (Gemini vs OpenAI Compatible) ──
    $('#aiProviderToggle')?.querySelectorAll('.ai-provider-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const provider = btn.getAttribute('data-provider') || 'gemini';
            APP.settings.aiProvider = provider;
            if (typeof setActiveAiProvider === 'function') {
                setActiveAiProvider(provider);
            }
            $('#aiProviderToggle')?.querySelectorAll('.ai-provider-btn').forEach(b => {
                const isActive = b === btn;
                b.classList.toggle('active', isActive);
                b.setAttribute('aria-checked', isActive ? 'true' : 'false');
            });
            $('#geminiConfigSection')?.classList.toggle('hidden', provider !== 'gemini');
            $('#openaiConfigSection')?.classList.toggle('hidden', provider !== 'openai');

            persistSettingsChange();
            updateGeminiKeyStatus();
        });
    });

    // ── Gemini Handlers ──
    $('#geminiApiKeyInput')?.addEventListener('change', (e) => {
        const val = e.target.value.trim();
        APP.settings.geminiApiKey = val;
        chrome.storage.local.set({ apiKey: val });
        persistSettingsChange();
        updateGeminiKeyStatus();
    });

    $('#geminiModelSelect')?.addEventListener('change', (e) => {
        APP.settings.geminiModel = e.target.value;
        if (typeof setActiveGeminiModel === 'function') {
            setActiveGeminiModel(e.target.value);
        }
        persistSettingsChange();
        updateGeminiKeyStatus();
    });

    // ── OpenAI Compatible Handlers ──
    $('#openaiPresetSelect')?.addEventListener('change', (e) => {
        const presetKey = e.target.value;
        APP.settings.openaiPreset = presetKey;
        const preset = OPENAI_PRESETS[presetKey];
        if (preset && presetKey !== 'custom') {
            APP.settings.openaiBaseUrl = preset.baseUrl;
            APP.settings.openaiModel = preset.model;
            const urlInput = $('#openaiBaseUrlInput');
            if (urlInput) urlInput.value = preset.baseUrl;
            const modelInput = $('#openaiModelInput');
            if (modelInput) modelInput.value = preset.model;
        }
        if (typeof setActiveOpenaiConfig === 'function') {
            setActiveOpenaiConfig({
                baseUrl: APP.settings.openaiBaseUrl,
                apiKey: APP.settings.openaiApiKey,
                model: APP.settings.openaiModel,
                preset: APP.settings.openaiPreset
            });
        }
        persistSettingsChange();
        updateGeminiKeyStatus();
    });

    $('#openaiBaseUrlInput')?.addEventListener('change', (e) => {
        APP.settings.openaiBaseUrl = e.target.value.trim();
        if (typeof setActiveOpenaiConfig === 'function') {
            setActiveOpenaiConfig({ baseUrl: APP.settings.openaiBaseUrl });
        }
        persistSettingsChange();
    });

    $('#openaiApiKeyInput')?.addEventListener('change', (e) => {
        const val = e.target.value.trim();
        APP.settings.openaiApiKey = val;
        chrome.storage.local.set({ openaiApiKey: val });
        if (typeof setActiveOpenaiConfig === 'function') {
            setActiveOpenaiConfig({ apiKey: val });
        }
        persistSettingsChange();
        updateGeminiKeyStatus();
    });

    $('#openaiModelInput')?.addEventListener('change', (e) => {
        APP.settings.openaiModel = e.target.value.trim();
        if (typeof setActiveOpenaiConfig === 'function') {
            setActiveOpenaiConfig({ model: APP.settings.openaiModel });
        }
        persistSettingsChange();
        updateGeminiKeyStatus();
    });

    // ── Test AI Connection Button ──
    $('#btnTestAiConnection')?.addEventListener('click', async () => {
        await testAiConnection();
    });

    // Gemini API Key 설정 버튼 → 모달 열기
    $('#geminiKeySettingBtn')?.addEventListener('click', () => {
        showGeminiGuideModal();
    });
    updateGeminiKeyStatus();

    // Nationality
    $('#nationalitySelect')?.addEventListener('change', (e) => {
        APP.settings.nationality = e.target.value;
        persistSettingsChange();
    });

    // 기본 저장 폴더 (Whisk와 동일)
    $('#downloadFolder')?.addEventListener('change', (e) => {
        APP.settings.downloadFolder = safeDownloadFolder(e.target.value);
        e.target.value = APP.settings.downloadFolder;
        persistSettingsChange();
    });

    $('#promptSeparatorInput')?.addEventListener('input', (e) => {
        const raw = e.target.value || '';
        if (raw.includes('@')) {
            e.target.value = raw.replace(/@/g, '');
            showToast('提示词中的 @ 符号保留用于角色与素材引用。', 'warning');
        }
        APP.settings.promptSeparator = normalizePromptSeparator(e.target.value, getPromptSeparator());
        updatePromptSeparatorUi();
        applyPromptInputPlaceholder();
        scheduleAutoPreview();
    });
    $('#promptSeparatorInput')?.addEventListener('change', (e) => {
        APP.settings.promptSeparator = normalizePromptSeparator(e.target.value, '###');
        e.target.value = APP.settings.promptSeparator;
        updatePromptSeparatorUi();
        applyPromptInputPlaceholder();
        persistSettingsChange();
        previewPromptQueue({ silent: true });
    });

    // Aspect ratio selects (image + video share APP.settings.aspectRatio)
    const imageRatioSelectEl = $('#imageRatioSelect');
    if (imageRatioSelectEl) {
        imageRatioSelectEl.addEventListener('change', () => {
            APP.settings.aspectRatio = imageRatioSelectEl.value;
            syncFlowSettingControls();
            persistSettingsChange();
        });
    }
    const videoRatioSelectEl = $('#videoRatioSelect');
    if (videoRatioSelectEl) {
        videoRatioSelectEl.addEventListener('change', () => {
            APP.settings.aspectRatio = videoRatioSelectEl.value;
            syncFlowSettingControls();
            persistSettingsChange();
        });
    }

    // Images per prompt (x1~x4)
    $$('.output-count-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const raw = Number(btn.dataset.outputCount);
            APP.settings.outputCount = (raw >= 1 && raw <= 4) ? raw : 1;
            syncFlowSettingControls();
            console.log('[OUTPUT_COUNT] user selection →', APP.settings.outputCount);
            persistSettingsChange();
            if (raw >= 2) {
                showToast('⚠️ 每组提示词生成多张图片可能增加限流风控风险。建议设为 x1 以获得最稳定的自动化体验。', 'warning', 4000);
            }
        });
    });

    // Flow 이미지 모델 선택
    const imageModelSelectEl = $('#imageModelSelect');
    if (imageModelSelectEl) {
        imageModelSelectEl.addEventListener('change', () => {
            APP.settings.flowImageModel = imageModelSelectEl.value;
            syncFlowSettingControls();
            persistSettingsChange();
        });
    }

    $$('[data-prompt-mode]').forEach(btn => {
        btn.addEventListener('click', () => {
            const nextMode = btn.dataset.promptMode;
            if (nextMode !== 'textToImage' && nextMode !== 'textToVideo') return;
            const isActivelyRunning = (APP.isRunning && !APP.isPaused) ||
                APP.runningMode ||
                (APP.factory.videoRunning && !APP.isPaused) ||
                APP.factory.isProcessing ||
                APP.isGeneratingPrompts ||
                APP.isGeneratingRefs;
            if (isActivelyRunning) {
                const runningModeName = getModeName(APP.runningMode || (APP.factory.isProcessing ? 'factory' : APP.mode));
                const message = "Task in progress in {mode} mode. Please switch after completion."
                    .replace('{mode}', runningModeName);
                showToast(message, 'warning');
                return;
            }
            APP.mode = nextMode;
            if (nextMode === 'textToVideo' && APP.settings.aspectRatio !== '16:9' && APP.settings.aspectRatio !== '9:16') {
                APP.settings.aspectRatio = '16:9';
            }
            APP.settings.lastMode = nextMode;
            syncFlowSettingControls();
            saveSettings();
            updateModeUI();
        });
    });

    // Flow 비디오 모델 선택 (Veo 3.1 Lite / Fast / Quality)
    const videoModelSelectEl = $('#videoModelSelect');
    if (videoModelSelectEl) {
        videoModelSelectEl.addEventListener('change', () => {
            APP.settings.flowVideoModel = videoModelSelectEl.value;
            syncFlowSettingControls();
            persistSettingsChange();
        });
    }

    // Video resolution
    $$('[data-resolution]').forEach(btn => {
        btn.addEventListener('click', () => {
            $$('[data-resolution]').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            APP.settings.videoResolution = btn.dataset.resolution;
            persistSettingsChange();
        });
    });

    // Video duration
    $$('[data-duration]').forEach(btn => {
        btn.addEventListener('click', () => {
            APP.settings.videoDuration = btn.dataset.duration;
            syncFlowSettingControls();
            persistSettingsChange();
        });
    });

    // Video preset
    $$('[data-preset]').forEach(btn => {
        btn.addEventListener('click', () => {
            $$('[data-preset]').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            APP.settings.videoPreset = btn.dataset.preset;
            persistSettingsChange();
        });
    });

    // Delay stepper (4~8초 고정)
    $('#delayMinus')?.addEventListener('click', () => {
        const val = clampPromptDelay(APP.settings.promptDelay);
        if (val > 4) {
            APP.settings.promptDelay = val - 1;
            $('#delayValue').textContent = APP.settings.promptDelay;
            persistSettingsChange();
        }
    });
    $('#delayPlus')?.addEventListener('click', () => {
        const val = clampPromptDelay(APP.settings.promptDelay);
        if (val < 8) {
            APP.settings.promptDelay = val + 1;
            $('#delayValue').textContent = APP.settings.promptDelay;
            persistSettingsChange();
        }
    });

    // Default prompt
    $('#defaultPrompt')?.addEventListener('change', (e) => {
        APP.settings.defaultVideoPrompt = e.target.value || 'Dynamic action, Active camera angle';
        e.target.value = APP.settings.defaultVideoPrompt;
        persistSettingsChange();
    });

    // Style select is handled by initStyleGallery()

    $('#resetSettingsBtn')?.addEventListener('click', async () => {
        if (confirm("Reset all settings?")) {
            await resetSettings();
            await loadSettings();
            applySettingsToUI();
            showToast("设置已恢复为默认值");
        }
    });
}

// ========== CONTROL HANDLERS ==========
function initControlHandlers() {
    // 顶栏新建画板 & 状态检测
    $('#btnHeaderNewProject')?.addEventListener('click', async () => {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab?.id && isFlowTabUrl(tab.url)) {
            await chrome.tabs.update(tab.id, { url: 'https://flow.google.com/' });
            showToast('已返回 Flow 首页，准备创建独立新画板', 'info');
        } else {
            chrome.tabs.create({ url: 'https://flow.google.com/' });
        }
    });

    $('#flowCanvasStatusChip')?.addEventListener('click', async () => {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab || !isFlowTabUrl(tab.url)) {
            chrome.tabs.create({ url: 'https://flow.google.com/' });
        } else {
            await updateFlowCanvasStatus();
            showToast('已检测并同步 Flow 画板状态', 'info');
        }
    });

    // 步骤条点击
    document.querySelectorAll('.studio-pipeline-stepper .stepper-step').forEach(btn => {
        btn.addEventListener('click', () => {
            switchStudioStep(btn.dataset.step);
        });
    });

    // 步骤间跳转按钮
    $('#btnNextToStep2')?.addEventListener('click', () => switchStudioStep(2));
    $('#btnNextToStep3')?.addEventListener('click', () => switchStudioStep(3));
    $('#btnNextToStep3Bottom')?.addEventListener('click', () => switchStudioStep(3));
    $('#btnBackToStep1')?.addEventListener('click', () => switchStudioStep(1));
    $('#btnBackToStep2')?.addEventListener('click', () => switchStudioStep(2));

    // Script actions: EDIT(focus), DEL(clear), SAVE(save draft)
    $('#btn-script-edit')?.addEventListener('click', () => $('#scriptInput')?.focus());
    $('#btn-script-del')?.addEventListener('click', () => {
        const scriptInput = $('#scriptInput');
        if (scriptInput) {
            scriptInput.value = '';
            scriptInput.scrollTop = 0;   // ★ 스크롤 상단 이동 (커서 즉시 보임)
            scriptInput.focus();         // ★ 포커스 자동 — 바로 입력 가능
        }
        chrome.storage.local.remove('savedScript');
        showToast("剧本内容已清空", 'success');
    });
    $('#btn-script-save')?.addEventListener('click', async () => {
        await saveScriptDraft();
        showToast("剧本内容已保存", 'success');
    });

    $('#btn-prompt-splitter')?.addEventListener('click', insertPromptSeparator);

    // Generate Prompts (Script mode)
    $('#btn-generate-prompts')?.addEventListener('click', async () => {
        // 팩토리+대본투이미지 통합 월 10회 — 소진 시 업그레이드 모달
        if (APP.mode === 'factory' || APP.mode === 'scriptToImage') {
            const access = await checkFactoryAccess();
            if (!access.allowed) {
                showUpgradeModal();
                return;
            }
            if (APP.mode === 'scriptToImage' && access.type === 'free') {
                await incrementUsage();
            }
        }

        await saveScriptDraft();
        const script = $('#scriptInput')?.value?.trim();
        if (!script) {
            showToast("剧本内容为空。请在文本框输入长剧本或故事后，再点击「生成 AI 分镜提示词」。", 'error');
            return;
        }

        if (script.length < 50) {
            showToast("Script too short (min 50 characters). Solution: Enter at least 50 characters and try again.", 'error');
            return;
        }

        const apiKey = getActiveApiKey();
        if (!apiKey) {
            const isOp = APP.settings.aiProvider === 'openai';
            showToast(isOp ? "未配置 API Key。请在设置中输入您的 API Key（如 DeepSeek/OpenAI 等）。" : "未配置 Gemini API Key。请在设置中输入您的 API Key。", 'error');
            setTimeout(() => {
                $('#btnOpenSettings')?.click();
                setTimeout(() => {
                    if (isOp) {
                        $('#openaiApiKeyInput')?.focus();
                    } else {
                        $('#geminiApiKeyInput')?.focus();
                    }
                }, 200);
            }, 400);
            return;
        }

        // ★ PRO 2.0: 대본 분할 방식 결정
        const splitMode = $('#splitMode')?.value || APP.splitMode || 'giseungjeongyeol';

        const PROMPT_OPTIONS = [4, 10, 15, 20, 25, 30, 40, 50, 60, 70, 74, 80, 100, 120, 150, 200];
        let numPrompts;
        if (splitMode === 'giseungjeongyeol') {
            numPrompts = parseInt($('#numPrompts')?.value, 10) || 4;
            if (!PROMPT_OPTIONS.includes(numPrompts)) numPrompts = PROMPT_OPTIONS[0];
        } else {
            numPrompts = null;  // Gemini가 Phase 0에서 결정
        }

        // ─── DEBUG: API 호출 전 분할 미리보기 (테스트 후 제거) ───
        console.group('🔍 [DEBUG] 프롬프트 생성 시작');
        console.log(`선택된 프롬프트 수: ${numPrompts}`);
        console.log(`대본 길이: ${script.length}자`);
        console.log(`API 키: ${apiKey.slice(0,8)}...`);
        console.groupEnd();
        // ─── DEBUG END ───

        // ★ 대본/가사 자동 백업 다운로드 (토큰 영향 없음, 클라이언트 파일 저장)
        try {
            const projectName = APP.factory?.projectName || $('#controlProjectName')?.value?.trim() || 'my_project';
            const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
            const isLyrics = splitMode === 'lyrics';
            const header = isLyrics
                ? `# ${projectName} — original lyrics (${ts})\n# genre: ${APP.musicGenre || 'cinematic_ballad'} | hook variation: ${APP.hookVariationIntensity || 'medium'} | narrative arc: ${APP.applyNarrativeArc !== false}\n\n`
                : `# ${projectName} — original script (${ts})\n# split mode: ${splitMode}\n\n`;
            const filename = `${projectName}/script_${ts}.txt`;
            const dataUrl = 'data:text/plain;charset=utf-8;base64,' + btoa(unescape(encodeURIComponent(header + script)));
            const folder = APP.settings?.downloadFolder || 'AI4Next';
            chrome.runtime.sendMessage({
                type: 'DOWNLOAD_FILE',
                url: dataUrl,
                filename,
                folder
            }).catch(err => console.log('[SCRIPT BACKUP] sendMessage warning:', err?.message));
            console.log(`📥 [SCRIPT BACKUP] 대본 자동 저장: ${folder}/${filename}`);
        } catch (e) {
            console.log('[SCRIPT BACKUP] 예외:', e);
        }

        // 커스텀 스타일 → Gemini 프롬프트 (없으면 스타일 없음)
        const styleId = normalizeSelectedStyle(APP.settings.selectedStyle);
        let customStyle = '';
        if (isCustomStyleId(styleId)) {
            const customStyles = await loadCustomStyles();
            const style = customStyles.find(s => s.id === styleId);
            if (!style) {
                showToast(getCustomStyleError('styleNotFound'), 'error');
                return;
            }
            customStyle = style.prompt;
            APP.customStyles = customStyles;
        }

        const nationality = {
            korean: 'Korean', japanese: 'Japanese', chinese: 'Chinese',
            southeast_asian: 'Southeast Asian', western: 'American',
            indian: 'Indian', latin: 'Latin American', arab: 'Arab', black: 'Black'
        }[APP.settings.nationality] || 'Korean';
        const userDirections = $('#userDirections')?.value?.trim() || '';

        const btn = $('#btn-generate-prompts');
        const originalText = btn.textContent;
        btn.disabled = true;
        btn.classList.add('loading');
        btn.innerHTML = '<span class="spinner"></span>' + "GENERATING IMAGE PROMPTS...";

        APP.isGeneratingPrompts = true;  // ★ Gemini API 호출 시작 (모드 전환 차단)

        if (APP.factory.isFullAuto && (APP.mode === 'factory' || APP.mode === 'scriptToImage')) {
            $('#section-progress')?.classList.remove('hidden');
            updateFactoryPhaseStatus('prompt_generating');
        }

        try {
            // ★ PRO 2.0: 배치 진행률 표시용 "유효 개수" — null 방지
            //   - 균일 모드: 사용자 지정 numPrompts (이미 숫자)
            //   - 신규 모드: split_decided 이벤트로부터 동적 업데이트, 그 전까지는 "?"
            let effectiveNumPrompts = typeof numPrompts === 'number' && numPrompts > 0 ? numPrompts : '?';

            const onBatchProgress = (phase, current, total, startNum, endNum, data) => {
                if (phase === 'single') {
                    const msg = ("GENERATING {count} PROMPTS...").replace('{count}', effectiveNumPrompts);
                    btn.innerHTML = '<span class="spinner"></span> ' + msg;
                } else if (phase === 'retry') {
                    btn.innerHTML = '<span class="spinner"></span> ' + "RETRYING...";
                } else if (phase === 'fallback') {
                    btn.innerHTML = '<span class="spinner"></span> ' + "SWITCHING TO SAFE MODE...";
                } else if (phase === 'divide') {
                    btn.innerHTML = '<span class="spinner"></span> ' + "Analyzing script...";
                } else if (phase === 'split_decided') {
                    // ★ PRO 2.0: Gemini가 씬 개수 결정 — numPrompts UI 업데이트 + 토스트 + 유효개수 갱신
                    const n = current;
                    if (splitMode !== 'giseungjeongyeol' && typeof n === 'number' && n > 0) {
                        effectiveNumPrompts = n;  // 이후 배치 진행률에서 사용
                        updateNumPromptsUI(n);
                        const tmpl = "AI analyzed the script and will generate {n} prompts";
                        showToast(tmpl.replace('{n}', n), 'info', 4000);
                    }
                } else if (phase === 'validation') {
                    // ★ PRO 2.0: 배치 검증 결과 (심각도 기반 대응)
                    const v = data || {};
                    const isUniform = v.splitMode === 'giseungjeongyeol';
                    const label = isUniform ? 'UNIFORM' : 'SPLIT';
                    const batchN = current;
                    const sev = v.severity || (v.ok ? 'OK' : 'MINOR');

                    // ★ Validation 로그 — 개수 편차(MAJOR/CRITICAL) 있을 때만 기록
                    //   OK/MINOR 는 조용히 지나감 (사용자 노이즈 최소화)
                    if (sev === 'MAJOR' || sev === 'CRITICAL') {
                        console.log(`⚠️ [${label} VALIDATION] 배치 ${batchN} 개수 편차 ${sev}: 예상 ${v.expectedCount}개 → 반환 ${v.matchCount}개`);
                    }
                } else if (phase === 'batch') {
                    // 배치 시작: "배치 1/8 | 프롬프트 #1~25 생성 중"
                    const msg = total > 1
                        ? ("BATCH {current}/{total} | GENERATING #{start}~{end}...")
                            .replace('{current}', current)
                            .replace('{total}', total)
                            .replace('{start}', startNum || '?')
                            .replace('{end}', endNum || '?')
                        : ("GENERATING {count} PROMPTS...").replace('{count}', effectiveNumPrompts);
                    btn.innerHTML = '<span class="spinner"></span> ' + msg;
                } else if (phase === 'batch_done') {
                    // 배치 완료: "배치 1/8 완료 ✓ | 25/200개 완료"
                    const done = endNum || 0;  // 누적 완료 프롬프트 수
                    const msg = ("BATCH {current}/{total} DONE ✓ | {done}/{totalPrompts}")
                        .replace('{current}', current)
                        .replace('{total}', total)
                        .replace('{done}', done)
                        .replace('{totalPrompts}', effectiveNumPrompts);
                    btn.innerHTML = '<span class="spinner"></span> ' + msg;

                    // ★ 배치별 자동 저장 (SW 재시작 대비, 브라우저 종료 시 소멸)
                    if (data && data.prompts && data.prompts.length > 0) {
                        const saveData = { resumeExistingPrompts: data.prompts.map(p => ({ ...p })) };
                        if (data.resumeState) saveData.resumeState = data.resumeState;
                        chrome.storage.session.set(saveData).catch(() => {});
                    }
                }
            };

            // ★ PRO 2.0: 커스텀 캐릭터 레퍼런스 주입 (체크박스 ON 시)
            const userProvidedCharRefs = (typeof buildUserProvidedCharRefsForGemini === 'function')
                ? buildUserProvidedCharRefsForGemini()
                : null;

            // ★ PRO 2.0: 이미지만 있고 프롬프트 없는 슬롯 사전 경고
            if (APP.useCustomCharRefs && typeof CCR_CODES !== 'undefined') {
                const imageOnlyCodes = CCR_CODES.filter(c =>
                    APP.customCharRefs?.[c]?.image && !APP.customCharRefs?.[c]?.prompt?.trim()
                );
                if (imageOnlyCodes.length > 0) {
                    const confirmMsg = "⚠️ Warning: the following slots have images but no prompts:\n{codes}\n\nGemini won't recognize these characters, and scene descriptions may not match the uploaded images.\n\nContinue anyway?"
                        .replace('{codes}', imageOnlyCodes.join(', '));
                    const proceed = confirm(confirmMsg);
                    if (!proceed) {
                        showToast('Prompt generation canceled. Please add prompts to the relevant slots.', 'info');
                        throw new Error('USER_ABORT_MISSING_PROMPT');
                    }
                }
            }

            if (userProvidedCharRefs) {
                console.log(`🎨 [PRO 2.0] 사용자 캐릭터 ${userProvidedCharRefs.length}개 Gemini에 전달:`,
                    userProvidedCharRefs.map(r => r.code).join(', '));
            }

            // ★ PRO: 음악 가사 분할 모드 옵션 번들
            const musicOptions = splitMode === 'lyrics' ? {
                genre: APP.musicGenre || 'cinematic_ballad',
                hookVariation: APP.hookVariationIntensity || 'medium',
                narrativeArc: APP.applyNarrativeArc !== false
            } : null;

            const result = await generatePromptsFromScript(
                script, numPrompts, apiKey, styleId, customStyle, nationality, userDirections, onBatchProgress,
                userProvidedCharRefs,
                splitMode,     // ★ PRO 2.0: 대본 분할 방식
                musicOptions   // ★ PRO: 음악 장르 + 훅 변주 + 기승전결 옵션 (lyrics 모드일 때만 값)
            );

            const prompts = result.prompts || [];
            const characterRefs = result.characterRefs || [];

            if (!prompts || prompts.length === 0) {
                throw new Error("Prompt generation failed. Solution: Check your script and try again, or enter a different Gemini API key in Settings.");
            }

            // ★ 배치 실패로 부분 완료 시: 생성된 프롬프트 표시 + 재개 버튼
            if (result.partial && result.resumeState) {
                const is429 = result.failReason === '429_RATE_LIMIT';
                const failMsg = is429
                    ? `⚠️ Rate limit hit on batch ${result.failedBatch}/${result.totalBatches}. ${prompts.length}/${numPrompts} generated.\n→ Click [Resume Prompt Generation] shortly (if this recurs, try a different API key)`
                    : `Batch ${result.failedBatch}/${result.totalBatches} failed. ${prompts.length}/${numPrompts} generated. Click [Resume Prompt Generation] for the rest`;
                showToast(failMsg, 'warning', 8000);

                APP.resumeState = result.resumeState;
                APP.resumeExistingPrompts = prompts;
                chrome.storage.session.set({
                    resumeState: result.resumeState,
                    resumeExistingPrompts: prompts.map(p => ({ ...p }))
                });
            } else {
                APP.resumeState = null;
                APP.resumeExistingPrompts = null;
                chrome.storage.session.remove(['resumeState', 'resumeExistingPrompts']);
            }

            APP.prompts = prompts;
            APP.characterRefs = characterRefs;

            // ★ 새 스크립트 = 새 캐릭터 레퍼런스 필요. 이전 프로젝트 assets 초기화 (FULL AUTO 캐릭터생성 스킵 방지)
            APP.characterRefAssets = null;
            chrome.storage.local.remove('characterRefAssets');
            renderCharRefThumbnails(null);
            const charRefSection = document.getElementById('charRefSection');
            if (charRefSection) charRefSection.classList.add('hidden');

            const firstRef = characterRefs[0];
            const firstPrompt = prompts[0];

            // Build queue
            APP.queue = [];

            if (result.scenePrompts && result.scenePrompts.length > 0) {
                const projInput = $('#controlProjectName');
                const firstScript = result.scenePrompts[0].scriptText || '';
                if (projInput && firstScript && !projInput.value.trim()) {
                    projInput.value = firstScript.substring(0, 30).replace(/\s+/g, '_');
                }
            }

            if (characterRefs.length > 0) {
                characterRefs.forEach((ref) => {
                    APP.queue.push({
                        text: ref.prompt, status: 'ready', type: 'characterRef',
                        code: ref.code, name: ref.name
                    });
                });
            }

            prompts.forEach((p) => {
                APP.queue.push({
                    text: p.prompt, status: 'ready', type: 'scene',
                    number: p.number, characters: p.characters, scriptText: p.scriptText
                });
            });

            renderCharacterRefs(characterRefs);
            showGeneratedPrompts(prompts, !!result.partial, numPrompts);
            showQueue();
            updateStartButtonState();
            _updateResumeButton();
            saveSession();

            if (result.partial) {
                // 토스트는 위에서 이미 표시됨 — 여기서는 성공 메시지만 표시하지 않음
            } else {
                showToast(`${prompts.length} ${" prompts generated"}`, 'success');
            }

            // ★ 프롬프트 생성 완료
            if (APP.mode === 'scriptToImage') {
                if (characterRefs && characterRefs.length > 0) {
                    switchStudioStep(1);
                    setTimeout(() => {
                        $('#charRefsSection')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }, 300);
                    showToast(`✨ 解析出 ${prompts.length} 个分镜镜头与 ${characterRefs.length} 位角色，请在下方生成角色定妆图`, 'success', 5000);
                } else {
                    switchStudioStep(2);
                    setTimeout(() => {
                        $('#generatedPromptsSection')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }, 300);
                }
            }

            // ★ 대본투이미지/팩토리에서 FULL AUTO가 아니면 캐릭터 레퍼런스는 수동 생성만 — 스피너 해제·버튼 복구
            if (!APP.factory.isFullAuto && (APP.mode === 'factory' || APP.mode === 'scriptToImage')) {
                APP.isGeneratingRefs = false;
                APP.factory.charRefReadyResolve = null;
                const btnGenRefs = $('#btnGenerateAllRefs');
                if (btnGenRefs) {
                    btnGenRefs.disabled = false;
                    btnGenRefs.innerHTML = "GENERATE CHARACTER REFERENCE IMAGES";
                }
                if (APP.characterRefs?.length) {
                    APP.characterRefs.forEach(r => { if (r.status !== 'completed') r.status = 'pending'; });
                    renderCharacterRefs(APP.characterRefs);
                }
            }

            // ★ FULL AUTO 모드일 경우에만 자동으로 캐릭터 레퍼런스 생성 후 이미지 생성 시작 (partial 결과 시 자동 진행 차단)
            if (APP.factory.isFullAuto && (APP.mode === 'factory' || APP.mode === 'scriptToImage') && !result.partial) {
                // 이미 위에서 무조건 다운로드했음 — 중복 호출 제거
                const STABILIZE_BEFORE_NEXT_MS = 4000;
                const refs = characterRefs; // closure 보존
                updateFactoryPhaseStatus('prompt_done', prompts.length);
                setTimeout(async () => {
                    $('#section-progress')?.classList.remove('hidden');
                    // 캐릭터 레퍼런스 생성 버튼이 패널 하단에 오도록 스크롤 (위로 치우치지 않게)
                    const btnCharRef = document.getElementById('btnGenerateAllRefs');
                    if (btnCharRef) btnCharRef.scrollIntoView({ behavior: 'smooth', block: 'end' });
                    else $('#section-progress')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    if (refs.length > 0) {
                        updateFactoryPhaseStatus('char_ref_generating');
                        let resolveCharRef;
                        const p = new Promise((resolve) => {
                            resolveCharRef = resolve;
                            APP.factory.charRefReadyResolve = resolve;
                            setTimeout(() => {
                                if (APP.factory.charRefReadyResolve === resolve) {
                                    APP.factory.charRefReadyResolve = null;
                                    if (APP.mode === 'factory') APP.isGeneratingRefs = false;
                                    resolve();
                                }
                            }, 600000); // 10분 타임아웃 (캐릭터 6명 등 충분한 생성 시간 확보)
                        });
                        try {
                            await handleGenerateAllRefs();
                            await p;
                        } catch (e) {
                            APP.factory.charRefReadyResolve = null;
                            if (resolveCharRef) resolveCharRef();
                        }
                    } else {
                        await new Promise(r => setTimeout(r, STABILIZE_BEFORE_NEXT_MS));
                    }
                    updateFactoryPhaseStatus('image_start');
                    startGeneration();
                }, STABILIZE_BEFORE_NEXT_MS);
            } // FULL AUTO 아닌 경우: 이미 위에서 무조건 다운로드 완료

        } catch (err) {
            const { message, duration } = getPromptErrorToast(err);
            showToast(message, 'error', duration);
            // ★ 에러 발생 시 AUTO 모드 해제
            APP.factory.isFullAuto = false;
            APP.factory.isAutoMode = false;
            APP.factory.isVideoAuto = false;
        } finally {
            btn.textContent = originalText;
            btn.disabled = false;
            btn.classList.remove('loading');
            APP.isGeneratingPrompts = false;  // ★ Gemini API 호출 완료 (모드 전환 허용)
        }
    });

    // ★ FULL AUTO 버튼 핸들러 (프롬프트 생성부터 끝까지 전체 자동)
    $('#btn-full-auto')?.addEventListener('click', async () => {
        if (APP.mode !== 'factory' && APP.mode !== 'scriptToImage') {
            showToast("FULL AUTO is only available in Script→Image or FACTORY mode", 'error');
            return;
        }

        if (APP.mode === 'factory' || APP.mode === 'scriptToImage') {
            const access = await checkFactoryAccess();
            if (!access.allowed) {
                showUpgradeModal();
                return;
            }
            if (APP.mode === 'factory' && access.type === 'free') {
                await incrementUsage();
                refreshFactoryBadge();
            }
            // scriptToImage: increment는 btn-generate-prompts 클릭 시 처리 (full-auto가 해당 버튼 트리거)
        }

        await saveScriptDraft();
        const script = $('#scriptInput')?.value?.trim();
        if (!script) {
            showToast("剧本内容为空。请在文本框输入长剧本或故事后，再点击「生成 AI 分镜提示词」。", 'error');
            return;
        }
        if (script.length < 50) {
            showToast("Script too short (min 50 characters). Solution: Enter at least 50 characters and try again.", 'error');
            return;
        }

        const apiKey = getActiveApiKey();
        if (!apiKey) {
            const isOp = APP.settings.aiProvider === 'openai';
            showToast(isOp ? "未配置 API Key。请在设置中输入您的 API Key（如 DeepSeek/OpenAI 等）。" : "未配置 Gemini API Key。请在设置中输入您的 API Key。", 'error');
            setTimeout(() => {
                $('#btnOpenSettings')?.click();
                setTimeout(() => {
                    if (isOp) {
                        $('#openaiApiKeyInput')?.focus();
                    } else {
                        $('#geminiApiKeyInput')?.focus();
                    }
                }, 200);
            }, 400);
            return;
        }

        // ★ FULL AUTO 모드 활성화
        APP.factory.isFullAuto = true;
        APP.factory.isAutoMode = true;  // 이미지 생성부터 끝까지도 자동
        APP.factory.isVideoAuto = true; // 동영상 프롬프트부터 끝까지도 자동

        showToast("🚀 FULL AUTO started - all processes will run automatically", 'success', 3000);

        // 기존 프롬프트 생성 버튼 클릭과 동일한 로직 실행
        $('#btn-generate-prompts')?.click();
    });

    // 프롬프트/프로젝트명 변경 시 세션 자동 저장
    $('#promptInput')?.addEventListener('input', debounce(saveSession, 1000));
    $('#promptInput')?.addEventListener('input', savePromptInputDraft);
    $('#promptInput')?.addEventListener('input', scheduleAutoPreview);
    $('#promptInput')?.addEventListener('input', updateStartButtonState);
    $('#promptInput')?.addEventListener('input', updatePromptSplitterPosition);
    $('#promptInput')?.addEventListener('input', renderPromptMentionHighlights);
    $('#promptInput')?.addEventListener('click', updatePromptSplitterPosition);
    $('#promptInput')?.addEventListener('mouseup', updatePromptSplitterPosition);
    $('#promptInput')?.addEventListener('keydown', handlePromptInputShortcut);
    $('#promptInput')?.addEventListener('keyup', updatePromptSplitterPosition);
    $('#promptInput')?.addEventListener('select', updatePromptSplitterPosition);
    $('#promptInput')?.addEventListener('scroll', () => {
        updatePromptSplitterPosition();
        renderPromptMentionHighlights();
    });
    if (typeof ResizeObserver !== 'undefined') {
        MENTION_HIGHLIGHT_PAIRS.forEach(({ textareaId }) => {
            const ta = $('#' + textareaId);
            if (!ta || ta._mentionResizeObs) return;
            ta._mentionResizeObs = true;
            new ResizeObserver(() => renderPromptMentionHighlights()).observe(ta);
        });
    }
    $('#promptInput')?.addEventListener('focus', updatePromptSplitterPosition);
    updatePromptSplitterPosition();
    renderPromptMentionHighlights();
    $('#controlProjectName')?.addEventListener('input', debounce(saveSession, 500));

    // @mention autocomplete: reference uploaded assets by name inside the prompt boxes
    attachAssetMention($('#promptInput'));
    attachAssetMention($('#videoPromptInput'));
    $('#videoPromptInput')?.addEventListener('input', renderPromptMentionHighlights);
    $('#videoPromptInput')?.addEventListener('scroll', renderPromptMentionHighlights);

    // Start Generation
    $('#btn-start-generation')?.addEventListener('click', () => startGeneration());

    // Pause
    $('#btn-pause')?.addEventListener('click', () => {
        if (APP.isPaused) {
            resumeGeneration();
        } else {
            pauseGeneration();
        }
    });

    // ★ Factory Video Control Buttons (팩토리 전용 일시정지/정지)
    $('#btn-factory-pause')?.addEventListener('click', () => {
        if (APP.factory.videoPaused) {
            resumeFactoryVideoGeneration();
        } else {
            pauseFactoryVideoGeneration();
        }
    });

    // ★ Factory Video New Project Button
    $('#btn-factory-new-project')?.addEventListener('click', () => {
        if (confirm("Start a new project? Current progress will be lost.")) {
            resetProject();
        }
    });

    // New Project (completion section + mid-section + 상단 공통)
    $('#btn-new-project')?.addEventListener('click', resetProject);
    $('#btn-new-project-mid')?.addEventListener('click', resetProject);
    $('#btn-new-project-top')?.addEventListener('click', resetProject);

    // ★ 완료 섹션의 재개 버튼
    $('#btn-completion-resume')?.addEventListener('click', async () => {
        await resumeGeneration();
        // 재개 후 버튼 숨김
        $('#btn-completion-resume')?.classList.add('hidden');
        // 완료 섹션 숨기고 진행 섹션 표시
        $('#section-completion')?.classList.add('hidden');
        $('#section-progress')?.classList.remove('hidden');
        $('#controlButtons')?.classList.remove('hidden');
    });

    // Retry Failed
    $('#btn-retry-failed')?.addEventListener('click', retryFailed);

    // Copy Prompts
    $('#btnCopyPrompts')?.addEventListener('click', () => {
        const text = $('#generatedPromptsText')?.value;
        if (text) {
            navigator.clipboard.writeText(text).then(() => {
                showToast("Copied to clipboard", 'success');
            });
        }
    });

    // Edit Prompts
    $('#btnEditPrompts')?.addEventListener('click', handleEditPrompts);

    // Download Prompts (이미지프롬프트 - 동영상프롬프트와 동일한 저장경로)
    //   ★ 캐릭터 레퍼런스 프롬프트 + 씬 프롬프트 결합 (buildImagePromptsExportText 공용)
    $('#btnDownloadPrompts')?.addEventListener('click', () => {
        const text = buildImagePromptsExportText();
        if (!text) {
            showToast("No content to copy", 'warning');
            return;
        }
        const projectName = APP.factory.projectName || $('#controlProjectName')?.value?.trim() || 'my_project';
        const dateStr = new Date().toISOString().slice(0, 10);
        const filename = `${projectName}/image_prompts_${dateStr}.txt`;
        const dataUrl = 'data:text/plain;charset=utf-8;base64,' + btoa(unescape(encodeURIComponent(text)));
        chrome.runtime.sendMessage({
            type: 'DOWNLOAD_FILE',
            url: dataUrl,
            filename,
            folder: APP.settings.downloadFolder || 'AI4Next'
        });
        showToast("Prompts downloaded", 'success');
    });

    // Generate All Character References
    $('#btnGenerateAllRefs')?.addEventListener('click', handleGenerateAllRefs);
    // ★ PRO 2.0: 캐릭터 레퍼런스 생성 중 정지 버튼
    $('#btnStopCharRefGen')?.addEventListener('click', handleStopCharRefGen);

    // ========== FACTORY MODE EVENT HANDLERS ==========

    // FACTORY Start (Manual) - 이미지 생성만 시작
    $('#btn-factory-start')?.addEventListener('click', async () => {
        // ★ CCR preflight — CCR ON 상태에서 3회 소진됐으면 5회 차감 전에 차단
        //   (CCR 실제 카운트는 startGeneration 에서 증가 → 중복 방지)
        if (isCcrEnabledForCurrentMode()) {
            const ccrAccess = await checkCcrAccess();
            if (!ccrAccess.allowed) {
                showUpgradeModal();
                return;
            }
        }
        const access = await checkFactoryAccess();
        if (!access.allowed) {
            showUpgradeModal();
            return;
        }
        if (access.type === 'free') {
            await incrementUsage();
            refreshFactoryBadge();
        }

        APP.factory.isAutoMode = false;
        APP.factory.isFullAuto = false;   // ★ 수동 시작이므로 FULL AUTO 해제
        APP.factory.isVideoAuto = false;  // ★ 수동 시작이므로 VIDEO AUTO 해제
        APP.factory.isProcessing = true;  // ★ Factory 프로세스 시작 (모드 전환 차단)
        startGeneration();
    });

    // FACTORY Auto - 전체 자동화 (이미지→동영상프롬프트→동영상→다운로드)
    $('#btn-factory-auto')?.addEventListener('click', async () => {
        // ★ CCR preflight — CCR ON 상태에서 3회 소진됐으면 5회 차감 전에 차단
        if (isCcrEnabledForCurrentMode()) {
            const ccrAccess = await checkCcrAccess();
            if (!ccrAccess.allowed) {
                showUpgradeModal();
                return;
            }
        }
        const access = await checkFactoryAccess();
        if (!access.allowed) {
            showUpgradeModal();
            return;
        }
        if (access.type === 'free') {
            await incrementUsage();
            refreshFactoryBadge();
        }

        APP.factory.isAutoMode = true;
        APP.factory.isProcessing = true;  // ★ Factory 프로세스 시작 (모드 전환 차단)
        startGeneration();
    });

    // 동영상 프롬프트 생성 버튼
    $('#btn-generate-video-prompts')?.addEventListener('click', generateVideoPrompts);

    // ★ 생성된 동영상프롬프트 박스: Copy / Edit / Download
    $('#btnCopyVideoPrompts')?.addEventListener('click', () => {
        const text = $('#generatedVideoPromptsText')?.value;
        if (text) {
            navigator.clipboard.writeText(text).then(() => showToast("Copied to clipboard", 'success'));
        }
    });
    $('#btnDownloadVideoPrompts')?.addEventListener('click', () => {
        const text = $('#generatedVideoPromptsText')?.value;
        if (!text) {
            showToast("No content to copy", 'warning');
            return;
        }
        const projectName = APP.factory.projectName || $('#controlProjectName')?.value?.trim() || 'my_project';
        const dateStr = new Date().toISOString().slice(0, 10);
        const filename = `${projectName}/video_prompts_${dateStr}.txt`;
        const dataUrl = 'data:text/plain;charset=utf-8;base64,' + btoa(unescape(encodeURIComponent(text)));
        chrome.runtime.sendMessage({
            type: 'DOWNLOAD_FILE',
            url: dataUrl,
            filename,
            folder: APP.settings.downloadFolder || 'AI4Next'
        });
        showToast("Prompts downloaded", 'success');
    });
    $('#btnEditVideoPrompts')?.addEventListener('click', handleEditVideoPrompts);

    // ★ VIDEO AUTO 버튼 핸들러 (동영상 프롬프트 생성부터 끝까지 자동)
    $('#btn-video-auto')?.addEventListener('click', async () => {
        if (APP.mode !== 'factory') {
            showToast("VIDEO AUTO is only available in FACTORY mode", 'error');
            return;
        }

        // 이미지 생성이 완료되었는지 확인
        if (!APP.factory.imageGenerationComplete || APP.factory.batch1Images.length === 0) {
            showToast("Please complete image generation first", 'error');
            return;
        }

        // ★ VIDEO AUTO 모드 활성화
        APP.factory.isVideoAuto = true;

        showToast("🎬 VIDEO AUTO started - auto progress from video prompts", 'success', 3000);

        // 동영상 프롬프트 생성 실행 (완료 후 자동으로 동영상 생성 시작)
        generateVideoPrompts();
    });

    // 동영상 생성 시작 버튼
    $('#btn-start-video-generation')?.addEventListener('click', startVideoGeneration);

    // 실패 동영상 재생성 버튼
    $('#btn-retry-failed-videos')?.addEventListener('click', retryFailedVideos);

    // Factory 이미지 완료 후: 전체 이미지 재생성
    $('#btn-factory-regen-all-images')?.addEventListener('click', factoryRegenAllImages);

    // Factory 동영상 완료 후: 전체 동영상 재생성
    $('#btn-factory-regen-all-videos')?.addEventListener('click', factoryRegenAllVideos);

    // Factory 비디오 완료 후 새 프로젝트 버튼 (진행 중 화면)
    $('#btn-factory-new-project')?.addEventListener('click', () => {
        resetProject();
    });

    // Factory 비디오 완료 후 새 프로젝트 버튼 (완료 화면)
    $('#btn-factory-new-project-completion')?.addEventListener('click', () => {
        resetProject();
    });
}

// ========== CHARACTER REFERENCES (Whisk 동일) ==========

function renderCharacterRefs(characterRefs) {
    const container = $('#charRefsList');
    const section = $('#charRefsSection');
    if (!container || !section) return;

    if (!characterRefs || characterRefs.length === 0) {
        section.classList.add('hidden');
        return;
    }

    let html = '';
    characterRefs.forEach((ref) => {
        const status = ref.status || 'pending';
        const isGenerating = status === 'generating';
        const isCompleted = status === 'completed';
        let btnContent;
        if (isGenerating) {
            btnContent = `<span class="spinner spinner-dark"></span>`;  // 생성 중: 스피너만 표시
        } else {
            btnContent = "REGEN";  // 완료 후: REGEN 텍스트만 표시
        }
        html += `
            <div class="character-card" data-code="${ref.code}">
                <div class="character-info">
                    <span class="character-code">${ref.code}</span>
                    ${ref.name ? `<span class="character-name">${ref.name}</span>` : ''}
                    <span class="character-desc">${ref.refSheetPrompt || ref.prompt || ref.description || ''}</span>
                </div>
                <div class="character-card-actions">
                    <button class="btn-copy-char-ref" data-code="${ref.code}" title="${"COPY"}">
                        ${"COPY"}
                    </button>
                    <button class="btn-regenerate" data-code="${ref.code}"
                            ${APP.isGeneratingRefs || isGenerating ? 'disabled' : ''}>
                        ${btnContent}
                    </button>
                </div>
            </div>
        `;
    });

    container.innerHTML = html;
    section.classList.remove('hidden');

    container.querySelectorAll('.btn-regenerate').forEach(btn => {
        btn.addEventListener('click', () => {
            if (!btn.disabled) regenerateSingleCharacter(btn.dataset.code);
        });
    });

    container.querySelectorAll('.btn-copy-char-ref').forEach(btn => {
        btn.addEventListener('click', () => {
            const code = btn.dataset.code;
            const ref = APP.characterRefs?.find(r => r.code === code);
            if (!ref) return;
            const text = ref.refSheetPrompt || ref.prompt || (ref.description ? `[${ref.code}] ${ref.name || ''}: ${ref.description}` : '');
            if (!text) {
                showToast("No content to copy", 'warning');
                return;
            }
            navigator.clipboard.writeText(text).then(() => {
                showToast("Copied to clipboard", 'success');
            }).catch(() => {
                showToast("Copy failed", 'error');
            });
        });
    });
}

/** flow-content에서 이미 base64로 변환된 이미지 저장 — fetch 불필요 (CORS/URL만료 리스크 제거) */
async function saveCharRefFromBase64(characterRefsArray, base64Images, opts = {}) {
    const isSingleRegen = !!(opts.isSingleRegen && opts.regenCode);

    // ★ PRO 2.0 DEFENSIVE: 인자 타입 검증 (.find 등 메서드 호출 실패 방지)
    if (!Array.isArray(characterRefsArray)) {
        console.log('[CCR] saveCharRefFromBase64: characterRefsArray not an array', characterRefsArray);
        characterRefsArray = [];
    }
    if (!Array.isArray(base64Images)) {
        console.log('[CCR] saveCharRefFromBase64: base64Images not an array', base64Images);
        base64Images = [];
    }

    // ★ PRO 2.0: 사용자 업로드 커스텀 캐릭터는 항상 보존
    const customCodes = new Set();
    if (APP.useCustomCharRefs && APP.customCharRefs) {
        const codes = (typeof CCR_CODES !== 'undefined') ? CCR_CODES : ['MCR','SC1','SC2','SC3','SC4','SC5'];
        codes.forEach(code => {
            if (APP.customCharRefs[code]?.image) customCodes.add(code);
        });
    }

    // ★ assets 초기화 — 단일 재생성이거나 커스텀이 있으면 기존 유지, 아니면 완전 초기화
    const preserveExisting = isSingleRegen || customCodes.size > 0;
    const assets = preserveExisting ? { ...(APP.characterRefAssets || {}) } : {};

    // ★ 사용자 업로드 커스텀 캐릭터를 먼저 주입 (AI 생성 결과가 덮어쓰지 못하도록)
    if (!isSingleRegen && customCodes.size > 0) {
        customCodes.forEach(code => {
            const slot = APP.customCharRefs[code];
            assets[code] = {
                filename: `${code}_custom.jpg`,
                base64: slot.image,
                name: slot.name || code
            };
        });
    }

    if (isSingleRegen) {
        const code = opts.regenCode;
        const ref = characterRefsArray?.find(r => r.code === code);
        // ★ BUGFIX (PRO 2.0): 개별 REGEN 시 base64Images에는 새 이미지 1개만 들어옴
        //    regenIndex(APP.characterRefs 내 인덱스, 예: 2)를 base64Images[2]로 매칭하면 undefined
        //    → 항상 base64Images[0]을 사용 (Flow가 방금 생성한 해당 캐릭터의 이미지)
        const base64 = base64Images?.[0];
        if (!base64 || !ref) {
            console.log('[CCR] regen save skipped — no base64 or ref', {
                code,
                hasBase64: !!base64,
                base64Len: base64?.length || 0,
                base64Preview: base64 ? base64.slice(0, 50) + '...' : null,
                hasRef: !!ref,
                characterRefsAvailable: characterRefsArray?.map(r => r.code),
                base64ImagesArrayLen: base64Images?.length,
                base64ImagesNulls: base64Images?.map(b => b ? 'HAS' : 'NULL')
            });
            // ★ 타임아웃 해제 + 상태 복구 + 토스트 (사용자에게 실패 원인 표시)
            if (APP._regenTimeouts?.[code]) {
                clearTimeout(APP._regenTimeouts[code]);
                APP._regenTimeouts[code] = null;
            }
            if (ref) ref.status = 'failed';
            const reason = !base64 ? 'Image capture failed (Flow tile not loaded)' : `No reference (code=${code})`;
            showToast(`⚠️ ${code} regeneration save failed: ${reason}`, 'error');
            return assets;
        }
        const safeName = (ref.name ?? code).replace(/\s/g, '');
        const filename = `${code}_a_${safeName}.jpg`;
        assets[code] = { filename, base64, name: ref.name ?? code };
        console.log(`🔄 [REGEN SAVE] ${code} 이미지 교체 완료 → 썸네일 재렌더 + 다운로드`);

        // ★ PRO 2.0: REGEN 성공 시 새 이미지를 프로젝트 폴더에 다운로드 (방어적)
        try {
            const projectName = APP.factory?.projectName || $('#controlProjectName')?.value?.trim() || 'my_project';
            const downloadFolder = APP.settings?.downloadFolder || 'AI4Next';
            const downloadFilename = `${projectName}/${filename}`;
            chrome.runtime.sendMessage({
                type: 'DOWNLOAD_FILE',
                url: base64,
                filename: downloadFilename,
                folder: downloadFolder
            }).catch(err => console.log('[REGEN DOWNLOAD] sendMessage warning:', err?.message));
            console.log(`📥 [REGEN DOWNLOAD] ${downloadFolder}/${downloadFilename}`);
        } catch (e) {
            console.log('[REGEN DOWNLOAD] 예외:', e);
        }

        // ★ PRO 2.0: REGEN 타임아웃 해제 (orphan 방지)
        if (APP._regenTimeouts?.[code]) {
            clearTimeout(APP._regenTimeouts[code]);
            APP._regenTimeouts[code] = null;
        }
    } else {
        // ★ PRO 2.0 핵심 수정: base64Images는 "AI 생성 대상 refs"의 결과이므로
        //    characterRefsArray에서 customCodes를 제외한 순서와 1:1 매칭되어야 함
        const aiRefs = characterRefsArray.filter(r => !customCodes.has(r.code));
        for (let i = 0; i < aiRefs.length; i++) {
            const ref = aiRefs[i];
            const code = ref.code || 'MCR';
            const base64 = base64Images[i];
            if (!base64) continue;
            // 안전장치: 사용자 업로드 코드는 AI 이미지로 덮어쓰지 않음
            if (customCodes.has(code)) continue;
            const safeName = (ref.name ?? code).replace(/\s/g, '');
            const filename = `${code}_a_${safeName}.jpg`;
            assets[code] = { filename, base64, name: ref.name ?? code };
        }
    }

    await chrome.storage.local.set({ characterRefAssets: assets });
    APP.characterRefAssets = assets;
    renderCharRefThumbnails(assets);
    return assets;
}

function renderCharRefThumbnails(characterRefAssets) {
    const container = document.getElementById('charRefThumbnailList');
    if (!container) {
        return;
    }
    const codes = characterRefAssets ? Object.keys(characterRefAssets) : [];
    container.innerHTML = '';
    if (!characterRefAssets || typeof characterRefAssets !== 'object') return;
    for (const [code, ref] of Object.entries(characterRefAssets)) {
        const card = document.createElement('div');
        card.className = 'char-ref-thumb';
        card.style.cssText = 'position:relative;flex:1 1 calc(33.333% - 6px);min-width:90px;max-width:calc(33.333% - 6px);display:flex;flex-direction:column;align-items:center;gap:4px;';

        // ★ PRO 2.0: 사용자 업로드 여부 확인 → 배지 표시
        const isUserUploaded = !!(APP.useCustomCharRefs
            && APP.customCharRefs
            && APP.customCharRefs[code]
            && APP.customCharRefs[code].image);
        if (isUserUploaded) {
            const badge = document.createElement('span');
            badge.className = 'user-upload-badge';
            badge.textContent = "✨ USER";
            card.appendChild(badge);
        }

        const img = document.createElement('img');
        img.src = ref.base64 || '';
        img.alt = ref.filename || '';
        img.style.cssText = 'width:100%;aspect-ratio:1;object-fit:cover;border-radius:6px;border:2px solid ' + (isUserUploaded ? '#c93fb4' : '#333') + ';';
        const codeLabel = document.createElement('span');
        codeLabel.textContent = code;
        codeLabel.style.cssText = 'font-size:11px;font-weight:bold;color:' + (isUserUploaded ? '#ff6b9d' : '#4ade80') + ';';
        const nameLabel = document.createElement('span');
        nameLabel.textContent = ref.name ?? '';
        nameLabel.style.cssText = 'font-size:10px;color:#aaa;text-align:center;width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
        card.appendChild(img);
        card.appendChild(codeLabel);
        card.appendChild(nameLabel);
        container.appendChild(card);
    }
    const section = document.getElementById('charRefSection');
    if (section) {
        section.classList.remove('hidden');
    }
}

function initCharRefCheckbox() {
    chrome.storage.local.get('useCharRef').then(stored => {
        const checkbox = document.getElementById('useCharRefCheckbox');
        if (checkbox) {
            checkbox.checked = stored.useCharRef !== false;
            checkbox.addEventListener('change', (e) => {
                chrome.storage.local.set({ useCharRef: e.target.checked });
            });
        }
    });
}

// ========== PRO 2.0: 대본 분할 방식 (Split Mode) ==========

/** splitMode 초기화 — storage 복원 + 드롭다운 바인딩 */
async function initSplitMode() {
    try {
        const stored = await chrome.storage.local.get(['splitMode', 'lastUserNumPrompts']);
        if (stored.splitMode) APP.splitMode = stored.splitMode;
        if (stored.lastUserNumPrompts) APP.lastUserNumPrompts = stored.lastUserNumPrompts;
    } catch (_) { /* ignore */ }

    const splitEl = document.getElementById('splitMode');
    if (splitEl) {
        splitEl.value = APP.splitMode;
        splitEl.addEventListener('change', (e) => {
            APP.splitMode = e.target.value;
            chrome.storage.local.set({ splitMode: APP.splitMode }).catch(() => {});
            updateNumPromptsUI();
            updateMusicOptionsVisibility();
        });
    }

    // numPrompts의 사용자 선택 변화도 기록 (균일 모드에서만 유효)
    const numEl = document.getElementById('numPrompts');
    if (numEl) {
        numEl.addEventListener('change', (e) => {
            if (APP.splitMode === 'giseungjeongyeol' && e.target.value !== 'auto') {
                APP.lastUserNumPrompts = e.target.value;
                chrome.storage.local.set({ lastUserNumPrompts: APP.lastUserNumPrompts }).catch(() => {});
            }
        });
    }

    updateNumPromptsUI();
    updateMusicOptionsVisibility();
}

/** 음악 옵션 UI 표시/숨김 — splitMode === 'lyrics' 일 때만 노출 */
function updateMusicOptionsVisibility() {
    const group = document.getElementById('musicOptionsGroup');
    if (!group) return;
    if (APP.splitMode === 'lyrics') {
        group.classList.remove('hidden');
    } else {
        group.classList.add('hidden');
    }
}

/** 음악 옵션 초기화 — storage 복원 + 이벤트 바인딩 */
async function initMusicOptions() {
    try {
        const stored = await chrome.storage.local.get([
            'musicGenre', 'hookVariationIntensity', 'applyNarrativeArc'
        ]);
        if (stored.musicGenre) APP.musicGenre = stored.musicGenre;
        if (stored.hookVariationIntensity) APP.hookVariationIntensity = stored.hookVariationIntensity;
        if (typeof stored.applyNarrativeArc === 'boolean') APP.applyNarrativeArc = stored.applyNarrativeArc;
    } catch (_) { /* ignore */ }

    const genreEl = document.getElementById('musicGenre');
    if (genreEl) {
        genreEl.value = APP.musicGenre || 'cinematic_ballad';
        genreEl.addEventListener('change', (e) => {
            APP.musicGenre = e.target.value;
            chrome.storage.local.set({ musicGenre: APP.musicGenre }).catch(() => {});
        });
    }

    const hookEl = document.getElementById('hookVariation');
    if (hookEl) {
        hookEl.value = APP.hookVariationIntensity || 'medium';
        hookEl.addEventListener('change', (e) => {
            APP.hookVariationIntensity = e.target.value;
            chrome.storage.local.set({ hookVariationIntensity: APP.hookVariationIntensity }).catch(() => {});
        });
    }

    const arcEl = document.getElementById('applyNarrativeArc');
    if (arcEl) {
        arcEl.checked = APP.applyNarrativeArc !== false;
        arcEl.addEventListener('change', (e) => {
            APP.applyNarrativeArc = e.target.checked;
            chrome.storage.local.set({ applyNarrativeArc: APP.applyNarrativeArc }).catch(() => {});
        });
    }
}

/** splitMode에 따라 #numPrompts 드롭다운의 활성/비활성 상태 토글 */
function updateNumPromptsUI(decidedN) {
    const numEl = document.getElementById('numPrompts');
    if (!numEl) return;

    if (APP.splitMode === 'giseungjeongyeol') {
        // 균일 모드: 기존 동작 복원
        numEl.disabled = false;
        const autoOpt = numEl.querySelector('option[value="auto"]');
        if (autoOpt) autoOpt.remove();
        // 사용자가 이전에 선택한 값 복원
        if (numEl.value === 'auto' || !numEl.value) {
            numEl.value = APP.lastUserNumPrompts || '4';
        }
    } else {
        // AI 자동 모드: disabled + "AI 자동" 옵션 삽입/선택
        let autoOpt = numEl.querySelector('option[value="auto"]');
        if (!autoOpt) {
            autoOpt = document.createElement('option');
            autoOpt.value = 'auto';
            numEl.prepend(autoOpt);
        }
        // decidedN이 있으면 "AI 자동 (N개)", 없으면 "AI 자동 결정"
        if (typeof decidedN === 'number' && decidedN > 0) {
            const tmpl = "AI Auto ({n} scenes)";
            autoOpt.textContent = tmpl.replace('{n}', decidedN);
        } else {
            autoOpt.textContent = "AI Auto Decide";
        }
        numEl.value = 'auto';
        numEl.disabled = true;
    }
}

function isCharRefEnabled() {
    // P2I 모드는 자체 CCR 시스템(p2iUseCustomCharRefs) 사용 — 공유 체크박스 무시
    if (APP.mode === 'textToImage') return false;
    const checkbox = document.getElementById('useCharRefCheckbox');
    return (checkbox?.checked ?? false) && !!APP.characterRefAssets;
}

/**
 * 이미지 프롬프트 TXT 내보내기 텍스트 빌드
 * ★ 캐릭터 레퍼런스 프롬프트 섹션 + 씬 프롬프트 섹션 결합
 * - 수동 Download 버튼에서 사용
 *
 * 모드별 캐릭터 레퍼런스 소스:
 * - scriptToImage / factory: APP.characterRefs (Gemini 생성 + 사용자 업로드 병합)
 * - textToImage (P2I):       APP.p2iCustomCharRefs (사용자 업로드만, 각 슬롯별)
 */
function buildImagePromptsExportText() {
    // 1. 캐릭터 레퍼런스 섹션 — 모드별 소스 병합
    const refsList = [];

    // 1-A. AI 생성 + 대본/팩토리 모드 사용자 업로드 (APP.characterRefs)
    if (Array.isArray(APP.characterRefs) && APP.characterRefs.length > 0) {
        APP.characterRefs.forEach(r => {
            const lines = [];
            const header = r.name ? `[${r.code}] ${r.name}` : `[${r.code}]`;
            lines.push(header);
            if (r.description) lines.push(`Description: ${r.description}`);
            if (r.prompt) lines.push(`Prompt: ${r.prompt}`);
            if (r.refSheetPrompt) lines.push(`RefSheet: ${r.refSheetPrompt}`);
            refsList.push(lines.join('\n'));
        });
    }

    // 1-B. P2I 커스텀 레퍼런스 (프롬프트→이미지 모드 전용)
    //   - 사용자가 직접 업로드한 이미지의 name/prompt 기록
    //   - base64 이미지 자체는 제외 (용량 + 가독성)
    if (APP.mode === 'textToImage' && APP.p2iCustomCharRefs) {
        const codes = ['MCR', 'SC1', 'SC2', 'SC3', 'SC4', 'SC5'];
        codes.forEach(code => {
            const slot = APP.p2iCustomCharRefs[code];
            if (slot && (slot.image || slot.prompt || slot.name)) {
                const lines = [];
                const header = slot.name ? `[${code}] ${slot.name}` : `[${code}]`;
                lines.push(header);
                if (slot.prompt) lines.push(`Prompt: ${slot.prompt}`);
                if (slot.image) lines.push(`Image: (user uploaded — base64 excluded)`);
                refsList.push(lines.join('\n'));
            }
        });
    }

    let charRefsText = '';
    if (refsList.length > 0) {
        charRefsText = `=== CHARACTER REFERENCES (${refsList.length}) ===\n\n${refsList.join('\n\n')}\n\n=== SCENE PROMPTS ===\n\n`;
    }

    // 2. 씬 프롬프트 섹션 (APP.prompts 우선, fallback DOM textarea)
    let sceneText = '';
    if (Array.isArray(APP.prompts) && APP.prompts.length > 0) {
        sceneText = APP.prompts.map(p =>
            `[${p.number}]\n${p.characters || 'BG'}\n${p.scriptText || ''}\n${p.sceneDesc || ''}\n${p.charProps || ''}\n${p.action || ''}`
        ).join('\n\n');
    }
    if (!sceneText) sceneText = $('#generatedPromptsText')?.value || '';

    // ★ P2I 모드는 APP.prompts 가 사용자 입력 그대로 → textarea 내용 그대로 사용
    //   (parseOneBlock 이 text/rawText 필드로 구성하므로 APP.prompts 에서도 작동)
    if (APP.mode === 'textToImage' && !sceneText) {
        sceneText = $('#promptInput')?.value || '';
    }

    return charRefsText + sceneText;
}

function showGeneratedPrompts(prompts, partial = false, totalRequested = 0) {
    const text = prompts.map(p =>
        `[${p.number}]\n${p.characters || 'BG'}\n${p.scriptText}\n${p.sceneDesc}\n${p.charProps}\n${p.action}`
    ).join('\n\n');

    const countEl = $('#generatedCount');
    const textEl = $('#generatedPromptsText');
    const section = $('#generatedPromptsSection');
    const badge = section?.querySelector('.success-badge');

    if (countEl) countEl.textContent = prompts.length;
    if (textEl) textEl.value = text;

    // ★ 부분 완료 vs 전체 완료 배지 분기
    if (badge) {
        if (partial && totalRequested > 0) {
            badge.innerHTML = `⚠️ <span>${"PARTIAL — Change API key and click Resume"}</span> (${prompts.length}/${totalRequested})`;
            badge.classList.add('partial');
        } else {
            badge.innerHTML = `✅ <span>PROMPTS GENERATED !</span> (<span id="generatedCount">${prompts.length}</span>)`;
            badge.classList.remove('partial');
        }
    }

    if (section) {
        section.classList.remove('hidden');
        setTimeout(() => section.scrollIntoView({ behavior: 'smooth' }), 100);
    }
}

function handleEditVideoPrompts() {
    const items = APP.factory.videoQueue;
    if (!items || items.length === 0) return;
    const allText = items.map(item =>
        `[${item.number}]\n${item.characters || 'BG'}\n${item.scriptText || ''}\n${item.prompt || ''}`
    ).join('\n\n');

    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
    <div class="modal modal-large">
      <div class="modal-header">
        <span>${"Edit Video Prompts"}</span>
        <button class="modal-close">&times;</button>
      </div>
      <div class="modal-body">
        <textarea id="editVideoPromptsText" class="textarea" rows="12"></textarea>
        <p class="info-text">Format: line 1 [number], line 2 character code, line 3 script, line 4+ video prompt. Syncs automatically with the thumbnail list on save.</p>
      </div>
      <div class="modal-footer">
        <button id="btnCancelEditVideo" class="btn btn-secondary">${"CANCEL"}</button>
        <button id="btnSaveEditVideo" class="btn btn-primary">${"SAVE"}</button>
      </div>
    </div>`;
    document.body.appendChild(modal);

    const textarea = modal.querySelector('#editVideoPromptsText');
    textarea.value = allText;

    modal.querySelector('.modal-close').addEventListener('click', () => modal.remove());
    modal.querySelector('#btnCancelEditVideo').addEventListener('click', () => modal.remove());
    modal.querySelector('#btnSaveEditVideo').addEventListener('click', () => {
        const text = modal.querySelector('#editVideoPromptsText').value;
        if (parseAndApplyVideoPromptsFromText(text)) {
            renderVideoPromptList();
            updateGeneratedVideoPromptsText();
            showToast("Saved", 'success');
        }
        modal.remove();
    });
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
}

function handleEditPrompts() {
    if (!APP.prompts || APP.prompts.length === 0) return;
    const allText = APP.prompts.map(p =>
        `[${p.number}]\n${p.characters || 'BG'}\n${p.scriptText}\n${p.sceneDesc}\n${p.charProps}\n${p.action}`
    ).join('\n\n');

    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
    <div class="modal modal-large">
      <div class="modal-header">
        <span>${"Edit All Prompts"}</span>
        <button class="modal-close">&times;</button>
      </div>
      <div class="modal-body">
        <textarea id="editAllPromptsText" class="textarea" rows="15">${allText}</textarea>
        <p class="info-text">Format: [Number] / Characters / Script / Scene / Props / Action</p>
      </div>
      <div class="modal-footer">
        <button id="btnCancelEditAll" class="btn btn-secondary">${"CANCEL"}</button>
        <button id="btnSaveEditAll" class="btn btn-primary">${"SAVE"}</button>
      </div>
    </div>`;
    document.body.appendChild(modal);

    modal.querySelector('.modal-close').addEventListener('click', () => modal.remove());
    modal.querySelector('#btnCancelEditAll').addEventListener('click', () => modal.remove());
    modal.querySelector('#btnSaveEditAll').addEventListener('click', () => {
        const text = modal.querySelector('#editAllPromptsText').value;
        const parsed = parseEditedPromptsV3(text);
        if (parsed.length > 0) {
            APP.prompts = parsed;
            showGeneratedPrompts(APP.prompts, !!APP.resumeState);
            rebuildQueueFromPrompts();
            showQueue();
            saveSession();
            showToast("Prompts updated", 'success');
        }
        modal.remove();
    });
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
}

function parseEditedPromptsV3(text) {
    const prompts = [];
    const regex = /\[(\d+)\]\s*\n([^\n]+)\s*\n([^\n]+)\s*\n([^\n]+)\s*\n([^\n]+)\s*\n([^\n]+)/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
        const sceneDesc = match[4].trim();
        const charProps = match[5].trim();
        const action = match[6].trim();
        const rawPrompt = `${sceneDesc} ${charProps} ${action}`;
        const rawChars = match[2].trim();
        prompts.push({
            number: match[1].trim(),
            characters: (rawChars === 'BG') ? '' : rawChars,
            scriptText: match[3].trim(),
            sceneDesc, charProps, action,
            rawPrompt,
            prompt: typeof convertCharacterCodes === 'function'
                ? convertCharacterCodes(rawPrompt)
                : rawPrompt
        });
    }
    return prompts;
}

function rebuildQueueFromPrompts() {
    const charRefItems = APP.queue.filter(q => q.type === 'characterRef');
    APP.queue = [...charRefItems];
    APP.prompts.forEach((p) => {
        APP.queue.push({
            text: p.prompt, status: 'ready', type: 'scene',
            rawPrompt: p.rawPrompt, rawText: p.rawText,
            number: p.number, characters: p.characters, scriptText: p.scriptText
        });
    });
}

/**
 * 9:16 세로 모드용: 좌우분할 → 상하분할로 프롬프트 변환
 * 상단: 4개 그리드(얼굴 클로즈업), 하단: 2개 버티컬(전신 정면/후면)
 */
function adaptCharRefPromptForPortrait(prompt) {
    if (!prompt || typeof prompt !== 'string') return prompt;
    return prompt
        .replace(/\b16:9\b/g, '9:16')
        .replace(/split vertically into two panels?/gi, 'split horizontally into two sections')
        .replace(/canvas split vertically/gi, 'canvas split horizontally')
        .replace(/\bLEFT panel\b/gi, 'TOP section')
        .replace(/\bRIGHT panel\b/gi, 'BOTTOM section')
        .replace(/\bLEFT:\s*/gi, 'TOP: ')
        .replace(/\bRIGHT:\s*/gi, 'BOTTOM: ');
}

async function handleGenerateAllRefs() {
    if (!APP.characterRefs || APP.characterRefs.length === 0) return;

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!isFlowTabUrl(tab?.url)) {
        showToast("Flow page (flow.google.com) required. Please open flow.google.com in a new tab.", 'error');
        await checkFlowTabAndShowModal();
        return;
    }

    // ★ PRO 2.0: 사용자가 업로드한 캐릭터는 이미 이미지가 있으므로 Flow 생성 스킵
    // characterRefAssets에 사용자 업로드 즉시 주입 (재생성 없이 재사용)
    const customCodes = new Set();
    if (APP.useCustomCharRefs && typeof hasCustomCharRef === 'function') {
        const codes = (typeof CCR_CODES !== 'undefined') ? CCR_CODES : ['MCR','SC1','SC2','SC3','SC4','SC5'];
        codes.forEach(code => {
            if (hasCustomCharRef(code)) {
                customCodes.add(code);
                const slot = APP.customCharRefs[code];
                if (!APP.characterRefAssets) APP.characterRefAssets = {};
                APP.characterRefAssets[code] = {
                    filename: `${code}_custom.jpg`,
                    base64: slot.image,
                    name: slot.name || code
                };
            }
        });
        if (customCodes.size > 0) {
            chrome.storage.local.set({ characterRefAssets: APP.characterRefAssets }).catch(() => {});
            console.log(`🎨 [PRO 2.0] 사용자 업로드 캐릭터 ${customCodes.size}개 재사용 (Flow 생성 스킵):`,
                [...customCodes].join(', '));

            // ★ PRO 2.0: 사용자 업로드 이미지도 다운로드 폴더에 저장
            //    (서브폴더 없이 프로젝트 루트에 _custom_ 접미사로 저장)
            const projectName = $('#controlProjectName')?.value?.trim() || 'my_project';
            const downloadFolder = APP.settings.downloadFolder || 'AI4Next';
            customCodes.forEach(code => {
                const slot = APP.customCharRefs[code];
                if (!slot?.image) return;
                const safeName = (slot.name || code).replace(/\s/g, '');
                const filename = `${projectName}/${code}_custom_${safeName}.jpg`;
                chrome.runtime.sendMessage({
                    type: 'DOWNLOAD_FILE',
                    url: slot.image,  // data:image/jpeg;base64,...
                    filename,
                    folder: downloadFolder
                }).catch(() => {});
            });

            // 사용자 업로드 ref 상태를 'completed'로 마킹 (UI 피드백)
            APP.characterRefs.forEach(r => {
                if (customCodes.has(r.code)) {
                    r.status = 'completed';
                    r.userUploaded = true;
                }
            });
        }
    }

    const btn = $('#btnGenerateAllRefs');

    APP.isGeneratingRefs = true;
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner"></span> ' + "GENERATING CHARACTER REFERENCES";
    }
    // 이전 완료 메시지 숨기기
    $('#charRefCompletionMsg')?.classList.add('hidden');

    // ★ PRO 2.0: 사용자 업로드 코드는 제외하고, AI 생성 대상만 필터링
    const refsToGenerate = APP.characterRefs.filter(r => !customCodes.has(r.code));

    if (refsToGenerate.length === 0) {
        // 모든 캐릭터가 사용자 업로드로 완료됨 → Flow 호출 스킵
        showToast('✓ All characters covered by user uploads — generation skipped', 'success');
        APP.isGeneratingRefs = false;
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = "GENERATE CHARACTER REFERENCE IMAGES";
        }
        renderCharacterRefs(APP.characterRefs);
        renderCharRefThumbnails(APP.characterRefAssets);
        $('#charRefCompletionMsg')?.classList.remove('hidden');

        // ★ 팩토리 FULL AUTO 전용 — 다른 모드엔 절대 영향 없음
        //   3중 가드:
        //     ① APP.mode === 'factory' (모드 체크)
        //     ② APP.factory?.charRefReadyResolve 존재 (FULL AUTO 시점에만 set됨 L2724)
        //     ③ typeof resolve === 'function' (타입 체크)
        //   대본투이미지·P2I·P2V·이미지투비디오 모두 이 가드 통과 못함 → 영향 없음
        if (APP.mode === 'factory') {
            const resolve = APP.factory?.charRefReadyResolve;
            if (typeof resolve === 'function') {
                APP.factory.charRefReadyResolve = null;
                setTimeout(() => resolve(), 500);
            }
        }
        return;
    }

    const totalRefs = refsToGenerate.length;

    const prefix = APP.settings.imageGenPrefix ?? '';
    // 캐릭터레퍼런스 생성: 4-view 시트용 refSheetPrompt 사용 (없으면 prompt 폴백)
    const aspectRatio = APP.settings.aspectRatio || '16:9';
    const refPayloads = refsToGenerate.map((ref, idx) => {
        let effectivePrompt = ref.refSheetPrompt || ref.prompt;
        if (aspectRatio === '9:16' || aspectRatio === '3:4') {
            effectivePrompt = adaptCharRefPromptForPortrait(effectivePrompt);
        }
        return {
        promptIndex: idx,
        prompt: prefix + effectivePrompt,
        rawPrompt: effectivePrompt,
        mode: 'scriptToImage',
        aspectRatio,
        images: [],
        outputCount: 2,
        type: 'characterRef',
        code: ref.code,
        name: ref.name || ref.code || '',
        scriptText: ref.name || ref.code || '',
        number: String(idx + 1).padStart(2, '0'),
        characters: ref.code || 'MCR'
    };
    });

    const projectName = $('#controlProjectName')?.value?.trim() || 'my_project';
    chrome.runtime.sendMessage({
        type: 'SETUP_DOWNLOAD',
        folder: APP.settings.downloadFolder || 'AI4Next',
        subfolder: projectName
    });

    const settings = {
        mode: 'scriptToImage',
        ...APP.settings,
        projectName,
        styleImage: null,  // 캐릭터레퍼런스: 스타일첨부 미사용
        isCharRefGeneration: true
    };

    // ★ PRO 2.0: 사용자 업로드 코드는 'completed' 유지, 나머지만 'generating'
    APP.characterRefs.forEach(r => {
        if (!customCodes.has(r.code)) r.status = 'generating';
    });
    renderCharacterRefs(APP.characterRefs);

    // ★ 대본투이미지/팩토리 수동 생성 시 10분 타임아웃 (FULL AUTO는 상단 Promise에서 처리)
    const CHAR_REF_TIMEOUT_MS = 600000;
    const isFullAutoWaiting = !!APP.factory.charRefReadyResolve;
    let charRefTimeoutId = null;
    if (!isFullAutoWaiting) {
        charRefTimeoutId = setTimeout(() => {
            if (!APP.isGeneratingRefs) return;
            APP.factory.charRefGenerationTimeoutId = null;
            APP.isGeneratingRefs = false;
            APP.characterRefs?.forEach(r => { if (r.status !== 'failed') r.status = 'pending'; });
            if (APP.characterRefs?.length) renderCharacterRefs(APP.characterRefs);
            const btnGen = $('#btnGenerateAllRefs');
            if (btnGen) {
                btnGen.disabled = false;
                btnGen.innerHTML = "GENERATE CHARACTER REFERENCE IMAGES";
            }
        }, CHAR_REF_TIMEOUT_MS);
        APP.factory.charRefGenerationTimeoutId = charRefTimeoutId;
    }

    // ★ 정정: 긴 버튼(btnGenerateAllRefs)은 "새 프로젝트부터" 시작 — 기존 동작 유지
    //    개별 REGEN(🔄)만 현재 프로젝트 내 재생성 (runCharRefRegenOnly)
    // ★ STOP 버튼 표시
    const stopBtn = $('#btnStopCharRefGen');
    if (stopBtn) stopBtn.classList.remove('hidden');
    APP._charRefGenStopRequested = false;

    try {
        await sendPayloadsToContentScript(tab, refPayloads, false, false, { isCharRefGeneration: true, styleImage: null });
    } catch (err) {
        if (charRefTimeoutId) clearTimeout(charRefTimeoutId);
        APP.factory.charRefGenerationTimeoutId = null;
        showToast(`${"Error"}: ${err.message}`, 'error');
        APP.isGeneratingRefs = false;
        APP.characterRefs.forEach(r => r.status = 'pending');
        renderCharacterRefs(APP.characterRefs);
        if (stopBtn) stopBtn.classList.add('hidden');
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = "GENERATE CHARACTER REFERENCE IMAGES";
        }
    }
}

// ★ PRO 2.0: 캐릭터 레퍼런스 생성 수동 정지 (긴 버튼 + 개별 리젠 모두 대상)
async function handleStopCharRefGen() {
    APP._charRefGenStopRequested = true;

    // 타임아웃 정리
    if (APP.factory?.charRefGenerationTimeoutId) {
        clearTimeout(APP.factory.charRefGenerationTimeoutId);
        APP.factory.charRefGenerationTimeoutId = null;
    }
    if (APP._regenTimeouts) {
        Object.keys(APP._regenTimeouts).forEach(c => {
            if (APP._regenTimeouts[c]) { clearTimeout(APP._regenTimeouts[c]); APP._regenTimeouts[c] = null; }
        });
    }

    // 'generating' 상태 복구
    if (Array.isArray(APP.characterRefs)) {
        APP.characterRefs.forEach(r => { if (r.status === 'generating') r.status = 'pending'; });
        renderCharacterRefs(APP.characterRefs);
    }

    APP.isGeneratingRefs = false;
    const btnGen = $('#btnGenerateAllRefs');
    if (btnGen) {
        btnGen.disabled = false;
        const hasGen = APP.characterRefs?.some(r => r.status === 'completed');
        btnGen.innerHTML = hasGen
            ? `🔄 ${"REGENERATE ALL CHARACTER REFERENCES"}`
            : "GENERATE CHARACTER REFERENCE IMAGES";
    }
    $('#btnStopCharRefGen')?.classList.add('hidden');

    // content script에 중단 알림 (옵션 — 실패해도 UI는 이미 복구됨)
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab?.id && isFlowTabUrl(tab.url)) {
            chrome.tabs.sendMessage(tab.id, { type: 'STOP_CHAR_REF_GEN' }).catch(() => {});
        }
    } catch (_) {}

    showToast("⏹ Character reference generation stopped", 'info');
}

async function regenerateSingleCharacter(code) {
    const ref = APP.characterRefs.find(r => r.code === code);
    if (!ref) return;

    // 즉시 버튼을 스피너만 표시 (REGEN 텍스트 제거)
    const btn = document.querySelector(`.btn-regenerate[data-code="${code}"]`);
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<span class="spinner spinner-dark"></span>`;
    }
    ref.status = 'generating';

    // ★ PRO 2.0: 단일 재생성 타임아웃 (3분) — 무한 스피너 방지
    APP._regenTimeouts = APP._regenTimeouts || {};
    if (APP._regenTimeouts[code]) clearTimeout(APP._regenTimeouts[code]);
    APP._regenTimeouts[code] = setTimeout(() => {
        if (ref.status === 'generating') {
            ref.status = 'failed';
            renderCharacterRefs(APP.characterRefs);
            showToast(`⏱ ${code} regeneration timed out (3 min). Please try again.`, 'error');
        }
        APP._regenTimeouts[code] = null;
    }, 180000);  // 3분

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!isFlowTabUrl(tab?.url)) {
        showToast("Flow page (flow.google.com) required. Please open flow.google.com in a new tab.", 'error');
        await checkFlowTabAndShowModal();
        ref.status = 'completed';
        renderCharacterRefs(APP.characterRefs);
        if (APP._regenTimeouts[code]) { clearTimeout(APP._regenTimeouts[code]); APP._regenTimeouts[code] = null; }
        return;
    }

    const prefix = APP.settings.imageGenPrefix ?? '';
    // 캐릭터레퍼런스 재생성: 스타일첨부 미사용
    const refIndex = APP.characterRefs.findIndex(r => r.code === code);
    const aspectRatio = APP.settings.aspectRatio || '16:9';
    let effectivePromptForPayload = ref.refSheetPrompt || ref.prompt;
    if (aspectRatio === '9:16' || aspectRatio === '3:4') {
        effectivePromptForPayload = adaptCharRefPromptForPortrait(effectivePromptForPayload);
    }
    const refPayloads = [{
        promptIndex: refIndex >= 0 ? refIndex : 0,
        prompt: prefix + effectivePromptForPayload,
        rawPrompt: effectivePromptForPayload,
        mode: 'scriptToImage',
        aspectRatio,
        images: [],
        outputCount: 2,
        type: 'characterRef',
        code: ref.code,
        name: ref.name || ref.code || '',
        scriptText: ref.name || ref.code || '',
        number: String(refIndex + 1).padStart(2, '0'),
        characters: ref.code || 'MCR'
    }];

    const projectName = $('#controlProjectName')?.value?.trim() || 'my_project';
    const settings = {
        mode: 'scriptToImage',
        ...APP.settings,
        projectName,
        styleImage: null,  // 캐릭터레퍼런스: 스타일첨부 미사용
        isCharRefGeneration: true
    };

    try {
        await sendPayloadsToContentScript(tab, refPayloads, false, true, { isCharRefRegen: true });
    } catch (err) {
        showToast(`${"Error"}: ${err.message}`, 'error');
        ref.status = 'pending';
        renderCharacterRefs(APP.characterRefs);
    }
}

// ========== PROMPT/TEXT HANDLING ==========
// ★ P2I 전용: 슬롯 변경 시 큐의 캐릭터 뱃지를 즉시 재계산
//   - P2I 모드 + 큐가 이미 표시 중 + 생성 중이 아닐 때만 발동
//   - 새 큐를 만들어 기존 status/에러 상태는 덮어쓰지 않고 characters 필드만 갱신
//   - 아직 생성 시작 전이므로 전체 재생성이 안전
window.refreshP2IQueueBadges = function refreshP2IQueueBadges() {
    if (APP.mode !== 'textToImage') return;
    if (APP.isRunning) return;  // 생성 중에는 큐 변경 금지
    const section = document.getElementById('section-queue');
    if (!section || section.classList.contains('hidden')) return;  // 큐 미표시 시 skip
    try {
        const fresh = getPromptsFromInput();
        if (!fresh || fresh.length === 0) return;
        // characters 필드만 머지 (기존 큐 순서/상태 유지)
        if (APP.queue && APP.queue.length === fresh.length) {
            for (let i = 0; i < fresh.length; i++) {
                if (APP.queue[i] && fresh[i]) {
                    APP.queue[i].characters = fresh[i].characters;
                    APP.queue[i].useReference = fresh[i].useReference;
                    APP.queue[i].characterRefAssets = fresh[i].characterRefAssets;
                }
            }
        } else {
            APP.queue = fresh;
        }
        if (typeof showQueue === 'function') showQueue();
    } catch (e) { /* silent */ }
};

/** Prompts are split by the user-configurable literal separator. */
function getPromptSplitterConfig() {
    return { mode: 'literal', separator: getPromptSeparator(), customRegex: '' };
}

const scheduleAutoPreview = debounce(() => previewPromptQueue({ silent: true }), 280);

function previewPromptQueue(options = {}) {
    const silent = options === true || options.silent === true;
    if (APP.isRunning) return;
    if (APP.mode !== 'textToImage' && APP.mode !== 'textToVideo') return;
    const parsed = getPromptsFromInput();
    if (parsed === null) return;
    if (!parsed.length) {
        APP.queue = [];
        showQueue();
        updateStartButtonState();
        if (!silent) showToast('请粘贴提示词，或检查提示词分隔符设置。', 'warning');
        return;
    }
    APP.queue = parsed;
    showQueue();
    updateStartButtonState();
    if (!silent) {
        saveSession();
        showToast(`任务就绪：共 ${parsed.length} 组提示词`, 'success');
    }
}

function splitPrompts(text, mode = 'literal', customRegex = '', separator = '###') {
    const normalized = String(text || '')
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .replace(/```[\s\S]*?```/g, m => m.replace(/```\w*\n?/g, '').replace(/```/g, ''))
        .replace(/\*\*/g, '')
        .replace(/\*/g, '');

    let splitter;
    if (mode === 'literal') {
        splitter = new RegExp(`(?:^|\\n)\\s*${escapeRegExp(normalizePromptSeparator(separator))}\\s*(?:\\n|$)`, 'g');
    } else if (mode === 'dash') {
        splitter = /\n\s*---+\s*\n/g;
    } else if (mode === 'hash') {
        splitter = /\n\s*###+\s*\n/g;
    } else if (mode === 'custom') {
        if (!customRegex.trim()) {
            throw new Error('Enter a custom regex splitter first.');
        }
        try {
            splitter = new RegExp(customRegex, 'g');
        } catch (e) {
            throw new Error('Invalid custom regex. Please check the pattern.');
        }
    } else {
        splitter = /\n\s*\n/g;
    }

    const literalSeparator = escapeRegExp(normalizePromptSeparator(separator));
    const isSeparatorOnly = (b) => new RegExp(`^(?:[=\\-_*~#\\s]+|\\s*${literalSeparator}\\s*)$`).test(b);
    return normalized
        .split(splitter)
        .map(b => b.trim())
        .filter(b => b && !isSeparatorOnly(b));
}

function getPromptsFromInput() {
    // scriptToImage와 factory는 AI 프롬프트 생성 후 APP.queue 사용
    if (APP.mode === 'scriptToImage' || APP.mode === 'factory') {
        return APP.queue; // Already generated via AI
    }

    if (APP.mode === 'textToImage' || APP.mode === 'textToVideo') {
        const text = $('#promptInput')?.value?.trim();
        if (!text) return [];

        const { mode, customRegex, separator } = getPromptSplitterConfig();
        let blocks;
        try {
            blocks = splitPrompts(text, mode, customRegex, separator);
        } catch (e) {
            showToast(e.message || 'Invalid prompt splitter.', 'error');
            return null;
        }
        return blocks.map((block, idx) => parseOneBlock(block, idx)).filter(Boolean);
    }

    if (APP.mode === 'imageToVideo') {
        return APP.queue;
    }

    return [];
}

function extractCharacterCodes(text) {
    const codes = [];
    const patterns = [/\bMCR\b/gi, /\bSC\d{1,2}\b/gi, /\bTC\d{1,2}\b/gi];
    const upper = text.toUpperCase();
    for (const pat of patterns) {
        const matches = upper.match(pat);
        if (matches) {
            matches.forEach(m => {
                const n = m.toUpperCase();
                if (!codes.includes(n)) codes.push(n);
            });
        }
    }
    return codes.length > 0 ? codes.join(',') : '';
}

function getUploadedP2IReferenceCodes() {
    const refs = APP.p2iCustomCharRefs || {};
    return ['MCR', 'SC1', 'SC2', 'SC3', 'SC4', 'SC5'].filter(code => refs[code] && refs[code].image);
}

/**
 * 블록 하나 파싱 (빈 줄로 쪼개진 후 호출)
 * 형식: [03] / MCR,SC1 / 대사한줄 / [Korean Context]...
 * scriptText는 파일명용으로 대사 줄(세 번째 줄)만 사용
 */
function parseOneBlock(block, idx) {
    // ★ 구분선 전용 블록 방어 (이중 필터 — getPromptsFromInput 에서 먼저 거름)
    if (!block || /^[=\-_*~#\s]+$/.test(block)) return null;

    const lines = block.split('\n').map(l => l.trim());
    const firstLine = lines[0] || '';
    const numMatch = firstLine.match(/\[0?(\d+)\]/);

    let number, rawText, scriptLine = '';
    if (numMatch) {
        number = numMatch[1].padStart(2, '0');
        // ★ BG 라인뿐 아니라 구분선 라인도 제외
        const contentLines = lines.slice(1).filter(l => l && l !== 'BG' && !/^[=\-_*~#]+$/.test(l));
        rawText = contentLines.join(' ').trim();
        // 대사 줄 추출 — 모드별 포맷 지원:
        //   [대본투이미지 모드] [번호]\nMCR\n대사\n지문...  → lines[2] 가 대사
        //   [프롬프트투이미지 모드] [번호]\n대사\n[Korean Context]... → lines[1] 이 대사
        //
        // 규칙: "[번호] 다음 줄부터 첫 번째 '괄호로 시작하지 않고 캐릭터 코드도 아닌 줄'"
        //   이렇게 하면 두 포맷 모두 대사 줄을 정확히 집어냄
        // ★ v1.1.3 fix: BG/ETC도 캐릭터 코드 라인으로 인식 (대본 텍스트로 오인 방지)
        //   이전 버그: [03]\nBG\n대사\n... 에서 BG를 scriptLine으로 잡아서 파일명에서 대사 누락
        //   ETC: 추가 캐릭터(기타) 표시용 코드 — 같은 패턴 처리
        const isCharCodeLine = (s) => /^(BG|ETC|MCR|SC[1-5])(\s*,\s*(BG|ETC|MCR|SC[1-5]))*$/i.test(s.trim());
        for (let i = 1; i < Math.min(lines.length, 5); i++) {
            const candidate = (lines[i] || '').trim();
            if (!candidate) continue;
            if (candidate.startsWith('[') || candidate.startsWith('(') || candidate.startsWith('{')) continue;
            if (isCharCodeLine(candidate)) continue;
            if (/^[A-Za-z].*\.$/.test(candidate)) continue;  // 영문 문장(프롬프트)형 제외
            scriptLine = candidate;
            break;
        }
    } else {
        number = String(idx + 1).padStart(2, '0');
        rawText = block.replace(/\s+/g, ' ').trim();
    }

    if (!rawText) return null;

    const prompt = typeof convertCharacterCodes === 'function'
        ? convertCharacterCodes(rawText)
        : rawText;

    // ★ P2I v1.7: 캐릭터 뱃지 매칭 — P2I 모드 + CCR ON 시 확장 매칭 사용
    //   - 기본 extractCharacterCodes 는 MCR/SC1~5 코드만 탐지 → 대부분 기본값 'MCR' 로 떨어짐
    //   - P2I 에서는 parseCharacterCodesFromPromptP2I (코드 + 별칭 + 이름 + 슬롯 설명) 활용
    //   - 매칭 실패 시 'BG' (배경 — 캐릭터 미등장) 로 표기 → 사용자에게 정확한 정보 전달
    let characters;
    if (APP.mode === 'textToImage') {
        characters = extractCharacterCodes(rawText) || '';
    } else {
        // 대본/팩토리 모드 — Gemini 가 코드 지정. fallback 'MCR' 유지 (기존 호환)
        characters = extractCharacterCodes(rawText) || 'MCR';
    }

    const st = scriptLine || (typeof cleanScriptText === 'function'
        ? cleanScriptText(rawText)
        : rawText.replace(/[\s!?.,;:'"''""\-—–…·]/g, '').substring(0, 50));

    // @mention of an UPLOAD ASSETS image auto-enables "Use reference image for this prompt".
    const mentionIdx = resolveMentionsToIndices(rawText);
    const useReference = (APP.mode === 'textToImage' || APP.mode === 'textToVideo') && mentionIdx.length > 0;

    const item = {
        text: prompt,
        rawText,
        status: 'ready',
        type: 'scene',
        number,
        characters,
        scriptText: st,
        useReference
    };

    if (mentionIdx.length) {
        item.assetIndices = mentionIdx.slice();
        // Keep @mentions in the prompt text exactly as typed; Flow still gets
        // the referenced assets via assetIndices / promptSegments.
    }

    return item;
}

// ========== 429 재개 (Resume) ==========
/** [🔄 이어서 생성] 버튼 표시/숨김 */
function _updateResumeButton() {
    const btn = document.getElementById('btnResumeGeneration');
    if (!btn) return;

    // 이벤트 리스너 (최초 1회만 등록)
    if (!btn._resumeListenerAdded) {
        btn.addEventListener('click', _handleResumeGeneration);
        btn._resumeListenerAdded = true;
    }

    if (APP.resumeState) {
        btn.classList.remove('hidden');
        btn.disabled = false;
        btn.innerHTML = '🔄 <span>' + ("Resume Prompt Generation") + '</span>';
    } else {
        btn.classList.add('hidden');
    }
}

/** 재개 실행 */
async function _handleResumeGeneration() {
    if (!APP.resumeState) {
        showToast('No state to resume.', 'error');
        return;
    }

    const btn = document.getElementById('btnResumeGeneration');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner"></span> Resuming generation...';
    }

    try {
        const apiKey = getActiveApiKey();
        if (!apiKey) {
            const isOp = APP.settings.aiProvider === 'openai';
            showToast(isOp ? "请在设置中输入 API Key (如 DeepSeek/OpenAI)。" : "请在设置中输入 Gemini API Key。", 'error');
            if (btn) { btn.disabled = false; btn.innerHTML = '🔄 <span>' + ("Resume Prompt Generation") + '</span>'; }
            return;
        }

        const existingPrompts = APP.resumeExistingPrompts || APP.prompts || [];

        const totalRequested = (existingPrompts.length || 0) + (APP.resumeState.remainingBatches || []).reduce((a, b) => a + b.reduce((x, s) => x + s.numPrompts, 0), 0);
        const result = await resumePromptsGeneration(
            APP.resumeState, existingPrompts, apiKey,
            (phase, current, total, startNum, endNum, data) => {
                if (btn && phase === 'batch') {
                    btn.innerHTML = `<span class="spinner"></span> Resuming... batch ${current}/${total}`;
                } else if (phase === 'batch_done' && data) {
                    if (btn) {
                        const done = endNum || 0;
                        btn.innerHTML = `<span class="spinner"></span> Resume ${current}/${total} done ✓ | ${done} items`;
                    }
                    // 배치별 자동 저장
                    if (data.prompts && data.prompts.length > 0) {
                        const saveData = { resumeExistingPrompts: data.prompts.map(p => ({ ...p })) };
                        if (data.resumeState) saveData.resumeState = data.resumeState;
                        chrome.storage.session.set(saveData).catch(() => {});
                    }
                }
            }
        );

        const prompts = result.prompts || [];
        const characterRefs = result.characterRefs || APP.characterRefs || [];

        if (result.partial && result.resumeState) {
            // 재개 중에도 429 → 다시 부분 저장
            APP.resumeState = result.resumeState;
            APP.resumeExistingPrompts = prompts;
            chrome.storage.session.set({
                resumeState: result.resumeState,
                resumeExistingPrompts: prompts.map(p => ({ ...p }))
            });
            showToast(`⚠️ API limit hit again. ${prompts.length} generated so far. Change key and retry.`, 'warning', 10000);
        } else {
            // 전체 완료
            APP.resumeState = null;
            APP.resumeExistingPrompts = null;
            chrome.storage.session.remove(['resumeState', 'resumeExistingPrompts']);
            showToast(`✅ All ${prompts.length} prompts generated!`, 'success');
        }

        APP.prompts = prompts;
        APP.characterRefs = characterRefs;

        // 큐 재구성
        APP.queue = [];
        if (characterRefs.length > 0) {
            characterRefs.forEach((ref) => {
                APP.queue.push({
                    text: ref.prompt, status: 'ready', type: 'characterRef',
                    code: ref.code, name: ref.name
                });
            });
        }
        prompts.forEach((p) => {
            APP.queue.push({
                text: p.prompt, status: 'ready', type: 'scene',
                number: p.number, characters: p.characters, scriptText: p.scriptText
            });
        });

        renderCharacterRefs(characterRefs);
        showGeneratedPrompts(prompts, !!result.partial, totalRequested);
        showQueue();
        updateStartButtonState();
        _updateResumeButton();
        saveSession();

        // ★ Resume 전체 완료 + FULL AUTO 모드 → 자동으로 다음 단계(캐릭터 레퍼런스 → 이미지 생성) 진행
        //   초기 프롬프트 생성 경로(L2707~)와 동일한 로직
        //   3중 가드: result.partial 아님 + factory/scriptToImage + isFullAuto
        if (!result.partial
            && (APP.mode === 'factory' || APP.mode === 'scriptToImage')
            && APP.factory?.isFullAuto) {
            const STABILIZE_BEFORE_NEXT_MS = 4000;
            const refs = characterRefs;
            updateFactoryPhaseStatus('prompt_done', prompts.length);
            setTimeout(async () => {
                $('#section-progress')?.classList.remove('hidden');
                const btnCharRef = document.getElementById('btnGenerateAllRefs');
                if (btnCharRef) btnCharRef.scrollIntoView({ behavior: 'smooth', block: 'end' });
                else $('#section-progress')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                if (refs.length > 0) {
                    updateFactoryPhaseStatus('char_ref_generating');
                    let resolveCharRef;
                    const p = new Promise((resolve) => {
                        resolveCharRef = resolve;
                        APP.factory.charRefReadyResolve = resolve;
                        setTimeout(() => {
                            if (APP.factory.charRefReadyResolve === resolve) {
                                APP.factory.charRefReadyResolve = null;
                                if (APP.mode === 'factory') APP.isGeneratingRefs = false;
                                resolve();
                            }
                        }, 600000);  // 10분 타임아웃
                    });
                    try {
                        await handleGenerateAllRefs();
                        await p;
                    } catch (e) {
                        APP.factory.charRefReadyResolve = null;
                        if (resolveCharRef) resolveCharRef();
                    }
                } else {
                    await new Promise(r => setTimeout(r, STABILIZE_BEFORE_NEXT_MS));
                }
                updateFactoryPhaseStatus('image_start');
                startGeneration();
            }, STABILIZE_BEFORE_NEXT_MS);
        }
    } catch (e) {
        showToast(`Resume failed: ${e.message}`, 'error');
    }

    if (btn) { btn.disabled = false; btn.innerHTML = '🔄 <span>' + ("Resume Prompt Generation") + '</span>'; }
}

// ========== QUEUE UI ==========
function showQueue() {
    const section = $('#section-queue');
    const list = $('#promptList');
    const count = $('#queueCount');

    if (!section || !list) return;

    const sceneItems = APP.queue.filter(q => q.type !== 'characterRef');
    if (sceneItems.length === 0) {
        section.classList.add('hidden');
        list.innerHTML = '';
        if (count) count.textContent = '0';
        return;
    }

    section.classList.remove('hidden');
    count.textContent = sceneItems.length;

    const statusLabels = {
        ready: '<span class="queue-status-icon pending">⏸</span>',
        active: '<span class="queue-status-icon generating"><span class="queue-spinner"></span></span>',
        paused: '<span class="queue-status-icon pending">⏸</span>',
        done: '<span class="queue-status-icon success">✅</span>',
        fail: '<span class="queue-status-icon error">❌</span>'
    };

    list.innerHTML = sceneItems.map((item, idx) => {
        const visualStatus = (APP.isPaused && item.status === 'active') ? 'paused' : item.status;
        const statusClass = visualStatus;
        const isImgToVid = APP.mode === 'imageToVideo';
        const displayText = isImgToVid
            ? (item.text || '')
            : (item.filename || item.text);
        const num = item.number || String(idx + 1).padStart(2, '0');
        const charCode = item.characters
            ? `<span class="prompt-char-code">${item.characters}</span>`
            : '<span class="prompt-char-code none">BG</span>';
        const isGenerating = visualStatus === 'active';
        const escapedText = String(displayText || '')
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');

        if (isImgToVid) {
            const assetIndices = getI2vAssetIndices(item);
            const hasAsset = assetIndices.length > 0;
            const assetName = hasAsset
                ? (assetIndices.length === 1
                    ? (APP.imageFiles[assetIndices[0]]?.name || item.filename || 'Asset')
                    : `${assetIndices.length} assets`)
                : 'No asset';
            const stackImgs = assetIndices.slice(0, 3).map((ai) => {
                const url = (_previewUrls[ai] || item.previewUrls?.[assetIndices.indexOf(ai)] || item.previewUrl || '');
                return url ? `<img src="${url}" alt="">` : '';
            }).join('');
            const thumb = hasAsset
                ? `<span class="i2v-asset-stack">${stackImgs}</span>${assetIndices.length > 1 ? `<span class="i2v-asset-count-badge">${assetIndices.length}</span>` : ''}`
                : `<span class="i2v-asset-slot-plus">+</span><span class="i2v-asset-slot-label">Asset</span>`;
            const miniThumbs = hasAsset && assetIndices.length > 1
                ? `<div class="i2v-mini-thumbs">${assetIndices.map((ai) => {
                    const url = _previewUrls[ai] || '';
                    return url ? `<img src="${url}" alt="">` : '';
                }).join('')}</div>`
                : '';
            return `
      <div class="prompt-item i2v-queue-item${isGenerating ? ' generating' : ''} video-confirm-item" data-status="${visualStatus}" data-idx="${idx}">
        <button type="button" class="i2v-asset-slot${hasAsset ? ' has-asset' : ''}" data-assign-idx="${idx}" title="Assign assets">
          ${thumb}
        </button>
        <div class="i2v-queue-body">
          <div class="i2v-queue-meta">
            <span class="prompt-number">${num}</span>
            <span class="i2v-asset-name${hasAsset ? '' : ' empty'}">${String(assetName).replace(/</g, '&lt;')}</span>
            ${charCode}
          </div>
          ${miniThumbs}
          <span class="prompt-text" title="${escapedText}">${escapedText}</span>
        </div>
        <div class="i2v-queue-actions">
          <span class="prompt-status ${statusClass}">${statusLabels[visualStatus] || visualStatus}</span>
          <button type="button" class="i2v-clear-asset" data-clear-idx="${idx}" ${hasAsset ? '' : 'disabled'}>Clear</button>
        </div>
      </div>`;
        }

        return `
      <div class="prompt-item${isGenerating ? ' generating' : ''}" data-status="${visualStatus}" data-idx="${idx}">
        <span class="prompt-number">${num}</span>
        ${charCode}
        <span class="prompt-text" title="${escapedText}">${escapedText}</span>
        <span class="prompt-status ${statusClass}">${statusLabels[visualStatus] || visualStatus}</span>
      </div>
    `;
    }).join('');

    list.querySelectorAll('[data-assign-idx]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const idx = Number(e.currentTarget.dataset.assignIdx);
            openI2vAssetPicker(idx, e.currentTarget);
        });
    });

    list.querySelectorAll('[data-clear-idx]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const idx = Number(e.currentTarget.dataset.clearIdx);
            const item = sceneItems[idx];
            if (!item) return;
            clearI2vAssetAssignment(item);
            APP.videoQueueConfirmed = false;
            closeI2vAssetPicker();
            showQueue();
            updateStartButtonState();
            saveSession();
        });
    });

    // ★ 현재 생성 중인 항목으로 자동 스크롤 (박스 내부 스크롤)
    setTimeout(() => {
        if (APP.isPaused) return;
        const generatingItem = list.querySelector('.prompt-item.generating');
        if (generatingItem) {
            const generatingIdx = Number(generatingItem.dataset.idx);
            if (Number.isFinite(generatingIdx) && generatingIdx < (APP.flowUi.lastAutoScrollIndex ?? -1)) return;
            if (Number.isFinite(generatingIdx)) APP.flowUi.lastAutoScrollIndex = generatingIdx;
            const containerRect = list.getBoundingClientRect();
            const itemRect = generatingItem.getBoundingClientRect();

            if (itemRect.top < containerRect.top || itemRect.bottom > containerRect.bottom) {
                const scrollTop = generatingItem.offsetTop - list.offsetTop - (list.clientHeight / 2) + (generatingItem.clientHeight / 2);
                list.scrollTo({ top: Math.max(0, scrollTop), behavior: 'smooth' });
            }
        }
    }, 600);
}

function renderCompletionStats() {
    const stats = $('#completionStats');
    if (!stats) return;

    const successCount = APP.flowUi.generationSuccessCount || 0;
    const failCount = APP.flowUi.generationFailCount || 0;
    let html = `
      <span class="stat-success">${successCount}</span> ${"SUCCESS"} /
      <span class="stat-fail">${failCount}</span> ${"FAILED"}
    `;

    if (APP.flowUi.expectedDownloadCount > 0 || APP.flowUi.downloadVerified) {
        const downloaded = APP.flowUi.downloadedCount || 0;
        const downloadFailed = APP.flowUi.downloadFailedCount || 0;
        const expected = APP.flowUi.expectedDownloadCount || 0;
        const verifiedText = APP.flowUi.downloadVerified
            ? (downloadFailed > 0
                ? `${"SOME DOWNLOADS WERE INTERRUPTED"} ${downloaded}/${expected} · ${"FAILED"} ${downloadFailed}`
                : `${"DOWNLOAD VERIFICATION COMPLETE"} ${downloaded}/${expected}`)
            : `${"DOWNLOAD VERIFICATION IN PROGRESS"} ${downloaded}/${expected}`;
        html += `<div style="margin-top:8px;font-size:12px;opacity:0.85;">${verifiedText}</div>`;
    }

    stats.innerHTML = html;
}

function resetFlowUiTracking() {
    APP.flowUi.lastProgressSeq = -1;
    APP.flowUi.maxCompletedPrompts = 0;
    APP.flowUi.lastAutoScrollIndex = -1;
    APP.flowUi.downloadSessionId = '';
    APP.flowUi.expectedDownloadCount = 0;
    APP.flowUi.downloadedCount = 0;
    APP.flowUi.downloadFailedCount = 0;
    APP.flowUi.downloadVerified = false;
    APP.flowUi.generationSuccessCount = 0;
    APP.flowUi.generationFailCount = 0;
}

/**
 * videoPromptInput 텍스트를 splitter 설정으로 파싱
 * @returns {{ lines: string[], map: Map|null, hasSceneBlocks: boolean } | null}
 */
function parseVideoPrompts(text) {
    if (!text || !text.trim()) return null;

    const { mode, customRegex, separator } = getPromptSplitterConfig();
    let lines;
    try {
        lines = splitPrompts(text, mode, customRegex, separator);
    } catch (e) {
        showToast(e.message || 'Invalid prompt splitter.', 'error');
        return null;
    }

    // Fallback: [01] scene headers when splitter yields a single block
    if (lines.length <= 1) {
        const normalized = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
        if (/\n\s*\[\d+\]/.test('\n' + normalized)) {
            lines = normalized
                .split(/\n(?=\s*\[\d+\])/g)
                .map(b => b.trim())
                .filter(Boolean);
        }
    }

    const promptMap = new Map();
    let hasSceneBlocks = false;

    for (const line of lines) {
        const headerMatch = line.match(/^\[(\d+)\]\s*/);
        if (headerMatch) {
            hasSceneBlocks = true;
            const sceneNum = parseInt(headerMatch[1], 10);
            const promptBody = line.substring(headerMatch[0].length).trim();
            if (promptBody) promptMap.set(sceneNum, promptBody);
        }
    }

    return {
        lines,
        map: hasSceneBlocks ? promptMap : null,
        hasSceneBlocks
    };
}

const MAX_I2V_ASSETS_PER_PROMPT = 5;

function getI2vAssetIndices(item) {
    if (!item || item.useAsset === false) return [];
    const poolLen = APP.imageFiles?.length || 0;
    const valid = (arr) => [...new Set(arr)]
        .map(n => Number(n))
        .filter(n => Number.isInteger(n) && n >= 0 && n < poolLen);

    if (Array.isArray(item.assetIndices) && item.assetIndices.length) {
        return valid(item.assetIndices);
    }
    if (item.originalFileIndex != null) {
        return valid([item.originalFileIndex]);
    }
    return [];
}

function clearI2vAssetAssignment(item) {
    if (!item) return;
    item.useAsset = false;
    item.file = null;
    item.filename = '';
    item.previewUrl = '';
    item.previewUrls = [];
    item.originalFileIndex = null;
    item.assetIndices = [];
}

function syncI2vAssetFields(item, indices) {
    if (!item) return;
    const unique = [...new Set((indices || []).map(n => Number(n)))]
        .filter(n => Number.isInteger(n) && n >= 0 && n < (APP.imageFiles?.length || 0))
        .slice(0, MAX_I2V_ASSETS_PER_PROMPT);

    if (!unique.length) {
        clearI2vAssetAssignment(item);
        return;
    }

    item.useAsset = true;
    item.assetIndices = unique;
    item.originalFileIndex = unique[0];
    item.file = APP.imageFiles[unique[0]] || null;
    item.filename = unique.map(i => APP.imageFiles[i]?.name).filter(Boolean).join(', ');
    item.previewUrl = _previewUrls[unique[0]] || '';
    item.previewUrls = unique.map(i => _previewUrls[i] || '');
    const sceneRaw = extractSceneNumberRaw(APP.imageFiles[unique[0]]?.name || '');
    if (sceneRaw) item.number = sceneRaw;
}

function assignI2vAssetToItem(item, assetIdx) {
    syncI2vAssetFields(item, assetIdx == null ? [] : [assetIdx]);
}

function assignI2vAssetsToItem(item, assetIndices) {
    syncI2vAssetFields(item, assetIndices);
}

function rematerializeI2vAssetUrls() {
    if (APP.mode !== 'imageToVideo') return;
    APP.queue.forEach(item => {
        if (item?.type === 'characterRef') return;
        const indices = getI2vAssetIndices(item);
        syncI2vAssetFields(item, indices);
    });
}

function reindexI2vAssetsAfterRemoval(removedIdx) {
    if (APP.mode !== 'imageToVideo') return;
    APP.queue.forEach(item => {
        if (item?.type === 'characterRef') return;
        const next = getI2vAssetIndices(item)
            .filter(i => i !== removedIdx)
            .map(i => (i > removedIdx ? i - 1 : i));
        syncI2vAssetFields(item, next);
    });
}

function reindexI2vAssetsAfterReorder(fromIdx, toIdx) {
    if (APP.mode !== 'imageToVideo') return;
    APP.queue.forEach(item => {
        if (item?.type === 'characterRef') return;
        const next = getI2vAssetIndices(item).map((i) => {
            if (i === fromIdx) return toIdx;
            if (fromIdx < toIdx && i > fromIdx && i <= toIdx) return i - 1;
            if (fromIdx > toIdx && i >= toIdx && i < fromIdx) return i + 1;
            return i;
        });
        syncI2vAssetFields(item, next);
    });
}

function autoAssignI2vAssets({ onlyEmpty = false } = {}) {
    const used = new Set();
    if (onlyEmpty) {
        APP.queue.forEach(item => {
            getI2vAssetIndices(item).forEach(i => used.add(i));
        });
    }

    let assetCursor = 0;
    APP.queue.forEach(item => {
        if (item?.type === 'characterRef') return;
        if (onlyEmpty && getI2vAssetIndices(item).length > 0) return;

        while (assetCursor < APP.imageFiles.length && used.has(assetCursor)) assetCursor += 1;
        if (assetCursor < APP.imageFiles.length) {
            syncI2vAssetFields(item, [assetCursor]);
            used.add(assetCursor);
            assetCursor += 1;
        } else {
            clearI2vAssetAssignment(item);
        }
    });
}

function previewImageToVideoQueue() {
    if (APP.isRunning) return;
    const textarea = $('#videoPromptInput');
    const rawText = textarea?.value || '';
    if (!rawText.trim()) {
        showToast('Paste one or more video prompts first.', 'warning');
        return;
    }

    const parsed = parseVideoPrompts(rawText);
    if (!parsed || !parsed.lines.length) {
        showToast('No prompts found. Check your splitter setting.', 'warning');
        return;
    }

    const defaultPrompt = APP.settings.defaultVideoPrompt || 'Dynamic action, Active camera angle';
    APP.queue = parsed.lines.map((block, idx) => {
        let promptText = String(block || '').replace(/^\[\d+\]\s*/, '').trim();
        if (!promptText) promptText = defaultPrompt;
        // @mention → assign the named UPLOAD ASSETS image(s) to this row.
        // Keep the mention tokens in the prompt text sent to Flow.
        const mentionIdx = resolveMentionsToIndices(promptText);
        const codes = extractCharacterCodes(promptText);
        return {
            text: promptText,
            status: 'ready',
            file: null,
            filename: '',
            previewUrl: '',
            previewUrls: [],
            originalFileIndex: null,
            assetIndices: mentionIdx.slice(),
            useAsset: mentionIdx.length > 0,
            number: String(idx + 1).padStart(2, '0'),
            characters: codes || ''
        };
    });

    rematerializeI2vAssetUrls();
    // Fill only rows the user didn't explicitly pin via @mention.
    autoAssignI2vAssets({ onlyEmpty: true });
    APP.videoQueueConfirmed = true;
    closeI2vAssetPicker();
    showQueue();
    updateStartButtonState();
    saveSession();

    const withAsset = APP.queue.filter(q => getI2vAssetIndices(q).length > 0).length;
    const without = APP.queue.length - withAsset;
    $('#section-queue')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    showToast(
        `Preview ready: ${APP.queue.length} prompt${APP.queue.length === 1 ? '' : 's'} · ${withAsset} with asset · ${without} text-only`,
        'success'
    );
}

let _i2vPickerQueueIdx = null;
let _i2vPickerSelected = [];

function updateI2vPickerCount() {
    const el = $('#i2vAssetPickerCount');
    if (el) el.textContent = `${_i2vPickerSelected.length} selected`;
    const noneBtn = $('#i2vAssetPicker')?.querySelector('.i2v-asset-picker-none');
    noneBtn?.classList.toggle('active', _i2vPickerSelected.length === 0);
}

function refreshI2vPickerGridSelection() {
    const grid = $('#i2vAssetPickerGrid');
    if (!grid) return;
    grid.querySelectorAll('[data-pick-idx]').forEach(btn => {
        const idx = Number(btn.dataset.pickIdx);
        const ord = _i2vPickerSelected.indexOf(idx);
        const active = ord >= 0;
        btn.classList.toggle('active', active);
        const ordEl = btn.querySelector('.i2v-picker-ord');
        if (ordEl) ordEl.textContent = active ? String(ord + 1) : '';
    });
    updateI2vPickerCount();
}

function applyI2vPickerSelection() {
    if (_i2vPickerQueueIdx == null) return;
    const item = APP.queue[_i2vPickerQueueIdx];
    if (!item) return;
    syncI2vAssetFields(item, _i2vPickerSelected);
    APP.videoQueueConfirmed = true;
    closeI2vAssetPicker();
    showQueue();
    updateStartButtonState();
    saveSession();
}

function initI2vAssetPicker() {
    const picker = $('#i2vAssetPicker');
    if (!picker || picker.dataset.bound === '1') return;
    picker.dataset.bound = '1';

    const maxLabel = $('#i2vAssetMaxLabel');
    if (maxLabel) maxLabel.textContent = String(MAX_I2V_ASSETS_PER_PROMPT);

    $('#i2vAssetPickerClose')?.addEventListener('click', () => {
        applyI2vPickerSelection();
    });
    $('#i2vAssetPickerApply')?.addEventListener('click', () => {
        applyI2vPickerSelection();
    });
    picker.querySelector('.i2v-asset-picker-none')?.addEventListener('click', () => {
        _i2vPickerSelected = [];
        refreshI2vPickerGridSelection();
        applyI2vPickerSelection();
    });

    document.addEventListener('click', (e) => {
        if (!picker || picker.classList.contains('hidden')) return;
        if (picker.contains(e.target)) return;
        if (e.target.closest?.('[data-assign-idx]')) return;
        applyI2vPickerSelection();
    });

    window.addEventListener('resize', () => {
        if (!picker.classList.contains('hidden') && _i2vPickerQueueIdx != null) {
            const anchor = document.querySelector(`[data-assign-idx="${_i2vPickerQueueIdx}"]`);
            if (anchor) positionI2vAssetPicker(anchor);
            else closeI2vAssetPicker();
        }
    });
}

function openI2vAssetPicker(queueIdx, anchorEl) {
    const picker = $('#i2vAssetPicker');
    const grid = $('#i2vAssetPickerGrid');
    if (!picker || !grid) return;

    _i2vPickerQueueIdx = queueIdx;
    const item = APP.queue[queueIdx];
    _i2vPickerSelected = getI2vAssetIndices(item);

    if (!APP.imageFiles.length) {
        grid.innerHTML = `<div class="i2v-asset-picker-empty">No assets uploaded yet.<br>Upload images above, or keep this prompt text-only.</div>`;
    } else {
        grid.innerHTML = APP.imageFiles.map((file, idx) => {
            const url = _previewUrls[idx] || '';
            const ord = _i2vPickerSelected.indexOf(idx);
            const active = ord >= 0 ? ' active' : '';
            const safeName = String(file.name || '').replace(/"/g, '&quot;');
            return `
        <button type="button" class="i2v-asset-picker-item${active}" data-pick-idx="${idx}" title="${safeName}">
          <img src="${url}" alt="${safeName}">
          <span class="i2v-picker-ord">${ord >= 0 ? ord + 1 : ''}</span>
          <span class="i2v-picker-check">✓</span>
        </button>`;
        }).join('');

        grid.querySelectorAll('[data-pick-idx]').forEach(btn => {
            btn.addEventListener('click', () => {
                const assetIdx = Number(btn.dataset.pickIdx);
                const pos = _i2vPickerSelected.indexOf(assetIdx);
                if (pos >= 0) {
                    _i2vPickerSelected.splice(pos, 1);
                } else {
                    if (_i2vPickerSelected.length >= MAX_I2V_ASSETS_PER_PROMPT) {
                        showToast(`Max ${MAX_I2V_ASSETS_PER_PROMPT} assets per prompt.`, 'warning');
                        return;
                    }
                    _i2vPickerSelected.push(assetIdx);
                }
                refreshI2vPickerGridSelection();
            });
        });
    }

    updateI2vPickerCount();
    picker.classList.remove('hidden');
    positionI2vAssetPicker(anchorEl);
}

function positionI2vAssetPicker(anchorEl) {
    const picker = $('#i2vAssetPicker');
    if (!picker || !anchorEl) return;
    const rect = anchorEl.getBoundingClientRect();
    const pad = 8;
    let top = rect.bottom + pad;
    let left = rect.left;
    picker.style.top = `${Math.max(8, top)}px`;
    picker.style.left = `${Math.max(8, left)}px`;

    requestAnimationFrame(() => {
        const pr = picker.getBoundingClientRect();
        let nextTop = pr.top;
        let nextLeft = pr.left;
        if (pr.bottom > window.innerHeight - 8) nextTop = Math.max(8, rect.top - pr.height - pad);
        if (pr.right > window.innerWidth - 8) nextLeft = Math.max(8, window.innerWidth - pr.width - 8);
        picker.style.top = `${nextTop}px`;
        picker.style.left = `${nextLeft}px`;
    });
}

function closeI2vAssetPicker() {
    const picker = $('#i2vAssetPicker');
    picker?.classList.add('hidden');
    _i2vPickerQueueIdx = null;
    _i2vPickerSelected = [];
}

/**
 * Legacy image-first matcher (kept for non-i2v callers)
 */
function matchPromptsToQueue() {
    if (APP.mode === 'imageToVideo') {
        // Prompt-first flow uses previewImageToVideoQueue()
        return;
    }

    const textarea = $('#videoPromptInput');
    if (!textarea) {
        return;
    }

    const rawText = textarea.value;
    const defaultPrompt = APP.settings.defaultVideoPrompt || 'Dynamic action, Active camera angle';

    if (!rawText || !rawText.trim()) {
        for (const item of APP.queue) {
            item.text = defaultPrompt;
        }
        return;
    }

    const parsed = parseVideoPrompts(rawText);
    if (!parsed) return;

    const { lines, map, hasSceneBlocks } = parsed;
    const allImagesHaveSceneNum = APP.queue.every(item => {
        const num = extractSceneNumber(item.filename);
        return num !== null;
    });
    const useSceneNumberMatching = hasSceneBlocks && allImagesHaveSceneNum && map;

    for (let i = 0; i < APP.queue.length; i++) {
        const item = APP.queue[i];
        let promptText = '';

        if (useSceneNumberMatching) {
            const sceneNum = extractSceneNumber(item.filename);
            if (sceneNum !== null && map.has(sceneNum)) {
                promptText = map.get(sceneNum);
            }
        }

        if (!promptText) {
            if (lines.length === 1) {
                promptText = i === 0 ? lines[0] : '';
            } else if (i < lines.length) {
                promptText = lines[i];
            } else {
                promptText = '';
            }
        }

        promptText = promptText.replace(/^\[\d+\]\s*/, '').trim();

        if (promptText) {
            item.text = promptText;
            const codes = extractCharacterCodes(promptText);
            if (codes) item.characters = codes;
        } else {
            item.text = defaultPrompt;
        }
    }
}

// ========== GENERATION ==========
async function startGeneration(isRetry = false) {
    if (!isRetry && (APP.mode === 'textToImage' || APP.mode === 'textToVideo')) {
        const hasPromptText = !!($('#promptInput')?.value || '').trim();
        if (!hasPromptText) {
            updateStartButtonState();
            showToast('Enter a prompt first.', 'warning');
            return;
        }
    }

    if (!isRetry && APP.mode === 'imageToVideo' && !APP.videoQueueConfirmed) {
        const raw = $('#videoPromptInput')?.value?.trim() || '';
        if (!raw && (!APP.queue || APP.queue.length === 0)) {
            showToast('Paste video prompts (and optionally upload assets) first.', 'warning');
            return;
        }
        previewImageToVideoQueue();
        return;
    }

    if (!isRetry && APP.mode === 'imageToVideo') {
        const sceneItems = (APP.queue || []).filter(q => q.type !== 'characterRef');
        if (!sceneItems.length) {
            showToast('Preview prompts first, then start video.', 'warning');
            return;
        }
    }

    // ★ CCR 토글 ON + 이미지 0장 → 생성 차단 (카운터 차감 전 선검증)
    //   유저가 실수로 체크만 하고 이미지 안 넣은 상태로 크레딧 소진하는 것 방지
    //   재시도는 이미 승인된 프로젝트이므로 체크 생략
    if (!isRetry && APP.mode !== 'textToImage' && isCcrEnabledForCurrentMode() && !_ccrSlotsHaveAnyImage()) {
        showToast(
            "Please upload a character image or uncheck the checkbox",
            'warning',
            5000
        );
        return;
    }

    // ★ CCR(커스텀 캐릭터 레퍼런스) 월 3회 제한 체크 — 모든 모드 공통
    //   - CCR 토글 ON + 생성 시작 = 1회 차감 (프로젝트 단위)
    //   - 유료 키 있으면 무제한 (checkCcrAccess 가 처리)
    //   - 재시도(isRetry)는 카운트 안 함 — 이미 승인된 프로젝트 재처리
    if (!isRetry && APP.mode !== 'textToImage' && isCcrEnabledForCurrentMode()) {
        const ccrAccess = await checkCcrAccess();
        if (!ccrAccess.allowed) {
            showUpgradeModal();
            return;
        }
        if (ccrAccess.type === 'free') {
            await incrementCcrUsage();
        }
    }

    // ★ Factory 버튼 텍스트 복구 (재개 → 원래 텍스트)
    if (APP.mode === 'factory') {
        const btnStart = $('#btn-factory-start');
        const btnAuto = $('#btn-factory-auto');
        if (btnStart) {
            btnStart.textContent = "▶ START IMAGE";
            btnStart.classList.remove('btn-resume');
        }
        if (btnAuto) {
            btnAuto.textContent = "▶▶ AUTO GENERATION";
        }
    }

    // ★ Factory 모드: 직접 startGeneration 호출 시 수동 모드로 강제 설정
    // (btn-factory-start/auto 외의 경로로 호출된 경우 대비)
    if (APP.mode === 'factory' && APP.factory.isAutoMode === undefined) {
        APP.factory.isAutoMode = false;
    }
    if (APP.mode === 'textToImage' || APP.mode === 'textToVideo') {
        await savePromptInputDraft();
    }
    if (!isRetry) {
        if (APP.mode === 'textToImage' || APP.mode === 'textToVideo') {
            const parsedQueue = getPromptsFromInput();
            if (parsedQueue === null) return;
            APP.queue = parsedQueue;
        }

        if (APP.mode === 'imageToVideo') {
            // Queue already built via Preview & assign; keep user asset choices
            rematerializeI2vAssetUrls();
        }
    }

    saveSession();

    // ★ 씬 프롬프트만 필터 (캐릭터레퍼런스 제외)
    // ★★★ 핵심 수정: 플래그 대신 queue 상태를 직접 확인
    // - done 또는 fail 상태 항목이 있으면 → ready 상태만 처리 (이어서 진행)
    // - 모두 ready 상태면 → 새 시작
    const hasCompletedOrFailed = APP.queue.some(q =>
        q.type !== 'characterRef' && (q.status === 'done' || q.status === 'fail')
    );
    const readyItems = APP.queue.filter(q => q.type !== 'characterRef' && q.status === 'ready');
    let sceneItems;
    if (isRetry) {
        // 이어서/실패 재생성(명시): ready 항목만 (호출 전 해당 항목을 ready로 리셋해 둠)
        sceneItems = readyItems;
    } else if (hasCompletedOrFailed && readyItems.length === 0) {
        // ★ v1.1.8 수정: 전체 완료/실패 후 "재생성" 버튼 클릭 — ready가 0개라 "처리할 항목 없음"이 뜨던 버그.
        //   완료(done)/실패(fail) 항목을 ready로 되돌려 전체를 다시 생성한다.
        APP.queue.forEach(q => {
            if (q.type !== 'characterRef' && (q.status === 'done' || q.status === 'fail')) {
                q.status = 'ready';
            }
        });
        sceneItems = APP.queue.filter(q => q.type !== 'characterRef' && q.status === 'ready');
        console.log('[REGEN] 전체 완료 후 재생성 — done/fail 항목을 ready로 리셋', { count: sceneItems.length });
    } else if (hasCompletedOrFailed) {
        // 일부만 완료/실패 + 아직 ready 남음 → 이어서 진행 (ready 항목만)
        sceneItems = readyItems;
    } else {
        // 전부 ready (새 시작) → 전체 처리
        sceneItems = APP.queue.filter(q => q.type !== 'characterRef');
    }


    // ★ 재시작 플래그 초기화
    APP.stoppedWithPendingItems = false;

    // ★ Factory 모드: 이미지 생성 시작 시 비디오 완료 상태 리셋
    if (APP.mode === 'factory') {
        APP.factory.videoGenerationComplete = false;
        APP.factory.imageGenerationComplete = false;
        $('#factoryVideoCompletion')?.classList.add('hidden');
        $('#section-factory-video')?.classList.add('hidden');
    }

    if (sceneItems.length === 0) {
        showToast("No items to process. Solution: Enter a script/prompt or upload images, then click 'Start generation' or 'Start video'.", 'error');
        return;
    }

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!isFlowTabUrl(tab?.url)) {
        showToast("Flow page (flow.google.com) required. Please open flow.google.com in a new tab.", 'error');
        await checkFlowTabAndShowModal();  // Flow 열어주세요 안내 모달 표시
        return;
    }

    // 비디오 모드(Prompt→Video, Image→Video)에서만 초기 설정 안내 모달 표시 (재시도 시 스킵)
    const isVideoMode = APP.mode === 'textToVideo' || APP.mode === 'imageToVideo';
    if (isVideoMode && !isRetry) {
        await checkAndShowSetupModal();
    }

    APP.isRunning = true;
    APP.isPaused = false;
    APP.runningMode = APP.mode;  // ★ 실행 시작한 모드 저장 (모드 전환 시 UI 분리용)
    resetFlowUiTracking();

    // ★ 이전 세션의 일시정지 상태 제거 (새 생성 시작 시)
    chrome.storage.local.remove(['isPaused', 'pausedMode']);

    // ★ 일시정지 버튼 UI 초기화 (재개 → 일시정지)
    const pauseBtn = $('#btn-pause');
    if (pauseBtn) {
        pauseBtn.textContent = "⏸ PAUSE";
        pauseBtn.classList.remove('btn-primary');
        pauseBtn.classList.add('btn-secondary');
        pauseBtn.disabled = false;
        pauseBtn.removeAttribute('title');
    }

    $('#btn-start-generation')?.classList.add('hidden');
    $('#controlButtons')?.classList.remove('hidden');
    $('#section-progress')?.classList.remove('hidden');
    $('#section-completion')?.classList.add('hidden');
    $('#btn-completion-resume')?.classList.add('hidden');

    // ★ Completion 섹션 내용 리셋 (이전 상태 잔재 방지)
    const completionIcon = $('#section-completion .completion-icon');
    const completionTitle = $('#section-completion .completion-title');
    const completionStats = $('#completionStats');
    if (completionIcon) completionIcon.textContent = '🎉';
    if (completionTitle) completionTitle.textContent = "DONE!";
    if (completionStats) completionStats.innerHTML = '<span class="stat-success">0</span> ' + "SUCCESS" + ' / <span class="stat-fail">0</span> ' + "FAILED";

    if ($('#progressLog')) $('#progressLog').innerHTML = '';
    if ($('#progressFill')) $('#progressFill').style.width = '0%';
    if ($('#progressText')) $('#progressText').textContent = '0 / 0';

    // ★ 텍스트투이미지: 시작 즉시 첫 처리 대상(index 0)을 active로 마킹 → 스피너 즉시 표시
    const imageSceneItems = APP.queue.filter(q => q.type !== 'characterRef');
    if ((APP.mode === 'textToImage' || APP.mode === 'scriptToImage' || APP.mode === 'factory') && imageSceneItems.length > 0) {
        const firstReadyIdx = imageSceneItems.findIndex(q => q.status === 'ready');
        if (firstReadyIdx >= 0) {
            imageSceneItems.forEach((item, idx) => {
                if (item.status === 'done' || item.status === 'fail') return;
                item.status = idx === firstReadyIdx ? 'active' : 'ready';
            });
            showQueue();
        }
    }

    // ★ 이미지/동영상 생성 시작 → 진행 상황 섹션으로 스크롤
    setTimeout(() => {
        $('#section-progress')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 300);

    showQueue();

    const payloads = await preparePayloads(sceneItems);

    const projectName = $('#controlProjectName')?.value?.trim() || 'my_project';

    // ★ Factory 모드: projectName 저장 (동영상 생성 시 같은 폴더 사용)
    if (APP.mode === 'factory' || APP.mode === 'scriptToImage') {
        APP.factory.projectName = projectName;
    }

    chrome.runtime.sendMessage({
        type: 'SETUP_DOWNLOAD',
        folder: APP.settings.downloadFolder || 'AI4Next',
        subfolder: projectName
    });

    // ★ 이미지투비디오 단독: 동영상 생성 시작 시 lastProgressSeq 초기화
    // (이전 phase에서 높은 seq 잔존 시 submitting(seq=1)이 stale로 폐기되는 것 방지)
    if (APP.mode === 'imageToVideo') {
        APP.flowUi = APP.flowUi || {};
        APP.flowUi.lastProgressSeq = -1;
    }

    try {
        await sendPayloadsToContentScript(tab, payloads, isRetry);
    } catch (err) {
        showToast(`${"Error"}: ${err.message}`, 'error');
        resetControlUI();
    }
}

/** 프롬프트→이미지 모드에서 스타일 첨부 시: Refer to attached... + [국적 context] + [스타일디스크립션] */
function buildStyleAttachPrefix() {
    const styleId = normalizeSelectedStyle(APP.settings.selectedStyle || $('#controlStyleSelect')?.value || '');
    if (!isCustomStyleId(styleId)) return '';
    const custom = (APP.customStyles || []).find(s => s.id === styleId);
    return (custom && custom.prompt) ? `[${custom.prompt}]` : '';
}

async function preparePayloads(items) {
    const sourceItems = items || APP.queue;
    const payloads = [];

    // ★ 원래 APP.queue에서 씬 항목만 추출 (promptIndex 매핑용)
    const allSceneItems = APP.queue.filter(q => q.type !== 'characterRef');

    for (let i = 0; i < sourceItems.length; i++) {
        const item = sourceItems[i];

        // ★★★ 핵심 수정: 필터링된 배열의 인덱스(i)가 아니라 원래 배열의 인덱스 사용
        const originalIndex = allSceneItems.findIndex(q => q === item);
        const effectiveIndex = originalIndex !== -1 ? originalIndex : i;

        if (APP.mode === 'imageToVideo') {
            const assetIndices = getI2vAssetIndices(item);
            const hasAsset = assetIndices.length > 0;
            const filenames = assetIndices
                .map(i => APP.imageFiles[i]?.name)
                .filter(Boolean);
            const vidPrompt = item.text || APP.settings.defaultVideoPrompt || 'Dynamic action, Active camera angle';
            // Mirror image gen: @mention → inline reference. refIdx comes from the mentions
            // in the prompt text (order preserved), same fields the image path emits.
            const refIdx = resolveMentionsToIndices(vidPrompt)
                .filter(n => Number.isInteger(n) && n >= 0 && n < APP.imageFiles.length);
            payloads.push({
                promptIndex: effectiveIndex,
                prompt: vidPrompt,
                mode: APP.mode,
                aspectRatio: APP.settings.aspectRatio || '16:9',
                images: [],
                hasLazyImage: hasAsset,
                lazyImageIndex: hasAsset ? assetIndices[0] : undefined,
                lazyImageIndices: hasAsset ? assetIndices.slice() : [],
                originalFilename: hasAsset ? (filenames[0] || item.filename || '') : '',
                originalFilenames: hasAsset ? filenames : [],
                // @mention inline-reference data (parity with textToImage payloads).
                useReference: refIdx.length > 0,
                refAssetIndices: refIdx,
                refAssetNames: refIdx.map(n => getAssetUploadFilename(n)),
                promptSegments: refIdx.length ? buildPromptRefSegments(vidPrompt) : [],
                outputCount: Math.max(1, Math.min(4, Number(APP.settings.outputCount) || 1)),
                scriptText: item.scriptText || '',
                number: item.number || '',
                characters: item.characters || ''
            });
        } else {
            let base64 = null;
            if (item.file) {
                base64 = await fileToBase64(item.file);
            }

            // textToImage / scriptToImage / factory 공통: imageGenPrefix 적용 (프롬프트 수정 시에도 동일)
            const isImageGen = APP.mode === 'textToImage' || APP.mode === 'scriptToImage' || APP.mode === 'factory';
            let rawPrompt = item.text || APP.settings.defaultVideoPrompt || 'Dynamic action, Active camera angle';
            // 캐릭터 레퍼런스 사용 시: MCR/SC1/SC2 코드 유지 (@ 태그 매칭용). convertCharacterCodes 비적용
            const skipCharCodeConversion = typeof isCharRefEnabled === 'function' && isCharRefEnabled();
            // 텍스트→비디오: 비디오 생성창에는 [XXX Context]부터만 전달 (Korean/English/Japanese 등 언어 공통)
            if (APP.mode === 'textToVideo') {
                const source = item.rawText !== undefined && item.rawText !== null ? item.rawText : rawPrompt;
                const match = source.match(/\[[^\]]*Context\][\s\S]*/i);
                const fromContext = match ? match[0].trim() : source;
                rawPrompt = item.rawText !== undefined && item.rawText !== null && typeof convertCharacterCodes === 'function' && !skipCharCodeConversion
                    ? convertCharacterCodes(fromContext)
                    : fromContext;
            } else if (isImageGen && skipCharCodeConversion && (item.rawPrompt ?? item.rawText) != null) {
                rawPrompt = item.rawPrompt ?? item.rawText;
            }
            const prefix = isImageGen ? (APP.settings.imageGenPrefix ?? '') : '';
            // ★ P2I v1.6: 중복 스타일 UI 제거 → 커스텀 캐릭터 레퍼런스 체크 상태로 스타일 적용 결정
            //   - CCR OFF: 설정 탭 스타일 자동 적용 (기존 동작)
            //   - CCR ON:  스타일 무시, 사용자 프롬프트만 그대로 적용
            const addStyleHint = APP.mode === 'textToImage' && !APP.p2iUseCustomCharRefs && APP.styleImage;
            const effectivePrefix = addStyleHint ? buildStyleAttachPrefix() : prefix;
            const prompt = isImageGen ? effectivePrefix + rawPrompt : rawPrompt;

            // @mention → "Use reference image for this prompt". Names match the bulk
            // upload filenames so Flow's @ picker can attach the same files.
            const refIdx = ((APP.mode === 'textToImage' || APP.mode === 'textToVideo')
                && item.useReference && Array.isArray(item.assetIndices))
                ? item.assetIndices.filter(n => Number.isInteger(n) && n >= 0 && n < APP.imageFiles.length)
                : (APP.mode === 'textToVideo'
                    ? resolveMentionsToIndices(item.rawText || prompt)
                        .filter(n => Number.isInteger(n) && n >= 0 && n < APP.imageFiles.length)
                    : []);
            let promptSegments = [];
            if (refIdx.length) {
                promptSegments = buildPromptRefSegments(prompt);
                if (!promptSegments.some(s => s.type === 'ref')) {
                    promptSegments = [
                        ...refIdx.map(n => ({
                            type: 'ref',
                            name: getAssetUploadFilename(n),
                            query: String(getAssetName(n) || '').replace(/\.(jpe?g|png|webp|gif)$/i, '').trim()
                        })),
                        ...(prompt ? [{ type: 'text', value: prompt }] : [])
                    ];
                }
            }
            payloads.push({
                promptIndex: effectiveIndex,
                prompt,
                rawPrompt: isImageGen ? rawPrompt : undefined,
                mode: APP.mode,
                aspectRatio: APP.settings.aspectRatio || '16:9',
                images: base64 ? [{ base64, name: item.filename || item.file?.name }] : [],
                useReference: refIdx.length > 0,
                refAssetIndices: refIdx,
                refAssetNames: refIdx.map(n => getAssetUploadFilename(n)),
                promptSegments,
                outputCount: (APP.mode === 'textToImage' || APP.mode === 'scriptToImage' || APP.mode === 'factory')
                    ? Math.max(1, Math.min(4, Number(APP.settings.outputCount) || 1)) : 1,
                scriptText: item.scriptText || '',
                number: item.number || '',
                characters: item.characters || ''
            });
        }
    }

    return payloads;
}

async function ensureContentScriptLoaded(tab) {
    // 1차 시도: PING으로 기존 Content Script 확인
    try {
        const response = await chrome.tabs.sendMessage(tab.id, { type: 'PING' });
        if (response?.alive) {
            return true;
        }
    } catch (e) {
    }

    // 2차 시도: Content Script 재주입 (Flow용 파일)
    try {
        await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['core/flow-selectors.js', 'core/flow-automation.js', 'core/filename.js', 'content-scripts/flow-content.js']
        });
        await new Promise(r => setTimeout(r, 1000));

        const response = await chrome.tabs.sendMessage(tab.id, { type: 'PING' });
        if (response?.alive) {
            return true;
        }
    } catch (injectErr) {
    }

    // 3차 시도: 페이지 새로고침 (최후의 수단)
    try {
        await chrome.tabs.reload(tab.id);

        // 페이지 로드 완료 대기 (최대 10초)
        for (let i = 0; i < 20; i++) {
            await new Promise(r => setTimeout(r, 500));
            try {
                const response = await chrome.tabs.sendMessage(tab.id, { type: 'PING' });
                if (response?.alive) {
                    return true;
                }
            } catch {
                // 아직 로드 안 됨
            }
        }
    } catch (reloadErr) {
    }

    return false;
}

async function sendPayloadsToContentScript(tab, payloads, isRetry = false, skipNavigation = false, extraSettings = {}) {
    let updatedTab = tab;
    if (!skipNavigation) {
        // ★ 核心架构修复：准确判断当前标签页是否已在 Flow 项目画板中（支持 /project/ 任意 ID，无需 /edit/）
        let isCurrentProject = isFlowProjectUrl(tab?.url);
        if (!isCurrentProject && tab?.id) {
            try {
                const res = await chrome.tabs.sendMessage(tab.id, { type: 'CHECK_IN_PROJECT' });
                if (res?.inProject) isCurrentProject = true;
            } catch (_) {}
        }
        if (!isCurrentProject) {
            const navigated = await navigateToFlowHomeAndWait(tab);
            if (!navigated) {
                throw new Error("Content Script injection failed. Please refresh the Flow page (flow.google.com).");
            }
            updatedTab = await chrome.tabs.get(tab.id);
        } else {
            console.log('🎬 [FLOW STUDIO PRO] 复用当前 Flow 项目画板，闭环同项目生成:', tab?.url);
            updatedTab = await chrome.tabs.get(tab.id);
        }
    } else {
        updatedTab = await chrome.tabs.get(tab.id);
    }

    const projectName = $('#controlProjectName')?.value?.trim() || 'my_project';
    // ★ P2I v1.6: textToImage 스타일첨부는 커스텀 캐릭터 레퍼런스 체크 상태로 결정
    //   - CCR OFF: 설정 스타일 이미지 자동 첨부 (기존 동작)
    //   - CCR ON:  스타일 이미지 미첨부, 사용자 프롬프트만 그대로
    const useStyleImage = APP.mode === 'textToImage' && !APP.p2iUseCustomCharRefs && APP.styleImage ? APP.styleImage : null;

    // ★ v1.1.6 FIX: AI 자체 생성 캐릭터 ref 가 클리어되는 버그 수정
    //   이전 (v1.1.2 도입): isCcrEnabledForCurrentMode() = APP.useCustomCharRefs (커스텀 CCR 토글만 체크)
    //     → 자체 생성 ref 4개 + 커스텀 0개 케이스에서 useCustomCharRefs=false 라
    //       characterRefAssets 가 통째로 클리어됨 → useCharRef=false → 업로드/첨부 모두 스킵
    //   수정: 마스터 캐릭터레퍼런스 사용 체크박스(useCharRefCheckbox) 기준으로 판단
    //     - factory / scriptToImage: useCharRefCheckbox.checked
    //     - textToImage (P2I): p2iUseCustomCharRefs (자체 토글)
    //     - 나머지 모드: 캐릭터 ref 미사용
    const _ucrCheckbox = document.getElementById('useCharRefCheckbox');
    const _masterCharRefOn = APP.mode === 'textToImage'
        ? !!APP.p2iUseCustomCharRefs
        : !!(_ucrCheckbox?.checked);
    if (!_masterCharRefOn && APP.characterRefAssets) {
        APP.characterRefAssets = null;
        chrome.storage.local.remove('characterRefAssets').catch(() => {});
    }

    // ★ PRO 2.0: 커스텀 + AI 병합된 characterRefAssets를 사용. 동시에 chrome.storage.local에도 저장
    // → 프로젝트 배치 2차+ RESUME 시 복원되어 사용자 업로드 유지 보장
    const mergedAssets = (typeof mergeCustomCharRefsIntoAssets === 'function' && isCcrEnabledForCurrentMode())
        ? mergeCustomCharRefsIntoAssets(APP.characterRefAssets)
        : (APP.characterRefAssets || null);
    if (isCcrEnabledForCurrentMode() && mergedAssets) {
        chrome.storage.local.set({ characterRefAssets: mergedAssets }).catch(() => {});
    }

    // ★ P2I v1.6 → v1.1.3 수정: 이미지가 있는 캐릭터 전부 업로드 (대본투이미지와 동일)
    //   - 프롬프트별 매칭은 buildActiveCharRefAssetsForPromptP2I()가 개별 처리
    //   - Flow 프로젝트당 1회 업로드 → 전체 첨부 후 프롬프트별로 선택 사용
    let p2iEffectiveAssets = null;
    let p2iUseCharRef = false;
    if (APP.mode === 'textToImage' && APP.p2iUseCustomCharRefs
        && typeof buildCharRefAssetsFromCustomP2I === 'function') {
        const allAssets = buildCharRefAssetsFromCustomP2I();
        const batchNeedsRef = (payloads || []).some(p => !!(p.characters || p.scene?.characters));
        if (batchNeedsRef && allAssets && Object.keys(allAssets).length > 0) {
            p2iEffectiveAssets = allAssets;
            p2iUseCharRef = true;
        }
    }

    // Image/video @mention: upload the whole UPLOAD ASSETS pool first (user-given names),
    // then attach mentioned files per prompt via the Flow @ picker — same as
    // "Use reference image for this prompt".
    const usePromptRefAssets = (APP.mode === 'textToImage' || APP.mode === 'imageToVideo' || APP.mode === 'textToVideo')
        && (payloads || []).some(p => p?.useReference && Array.isArray(p.refAssetIndices) && p.refAssetIndices.length > 0);
    const promptRefAssetNames = usePromptRefAssets
        ? APP.imageFiles.map((_, i) => getAssetUploadFilename(i))
        : [];

    const settings = {
        mode: APP.mode,
        ...APP.settings,
        projectName,
        styleImage: useStyleImage,
        isRetry: !!isRetry,
        // ★ v1.1.2: P2I는 p2iUseCharRef만, 나머지는 isCharRefEnabled()
        useCharRef: p2iUseCharRef || isCharRefEnabled(),
        // ★ P2I: 필터링된 P2I assets 우선, 없으면 기존 mergedAssets (대본 모드)
        // ★ v1.1.2 guard: useCharRef가 false면 stale assets 전송 방지
        characterRefAssets: (p2iUseCharRef || isCharRefEnabled()) ? (p2iEffectiveAssets || mergedAssets) : null,
        usePromptRefAssets,
        promptRefAssetCount: usePromptRefAssets ? APP.imageFiles.length : 0,
        promptRefAssetNames,
        ...extraSettings  // ★ 버그 수정: isCharRefRegen 등 extraSettings 반영
    };

    const loaded = await ensureContentScriptLoaded(updatedTab);
    if (!loaded) {
        throw new Error("Content Script injection failed. Please refresh the Flow page (flow.google.com).");
    }

    // ★ v1.1.3 revert (커밋 de0435d 무효화):
    //   "모든 프롬프트에 전체 캐릭터 코드 주입" 로직 제거 — 팩토리 모드와 동일한 per-prompt 매칭 복원.
    //   parseCharacterCodesFromPromptP2I 가 rawText(convertCharacterCodes 적용 전)에서 코드/별칭/이름을
    //   정확히 검출하므로 item.characters 가 이미 정확함. 강제 오버라이드는 프롬프트별 매칭을 망가뜨림.

    const fullMessage = { type: 'START_GENERATION', payloads, settings };
    const fullJson = JSON.stringify(fullMessage);
    const MAX_CHUNK = 1048576; // 1MB


    if (fullJson.length <= MAX_CHUNK) {
        const response = await chrome.tabs.sendMessage(updatedTab.id, fullMessage);
    } else {
        const payloadJson = JSON.stringify(payloads);
        const groupId = `group-${Date.now()}`;
        const chunks = [];
        for (let i = 0; i < payloadJson.length; i += MAX_CHUNK) {
            chunks.push(payloadJson.slice(i, i + MAX_CHUNK));
        }

        for (let i = 0; i < chunks.length; i++) {
            await chrome.tabs.sendMessage(updatedTab.id, {
                type: 'START_GENERATION_CHUNK',
                groupId,
                chunkIndex: i,
                totalChunks: chunks.length,
                chunk: chunks[i],
                settings
            });
        }
    }
}

function pauseGeneration() {
    APP.isPaused = true;

    // ★ 일시정지 상태를 storage에 저장 (팝업 닫아도 유지)
    chrome.storage.local.set({ isPaused: true, pausedMode: APP.mode });

    // ★ 일시정지 시 모드 전환 허용 (AUTO 모드 상태는 유지)
    if (APP.mode === 'factory') {
        APP.factory.isProcessing = false;
    }

    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
        if (tab) chrome.tabs.sendMessage(tab.id, { type: 'PAUSE_GENERATION' });
    });
    const btn = $('#btn-pause');
    if (btn) {
        btn.textContent = "▶ RESUME";
        btn.classList.remove('btn-secondary');
        btn.classList.add('btn-primary');
    }
    showQueue();
    showToast("Paused - mode switching allowed", 'info');
}

async function resumeGeneration() {
    APP.isPaused = false;

    // ★ storage에서 일시정지 상태 제거
    chrome.storage.local.remove(['isPaused', 'pausedMode']);

    // ★ 재개 시 모드 전환 차단 복구 (AUTO 모드 상태는 유지되어 있음)
    if (APP.mode === 'factory') {
        APP.factory.isProcessing = true;
    }

    const btn = $('#btn-pause');
    if (btn) {
        btn.textContent = "⏸ PAUSE";
        btn.classList.remove('btn-primary');
        btn.classList.add('btn-secondary');
    }
    showQueue();

    // ★ 핵심 수정: 새 탭에서는 content script의 pausedState가 없으므로 재시작 필요
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) {
        showToast("Flow page (flow.google.com) required. Please open flow.google.com in a new tab.", 'error');
        return;
    }

    // ★ 이미지투비디오: 수동 일시정지 재개 시 화면 초기화 없음 (RESUME_GENERATION만)
    if (APP.mode === 'imageToVideo') {
        APP.flowUi = APP.flowUi || {};
        APP.flowUi.lastProgressSeq = -1;
        const url = tab.url || '';
        const isFlowTool = isFlowTabUrl(url);

        if (isFlowTool) {
            // ★ 크레딧 소진: hadSubmitted=false → RESUME_GENERATION 생략, 바로 리로드 (수동 일시정지와 분리)
            const resumeData = await chrome.storage.local.get('videoPipelineResume').then(r => r?.videoPipelineResume);
            if (resumeData?.hadSubmitted === false) {
                const res = await chrome.runtime.sendMessage({ type: 'RELOAD_AND_RESUME_VIDEO', tabId: tab.id });
                if (res?.success) showToast("Resumed - auto progress continues", 'success');
                else showToast("Flow page (flow.google.com) required. Please open flow.google.com in a new tab.", 'error');
                return;
            }
            // ★ 수동 일시정지: content script가 PAUSED 상태면 RESUME_GENERATION만 전송 (화면 초기화 없음)
            try {
                const response = await chrome.tabs.sendMessage(tab.id, { type: 'RESUME_GENERATION' });
                if (response?.success) {
                    showToast("Resumed - auto progress continues", 'success');
                    return;
                }
            } catch (e) { /* content script 미응답 → 크레딧 소진 경로 */ }

            // ★ 크레딧 소진 재개: 계정 변경 등으로 content script 상태 없음 → 리로드 후 RESUME_VIDEO_PIPELINE
            const res = await chrome.runtime.sendMessage({ type: 'RELOAD_AND_RESUME_VIDEO', tabId: tab.id });
            if (res?.success) {
                showToast("Resumed - auto progress continues", 'success');
            } else {
                showToast("Flow page (flow.google.com) required. Please open flow.google.com in a new tab.", 'error');
            }
            return;
        }

        // URL이 Flow가 아니면 이동 후 FLOW_CONTENT_READY 시 재전송
        const res = await chrome.runtime.sendMessage({ type: 'NAVIGATE_AND_RESUME_VIDEO', tabId: tab.id });
        if (res?.success) {
            showToast("Resumed - auto progress continues", 'success');
        } else {
            showToast("Flow page (flow.google.com) required. Please open flow.google.com in a new tab.", 'error');
        }
        return;
    }

    // ★ 텍스트투비디오: 기존대로 리로드/이동 후 RESUME_VIDEO_PIPELINE
    if (APP.mode === 'textToVideo') {
        APP.flowUi = APP.flowUi || {};
        APP.flowUi.lastProgressSeq = -1;
        const url = tab.url || '';
        const isFlowTool = isFlowTabUrl(url);
        if (!isFlowTool) {
            const res = await chrome.runtime.sendMessage({ type: 'NAVIGATE_AND_RESUME_VIDEO', tabId: tab.id });
            showToast(res?.success ? "Resumed - auto progress continues" : "Flow page (flow.google.com) required. Please open flow.google.com in a new tab.", res?.success ? 'success' : 'error');
        } else {
            const res = await chrome.runtime.sendMessage({ type: 'RELOAD_AND_RESUME_VIDEO', tabId: tab.id });
            showToast(res?.success ? "Resumed - auto progress continues" : "Flow page (flow.google.com) required. Please open flow.google.com in a new tab.", res?.success ? 'success' : 'error');
        }
        return;
    }

    try {
        const response = await chrome.tabs.sendMessage(tab.id, { type: 'RESUME_GENERATION' });

        // ★ content script가 RESUME 수신 → waitWhilePaused 탈출 후 이어서 진행
        // active/generating 상태 유지, 완료/실패는 progress handler에서 처리
        if (response) {
            // 이미지투비디오·텍스트투비디오: 재개 직후 progressSeq 초기화 (stale 폐기 방지)
            if (APP.mode === 'imageToVideo' || APP.mode === 'textToVideo') {
                APP.flowUi = APP.flowUi || {};
                APP.flowUi.lastProgressSeq = -1;
            }
            showToast("Resumed - auto progress continues", 'success');
            return;
        }
    } catch (e) {
    }

    // ★ content script에 상태가 없으면 (새 탭/미로드) popup에서 다시 시작

    await new Promise(r => setTimeout(r, 300));

    showToast("Resumed - restarting from beginning", 'success');
    startGeneration(true);  // true = 이어서 시작
}

// ★ 내부 사용 전용 (resetProject 등에서 호출)
function stopGeneration() {
    APP.isRunning = false;
    APP.isPaused = false;
    APP.runningMode = null;

    // Factory 모드 상태 초기화
    if (APP.mode === 'factory') {
        APP.factory.isProcessing = false;
        APP.factory.videoRunning = false;
        APP.factory.isVideoPhase = false;
        APP.factory.isAutoMode = false;
        APP.factory.isFullAuto = false;
        APP.factory.isVideoAuto = false;
    }

    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
        if (tab) chrome.tabs.sendMessage(tab.id, { type: 'STOP_GENERATION' });
    });
    clearGeneratingSpinners('stopped');

    // active 상태 항목을 fail로 변경
    APP.queue.filter(q => q.type !== 'characterRef' && q.status === 'active').forEach(q => {
        q.status = 'fail';
        q.error = 'Stopped';
    });

    showQueue();
    // ★ 중지 후에도 일시정지+새프로젝트 유지 (그록팩토리 동일)
    APP.isRunning = false;
    APP.isPaused = false;
    $('#btn-start-generation')?.classList.remove('hidden');
    $('#controlButtons')?.classList.remove('hidden');
    const pauseBtn = $('#btn-pause');
    if (pauseBtn) {
        pauseBtn.disabled = true;
        pauseBtn.removeAttribute('title');
    }
}

function clearGeneratingSpinners(reason) {
    const log = $('#progressLog');
    if (!log) return;

    // ★ 일시정지 상태면 generating 로그를 "paused"로 표시 (completed로 변경하지 않음)
    if (APP.isPaused && reason === 'completed') {
        const spinning = log.querySelectorAll('[data-log-status="generating"]');
        spinning.forEach(el => {
            el.className = 'log-item pending';
            el.innerHTML = `⏸️ #${el.dataset.logIdx} — ${"PAUSED"}`;
            el.dataset.logStatus = 'paused';
        });
        return;
    }

    const isSuccess = reason === 'completed' || reason === 'video_complete';
    const icon = isSuccess ? '✅' : '❌';
    const cls = isSuccess ? 'success' : 'error';
    const spinning = log.querySelectorAll('[data-log-status="generating"]');
    spinning.forEach(el => {
        el.className = `log-item ${cls}`;
        el.innerHTML = `${icon} #${el.dataset.logIdx} — ${reason}`;
        el.dataset.logStatus = reason;
    });
}

function resetControlUI() {
    APP.isRunning = false;
    APP.isPaused = false;
    resetFlowUiTracking();
    $('#btn-start-generation')?.classList.remove('hidden');
    $('#controlButtons')?.classList.add('hidden');
}

// ★ Factory Video 전용 일시정지
function pauseFactoryVideoGeneration() {
    APP.factory.videoPaused = true;
    APP.factory.isProcessing = false;  // 모드 전환 허용

    // ★ 일시정지 상태를 storage에 저장 (팝업 닫아도 유지)
    chrome.storage.local.set({ isPaused: true, pausedMode: 'factory-video' });

    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
        if (tab) chrome.tabs.sendMessage(tab.id, { type: 'PAUSE_GENERATION' });
    });

    const btn = $('#btn-factory-pause');
    if (btn) {
        btn.textContent = "▶ RESUME";
        btn.classList.remove('btn-secondary');
        btn.classList.add('btn-primary');
    }
    showToast("Paused - mode switching allowed", 'info');
}

// ★ Factory Video 전용 재개
async function resumeFactoryVideoGeneration() {
    // ★ 중복 전송 방지 (더블클릭/연속 클릭 시 RELOAD 반복 호출 차단)
    if (APP.factory._resumeInProgress) {
        return;
    }
    APP.factory._resumeInProgress = true;
    try {
    APP.factory.videoPaused = false;
    APP.factory.isProcessing = true;  // 모드 전환 차단

    // ★ storage에서 일시정지 상태 제거
    chrome.storage.local.remove(['isPaused', 'pausedMode']);

    const btn = $('#btn-factory-pause');
    if (btn) {
        btn.textContent = "⏸ PAUSE";
        btn.classList.remove('btn-primary');
        btn.classList.add('btn-secondary');
    }

    // ★ 핵심 수정: 새 탭에서는 content script의 pausedState가 없으므로
    // popup.js에서 직접 재시작 로직 실행
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) {
        showToast("Flow page (flow.google.com) required. Please open flow.google.com in a new tab.", 'error');
        return;
    }

    // ★ Factory 전용: 실제 PAUSED일 때만 RESUME_GENERATION 후 return. IDLE(계정 전환 후 등)이면 RELOAD 경로로 감 (다른 모드 무영향)
    try {
        const pausedResp = await chrome.tabs.sendMessage(tab.id, { type: 'CHECK_PAUSED_STATE' });
        if (pausedResp?.isPaused) {
            const response = await chrome.tabs.sendMessage(tab.id, { type: 'RESUME_GENERATION' });
            if (response) {
                APP.flowUi = APP.flowUi || {};
                APP.flowUi.lastProgressSeq = -1;
                showToast("Resumed - auto progress continues", 'success');
                return;
            }
        }
    } catch (e) {
    }

    // ★ content가 PAUSED가 아니거나 미응답(계정 전환 후 리로드 등) → Flow 탭 찾아 활성화 후 리로드
    await new Promise(r => setTimeout(r, 300));
    const hasResumeData = await chrome.storage.local.get(['videoPipelineResume', 'factoryVideoPipelineResume']).then(r => !!(r?.videoPipelineResume || r?.factoryVideoPipelineResume));
    if (hasResumeData) {
        APP.flowUi = APP.flowUi || {};
        APP.flowUi.lastProgressSeq = -1;
        // ★ 계정 전환 후 재개: Flow 탭이 있으면 해당 탭 활성화 후 리로드, 없으면 현재 탭을 Flow로 이동 (항상 이 단계부터 자동 진행)
        const FLOW_URL = 'https://flow.google.com/';
        const allTabs = await chrome.tabs.query({ currentWindow: true });
        const flowTab = allTabs.find(t => isFlowTabUrl(t.url));
        if (flowTab) {
            await chrome.tabs.update(flowTab.id, { active: true });
            const res = await chrome.runtime.sendMessage({ type: 'FACTORY_RELOAD_AND_RESUME', tabId: flowTab.id });
            showToast(res?.success ? "Resumed - auto progress continues" : "Flow page (flow.google.com) required. Please open flow.google.com in a new tab.", res?.success ? 'success' : 'error');
        } else {
            const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (!activeTab) {
                showToast("Flow page (flow.google.com) required. Please open flow.google.com in a new tab.", 'error');
                return;
            }
            const res = await chrome.runtime.sendMessage({ type: 'FACTORY_NAVIGATE_AND_RESUME', tabId: activeTab.id });
            showToast(res?.success ? "Resumed - auto progress continues" : "Flow page (flow.google.com) required. Please open flow.google.com in a new tab.", res?.success ? 'success' : 'error');
        }
        return;
    }

    // ★ videoPipelineResume 없으면 startVideoGeneration (pending 항목부터 재시작)
    const queue = APP.factory.videoQueue;
    APP.factory.videoRunning = false;

    const pendingCount = queue?.filter(q => q.status === 'pending').length || 0;
    const failedCount = queue?.filter(q => q.status === 'failed').length || 0;

    if (pendingCount > 0) {
        showToast("Resumed - continuing from pending items ({count})".replace('{count}', pendingCount), 'success');
        startVideoGeneration();
    } else if (failedCount > 0) {
        showToast("No pending items. Use 'Retry Failed' for failed items ({count})".replace('{count}', failedCount), 'info');
        // UI 복구
        APP.factory.videoRunning = false;
        APP.factory.isVideoPhase = false;
        const factoryPauseBtn = $('#btn-factory-pause');
        if (factoryPauseBtn) factoryPauseBtn.disabled = true;
        showVideoCompletion();  // 큐 기반
    } else {
        showToast("No videos to generate. Solution: Click 'Generate video prompts' first, then 'Start video generation'.", 'error');
    }
    } finally {
        APP.factory._resumeInProgress = false;
    }
}

// ★ Factory Video 전용 정지
function stopFactoryVideoGeneration() {
    APP.factory.videoRunning = false;
    APP.factory.videoPaused = false;
    APP.factory.isProcessing = false;  // 모드 전환 허용
    APP.factory.isVideoPhase = false;
    // AUTO 모드 해제
    APP.factory.isAutoMode = false;
    APP.factory.isFullAuto = false;
    APP.factory.isVideoAuto = false;

    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
        if (tab) chrome.tabs.sendMessage(tab.id, { type: 'STOP_GENERATION' });
    });

    // ★★★ generating 중이던 항목을 failed로 변경 (나중에 "실패 재생성"으로 처리 가능)
    if (APP.factory.videoQueue) {
        APP.factory.videoQueue.filter(q => q.status === 'generating' || q.status === 'active').forEach(q => {
            q.status = 'failed';
            q.error = 'Stopped by user';
        });
    }

    // UI 업데이트 — factoryControlButtons(일시정지+새프로젝트)는 유지
    $('#factoryVideoProgress')?.classList.add('hidden');
    $('#btn-start-video-generation')?.classList.remove('hidden');
    $('#factoryVideoActions')?.classList.remove('hidden');

    const btn = $('#btn-factory-pause');
    if (btn) {
        btn.textContent = "⏸ PAUSE";
        btn.classList.remove('btn-primary');
        btn.classList.add('btn-secondary');
        btn.disabled = true;
    }

    renderVideoPromptList();

    // 미완료 항목 카운트 (pending + failed)
    const pendingCount = APP.factory.videoQueue?.filter(q => q.status === 'pending').length || 0;
    const failedCount = APP.factory.videoQueue?.filter(q => q.status === 'failed').length || 0;
    const completedCount = APP.factory.videoQueue?.filter(q => q.status === 'completed').length || 0;

    if ((pendingCount > 0 || failedCount > 0) && completedCount > 0) {
        showToast("Stopped - restart to continue from pending items"
            .replace('{completed}', completedCount).replace('{pending}', pendingCount + failedCount), 'info');
    } else {
        showToast("GENERATION STOPPED");
    }

}

function resetProject() {
    const currentMode = APP.mode;

    // ★★★ 핵심: content script에 정지 메시지 전송 (진행 중인 루프 종료)
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
        if (tab) {
            chrome.tabs.sendMessage(tab.id, { type: 'STOP_GENERATION' }).catch(() => { });
        }
    });

    // ★ storage에서 일시정지 상태 제거
    chrome.storage.local.remove(['isPaused', 'pausedMode']);

    // ★ 완료 섹션의 재개 버튼 숨기기
    $('#btn-completion-resume')?.classList.add('hidden');

    // ★ 현재 모드에 해당하는 상태만 초기화 (모드 독립성)

    // 공통: 현재 모드의 큐와 실행 상태 초기화
    APP.queue = [];
    APP.prompts = [];
    APP.isRunning = false;
    APP.isPaused = false;
    APP.stoppedWithPendingItems = false;  // ★ 정지 후 재시작 플래그도 초기화
    APP.runningMode = null;

    // ★ 캐릭터 레퍼런스 완료 배너 & 플래그 초기화 — CCR 업로드 상태에서 이전 프로젝트의
    //   "완료 (N/N)" 표시가 남아있던 버그 수정. 신규 프로젝트는 배너 숨김에서 시작.
    $('#charRefCompletionMsg')?.classList.add('hidden');
    const _charRefMsgText = document.querySelector('#charRefCompletionMsg .charref-completion-text');
    if (_charRefMsgText) _charRefMsgText.textContent = '';
    APP._charRefsGeneratedOnce = false;

    // ★ 생성 진행 플래그 리셋 — 이전 프로젝트에서 Gemini/레퍼런스 호출 중 리셋 눌렀거나
    //   비정상 종료 후 남아있을 수 있는 플래그. true로 고착되면 다음 프로젝트 버튼 비활성화됨.
    APP.isGeneratingPrompts = false;
    APP.isGeneratingRefs = false;

    // ★ resume 상태 클리어 — 이전 프로젝트의 "계정 전환 후 재개" 데이터 완전 제거
    //   새 프로젝트 시작은 재개가 아닌 새로운 작업이므로 잔존 상태가 혼동 일으킴
    APP.resumeState = null;
    APP.resumeExistingPrompts = null;
    chrome.storage.local.remove(['resumeState', 'resumeExistingPrompts']).catch(() => {});

    // ★ "AI 자동 (N개)" 드롭다운 텍스트 리셋 — 이전 Gemini 분석 결과의 N이 남아있는 버그 수정
    //   splitMode가 giseungjeongyeol이면 자동으로 숫자 옵션 복원, 그 외는 "AI 자동 결정"으로 리셋
    if (typeof updateNumPromptsUI === 'function') updateNumPromptsUI();

    // 모드별 상태 초기화
    switch (currentMode) {
        case 'factory':
            // Factory 전용 상태 초기화
            APP.characterRefs = [];
            APP.isGeneratingRefs = false;
            APP.styleImage = null;
            APP.factory.batch1Images = [];
            APP.factory.batch1Prompts = [];
            APP.factory.batch1Filenames = [];
            APP.factory.videoPrompts = [];
            APP.factory.videoQueue = [];
            APP.factory.imageGenerationComplete = false;
            APP.factory.videoGenerationComplete = false;
            APP.factory.isAutoMode = false;
            APP.factory.isFullAuto = false;    // ★ FULL AUTO 해제
            APP.factory.isVideoAuto = false;   // ★ VIDEO AUTO 해제
            APP.factory.isProcessing = false;  // ★ Factory 프로세스 종료 (모드 전환 허용)
            APP.factory.isVideoPhase = false;
            APP.factory.videoRunning = false;
            chrome.storage.local.remove('factoryBatch1Images');

            // Factory UI 초기화
            if ($('#scriptInput')) $('#scriptInput').value = '';
            if ($('#controlProjectName')) $('#controlProjectName').value = '';
            $('#charRefsSection')?.classList.add('hidden');
            if ($('#charRefsList')) $('#charRefsList').innerHTML = '';
            $('#generatedPromptsSection')?.classList.add('hidden');
            $('#section-factory-video')?.classList.add('hidden');
            $('#factoryVideoList')?.classList.add('hidden');
            $('#factoryVideoActions')?.classList.add('hidden');
            $('#factoryVideoCompletion')?.classList.add('hidden');
            $('#factoryControlButtons')?.classList.add('hidden');
            $('#generatedVideoPromptsSection')?.classList.add('hidden');
            if ($('#factoryVideoList')) $('#factoryVideoList').innerHTML = '';
            if ($('#generatedVideoPromptsText')) $('#generatedVideoPromptsText').value = '';
            if ($('#styleImagePreview')) $('#styleImagePreview').innerHTML = '';
            break;

        case 'scriptToImage':
            // Script→Image 전용 상태 초기화
            APP.characterRefs = [];
            APP.isGeneratingRefs = false;
            APP.styleImage = null;

            // Script→Image UI 초기화
            if ($('#scriptInput')) $('#scriptInput').value = '';
            if ($('#controlProjectName')) $('#controlProjectName').value = '';
            $('#charRefsSection')?.classList.add('hidden');
            if ($('#charRefsList')) $('#charRefsList').innerHTML = '';
            $('#generatedPromptsSection')?.classList.add('hidden');
            if ($('#styleImagePreview')) $('#styleImagePreview').innerHTML = '';
            break;

        case 'textToImage':
            // Text→Image 전용 상태 초기화
            APP.styleImage = null;

            // Text→Image UI 초기화
            if ($('#promptInput')) $('#promptInput').value = '';
            if ($('#controlProjectName')) $('#controlProjectName').value = '';
            if ($('#styleImagePreview')) $('#styleImagePreview').innerHTML = '';
            $('#clearPromptBtn')?.classList.add('hidden');

            // ★ v1.1.2: CCR 슬롯 데이터는 새 프로젝트에서도 보존 (전 모드 공유 데이터)
            //   브랜드 불러오기/전체 초기화 버튼으로 명시적 리셋 가능
            break;

        case 'textToVideo':
            // Text→Video 전용 상태 초기화

            // Text→Video UI 초기화
            if ($('#promptInput')) $('#promptInput').value = '';
            if ($('#controlProjectName')) $('#controlProjectName').value = '';
            $('#clearPromptBtn')?.classList.add('hidden');
            break;

        case 'imageToVideo':
            // Image→Video 전용 상태 초기화
            APP.imageFiles = [];
            APP.assetNames = {};
            closeAssetMentionMenu();
            APP.videoQueueConfirmed = false;
            _previewUrls.forEach(u => URL.revokeObjectURL(u));
            _previewUrls = [];
            closeI2vAssetPicker();

            // Image→Video UI 초기화
            if ($('#imagePreview')) $('#imagePreview').innerHTML = '';
            if ($('#videoPromptInput')) $('#videoPromptInput').value = '';
            if ($('#controlProjectName')) $('#controlProjectName').value = '';
            $('#clearImagesBtn')?.classList.add('hidden');
            $('#clearPromptBtn')?.classList.add('hidden');
            updateUploadAssetsUI();
            break;
    }

    // videoPipelineResume이 있으면 재개 목적의 새 프로젝트 → characterRefAssets 유지
    // videoPipelineResume이 없으면 진짜 새 프로젝트 → characterRefAssets 초기화
    if (currentMode === 'scriptToImage' || currentMode === 'factory') {
        chrome.storage.local.get('videoPipelineResume').then((resumeCheck) => {
            const isResumingAfterAccountChange = !!resumeCheck?.videoPipelineResume;
            if (!isResumingAfterAccountChange) {
                APP.characterRefAssets = null;
                chrome.storage.local.remove('characterRefAssets');
                renderCharRefThumbnails(null);
            } else {
            }
        });
    } else {
    }

    // 공통 UI 초기화 (현재 모드에만 해당)
    $('#section-queue')?.classList.add('hidden');
    $('#section-progress')?.classList.add('hidden');
    $('#section-completion')?.classList.add('hidden');
    $('#btn-retry-failed')?.classList.add('hidden');
    $('#section-mode-select')?.classList.remove('hidden');
    $('#section-actions')?.classList.remove('hidden');

    if ($('#progressLog')) $('#progressLog').innerHTML = '';
    if ($('#progressFill')) $('#progressFill').style.width = '0%';
    if ($('#progressText')) $('#progressText').textContent = '0 / 0';

    resetControlUI();

    const startBtn = $('#btn-start-generation');
    if (startBtn) {
        const isVideo = currentMode === 'textToVideo' || currentMode === 'imageToVideo';
        setStartButtonContent(startBtn, isVideo);
    }

    // 세션 저장 (현재 모드만)
    chrome.storage.local.get(['grokSession'], (result) => {
        const existingSession = result.grokSession || {};
        // 현재 모드 세션만 초기화, 다른 모드 데이터는 유지
        existingSession[`${currentMode}_prompts`] = [];
        existingSession[`${currentMode}_queue`] = [];
        chrome.storage.local.set({ grokSession: existingSession });
    });

    updateModeUI();
}

function retryFailed() {
    const charRefItems = APP.queue.filter(q => q.type === 'characterRef');
    const failedSceneItems = APP.queue.filter(item => item.type !== 'characterRef' && item.status === 'fail');
    if (failedSceneItems.length === 0) {
        const isVideo = APP.mode === 'textToVideo' || APP.mode === 'imageToVideo';
        showToast(isVideo
            ? "No failed videos to regenerate. Solution: Run video generation first; then you can retry failed items only."
            : "No failed images to regenerate. Solution: Run image generation first; then you can retry failed items only.", 'info');
        return;
    }

    const retryBtn = $('#btn-retry-failed');
    if (retryBtn) {
        retryBtn.disabled = true;
        retryBtn.querySelector('span').textContent = "REGENERATING...";
    }

    // ★ done은 유지, fail만 ready로 → 큐 재구성 시 done 먼저 필터(실패→ready 변경 전)
    const doneSceneItems = APP.queue.filter(item => item.type !== 'characterRef' && item.status === 'done');
    failedSceneItems.forEach(item => item.status = 'ready');
    APP.queue = [...charRefItems, ...doneSceneItems, ...failedSceneItems];
    showQueue();

    startGeneration(true);
}

// ========== PROGRESS LISTENER ==========
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'RESET_LAST_PROGRESS_SEQ') {
        APP.flowUi = APP.flowUi || {};
        APP.flowUi.lastProgressSeq = -1;
        sendResponse({ ok: true });
        return true;
    }
    if (message.type === 'GENERATION_PROGRESS') {
        handleProgress(message.data);
    }
    if (message.type === 'DOWNLOAD_PROGRESS') {
        handleDownloadProgress(message.data);
    }
    if (message.type === 'GENERATION_COMPLETE') {
        const data = message.data || {};
        const totalSuccess = Number(data.totalSuccess);
        const totalFail = Number(data.totalFail);
        // ★ 비디오 단계 완료일 때만 showVideoCompletion (이미지 완료는 handleComplete로 progressText 덮어쓰기)
        const hasVideoCompletionData = (APP.factory.videoQueue?.length > 0) &&
            Number.isFinite(totalSuccess) && Number.isFinite(totalFail);
        const isFactoryVideoPhase = APP.factory.videoRunning || APP.factory.isVideoPhase;
        const isFactoryVideoComplete = hasVideoCompletionData && isFactoryVideoPhase;
        if (isFactoryVideoComplete) {
            // ★ Factory 비디오: 메인 리스너에서 직접 처리 (등록형 핸들러 미등록/사이드패널 재로드 시에도 완료 메시지 표시)
            $('#section-factory-video')?.classList.remove('hidden');
            // ★ 큐 동기화: 이전 성공(completed)은 유지, 재개/재시도 구간만 payload로 반영 (대기열 단일 소스)
            const queue = APP.factory.videoQueue || [];
            const failedSet = new Set(Array.isArray(data.failedPromptIndices) ? data.failedPromptIndices : []);
            const processedCount = totalSuccess + totalFail;
            queue.forEach((item, idx) => {
                if (item.status === 'completed') return;  // 이미 성공한 항목은 절대 덮어쓰지 않음
                if (failedSet.has(idx)) item.status = 'failed';
                else if (idx < processedCount) item.status = 'completed';
                else item.status = 'pending';
            });
            showVideoCompletion();
            APP.factory.videoRunning = false;
            APP.factory.videoPaused = false;
            APP.factory.isVideoPhase = false;
            const factoryPauseBtn = $('#btn-factory-pause');
            if (factoryPauseBtn) factoryPauseBtn.disabled = true;
            if (APP.factory._videoProgressHandler) {
                chrome.runtime.onMessage.removeListener(APP.factory._videoProgressHandler);
                APP.factory._videoProgressHandler = null;
            }
        } else {
            handleComplete(message.data);
        }
    }
    if (message.type === 'FLOW_ERROR') {
        const msg = message.data?.message || "Error";
        showToast(msg, 'error');
        // ★ 팩토리 모드: 캐릭터 레퍼런스 생성 중 에러 시 스피너 해제
        if (APP.mode === 'factory' && APP.isGeneratingRefs) {
            APP.isGeneratingRefs = false;
        }
        // ★ PRO 2.0: 캐릭터 레퍼런스 generating 상태 복구 + 모든 재생성 타임아웃 정리
        if (Array.isArray(APP.characterRefs)) {
            let changed = false;
            APP.characterRefs.forEach(r => {
                if (r.status === 'generating') { r.status = 'failed'; changed = true; }
            });
            if (changed) renderCharacterRefs(APP.characterRefs);
        }
        if (APP._regenTimeouts) {
            Object.keys(APP._regenTimeouts).forEach(code => {
                if (APP._regenTimeouts[code]) { clearTimeout(APP._regenTimeouts[code]); APP._regenTimeouts[code] = null; }
            });
        }
        // ★ 대규모 재생성 (handleGenerateAllRefs) 스피너도 해제
        APP.isGeneratingRefs = false;
        const btnGenRefs = $('#btnGenerateAllRefs');
        if (btnGenRefs) {
            btnGenRefs.disabled = false;
            btnGenRefs.innerHTML = `🔄 ${"REGENERATE ALL CHARACTER REFERENCES"}`;
        }
        const stopBtn = $('#btnStopCharRefGen');
        if (stopBtn) stopBtn.classList.add('hidden');
        if (APP.factory?.charRefGenerationTimeoutId) {
            clearTimeout(APP.factory.charRefGenerationTimeoutId);
            APP.factory.charRefGenerationTimeoutId = null;
        }
        // ★ 에러 시에도 일시정지+새프로젝트 유지 (그록팩토리 동일) — 새로 시작 가능
        APP.isRunning = false;
        APP.isPaused = false;
        $('#btn-start-generation')?.classList.remove('hidden');
        $('#controlButtons')?.classList.remove('hidden');
        const pauseBtn = $('#btn-pause');
        if (pauseBtn) {
            pauseBtn.disabled = true;
            pauseBtn.removeAttribute('title');
        }
    }
    if (message.type === 'AUTO_PAUSE') {
        const { reason } = message.data || {};
        if (APP.factory.videoRunning || APP.factory.isVideoPhase) {
            pauseFactoryVideoGeneration();
        } else {
            pauseGeneration();
        }
        const autoPauseMessages = {
            CREDIT_EXHAUSTED: "⚠️ AI credits exhausted — auto paused.\nSwitch account, then click ▶ Resume to continue.",
            SUBMIT_BUTTON_MISSING: 'Generate button not found. Check the Flow page, then click ▶ Resume.',
            CONSECUTIVE_FAILURES: 'Auto-paused after consecutive failures. Check status, then click ▶ Resume.',
            GENERATION_STALLED: 'Image generation stalled. Check Flow status, then click ▶ Resume.'
            // ★ v1.1.3: UNUSUAL_ACTIVITY_DETECTED는 UNUSUAL_ACTIVITY_STATUS가 단일 통합 토스트로 처리 (중복 방지)
        };
        // 토스트 메시지가 정의된 reason만 표시 (UNUSUAL_ACTIVITY_DETECTED는 별도 핸들러가 이미 처리)
        if (autoPauseMessages[reason]) {
            showToast(autoPauseMessages[reason], 'warning', 8000);
        }
    }
    if (message.type === 'UNUSUAL_ACTIVITY_STATUS') {
        // ★ v1.1.3: Google 봇 차단 감지 — 단일 통합 토스트 (DOM이 #toast 하나라 덮어쓰기 방지)
        //   패턴 안내 + 콘텐츠 정책 (필요 시) + AUTO_PAUSE 안내 (필요 시)를 한 번에 표시
        //   사용자는 X 버튼으로 즉시 닫거나, 30초 후 자동 사라짐
        // ★ v1.1.8: 사용자가 X 로 닫은 후 60초 내에는 동일 차단 토스트 재표시 안 함
        const now = Date.now();
        if (APP._unusualToastDismissedAt && (now - APP._unusualToastDismissedAt) < 60000) {
            return;  // 사용자가 명시적으로 닫음 — 60초간 재표시 차단
        }
        // ★ v1.1.8 fix: 표시 throttle (X 무관) — 차단 폴링(5초)이 계속 showToast 호출하면
        //   매번 자동 숨김 타이머가 리셋되어 토스트가 영원히 안 사라짐 (= "X 눌러도 안 닫힘" 진짜 원인)
        //   해결: 한 번 띄우면 45초간 재표시 안 함 → 토스트가 자기 duration 후 자동 닫힘 보장
        if (APP._unusualToastShownAt && (now - APP._unusualToastShownAt) < 45000) {
            return;  // 최근 표시함 — 자동 닫힘되도록 재표시 차단
        }
        APP._unusualToastShownAt = now;
        const { accumulated, successCount, pattern, showContentPolicy, willAutoPause } = message.data || {};

        const UNUSUAL_MSG = {
            automation: "🤖 Automation-suspected block pattern — {count} blocked ({success} succeeded)\n\nAlmost all requests blocked from the start.\nGoogle likely classified this as automation.\n\n💡 Recommended actions:\n1. ⏸ Pause and rest for 1~2 hours\n2. Switch to another Google account\n3. Stop other automation tools on same IP/VPN\n4. If using VPN, try switching to regular IP",
            content: "📋 Content-policy block suspected — partial block ({count} blocked / {success} succeeded)\n\nOnly some prompts blocked. Likely Google content policy violation.\n\n💡 Recommended actions:\n1. Review blocked prompts — see policy below\n2. Rewrite with fictional persons/situations\n3. ⏸ Pause then ▶ Resume to continue rest\n\n⚠️ Content policy blocks are NOT eligible for refund",
            gradual: "📉 Gradual block pattern — reCAPTCHA score accumulated ({count} blocked / {success} succeeded)\n\nInitially normal but blocks increased over time.\nFlow server lowered your reCAPTCHA score due to accumulated requests.\n\n💡 Recommended actions:\n1. ⏸ Pause and rest 30~60 minutes\n2. Click ▶ Resume after waiting — usually works\n3. Split large batches into smaller runs",
            unknown: "🛑 Google block detected — Flow service block (NOT AI4Next's issue)\n{count} blocked tiles accumulated\n\nPossible causes:\n• Excessive requests in short time\n• Account suspicious activity\n• Content policy violation\n• Multiple automation tools on same IP\n\nRecommended actions:\n1. ⏸ Pause and wait 10~30 minutes\n2. Switch to another Google account\n3. Stop other automation tools on same IP/VPN\n4. Check Flow page directly (reCAPTCHA, etc.)\n\nMore info: flow.google.com/help"
        };
        const UNUSUAL_AUTO_PAUSE_SUFFIX = "\n\n⏸ AUTO-PAUSED. Continuing now will worsen reCAPTCHA score.";
        const UNUSUAL_CONTENT_POLICY_SUFFIX = "\n\n━━━━━━━━━━━━━━━━━━━━\n⚠️ Google policy auto-blocks:\n• Real people (politicians, celebrities)\n• Political events (elections, protests)\n• Violent/shocking scenes\n• Religion, race, sensitive topics\n• Copyrighted characters/brands\n\nThese are blocked in ANY tool, not refundable.\n💡 Use fictional persons → most work fine.";

        let combined = (UNUSUAL_MSG[pattern] || UNUSUAL_MSG.unknown)
            .replace('{count}', String(accumulated || 0))
            .replace('{success}', String(successCount || 0));

        // Brief AUTO_PAUSE notice
        if (willAutoPause) {
            combined += UNUSUAL_AUTO_PAUSE_SUFFIX;
        }

        // Content-policy notice (content/unknown pattern only — automation/gradual patterns aren't policy-related)
        if (showContentPolicy && (pattern === 'content' || pattern === 'unknown')) {
            combined += UNUSUAL_CONTENT_POLICY_SUFFIX;
        }

        // ★ v1.1.8: 18초 후 자동 닫힘 (X 안 눌러도) + 45초 throttle 로 재표시 차단 → 확실히 사라짐
        //   사용자가 읽을 시간(18초) 충분 + X 즉시 닫기도 가능
        showToast(combined, 'error', 18000);
    }
    if (message.type === 'RATE_LIMIT_STATUS') {
        // ★ v1.1.3: Flow 속도 제한 단계별 사용자 안내 토스트
        //   - 원인 안내 + 권장 액션 (한/영 locale + 영어 fallback for 다국어)
        //   - 단계별 토스트 지속 시간 차등 (심각도 ↑ = 표시 시간 ↑)
        const { stage, accumulated, cooldownSec } = message.data || {};
        const stageNum = Math.min(4, Math.max(0, stage || 0));
        const RATE_LIMIT_MSG = [
            "⏳ Flow server temporarily busy — auto-waiting {cooldown}s\nWill retry automatically",
            "⚠️ Flow rate-limit detected (Stage 1) — {cooldown}s cooldown\n💡 Reduce Flow usage in other tabs",
            "⚠️ Flow rate-limit (Stage 2 · +10% delay) — {count} accumulated failures\n💡 Closing other Flow tabs/browsers recommended\n💡 Stop other background AI generation tasks",
            "🚨 Flow rate-limit severe (Stage 3 · +20% delay) — {count} accumulated failures\n💡 Recommend ⏸ Pause and wait 1~2 minutes\n💡 Click ▶ Resume after waiting for faster progress",
            "🛑 Flow rate-limit max (Stage 4 · +25% delay) — {count} accumulated failures\n💡 Strongly recommend ⏸ Pause and wait 5~10 minutes\n💡 Auto-pause will trigger if persists (AUTO_PAUSE)"
        ];
        const template = RATE_LIMIT_MSG[stageNum] || '';
        if (template) {
            const msg = template
                .replace('{cooldown}', String(cooldownSec || 0))
                .replace('{count}', String(accumulated || 0));
            // 단계별 토스트 지속 시간 (ms) — 단계 ↑ = 사용자가 읽을 시간 ↑
            const toastDuration = stageNum >= 3 ? 15000 : stageNum >= 2 ? 12000 : stageNum >= 1 ? 8000 : 6000;
            const toastType = stageNum >= 3 ? 'error' : stageNum >= 1 ? 'warning' : 'info';
            showToast(msg, toastType, toastDuration);
        }
    }
    if (message.type === 'PROJECT_BATCH_PROGRESS') {
        const { current, total, startIndex } = message.data || {};
        if (total > 1) {
            showToast(`📁 Project ${current}/${total} in progress (#${startIndex + 1}~)`, 'info', 4000);
        }
        // ★ 프로젝트 배치 전환 시 progressSeq 리셋 → 새 배치의 progress가 무시되지 않도록
        APP.flowUi.lastProgressSeq = -1;

        // ★ 큐 아이템 상태 갱신: startIndex 이후 항목을 ready로 리셋
        if (startIndex != null) {
            const sceneItems = APP.queue.filter(q => q.type !== 'characterRef');
            sceneItems.forEach((item, idx) => {
                if (idx >= startIndex && item.status !== 'done' && item.status !== 'fail') {
                    item.status = 'ready';
                }
            });
            // 첫 항목을 active로 → 스피너 즉시 표시
            const firstReady = sceneItems.find((item, idx) => idx >= startIndex && item.status === 'ready');
            if (firstReady) firstReady.status = 'active';
            showQueue();
        }
    }
    if (message.type === 'CREDIT_EXHAUSTED') {
        // 팩토리 모드(동영상 생성 중): "유료기능" 안내 모달 표시 안 함 (자동 진행)
        const isFactoryVideo = APP.mode === 'factory' || APP.factory?.videoRunning || APP.factory?.isVideoPhase;
        if (isFactoryVideo) {
        } else {
            showCreditModal();
        }
    }
    if (message.type === 'PROMPT_STATUS') {
        handlePromptStatus(message.data);
    }
    if (message.type === 'REQUEST_LAZY_IMAGE') {
        const idx = message.imageIndex;

        // ① 일반 모드: APP.imageFiles 조회
        const file = APP.imageFiles?.[idx];
        if (file) {
            fileToBase64(file).then(base64 => {
                sendResponse({ success: true, base64, name: file.name });
            }).catch(err => {
                sendResponse({ success: false, error: err.message });
            });
            return true;
        }

        // ② Factory 이미지 단계: APP.factory.batch1Images 조회
        const factoryImage = APP.factory?.batch1Images?.[idx];
        if (factoryImage?.base64) {
            sendResponse({
                success: true,
                base64: factoryImage.base64,
                name: factoryImage.filename || factoryImage.originalFilename || `factory_${idx + 1}.png`
            });
            return true;
        }

        // ③ Factory 동영상 단계: videoQueue에서 imageBase64 있는 n번째 항목
        if (APP.factory?.isVideoPhase && APP.factory?.videoQueue?.length) {
            const withImage = APP.factory.videoQueue.filter(q => q?.imageBase64 && q.imageBase64.length >= 100);
            const item = withImage[idx];
            if (item?.imageBase64) {
                sendResponse({
                    success: true,
                    base64: item.imageBase64,
                    name: item.originalFilename || `factory_${idx + 1}.png`
                });
                return true;
            }
        }

        // ④ 없으면 실패
        sendResponse({ success: false, error: 'File not found' });
        return true;
    }
    if (message.type === 'CHAR_REF_IMAGES_READY') {
        (async () => {
            const payload = message.payload || {};
            const base64Images = payload.base64Images || [];
            const isSingleRegen = !!(payload.isSingleRegen && payload.regenCode);
            try {
                if (base64Images.length > 0 && APP.characterRefs?.length > 0) {
                    const opts = isSingleRegen ? { isSingleRegen: true, regenCode: payload.regenCode } : {};
                    await saveCharRefFromBase64(APP.characterRefs, base64Images, opts);
                    if (isSingleRegen) {
                        const ref = APP.characterRefs.find(r => r.code === payload.regenCode);
                        if (ref) ref.status = 'completed';
                        renderCharacterRefs(APP.characterRefs);
                    } else {
                        // ★ 수동 생성 10분 타임아웃 해제 (대본투이미지/팩토리)
                        if (APP.factory.charRefGenerationTimeoutId) {
                            clearTimeout(APP.factory.charRefGenerationTimeoutId);
                            APP.factory.charRefGenerationTimeoutId = null;
                        }
                        // ★ 단일 재생성이 아닐 때: 캐릭터 레퍼런스 완료 UI (스피너 해제, 완료 메시지, 카드 completed)
                        APP.isGeneratingRefs = false;
                        APP.characterRefs.forEach(r => { if (r.status !== 'failed') r.status = 'completed'; });
                        renderCharacterRefs(APP.characterRefs);
                        const btnGenRefs = $('#btnGenerateAllRefs');
                        if (btnGenRefs) {
                            btnGenRefs.disabled = false;
                            btnGenRefs.innerHTML = `🔄 ${"REGENERATE ALL CHARACTER REFERENCES"}`;
                        }
                        const completionMsg = $('#charRefCompletionMsg');
                        const n = APP.characterRefs.filter(r => r.status === 'completed').length;
                        const total = APP.characterRefs.length;
                        if (completionMsg) {
                            completionMsg.querySelector('.charref-completion-text').textContent =
                                `${"CHARACTER REFERENCE IMAGES GENERATED!"} (${n}/${total})`;
                            completionMsg.classList.remove('hidden');
                        }
                        updateFactoryPhaseStatus('char_ref_done', n);
                        // ★ PRO 2.0: 생성 완료 → STOP 버튼 숨김 + 재생성 플래그 설정
                        $('#btnStopCharRefGen')?.classList.add('hidden');
                        APP._charRefsGeneratedOnce = true;
                    }
                } else {
                    if (!isSingleRegen) {
                        if (APP.factory.charRefGenerationTimeoutId) {
                            clearTimeout(APP.factory.charRefGenerationTimeoutId);
                            APP.factory.charRefGenerationTimeoutId = null;
                        }
                        APP.isGeneratingRefs = false;
                        APP.characterRefs?.forEach(r => { if (r.status !== 'failed') r.status = 'pending'; });
                        if (APP.characterRefs?.length) renderCharacterRefs(APP.characterRefs);
                        const btnGenRefs = $('#btnGenerateAllRefs');
                        if (btnGenRefs) {
                            btnGenRefs.disabled = false;
                            btnGenRefs.innerHTML = "GENERATE CHARACTER REFERENCE IMAGES";
                        }
                        const completionMsg = $('#charRefCompletionMsg');
                        const total = APP.characterRefs?.length || 0;
                        if (completionMsg && total > 0) {
                            completionMsg.querySelector('.charref-completion-text').textContent =
                                `${"CHARACTER REFERENCE IMAGES GENERATED!"} (0/${total})`;
                            completionMsg.classList.remove('hidden');
                        }
                        updateFactoryPhaseStatus('char_ref_done', 0);
                    }
                }
            } catch (e) {
                // ★ PRO 2.0: 에러 원인을 콘솔에 명확히 기록 (stack + 관련 상태)
                console.log('[CHAR_REF_IMAGES_READY] 핸들러 예외:', e, {
                    isSingleRegen,
                    regenCode: payload.regenCode,
                    base64Count: base64Images.length,
                    characterRefsCount: APP.characterRefs?.length,
                    message: e?.message,
                    stack: e?.stack
                });
                if (isSingleRegen) {
                    // 단일 리젠 실패 시: 해당 캐릭터 상태 복구 + 타임아웃 해제
                    const ref = APP.characterRefs?.find(r => r.code === payload.regenCode);
                    if (ref) ref.status = 'failed';
                    renderCharacterRefs(APP.characterRefs);
                    if (APP._regenTimeouts?.[payload.regenCode]) {
                        clearTimeout(APP._regenTimeouts[payload.regenCode]);
                        APP._regenTimeouts[payload.regenCode] = null;
                    }
                    showToast(`⚠️ ${payload.regenCode} regeneration failed: ${e?.message || 'Unknown error'}`, 'error');
                } else {
                    if (APP.factory.charRefGenerationTimeoutId) {
                        clearTimeout(APP.factory.charRefGenerationTimeoutId);
                        APP.factory.charRefGenerationTimeoutId = null;
                    }
                    APP.isGeneratingRefs = false;
                    const btnGenRefs = $('#btnGenerateAllRefs');
                    if (btnGenRefs) {
                        btnGenRefs.disabled = false;
                        btnGenRefs.innerHTML = "GENERATE CHARACTER REFERENCE IMAGES";
                    }
                }
            } finally {
                // ★ FULL AUTO 대기 중이면 캐릭터 레퍼런스 완료 신호 전달 → 4초 안정화 후 startGeneration
                const resolve = APP.factory?.charRefReadyResolve;
                if (typeof resolve === 'function') {
                    APP.factory.charRefReadyResolve = null;
                    const STABILIZE_BEFORE_NEXT_MS = 4000;
                    setTimeout(() => resolve(), STABILIZE_BEFORE_NEXT_MS);
                }
            }
        })();
    }

});

function handleProgress(data) {
    const { promptIndex, status, imageBase64, imageFilename, error, totalAttempts } = data;

    // ★ Flow 진행률: 그록팩토리와 동일 — 대기열 항목별 스피너/완료/실패 + 프로그레스바 매칭
    const phase = data.phase;
    const isFactoryVideo = APP.factory?.videoRunning || APP.factory?.isVideoPhase;
    const shouldProcessPhase = (phase === 'submitting' || phase === 'generating' || phase === 'chunk-downloading' || phase === 'retry-preparing') &&
        (APP.isRunning || isFactoryVideo);
    if (shouldProcessPhase) {
        const sceneItems = isFactoryVideo
            ? (APP.factory.videoQueue || [])
            : APP.queue.filter(q => q.type !== 'characterRef');
        const totalPrompts = sceneItems.length;
        const { totalSuccess, total, avgPercent } = data;
        const progressSeq = Number(data.progressSeq);
        // ★ 현재 Flow 파이프라인(progressSeq 포함)만 신뢰
        // 레거시 flow-automation.js progress(시퀀스/청크정보 없음)는 큐 상태를 덮어쓸 수 있어 무시
        if (!Number.isFinite(progressSeq)) {
            return;
        }
        if (progressSeq < APP.flowUi.lastProgressSeq) {
            return;
        }
        APP.flowUi.lastProgressSeq = progressSeq;
        const clampIndex = (value, fallback) => {
            const num = Number(value);
            if (!Number.isFinite(num)) return fallback;
            return Math.min(totalPrompts, Math.max(0, Math.floor(num)));
        };
        const chunkStart = clampIndex(data.chunkStart, 0);
        const chunkEnd = clampIndex(data.chunkEnd, totalPrompts);
        const clampPromptIndex = (value) => {
            const num = Number(value);
            if (!Number.isFinite(num)) return null;
            return Math.min(Math.max(0, Math.floor(num)), Math.max(0, totalPrompts - 1));
        };
        const completedPromptIndices = Array.isArray(data.completedPromptIndices)
            ? [...new Set(data.completedPromptIndices.map(v => clampPromptIndex(v)).filter(v => v !== null))]
            : null;
        const activePromptIndices = Array.isArray(data.activePromptIndices)
            ? [...new Set(data.activePromptIndices.map(v => clampPromptIndex(v)).filter(v => v !== null))]
            : null;
        const retryPendingPromptIndices = Array.isArray(data.retryPendingPromptIndices)
            ? [...new Set(data.retryPendingPromptIndices.map(v => clampPromptIndex(v)).filter(v => v !== null))]
            : null;
        const failedPromptIndicesProgress = Array.isArray(data.failedPromptIndices)
            ? [...new Set(data.failedPromptIndices.map(v => clampPromptIndex(v)).filter(v => v !== null))]
            : null;
        const hasExactPromptSets = !!completedPromptIndices || !!activePromptIndices || !!retryPendingPromptIndices || !!failedPromptIndicesProgress;

        if (hasExactPromptSets) {
            const completedSet = new Set(completedPromptIndices || []);
            const activeSet = new Set(activePromptIndices || []);
            const retryPendingSet = new Set(retryPendingPromptIndices || []);
            const failedSet = new Set(failedPromptIndicesProgress || []);
            // ★ activePromptIndices에 해당하는 인덱스만 generating/active, 나머지는 pending/ready
            if (isFactoryVideo) {
                for (let i = 0; i < totalPrompts; i++) {
                    if (failedSet.has(i)) sceneItems[i].status = 'failed';
                    else if (completedSet.has(i)) sceneItems[i].status = 'completed';
                    else if (activeSet.has(i)) sceneItems[i].status = 'generating';
                    else if (retryPendingSet.has(i)) sceneItems[i].status = 'pending';
                    else if (sceneItems[i].status !== 'completed') sceneItems[i].status = 'pending';
                }
                renderVideoPromptList();
            } else {
                for (let i = 0; i < totalPrompts; i++) {
                    if (failedSet.has(i)) sceneItems[i].status = 'fail';
                    else if (completedSet.has(i)) sceneItems[i].status = 'done';
                    else if (activeSet.has(i)) sceneItems[i].status = 'active';
                    else if (retryPendingSet.has(i)) sceneItems[i].status = 'ready';
                    else if (sceneItems[i].status !== 'done') sceneItems[i].status = 'ready';
                }
                showQueue();
            }

            const successCount = isFactoryVideo ? sceneItems.filter(q => q.status === 'completed').length : sceneItems.filter(q => q.status === 'done').length;
            const activeCount = isFactoryVideo ? sceneItems.filter(q => q.status === 'generating').length : sceneItems.filter(q => q.status === 'active').length;
            const readyCount = isFactoryVideo ? sceneItems.filter(q => q.status === 'pending').length : sceneItems.filter(q => q.status === 'ready').length;
            const failCount = isFactoryVideo ? sceneItems.filter(q => q.status === 'failed').length : sceneItems.filter(q => q.status === 'fail').length;
            const totalItems = sceneItems.length;
            const pct = totalItems > 0 ? Math.round((Math.min(successCount + activeCount, totalItems) / totalItems) * 100) : 0;
            const firstActiveIdx = isFactoryVideo ? sceneItems.findIndex(q => q.status === 'generating') : sceneItems.findIndex(q => q.status === 'active');
            const displayCount = successCount + (activeCount > 0 ? 1 : 0);
            const progressText = failCount > 0
                ? `${successCount} / ${totalItems} ${("(FAILED {count})").replace('{count}', failCount)}`
                : `${displayCount} / ${totalItems}`;

            if ($('#progressFill')) $('#progressFill').style.width = `${pct}%`;
            if ($('#progressText')) $('#progressText').textContent = progressText;
            if (isFactoryVideo) updateVideoProgressBar();  // 큐 기반 (단일소스)
            return;
        }

        // ★ 대기열 항목 상태 유도
        if (phase === 'submitting') {
            const submitted = clampIndex(data.submittedCount ?? totalSuccess, 0);
            const totalFromData = data.total;
            const isRetryBatch = totalFromData != null && totalFromData < totalPrompts;
            // ★ completedTiles: 직전 청크까지 완료된 타일 수 (재생성에는 해당 없음)
            const completedTiles = data.completedTiles;
            const completedPromptsRaw = (completedTiles != null && completedTiles >= 0)
                ? Math.min(Math.floor(completedTiles / 2), totalPrompts)
                : 0;
            const completedPrompts = isRetryBatch
                ? completedPromptsRaw
                : Math.max(APP.flowUi.maxCompletedPrompts, completedPromptsRaw);
            if (!isRetryBatch) APP.flowUi.maxCompletedPrompts = completedPrompts;
            if (isRetryBatch) {
                // ★ 재생성: 제출 중인 항목은 큐 끝 N개
                const retryCount = totalFromData;
                const retryStartIdx = Math.max(0, totalPrompts - retryCount);
                for (let i = 0; i < totalPrompts; i++) {
                    if (i < retryStartIdx) continue; // 기존 상태 유지
                    const j = i - retryStartIdx;
                    if (j < completedPrompts) sceneItems[i].status = 'done';
                    else sceneItems[i].status = j < submitted ? 'active' : 'ready';
                }
            } else {
                for (let i = 0; i < totalPrompts; i++) {
                    if (i < completedPrompts) sceneItems[i].status = 'done';
                    else if (sceneItems[i].status === 'done') continue;
                    else if (i >= chunkStart && i < submitted) sceneItems[i].status = 'active';
                    else sceneItems[i].status = 'ready';
                }
            }
        } else {
            // generating: totalSuccess=완료 타일 수, 프롬프트당 2타일
            const totalImages = total || totalPrompts * 2;
            const isRetryBatch = totalImages < totalPrompts * 2; // 이번 배치만(예:6) = 재생성
            const completedPromptsRaw = Math.min(Math.floor((totalSuccess || 0) / 2), totalPrompts);
            const completedPrompts = isRetryBatch
                ? completedPromptsRaw
                : Math.max(APP.flowUi.maxCompletedPrompts, completedPromptsRaw);
            if (!isRetryBatch) APP.flowUi.maxCompletedPrompts = completedPrompts;
            if (isRetryBatch) {
                // ★ 재생성: 배치가 큐 끝에 붙음. 기존 done 유지, 끝 N개만 갱신
                const retryCount = Math.floor(totalImages / 2);
                const retryStartIdx = Math.max(0, totalPrompts - retryCount);
                const retryCompleted = Math.min(completedPrompts, retryCount);
                const retryActiveIdx = retryCompleted < retryCount ? retryStartIdx + retryCompleted : -1;
                for (let i = 0; i < totalPrompts; i++) {
                    if (i < retryStartIdx) continue; // 기존 상태 유지
                    const j = i - retryStartIdx;
                    if (j < retryCompleted) sceneItems[i].status = 'done';
                    else if (i === retryActiveIdx) sceneItems[i].status = 'active';
                    else sceneItems[i].status = 'ready';
                }
            } else {
                const activeStart = Math.max(completedPrompts, chunkStart);
                for (let i = 0; i < totalPrompts; i++) {
                    if (i < completedPrompts) sceneItems[i].status = 'done';
                    else if (i >= activeStart && i < chunkEnd) sceneItems[i].status = 'active';
                    else sceneItems[i].status = 'ready';
                }
            }
        }
        showQueue();

        // ★ 프로그레스바: 실제 완료(done) / 전체 — 현재 스피너는 대기열에서만 표시
        const successCount = sceneItems.filter(q => q.status === 'done').length;
        const activeCount = sceneItems.filter(q => q.status === 'active').length;
        const readyCount = sceneItems.filter(q => q.status === 'ready').length;
        const failCount = sceneItems.filter(q => q.status === 'fail').length;
        const totalItems = sceneItems.length;
        const pct = totalItems > 0 ? Math.round((Math.min(successCount, totalItems) / totalItems) * 100) : 0;
        const firstActiveIdx = sceneItems.findIndex(q => q.status === 'active');
        const progressText = failCount > 0
            ? `${successCount} / ${totalItems} ${("(FAILED {count})").replace('{count}', failCount)}`
            : `${successCount} / ${totalItems}`;

        if ($('#progressFill')) $('#progressFill').style.width = `${pct}%`;
        if ($('#progressText')) $('#progressText').textContent = progressText;
        if (APP.factory.isVideoPhase) updateVideoProgressBar();  // 큐 기반 (단일소스)
        return;
    }

    // ★ 실행 모드와 현재 모드가 다르면 UI 업데이트 무시 (모드 전환 시 다른 모드 진행 상황 안 보이게)
    if (APP.runningMode && APP.runningMode !== APP.mode) {
        return;
    }

    // ★ 디버그: GENERATION_PROGRESS 수신 로그

    // 캐릭터 레퍼런스 생성 중 진행 업데이트 — 스피너 + 고정 텍스트만
    if (APP.isGeneratingRefs) {
        const btn = $('#btnGenerateAllRefs');

        if (status === 'completed' && promptIndex !== undefined && APP.characterRefs[promptIndex]) {
            APP.characterRefs[promptIndex].status = 'completed';
            renderCharacterRefs(APP.characterRefs);
        }
        if (btn) {
            btn.innerHTML = '<span class="spinner"></span> ' + "GENERATING CHARACTER REFERENCES";
        }
        return;
    }

    // 메인 생성이 실행 중이 아니면 씬 프롬프트 상태 업데이트 무시
    // (charRef 완료 후 뒤늦게 도착하는 progress 메시지 차단)
    if (!APP.isRunning) return;

    // 씬 프롬프트만 인덱싱 (캐릭터레퍼런스 제외)
    const sceneItems = APP.queue.filter(q => q.type !== 'characterRef');
    if (promptIndex !== null && promptIndex !== undefined && sceneItems[promptIndex]) {
        sceneItems[promptIndex].status = status === 'completed' ? 'done' : status === 'error' ? 'fail' : 'active';

        // ★ FACTORY/scriptToImage 모드: 이미지 base64 및 filename 저장 (동영상 생성용)
        if (status === 'completed' && imageBase64) {
            sceneItems[promptIndex].imageBase64 = imageBase64;
            sceneItems[promptIndex].imageFilename = imageFilename || '';
        }

        showQueue();
    }

    const completed = sceneItems.filter(q => q.status === 'done' || q.status === 'fail').length;
    const active = sceneItems.filter(q => q.status === 'active').length;
    const total = sceneItems.length;
    const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

    // ★★★ 핵심 수정: 진행 중인 항목도 카운트에 포함
    // - 3번째 진행 중 → "3 / 4" (완료 2개 + 진행 중 1개)
    // - 3번째 완료 후 → "3 / 4" (완료 3개)
    const displayCount = completed + active;

    if ($('#progressFill')) $('#progressFill').style.width = `${pct}%`;
    if ($('#progressText')) $('#progressText').textContent = `${displayCount} / ${total}`;

    // Add log item
    addLogItem(data);
}

function handlePromptStatus(data) {
    if (!APP.isRunning) return;

    // ★ 실행 모드와 현재 모드가 다르면 UI 업데이트 무시
    if (APP.runningMode && APP.runningMode !== APP.mode) {
        return;
    }

    const { index, status, error } = data;
    const sceneItems = APP.queue.filter(q => q.type !== 'characterRef');
    if (sceneItems[index]) {
        const mapped = status === 'completed' ? 'done' : status === 'error' ? 'fail' : status === 'processing' ? 'active' : status;
        sceneItems[index].status = mapped;
        showQueue();
    }
}

function handleDownloadProgress(data) {
    const sessionId = data?.sessionId || '';
    if (!sessionId) return;
    if (APP.flowUi.downloadSessionId && APP.flowUi.downloadSessionId !== sessionId) return;

    APP.flowUi.downloadSessionId = sessionId;
    if (Number.isFinite(Number(data.total))) {
        APP.flowUi.expectedDownloadCount = Math.max(0, Number(data.total));
    }
    APP.flowUi.downloadedCount = Math.max(0, Number(data.completed) || 0);
    APP.flowUi.downloadFailedCount = Math.max(0, Number(data.failed) || 0);

    const expected = APP.flowUi.expectedDownloadCount;
    if (expected > 0) {
        APP.flowUi.downloadVerified = (APP.flowUi.downloadedCount + APP.flowUi.downloadFailedCount) >= expected;
    }

    renderCompletionStats();
    if (data.isFinal && expected > 0 && (APP.flowUi.generationSuccessCount + APP.flowUi.generationFailCount) > 0) {
        if (APP.flowUi.downloadFailedCount > 0) {
            showToast(
                `${"SOME DOWNLOADS WERE INTERRUPTED"} ${APP.flowUi.downloadedCount}/${expected} · ${"FAILED"} ${APP.flowUi.downloadFailedCount}`,
                'info'
            );
        } else {
            showToast(
                `${"DOWNLOAD VERIFICATION COMPLETE"} ${APP.flowUi.downloadedCount}/${expected}`,
                'success'
            );
        }
    }
}

function handleComplete(data) {
    const { totalSuccess = 0, totalFail = 0 } = data;

    // ★ Factory 비디오 단계에서는 무시 (독립 핸들러 사용)
    if (APP.factory.isVideoPhase) {
        return;
    }

    // ★ 실행 모드와 현재 모드가 다르면 UI 업데이트 무시
    if (APP.runningMode && APP.runningMode !== APP.mode) {
        // 실행은 완료되었으므로 runningMode 초기화
        APP.runningMode = null;
        APP.isRunning = false;
        return;
    }

    // 캐릭터 레퍼런스 생성 완료 처리
    if (APP.isGeneratingRefs) {
        // charRef 완료 전에 메인 완료 섹션을 확실히 숨김
        $('#section-completion')?.classList.add('hidden');
        APP.isGeneratingRefs = false;
        APP.characterRefs.forEach(r => {
            if (r.status !== 'failed') r.status = 'completed';
        });
        renderCharacterRefs(APP.characterRefs);

        const btn = $('#btnGenerateAllRefs');
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = `🔄 ${"REGENERATE ALL CHARACTER REFERENCES"}`;
        }

        // 캐릭터 레퍼런스 완료 메시지를 charRef 섹션 내에 표시
        const completionMsg = $('#charRefCompletionMsg');
        if (completionMsg) {
            completionMsg.querySelector('.charref-completion-text').textContent =
                `${"CHARACTER REFERENCE IMAGES GENERATED!"} (${totalSuccess}/${totalSuccess + totalFail})`;
            completionMsg.classList.remove('hidden');
        }
        updateFactoryPhaseStatus('char_ref_done', APP.characterRefs?.length ?? 0);

        // 씬 프롬프트 상태가 오염되었을 수 있으므로 강제 초기화
        APP.queue.filter(q => q.type !== 'characterRef').forEach(q => {
            if (q.status !== 'ready') q.status = 'ready';
        });
        showQueue();

        return;
    }

    // 메인 생성이 실행 중이 아닌데 COMPLETE가 도착한 경우 무시
    if (!APP.isRunning) return;

    // ★ 일시정지 상태 저장 (한도 초과로 일시정지된 경우 유지)
    const wasPaused = APP.isPaused;

    APP.isRunning = false;
    APP.runningMode = null;  // ★ 실행 모드 초기화

    // ★ 일시정지 상태가 아닐 때만 초기화 (한도 초과로 일시정지된 경우 유지)
    if (!wasPaused) {
        APP.isPaused = false;
        chrome.storage.local.remove(['isPaused', 'pausedMode']);
    }

    clearGeneratingSpinners('completed');

    // Show completion (완료 메시지) — controlButtons(일시정지+새프로젝트)는 항상 유지
    $('#section-completion')?.classList.remove('hidden');
    updateFactoryPhaseStatus('image_done');
    // ★ 그록팩토리 동일: 완료 후에도 일시정지+새프로젝트 버튼 계속 표시
    $('#controlButtons')?.classList.remove('hidden');
    const pauseBtn = $('#btn-pause');
    if (pauseBtn) {
        pauseBtn.disabled = true;
        pauseBtn.title = "GENERATION COMPLETE";
    }

    const isVideo = APP.mode === 'textToVideo' || APP.mode === 'imageToVideo';

    const sceneItems = APP.queue.filter(q => q.type !== 'characterRef');
    const totalItems = sceneItems.length;

    // ★ 타일 순서 기준: 실패/성공/미시도 구분 (비디오는 1프롬프트=1타일, 이미지는 1프롬프트=2타일)
    // ★ v1.1.0: 'done' 항목은 절대 덮어쓰지 않음 (Content script 재접속/재메시지로 인한 롤백 방지)
    //   비디오 phase(L5785)에 이미 적용된 보호를 이미지 phase에도 적용
    const failedPromptIndices = data.failedPromptIndices;
    const processedCount = totalSuccess + totalFail;  // 실제 시도한 항목 수
    const useFailedIndices = Array.isArray(failedPromptIndices) &&
        !(totalSuccess > 0 && failedPromptIndices.length >= totalItems);
    if (useFailedIndices) {
        for (let i = 0; i < totalItems; i++) {
            if (sceneItems[i].status === 'done') continue;  // 이미 성공한 건 유지
            if (failedPromptIndices.includes(i)) sceneItems[i].status = 'fail';
            else if (i < processedCount) sceneItems[i].status = 'done';
            else sceneItems[i].status = 'ready';  // 미시도
        }
    } else {
        const successfulPrompts = isVideo ? totalSuccess : Math.floor(totalSuccess / 2);
        const promptOffset = Math.max(0, totalItems - successfulPrompts);
        for (let i = 0; i < totalItems; i++) {
            if (sceneItems[i].status === 'done') continue;  // 이미 성공한 건 유지
            sceneItems[i].status = (i >= promptOffset && i < promptOffset + successfulPrompts) ? 'done' : 'fail';
        }
    }
    showQueue();

    const pendingCount = sceneItems.filter(q => q.status === 'ready' || q.status === 'pending' || q.status === 'active').length;
    // ★ 재생성 후: data는 이번 배치만 포함. 실제 통계는 큐 상태(done/fail) 기준
    const actualSuccessCount = sceneItems.filter(q => q.status === 'done').length;
    const actualFailCount = sceneItems.filter(q => q.status === 'fail').length;

    // Completion icon & title
    const iconEl = $('#section-completion .completion-icon');
    const titleEl = $('#section-completion .completion-title');
    if (iconEl && titleEl) {
        const isPartialComplete = actualFailCount > 0 || processedCount < totalItems;

        if (actualFailCount === 0 && processedCount >= totalItems) {
            iconEl.textContent = '✅';
            titleEl.textContent = isVideo
                ? "ALL VIDEOS GENERATED!"
                : "ALL IMAGES GENERATED!";
        } else if (actualSuccessCount === 0) {
            iconEl.textContent = '❌';
            titleEl.textContent = "GENERATION FAILED";
        } else {
            iconEl.textContent = '⚠️';
            titleEl.textContent = "PARTIALLY COMPLETED";
        }
    }

    // ★ Factory 모드에서는 재생성 버튼 표시 안 함 (Factory 전용 UI 사용)
    if (APP.mode !== 'factory') {
        const startBtn = $('#btn-start-generation');
        if (startBtn) {
            startBtn.classList.remove('hidden');
            startBtn.disabled = false;
            startBtn.style.opacity = '1';
            setStartButtonContent(startBtn, isVideo);
        }
    }

    APP.flowUi.generationSuccessCount = actualSuccessCount;
    APP.flowUi.generationFailCount = actualFailCount;
    const nextDownloadSessionId = data.downloadSessionId || '';
    const sameDownloadSession = !!nextDownloadSessionId && APP.flowUi.downloadSessionId === nextDownloadSessionId;
    APP.flowUi.downloadSessionId = nextDownloadSessionId;
    APP.flowUi.expectedDownloadCount = Math.max(0, Number(data.expectedDownloadCount) || 0);
    if (!sameDownloadSession) {
        APP.flowUi.downloadedCount = 0;
        APP.flowUi.downloadFailedCount = 0;
    }
    APP.flowUi.downloadVerified = APP.flowUi.expectedDownloadCount > 0
        ? (APP.flowUi.downloadedCount + APP.flowUi.downloadFailedCount) >= APP.flowUi.expectedDownloadCount
        : true;
    renderCompletionStats();
    // ★ 프로그레스바: totalSuccess/totalFail 최종값으로 덮어쓰기 (대기열·완성과 일치)
    // 이미지: totalSuccess=타일수 → 프롬프트수=floor(totalSuccess/2). 비디오: 1:1
    const finalSuccess = Number.isFinite(totalSuccess)
        ? (isVideo ? totalSuccess : Math.floor(totalSuccess / 2))
        : actualSuccessCount;
    const finalFail = Number.isFinite(totalFail)
        ? (isVideo ? totalFail : (failedPromptIndices?.length ?? Math.floor(totalFail / 2)))
        : actualFailCount;
    const pctComplete = totalItems > 0 ? Math.round((finalSuccess / totalItems) * 100) : 0;
    if ($('#progressFill')) $('#progressFill').style.width = `${pctComplete}%`;
    if ($('#progressText')) {
        $('#progressText').textContent = finalFail > 0
            ? `${finalSuccess} / ${totalItems} ${("(FAILED {count})").replace('{count}', finalFail)}`
            : `${finalSuccess} / ${totalItems}`;
    }

    const retryBtn = $('#btn-retry-failed');
    if (retryBtn) {
        if (actualFailCount > 0) {
            retryBtn.classList.remove('hidden');
            retryBtn.disabled = false;
            retryBtn.querySelector('span').textContent = isVideo
                ? "REGENERATE FAILED VIDEOS"
                : "REGENERATE FAILED IMAGES";
        } else {
            retryBtn.classList.add('hidden');
        }
    }

    // ★ 일시정지 상태면 재개 버튼 표시 (한도 초과로 중단된 경우)
    const completionResumeBtn = $('#btn-completion-resume');
    if (completionResumeBtn) {
        if (wasPaused && pendingCount > 0) {
            completionResumeBtn.classList.remove('hidden');
        } else {
            completionResumeBtn.classList.add('hidden');
        }
    }

    // ★ btn-new-project-mid는 controlButtons 내부에 있어 항상 표시

    // ★ 완료 섹션으로 스크롤 (FACTORY 모드는 동영상 섹션으로 별도 처리)
    if (APP.mode !== 'factory') {
        setTimeout(() => {
            $('#section-completion')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 300);
    }

    if (APP.flowUi.expectedDownloadCount > 0) {
        if (APP.flowUi.downloadVerified) {
            const verifiedText = APP.flowUi.downloadFailedCount > 0
                ? `${"SOME DOWNLOADS WERE INTERRUPTED"} ${APP.flowUi.downloadedCount}/${APP.flowUi.expectedDownloadCount} · ${"FAILED"} ${APP.flowUi.downloadFailedCount}`
                : `${"DOWNLOAD VERIFICATION COMPLETE"} ${APP.flowUi.downloadedCount}/${APP.flowUi.expectedDownloadCount}`;
            showToast(`${"DONE!"} ${actualSuccessCount}/${actualSuccessCount + actualFailCount} · ${verifiedText}`);
        } else {
            showToast(`${"DONE!"} ${actualSuccessCount}/${actualSuccessCount + actualFailCount} · ${"DOWNLOAD VERIFICATION IN PROGRESS"} ${APP.flowUi.downloadedCount}/${APP.flowUi.expectedDownloadCount}`);
        }
    } else {
        showToast(`${"DONE!"} ${actualSuccessCount}/${actualSuccessCount + actualFailCount}`);
    }

    // FACTORY 모드: 이미지 생성 완료 후 반드시 동영상 단계로 진행
    // ★ 정책: "부분 생성이라도 팩토리 모드는 다음 단계(영상 프롬프트·영상 생성)로 반드시 이어진다"
    //   유저 요구 반영 — 실패한 1~2개가 있어도 성공한 이미지만으로 영상 파이프라인 진행
    //   이전 로직: allProcessed=true 일 때만 진행 → 일부 실패 시 스턱
    //   신규 로직: pending (ready/pending/active) 0개면 = 진행 여지 없음 = 다음 단계로
    //   (processedCount 타이밍 버그 + 부분 성공 케이스 모두 한 번에 해결)
    const queueProcessedCount = actualSuccessCount + actualFailCount;
    const pipelineFinished = pendingCount === 0                           // 대기 항목 0
                          || Math.max(processedCount, queueProcessedCount) >= totalItems;  // 또는 카운터 조건

    if (APP.mode === 'factory' && actualSuccessCount > 0 && pipelineFinished) {
        // ★ 부분 생성 포함 — actualSuccessCount > 0 이면 성공한 이미지 기반으로 영상 단계 진입
        //   (예: 66개 중 63개 성공 + 3개 실패 → 63개 기반 영상 프롬프트 생성)
        console.log('[FACTORY] image → video stage advance', {
            totalItems, processedCount, queueProcessedCount,
            actualSuccessCount, actualFailCount, pendingCount,
            reason: pendingCount === 0 ? 'pendingCount=0' : 'processed>=total'
        });
        onFactoryImageGenerationComplete();
    } else if (APP.mode === 'factory' && actualSuccessCount === 0) {
        console.log('[FACTORY] ⚠️ all images failed — not advancing to video stage', {
            totalItems, actualFailCount
        });
    }
}

function addLogItem(data) {
    const log = $('#progressLog');
    if (!log) return;

    const { promptIndex, status, displayNum, percentage } = data;

    if (percentage !== undefined && displayNum === undefined && promptIndex === null) {
        return;
    }

    const rawIdx = displayNum || String((promptIndex ?? 0) + 1);
    const idx = String(parseInt(rawIdx, 10) || rawIdx);
    const statusIcons = {
        completed: '✅',
        error: '❌',
        generating: '<span class="spinner spinner-dark"></span>',
        video_complete: '🎬'
    };

    // ★ 이미지/동영상 생성 구분 (모드에 따라)
    const isVideoMode = APP.mode === 'textToVideo' || APP.mode === 'imageToVideo' ||
        (APP.mode === 'factory' && APP.factory.isVideoPhase);
    const generatingText = isVideoMode
        ? "generating video"
        : "generating image";

    if (status === 'completed' || status === 'error' || status === 'video_complete') {
        // ★ 이미 같은 idx의 completed/error 로그가 있으면 중복 추가 방지
        const existingCompleted = log.querySelectorAll(`[data-log-status="completed"], [data-log-status="error"], [data-log-status="video_complete"]`);
        const alreadyDone = Array.from(existingCompleted).some(el =>
            String(parseInt(el.dataset.logIdx, 10) || el.dataset.logIdx) === idx
        );
        if (alreadyDone) {
            return; // 이미 완료 로그 있음, 중복 추가 방지
        }

        // generating 상태인 로그를 찾아서 업데이트
        const existingAll = log.querySelectorAll(`[data-log-status="generating"]`);
        const matched = Array.from(existingAll).filter(el =>
            String(parseInt(el.dataset.logIdx, 10) || el.dataset.logIdx) === idx
        );
        if (matched.length > 0) {
            matched[0].className = `log-item ${status === 'completed' || status === 'video_complete' ? 'success' : 'error'}`;
            matched[0].innerHTML = `${statusIcons[status] || '•'} #${idx} — ${status}`;
            matched[0].dataset.logIdx = idx;
            matched[0].dataset.logStatus = status;
            for (let i = 1; i < matched.length; i++) {
                matched[i].remove();
            }
            return;
        }
    }

    if (status === 'generating') {
        const existingAll = log.querySelectorAll(`[data-log-status="generating"]`);
        const matched = Array.from(existingAll).filter(el =>
            String(parseInt(el.dataset.logIdx, 10) || el.dataset.logIdx) === idx
        );
        matched.forEach(el => el.remove());
    }

    const div = document.createElement('div');
    div.className = `log-item ${status === 'completed' || status === 'video_complete' ? 'success' : status === 'error' ? 'error' : 'active'}`;
    // ★ generating 상태일 때 이미지/동영상 구분 표시
    const displayStatus = status === 'generating' ? generatingText : status;
    div.innerHTML = `${statusIcons[status] || '•'} #${idx} — ${displayStatus}`;
    div.dataset.logIdx = idx;
    div.dataset.logStatus = status;
    log.prepend(div);
}

// ========== CUSTOM STYLE STORAGE (Whisk와 동일) ==========
async function loadCustomStyles() {
    return new Promise((resolve) => {
        chrome.storage.local.get('customStyles', (result) => {
            resolve(result.customStyles || []);
        });
    });
}

async function saveCustomStyles(styles) {
    return new Promise((resolve) => {
        chrome.storage.local.set({ customStyles: styles }, resolve);
    });
}

async function addCustomStyle(style) {
    const styles = await loadCustomStyles();
    if (styles.length >= CUSTOM_STYLE_LIMITS.maxCount) throw new Error('maxCount');
    styles.push(style);
    await saveCustomStyles(styles);
    return styles;
}

function validateImageFile(file) {
    const validTypes = ['image/jpeg', 'image/jpg', 'image/png'];
    if (!validTypes.includes(file.type)) return { valid: false, error: 'invalidFormat' };
    if (file.size > CUSTOM_STYLE_LIMITS.maxUploadSize) return { valid: false, error: 'imageTooLarge' };
    return { valid: true };
}

function processImageForStyle(file, maxSize = CUSTOM_STYLE_LIMITS.maxImageSize) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                let w = img.width, h = img.height;
                if (w > h) { if (w > maxSize) { h = (h * maxSize) / w; w = maxSize; } }
                else { if (h > maxSize) { w = (w * maxSize) / h; h = maxSize; } }
                canvas.width = w; canvas.height = h;
                ctx.drawImage(img, 0, 0, w, h);
                resolve(canvas.toDataURL('image/jpeg', CUSTOM_STYLE_LIMITS.imageQuality));
            };
            img.onerror = reject;
            img.src = e.target.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

function initStyleGallery() {
    function applyStyleSelection(val) {
        const next = normalizeSelectedStyle(val);
        APP.settings.selectedStyle = next;
        $('#customStyleGallery')?.querySelectorAll('.custom-style-item').forEach(item => {
            item.classList.toggle('selected', item.dataset.customId === next);
            item.setAttribute('aria-pressed', item.dataset.customId === next ? 'true' : 'false');
        });
        if (isCustomStyleId(next)) {
            const style = APP.customStyles.find(s => s.id === next);
            if (style) APP.styleImage = { base64: style.imageData, name: style.name };
        } else {
            APP.styleImage = null;
        }
        const styleSelect = $('#styleSelect');
        const controlSelect = $('#controlStyleSelect');
        if (styleSelect && Array.from(styleSelect.options).some(o => o.value === next)) styleSelect.value = next;
        if (controlSelect && Array.from(controlSelect.options).some(o => o.value === next)) controlSelect.value = next;
        updateControlStyleDisplay();

        if (isCustomStyleId(next)) {
            const customItem = $('#customStyleGallery')?.querySelector(`.custom-style-item[data-custom-id="${next}"]`);
            if (customItem) customItem.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
        }
    }

    $('#styleSelect')?.addEventListener('change', (e) => {
        applyStyleSelection(e.target.value);
    });

    // 커스텀 스타일: + 스타일 추가 → 모달 열기 (Whisk와 동일)
    $('#addStyleBtn')?.addEventListener('click', openCustomStyleModal);

    $('#btnCloseCustomModal')?.addEventListener('click', closeCustomStyleModal);
    $('#btnCancelCustom')?.addEventListener('click', closeCustomStyleModal);

    $('#uploadPlusBtn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        $('#customImageInput')?.click();
    });
    $('#customImageInput')?.addEventListener('change', handleCustomImageSelect);

    const uploadArea = $('#imageUploadArea');
    if (uploadArea) {
        uploadArea.addEventListener('paste', handlePasteImage);
        uploadArea.addEventListener('focus', () => uploadArea.classList.add('focused'));
        uploadArea.addEventListener('blur', () => uploadArea.classList.remove('focused'));
        // 드래그앤드롭 지원
        uploadArea.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); uploadArea.classList.add('drag-over'); });
        uploadArea.addEventListener('dragenter', (e) => { e.preventDefault(); e.stopPropagation(); uploadArea.classList.add('drag-over'); });
        uploadArea.addEventListener('dragleave', (e) => { e.preventDefault(); if (!uploadArea.contains(e.relatedTarget)) uploadArea.classList.remove('drag-over'); });
        uploadArea.addEventListener('drop', handleDropImage);
    }
    document.addEventListener('paste', handlePasteImage);

    $('#btnSaveCustom')?.addEventListener('click', saveCustomStyleFromModal);

    // 초기 로드: storage에서 커스텀 스타일 불러와 갤러리·드롭다운 동기화
    loadCustomStyles().then((styles) => {
        APP.customStyles = styles;
        renderCustomStyleGallery();
        updateStyleSelectOptions(styles);
        updateCustomStyleCount(styles.length);
        if (APP.settings.selectedStyle && styles.some(s => s.id === APP.settings.selectedStyle)) {
            const sel = $('#styleSelect');
            if (sel) sel.value = APP.settings.selectedStyle;
        }
    });
}

/** 설정·제어 양쪽 스타일 드롭다운 동기화 (커스텀 옵션 추가 + 선택값 맞춤) */
function updateStyleSelectOptions(customStyles) {
    const targets = [$('#styleSelect'), $('#controlStyleSelect')].filter(Boolean);
    targets.forEach(select => {
        Array.from(select.options).forEach(opt => {
            if (opt.value.startsWith('custom_') || opt.value === 'custom-separator') opt.remove();
        });
        if (customStyles.length > 0) {
            const sep = document.createElement('option');
            sep.value = 'custom-separator';
            sep.textContent = "─── My Custom ───";
            sep.disabled = true;
            select.appendChild(sep);
            customStyles.forEach(s => {
                const opt = document.createElement('option');
                opt.value = s.id;
                opt.textContent = s.name;
                select.appendChild(opt);
            });
        }
        const val = normalizeSelectedStyle(APP.settings.selectedStyle);
        if (val && Array.from(select.options).some(o => o.value === val)) select.value = val;
    });
}

function updateCustomStyleCount(count) {
    const el = $('#customStyleCount');
    if (el) el.textContent = `(${count}/${CUSTOM_STYLE_LIMITS.maxCount})`;
    const addBtn = $('#addStyleBtn');
    if (addBtn) addBtn.disabled = count >= CUSTOM_STYLE_LIMITS.maxCount;
}

function openCustomStyleModal() {
    APP.editingCustomStyleId = null;
    resetCustomStyleForm();
    $('#customModalTitle').textContent = "Add Custom Style";
    $('#customStyleModal')?.classList.remove('hidden');
    setTimeout(() => $('#imageUploadArea')?.focus(), 100);
}

/** Whisk와 동일: 기존 커스텀 스타일 수정용 모달 열기 */
async function openEditCustomStyleModal(id) {
    const styles = await loadCustomStyles();
    const style = styles.find(s => s.id === id);
    if (!style) return;

    APP.editingCustomStyleId = id;
    APP.pendingCustomImage = style.imageData;

    const titleEl = $('#customModalTitle');
    if (titleEl) titleEl.textContent = "Edit Custom Style";

    $('#customStyleName').value = style.name;
    $('#customStylePrompt').value = style.prompt;

    const preview = $('#customImagePreview');
    if (preview) {
        preview.src = style.imageData;
        preview.classList.remove('hidden');
    }
    $('#uploadPlaceholder')?.classList.add('hidden');
    $('#imageUploadArea')?.classList.add('has-image');

    $('#customStyleModal')?.classList.remove('hidden');
    setTimeout(() => $('#imageUploadArea')?.focus(), 100);
}

function closeCustomStyleModal() {
    $('#customStyleModal')?.classList.add('hidden');
    APP.editingCustomStyleId = null;
    APP.pendingCustomImage = null;
}

function resetCustomStyleForm() {
    const preview = $('#customImagePreview');
    if (preview) { preview.src = ''; preview.classList.add('hidden'); }
    $('#uploadPlaceholder')?.classList.remove('hidden');
    $('#imageUploadArea')?.classList.remove('has-image');
    $('#customStyleName').value = '';
    $('#customStylePrompt').value = '';
    $('#customImageInput').value = '';
    APP.pendingCustomImage = null;
}

async function handleDropImage(e) {
    e.preventDefault();
    e.stopPropagation();
    $('#imageUploadArea')?.classList.remove('drag-over');
    if (!$('#customStyleModal') || $('#customStyleModal').classList.contains('hidden')) return;
    const files = e.dataTransfer?.files;
    if (!files?.length) return;
    for (const f of files) {
        if (f.type.startsWith('image/')) {
            await processAndPreviewImage(f);
            break;
        }
    }
}

async function handlePasteImage(e) {
    if (!$('#customStyleModal') || $('#customStyleModal').classList.contains('hidden')) return;
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
        if (item.type.startsWith('image/')) {
            e.preventDefault();
            const file = item.getAsFile();
            if (file) await processAndPreviewImage(file);
            break;
        }
    }
}

async function handleCustomImageSelect(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    await processAndPreviewImage(file);
    e.target.value = '';
}

async function processAndPreviewImage(file) {
    const validation = validateImageFile(file);
    if (!validation.valid) {
        showToast(getCustomStyleError(validation.error), 'error');
        return;
    }
    try {
        APP.pendingCustomImage = await processImageForStyle(file, CUSTOM_STYLE_LIMITS.maxImageSize);
        const preview = $('#customImagePreview');
        if (preview) { preview.src = APP.pendingCustomImage; preview.classList.remove('hidden'); }
        $('#uploadPlaceholder')?.classList.add('hidden');
        $('#imageUploadArea')?.classList.add('has-image');
        showToast("Image added", 'success');
    } catch (err) {
        showToast(getCustomStyleError('imageError'), 'error');
    }
}

async function saveCustomStyleFromModal() {
    const name = $('#customStyleName')?.value?.trim();
    const prompt = $('#customStylePrompt')?.value?.trim();
    const imageData = APP.pendingCustomImage;
    const editingId = APP.editingCustomStyleId;

    if (!imageData) { showToast(getCustomStyleError('noImage'), 'error'); return; }
    if (!name) { showToast(getCustomStyleError('noName'), 'error'); return; }
    if (!prompt) { showToast(getCustomStyleError('noPrompt'), 'error'); return; }

    try {
        let styles;
        if (editingId) {
            styles = await loadCustomStyles();
            const idx = styles.findIndex(s => s.id === editingId);
            if (idx !== -1) {
                styles[idx] = { ...styles[idx], name, prompt, imageData };
                await saveCustomStyles(styles);
            }
            showToast("Style updated", 'success');
        } else {
            const newStyle = {
                id: `custom_${Date.now()}`,
                name,
                prompt,
                imageData,
                createdAt: Date.now()
            };
            styles = await addCustomStyle(newStyle);
            showToast("Style saved", 'success');
        }
        APP.customStyles = styles;
        renderCustomStyleGallery();
        updateStyleSelectOptions(styles);
        updateCustomStyleCount(styles.length);
        closeCustomStyleModal();
    } catch (err) {
        if (err.message === 'maxCount') showToast(getCustomStyleError('maxCount'), 'error');
        else showToast(getCustomStyleError('saveError'), 'error');
    }
}

function renderCustomStyleGallery() {
    const gallery = $('#customStyleGallery');
    const countBadge = $('#customStyleCount');
    if (!gallery) return;

    if (countBadge) countBadge.textContent = `(${APP.customStyles.length}/6)`;
    const addBtn = $('#addStyleBtn');
    if (addBtn) addBtn.disabled = APP.customStyles.length >= 6;

    if (APP.customStyles.length === 0) {
        gallery.innerHTML = '';
        return;
    }

    gallery.innerHTML = APP.customStyles.map((style) => `
    <div class="custom-style-item ${APP.settings.selectedStyle === style.id ? 'selected' : ''}" data-custom-id="${style.id}" role="button" tabindex="0" aria-pressed="${APP.settings.selectedStyle === style.id ? 'true' : 'false'}" aria-label="Select custom style ${style.name}">
      <img src="${style.imageData}" alt="${style.name}">
      <span class="style-name">${style.name}</span>
      <div class="style-actions">
        <button type="button" class="edit-btn" data-edit-id="${style.id}">Edit</button>
        <button type="button" class="delete-btn" data-delete-id="${style.id}">Del</button>
      </div>
    </div>
  `).join('');

    gallery.querySelectorAll('.custom-style-item').forEach(item => {
        const selectCustomStyle = (e) => {
            if (e.target.closest('.style-actions')) return;
            gallery.querySelectorAll('.custom-style-item').forEach(i => {
                i.classList.remove('selected');
                i.setAttribute('aria-pressed', 'false');
            });
            item.classList.add('selected');
            item.setAttribute('aria-pressed', 'true');
            const id = item.dataset.customId;
            APP.settings.selectedStyle = id;
            const style = APP.customStyles.find(s => s.id === id);
            if (style) APP.styleImage = { base64: style.imageData, name: style.name };
            const styleSelect = $('#styleSelect');
            const controlSelect = $('#controlStyleSelect');
            if (styleSelect) styleSelect.value = id;
            if (controlSelect && Array.from(controlSelect.options).some(o => o.value === id)) controlSelect.value = id;
            updateControlStyleDisplay();
            showToast("Style selected", 'success');
        };
        item.addEventListener('click', selectCustomStyle);
        activateOnKeyboard(item, selectCustomStyle);
    });

    gallery.querySelectorAll('.edit-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            openEditCustomStyleModal(btn.dataset.editId);
        });
    });

    gallery.querySelectorAll('.delete-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const id = btn.dataset.deleteId;
            const msg = "Delete this style?";
            if (!confirm(msg)) return;
            const styles = await loadCustomStyles();
            const filtered = styles.filter(s => s.id !== id);
            await saveCustomStyles(filtered);
            APP.customStyles = filtered;
            renderCustomStyleGallery();
            updateStyleSelectOptions(filtered);
            updateCustomStyleCount(filtered.length);
            if (APP.settings.selectedStyle === id) {
                APP.settings.selectedStyle = '';
                APP.styleImage = null;
                const select = $('#styleSelect');
                if (select) select.value = '';
                const controlSelect = $('#controlStyleSelect');
                if (controlSelect) controlSelect.value = '';
                updateControlStyleDisplay();
            }
            showToast("Style deleted", 'success');
        });
    });
}

// ========== SESSION PERSISTENCE (대본/프롬프트/캐릭터 복원) ==========
/** 대본 입력란 내용을 저장(SAVE 버튼 또는 프롬프트 생성 시 자동 저장). 입력할 때마다 자동 저장은 하지 않음. */
function saveScriptDraft() {
    const scriptInput = $('#scriptInput');
    if (!scriptInput) return Promise.resolve();
    return new Promise(resolve => {
        chrome.storage.local.set({ savedScript: scriptInput.value || '' }, resolve);
    });
}

/** 프롬프트 입력란 내용을 저장(SAVE 버튼 또는 이미지/동영상 생성 시작 시 자동 저장). */
function savePromptInputDraft() {
    const promptInput = $('#promptInput');
    if (!promptInput) return Promise.resolve();
    return new Promise(resolve => {
        chrome.storage.local.set({ savedPromptInput: promptInput.value || '' }, resolve);
    });
}

/** 저장된 프롬프트 입력이 있으면 복원, 없으면 목업 기본값 표시. loadSession() 이후에 호출.
 *  scriptInput 의 loadScriptDraftOrMock 과 동일 패턴 — textarea 에 실제 텍스트 주입하여
 *  placeholder 가 아닌 편집 가능 상태로 바로 시작. */
async function loadPromptInputDraft() {
    const promptInput = $('#promptInput');
    if (!promptInput) return;
    if (promptInput.value.trim() === '') {
        await new Promise(resolve => {
            chrome.storage.local.get('savedPromptInput', (result) => {
                if (result.savedPromptInput != null) {
                    promptInput.value = result.savedPromptInput || '';
                } else {
                    promptInput.value = MOCK_PROMPT_EN;
                }
                resolve();
            });
        });
    }
    updatePromptSplitterPosition();
    renderPromptMentionHighlights();
    updateStartButtonState();
    previewPromptQueue({ silent: true });
}

/** Restores the saved script if present, otherwise shows the mock script. Called after loadSession(). */
async function loadScriptDraftOrMock() {
    const scriptInput = $('#scriptInput');
    if (!scriptInput) return;
    if (scriptInput.value.trim() !== '') return; // already filled by session restore, don't touch
    return new Promise(resolve => {
        chrome.storage.local.get('savedScript', (result) => {
            if (result.savedScript && result.savedScript.trim() !== '') {
                scriptInput.value = result.savedScript;
            } else {
                scriptInput.value = MOCK_SCRIPT_EN;
            }
            resolve();
        });
    });
}

async function saveSession() {
    const session = {
        script: $('#scriptInput')?.value || '',
        promptInput: $('#promptInput')?.value || '',
        prompts: APP.prompts || [],
        characterRefs: APP.characterRefs || [],
        queue: (APP.queue || []).map(q => ({
            text: q.text,
            rawText: q.rawText,
            status: 'ready',
            type: q.type,
            code: q.code,
            name: q.name,
            number: q.number,
            characters: q.characters,
            scriptText: q.scriptText,
            filename: q.filename,
            originalFileIndex: q.originalFileIndex,
            assetIndices: Array.isArray(q.assetIndices) ? q.assetIndices.slice() : (q.originalFileIndex != null ? [q.originalFileIndex] : []),
            useReference: !!q.useReference,
            useAsset: q.useAsset !== false && ((q.assetIndices && q.assetIndices.length) || q.originalFileIndex != null)
        })),
        mode: APP.mode,
        assetNames: APP.assetNames || {},
        projectName: $('#controlProjectName')?.value || ''
    };
    return new Promise(resolve => {
        chrome.storage.local.set({ grokSession: session }, resolve);
    });
}

async function loadSession() {
    return new Promise(resolve => {
        chrome.storage.local.get('grokSession', (result) => {
            const session = result.grokSession;
            if (!session) { resolve(false); return; }

            if (session.mode) {
                APP.mode = normalizeVisibleMode(session.mode);
                APP.settings.lastMode = APP.mode;
                $$('.mode-card').forEach(c => {
                    c.classList.toggle('active', c.dataset.mode === APP.mode);
                });
                updateModeUI();
            }

            if (session.script) {
                const scriptInput = $('#scriptInput');
                if (scriptInput) scriptInput.value = session.script;
            }

            if (session.promptInput) {
                const promptInput = $('#promptInput');
                if (promptInput) {
                    promptInput.value = session.promptInput;
                    updatePromptSplitterPosition();
                    renderPromptMentionHighlights();
                    updateStartButtonState();
                }
            }

            if (session.assetNames && typeof session.assetNames === 'object') {
                APP.assetNames = session.assetNames;
            }

            if (session.projectName) {
                const projInput = $('#controlProjectName');
                if (projInput) projInput.value = session.projectName;
            }

            if (session.characterRefs && session.characterRefs.length > 0) {
                APP.characterRefs = session.characterRefs;
                renderCharacterRefs(APP.characterRefs);
            }

            if (session.prompts && session.prompts.length > 0) {
                APP.prompts = session.prompts;
                showGeneratedPrompts(APP.prompts, !!APP.resumeState);
            }

            if (session.queue && session.queue.length > 0) {
                APP.queue = session.queue;
                showQueue();
                updateStartButtonState();

                if (session.mode === 'imageToVideo' && APP.imageFiles.length === 0) {
                    const needsAsset = (APP.queue || []).some(q =>
                        q?.type !== 'characterRef' && getI2vAssetIndices(q).length > 0
                    );
                    if (needsAsset) {
                        showToast("Please re-upload images. Solution: Select the folder or image files again.", 'error');
                        const btn = $('#btn-start-generation');
                        if (btn) { btn.disabled = true; btn.style.opacity = '0.5'; }
                    }
                }
            }

            resolve(true);
        });
    });
}

// ========== SETTINGS PERSISTENCE (chrome.storage) ==========
function clampPromptDelay(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return 4;
    return Math.min(8, Math.max(4, Math.round(num)));
}

async function saveSettings() {
    return new Promise((resolve) => {
        APP.settings.promptDelay = clampPromptDelay(APP.settings.promptDelay);
        APP.settings.promptSeparator = normalizePromptSeparator(APP.settings.promptSeparator || '###');
        APP.settings.downloadFolder = safeDownloadFolder(APP.settings.downloadFolder);
        delete APP.settings.autoDownloadImagePrompts;
        delete APP.settings.autoDownloadVideoPrompts;
        chrome.storage.local.set({ grokSettings: APP.settings }, resolve);
    });
}

async function loadSettings() {
    const defaults = {
        aiProvider: 'gemini', // 'gemini' | 'openai'
        geminiApiKey: '',
        geminiApiKeyPaid: '',
        geminiModel: 'gemini-3-flash-preview',
        openaiBaseUrl: 'https://api.deepseek.com/v1',
        openaiApiKey: '',
        openaiModel: 'deepseek-chat',
        openaiPreset: 'deepseek',
        nationality: 'korean',
        downloadFolder: 'AI4Next',
        projectName: '',
        imageGenPrefix: '',
        aspectRatio: '16:9',
        flowImageModel: 'Nano Banana 2 Lite',
        flowVideoModel: 'Veo 3.1 Lite',
        videoResolution: '1K',
        videoDuration: '6s',
        videoPreset: 'normal',
        promptDelay: 4,
        promptSeparator: '###',
        defaultVideoPrompt: 'Dynamic action, Active camera angle',
        selectedStyle: '',
        attachStyleInTextToImage: false,
        theme: 'light',
        language: 'zh',
        lastMode: 'textToImage',
        outputCount: 1  // 기본 1장 (봇 탐지 위험 최소화) — x2~x4는 사용자가 명시 선택 시에만
    };

    return new Promise((resolve) => {
        chrome.storage.local.get(['grokSettings', 'apiKey', 'apiKeyPaid', 'openaiApiKey'], (result) => {
            APP.settings = { ...defaults, ...(result.grokSettings || {}) };
            delete APP.settings.autoDownloadImagePrompts;
            delete APP.settings.autoDownloadVideoPrompts;
            APP.settings.promptDelay = clampPromptDelay(APP.settings.promptDelay);
            APP.settings.promptSeparator = normalizePromptSeparator(APP.settings.promptSeparator || APP.promptSplitterSeparator || '###');
            APP.settings.downloadFolder = safeDownloadFolder(APP.settings.downloadFolder);
            APP.settings.selectedStyle = normalizeSelectedStyle(APP.settings.selectedStyle);
            if (!result.grokSettings?.downloadFolder || ['flow4next', 'FlowFactory'].includes(APP.settings.downloadFolder)) {
                APP.settings.downloadFolder = 'AI4Next';
            }
            // ★ v1.1.2: 이전 기본값 마이그레이션 — storage에 저장된 구 프리픽스 제거
            if (APP.settings.imageGenPrefix === 'Generate an image: ') {
                APP.settings.imageGenPrefix = '';
            }
            if (APP.settings.flowVideoModel === 'Omni Flash') {
                APP.settings.flowVideoModel = 'Omni 1.1 Flash';
            }
            if (result.apiKey != null && result.apiKey !== '') {
                APP.settings.geminiApiKey = result.apiKey;
            }
            if (result.apiKeyPaid != null && result.apiKeyPaid !== '') {
                APP.settings.geminiApiKeyPaid = result.apiKeyPaid;
            }
            if (result.openaiApiKey != null && result.openaiApiKey !== '') {
                APP.settings.openaiApiKey = result.openaiApiKey;
            }
            // ★ AI Engine 동기화
            if (typeof setActiveAiProvider === 'function') {
                setActiveAiProvider(APP.settings.aiProvider || 'gemini');
            }
            if (typeof setActiveGeminiModel === 'function') {
                setActiveGeminiModel(APP.settings.geminiModel);
            }
            if (typeof setActiveOpenaiConfig === 'function') {
                setActiveOpenaiConfig({
                    baseUrl: APP.settings.openaiBaseUrl,
                    apiKey: APP.settings.openaiApiKey,
                    model: APP.settings.openaiModel,
                    preset: APP.settings.openaiPreset
                });
            }
            const savedMode = APP.settings.lastMode || 'textToImage';
            APP.mode = normalizeVisibleMode(savedMode);
            APP.settings.lastMode = APP.mode;
            APP.lang = 'zh';
            APP.settings.language = 'zh';
            applySettingsToUI();
            resolve();
        });
    });
}

async function resetSettings() {
    return new Promise((resolve) => {
        chrome.storage.local.remove('grokSettings', resolve);
    });
}

// Windows 예약 이름(nul, con, prn 등) 방지 — 다운로드 폴더명으로 사용 불가
function safeDownloadFolder(v) {
    const raw = (v && typeof v === 'string') ? v.trim() : '';
    return (/^(nul|con|prn|aux|com[1-9]|lpt[1-9])$/i.test(raw) || !raw) ? 'AI4Next' : raw;
}

function applySettingsToUI() {
    // ── AI Provider Switcher ──
    const provider = APP.settings.aiProvider || 'gemini';
    $('#aiProviderToggle')?.querySelectorAll('.ai-provider-btn').forEach(b => {
        const isMatch = b.getAttribute('data-provider') === provider;
        b.classList.toggle('active', isMatch);
        b.setAttribute('aria-checked', isMatch ? 'true' : 'false');
    });
    $('#geminiConfigSection')?.classList.toggle('hidden', provider !== 'gemini');
    $('#openaiConfigSection')?.classList.toggle('hidden', provider !== 'openai');

    // Gemini inputs
    const geminiInput = $('#geminiApiKeyInput');
    if (geminiInput) geminiInput.value = APP.settings.geminiApiKey || '';
    const geminiModel = $('#geminiModelSelect');
    if (geminiModel) geminiModel.value = APP.settings.geminiModel || 'gemini-3-flash-preview';

    // OpenAI inputs
    const presetSelect = $('#openaiPresetSelect');
    if (presetSelect) presetSelect.value = APP.settings.openaiPreset || 'deepseek';
    const urlInput = $('#openaiBaseUrlInput');
    if (urlInput) urlInput.value = APP.settings.openaiBaseUrl || 'https://api.deepseek.com/v1';
    const keyInput = $('#openaiApiKeyInput');
    if (keyInput) keyInput.value = APP.settings.openaiApiKey || '';
    const modelInput = $('#openaiModelInput');
    if (modelInput) modelInput.value = APP.settings.openaiModel || 'deepseek-chat';

    updateGeminiKeyStatus();

    // Nationality
    const natSelect = $('#nationalitySelect');
    if (natSelect) natSelect.value = APP.settings.nationality || 'korean';

    // Download folder (기본 저장 폴더명만, Whisk와 동일) — nul 등 예약명 방지
    const dlFolder = $('#downloadFolder');
    if (dlFolder) dlFolder.value = safeDownloadFolder(APP.settings.downloadFolder);
    const promptSeparatorInput = $('#promptSeparatorInput');
    if (promptSeparatorInput) promptSeparatorInput.value = getPromptSeparator();
    updatePromptSeparatorUi();

    syncFlowSettingControls();

    // Resolution (Flow: 1K/2K/4K)
    $$('[data-resolution]').forEach(b => {
        b.classList.toggle('active', b.dataset.resolution === (APP.settings.videoResolution || '1K'));
    });

    // Duration
    $$('[data-duration]').forEach(b => {
        b.classList.toggle('active', b.dataset.duration === APP.settings.videoDuration);
    });

    // Preset
    $$('[data-preset]').forEach(b => {
        b.classList.toggle('active', b.dataset.preset === APP.settings.videoPreset);
    });

    // Delay
    const delayVal = $('#delayValue');
    if (delayVal) delayVal.textContent = clampPromptDelay(APP.settings.promptDelay);

    // Default prompt
    const defPrompt = $('#defaultPrompt');
    if (defPrompt) defPrompt.value = APP.settings.defaultVideoPrompt || 'Dynamic action, Active camera angle';

    // Style (커스텀만)
    const effectiveStyle = normalizeSelectedStyle(APP.settings.selectedStyle);
    const styleSelect = $('#styleSelect');
    if (styleSelect) styleSelect.value = effectiveStyle;
    const controlStyleSelect = $('#controlStyleSelect');
    if (controlStyleSelect) {
        if (Array.from(controlStyleSelect.options).some(o => o.value === effectiveStyle)) {
            controlStyleSelect.value = effectiveStyle;
        }
    }

    $('#customStyleGallery')?.querySelectorAll('.custom-style-item').forEach(item => {
        item.classList.toggle('selected', item.dataset.customId === effectiveStyle);
    });

    // 제어 탭 썸네일·드롭다운 동기화 (설정 적용 시 반영)
    updateControlStyleDisplay();

    // 프롬프트이미지모드 스타일첨부 체크박스
    const attachCheckbox = $('#attachStyleCheckbox');
    if (attachCheckbox) attachCheckbox.checked = !!APP.settings.attachStyleInTextToImage;

    // Mode card
    $$('.mode-card').forEach(c => {
        c.classList.toggle('active', c.dataset.mode === APP.mode);
    });
}

// ========== HELPERS ==========
function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

/**
 * 当前选择引擎对应的有效 API 密钥
 */
function getActiveApiKey() {
    if (APP.settings.aiProvider === 'openai') {
        return (APP.settings.openaiApiKey || '').trim();
    }
    const model = APP.settings.geminiModel || 'gemini-3-flash-preview';
    const isFree = typeof isGeminiFreeModel === 'function' ? isGeminiFreeModel(model) : true;
    if (!isFree && APP.settings.geminiApiKeyPaid) {
        return APP.settings.geminiApiKeyPaid;
    }
    return APP.settings.geminiApiKey || '';
}

/**
 * 设置面板与顶栏的 AI 状态徽标更新
 */
function updateGeminiKeyStatus() {
    const badge = $('#geminiModelBadge');
    const statusText = $('#geminiKeyStatusText');
    if (!badge && !statusText) return;

    const isOp = APP.settings.aiProvider === 'openai';
    if (isOp) {
        const model = APP.settings.openaiModel || 'deepseek-chat';
        const hasKey = !!APP.settings.openaiApiKey || (APP.settings.openaiBaseUrl || '').includes('localhost');
        if (badge) {
            badge.textContent = model.length > 16 ? model.slice(0, 14) + '..' : model;
            badge.style.background = '#f5f3ff';
            badge.style.color = '#7c3aed';
            badge.style.borderColor = '#c4b5fd';
        }
        if (statusText) {
            statusText.innerHTML = hasKey
                ? 'AI KEY REGISTERED <span style="color:#10b981">&#10003;</span>'
                : 'REGISTER API KEY';
        }
        return;
    }

    const model = APP.settings.geminiModel || 'gemini-3-flash-preview';
    const label = typeof getGeminiModelLabel === 'function' ? getGeminiModelLabel(model) : model;
    const isFree = typeof isGeminiFreeModel === 'function' ? isGeminiFreeModel(model) : true;
    const hasKey = isFree ? !!APP.settings.geminiApiKey : !!APP.settings.geminiApiKeyPaid;

    if (badge) {
        badge.textContent = label;
        if (isFree) {
            badge.style.background = '#ecfdf5';
            badge.style.color = '#059669';
            badge.style.borderColor = '#6ee7b7';
        } else {
            badge.style.background = '#eff6ff';
            badge.style.color = '#2563eb';
            badge.style.borderColor = '#93c5fd';
        }
    }

    if (statusText) {
        if (hasKey) {
            statusText.innerHTML = isFree
                ? "FREE KEY REGISTERED" + ' <span style="color:#10b981">&#10003;</span>'
                : "PAID KEY REGISTERED" + ' <span style="color:#2563eb">&#10003;</span>';
        } else {
            statusText.textContent = "REGISTER API KEY";
        }
    }

    const settingBtn = $('#geminiKeySettingBtn');
    if (settingBtn) settingBtn.textContent = "API KEY SETTINGS";
}

/**
 * 测试 AI API 连通性
 */
async function testAiConnection() {
    const pill = $('#testAiStatusPill');
    const btn = $('#btnTestAiConnection');
    if (!pill) return;

    pill.className = 'test-status-pill testing';
    pill.textContent = '⏳ 测试连接中...';
    pill.classList.remove('hidden');
    if (btn) btn.disabled = true;

    const startTime = Date.now();
    try {
        const provider = APP.settings.aiProvider || 'gemini';
        if (provider === 'gemini') {
            const key = getActiveApiKey();
            if (!key) throw new Error('请先填入 Gemini API Key');
            const model = APP.settings.geminiModel || 'gemini-3-flash-preview';
            const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: 'Hi, reply with OK' }] }],
                    generationConfig: { maxOutputTokens: 10 }
                })
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.error?.message || `HTTP ${res.status}`);
            }
        } else {
            const key = (APP.settings.openaiApiKey || '').trim();
            const baseUrl = (APP.settings.openaiBaseUrl || 'https://api.deepseek.com/v1').trim().replace(/\/+$/, '');
            const model = (APP.settings.openaiModel || 'deepseek-chat').trim();
            const endpoint = baseUrl.endsWith('/chat/completions') ? baseUrl : `${baseUrl}/chat/completions`;

            const headers = { 'Content-Type': 'application/json' };
            if (key) headers['Authorization'] = `Bearer ${key}`;

            const res = await fetch(endpoint, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    model,
                    messages: [{ role: 'user', content: 'Hi, reply with OK' }],
                    max_tokens: 10
                })
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.error?.message || err.message || `HTTP ${res.status}`);
            }
        }

        const elapsed = Date.now() - startTime;
        pill.className = 'test-status-pill success';
        pill.textContent = `✓ 连通正常 (${elapsed}ms)`;
        showToast(`AI API 连接成功！响应耗时: ${elapsed}ms`, 'success');
    } catch (e) {
        pill.className = 'test-status-pill error';
        pill.textContent = '✗ 连接失败';
        showToast(`连接失败: ${e.message}`, 'error', 6000);
    } finally {
        if (btn) btn.disabled = false;
    }
}

function showGeminiGuideModal() {
    const currentModel = APP.settings.geminiModel || 'gemini-3-flash-preview';
    const currentLabel = typeof getGeminiModelLabel === 'function' ? getGeminiModelLabel(currentModel) : currentModel;
    const isFreeModel = typeof isGeminiFreeModel === 'function' ? isGeminiFreeModel(currentModel) : true;
    const freeModels = typeof GEMINI_FREE_MODELS !== 'undefined' ? GEMINI_FREE_MODELS : [];
    const paidModels = typeof GEMINI_PAID_MODELS !== 'undefined' ? GEMINI_PAID_MODELS : [];
    const freeKey = APP.settings.geminiApiKey || '';
    const paidKey = APP.settings.geminiApiKeyPaid || '';
    const maskKey = (k) => k ? k.substring(0, 4) + '••••••••' + k.slice(-4) : '';

    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
    <div class="modal gemini-guide-modal" style="max-width:420px;background:var(--bg-card);color:var(--text-primary);border-radius:14px;box-shadow:var(--card-shadow)">
      <div class="modal-header" style="display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--border);padding:14px 18px">
        <span style="font-weight:700;font-size:15px;color:var(--text-primary)">GEMINI API KEY</span>
        <button class="modal-close" style="background:none;border:none;font-size:20px;color:var(--text-muted);cursor:pointer">&times;</button>
      </div>
      <div class="modal-body" style="padding:18px;font-size:13px;line-height:1.6;color:var(--text-primary)">

        <!-- 모델 선택: 무료KEY / 유료KEY 드롭다운 (동일 크기) -->
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px">
          <div class="gm-dropdown-wrap" style="position:relative;flex:1">
            <button id="gmModelBtn" class="gm-model-btn" style="width:100%;padding:7px 14px;border-radius:8px;font-size:12px;font-weight:700;border:1px solid #6ee7b7;background:#ecfdf5;color:#059669;cursor:pointer;display:flex;align-items:center;justify-content:space-between">
              <span>${"Free KEY"} <span style="font-size:10px;opacity:0.7">(${isFreeModel ? currentLabel : freeModels[0]?.label || 'G3F'})</span></span>
              <span>&#9660;</span>
            </button>
            <div id="gmFreeDropdown" class="gm-dropdown" style="display:none;position:absolute;top:100%;left:0;right:0;z-index:100;background:var(--bg-card);border:1px solid var(--border);border-radius:10px;margin-top:4px;padding:4px 0;box-shadow:var(--card-shadow)">
              ${freeModels.map(m => `
                <div class="gm-dropdown-item" data-model="${m.name}" style="padding:8px 14px;cursor:pointer;font-size:12px;display:flex;justify-content:space-between;align-items:center;color:var(--text-primary)">
                  <span>${m.label} <span style="font-size:10px;color:var(--text-muted)">${m.name.replace('gemini-','')}</span></span>
                  ${m.name === currentModel ? '<span style="color:var(--mint-dark)">&#10003;</span>' : ''}
                </div>
              `).join('')}
            </div>
          </div>
          <div class="gm-dropdown-wrap" style="position:relative;flex:1">
            <button id="gmPaidModelBtn" class="gm-model-btn" style="width:100%;padding:7px 14px;border-radius:8px;font-size:12px;font-weight:700;border:1px solid #93c5fd;background:#eff6ff;color:#2563eb;cursor:pointer;display:flex;align-items:center;justify-content:space-between">
              <span>${"Paid KEY"} <span style="font-size:10px;opacity:0.7">(${!isFreeModel ? currentLabel : paidModels[0]?.label || 'G3.1P'})</span></span>
              <span>&#9660;</span>
            </button>
            <div id="gmPaidDropdown" class="gm-dropdown" style="display:none;position:absolute;top:100%;left:0;right:0;z-index:100;background:var(--bg-card);border:1px solid var(--border);border-radius:10px;margin-top:4px;padding:4px 0;box-shadow:var(--card-shadow)">
              ${paidModels.map(m => `
                <div class="gm-dropdown-item" data-model="${m.name}" style="padding:8px 14px;cursor:pointer;font-size:12px;display:flex;justify-content:space-between;align-items:center;color:var(--text-primary)">
                  <span>${m.label} <span style="font-size:10px;color:var(--text-muted)">${m.name.replace('gemini-','')}</span></span>
                  ${m.name === currentModel ? '<span style="color:var(--mint-dark)">&#10003;</span>' : ''}
                </div>
              `).join('')}
            </div>
          </div>
        </div>

        <!-- 무료 API KEY -->
        <div style="margin-bottom:6px;font-size:11px;color:var(--text-muted)">${"Free API KEY"} ${freeKey ? '<span style="color:var(--success)">&#9679; ' + "Registered" + '</span>' : ''}</div>
        <div style="display:flex;gap:4px;align-items:center;margin-bottom:6px">
          <div style="position:relative;flex:1;display:flex;align-items:center">
            <input type="password" id="gmFreeKeyInput" class="input" placeholder="${"Enter API Key"}"
              value="${freeKey}" style="flex:1;padding-right:32px;font-size:12px;background:var(--bg-input);border:1px solid var(--border);color:var(--text-primary);border-radius:8px;padding:9px 10px">
            <button id="gmFreeKeyToggle" style="position:absolute;right:6px;background:none;border:none;cursor:pointer;font-size:14px;color:var(--text-muted)" title="Show/Hide">&#128065;</button>
          </div>
        </div>
        <div style="display:flex;gap:6px;margin-bottom:18px">
          <button id="gmFreeKeyRegister" style="flex:1;box-sizing:border-box;padding:9px 7px;border-radius:8px;font-size:12px;font-weight:700;border:none;background:linear-gradient(135deg, var(--mint), var(--mint-dark));color:var(--mint-contrast);cursor:pointer">${"REGISTER"}</button>
          <button id="gmFreeKeyDelete" style="flex:1;box-sizing:border-box;padding:9px 7px;border-radius:8px;font-size:12px;font-weight:700;border:1px solid var(--border-strong);background:var(--bg-card);color:var(--text-secondary);cursor:pointer">${"DELETE"}</button>
        </div>

        <!-- 유료 API KEY -->
        <div style="margin-bottom:6px;font-size:11px;color:var(--text-muted)">${"Paid API KEY"} ${paidKey ? '<span style="color:var(--mint-dark)">&#9679; ' + "Registered" + '</span>' : ''}</div>
        <div style="display:flex;gap:4px;align-items:center;margin-bottom:6px">
          <div style="position:relative;flex:1;display:flex;align-items:center">
            <input type="password" id="gmPaidKeyInput" class="input" placeholder="${"Enter Paid API Key"}"
              value="${paidKey}" style="flex:1;padding-right:32px;font-size:12px;background:var(--bg-input);border:1px solid var(--border);color:var(--text-primary);border-radius:8px;padding:9px 10px">
            <button id="gmPaidKeyToggle" style="position:absolute;right:6px;background:none;border:none;cursor:pointer;font-size:14px;color:var(--text-muted)" title="Show/Hide">&#128065;</button>
          </div>
        </div>
        <div style="display:flex;gap:6px;margin-bottom:18px">
          <button id="gmPaidKeyRegister" style="flex:1;box-sizing:border-box;padding:9px 7px;border-radius:8px;font-size:12px;font-weight:700;border:none;background:linear-gradient(135deg, var(--mint), var(--mint-dark));color:var(--mint-contrast);cursor:pointer">${"REGISTER"}</button>
          <button id="gmPaidKeyDelete" style="flex:1;box-sizing:border-box;padding:9px 7px;border-radius:8px;font-size:12px;font-weight:700;border:1px solid var(--border-strong);background:var(--bg-card);color:var(--text-secondary);cursor:pointer">${"DELETE"}</button>
        </div>

        <!-- 안내 영역 -->
        <div style="margin-top:6px;padding:14px 16px;background:var(--mint-light);border-radius:10px;border:1px solid var(--border)">
          <div style="font-size:11px;color:var(--text-secondary);line-height:1.7">
            <div style="display:flex;align-items:flex-start;gap:6px;margin-bottom:4px">
              <span style="color:var(--mint-dark);font-size:13px;line-height:1.3">&#9679;</span>
              <span>${"Enter your <b style=\"color:var(--mint-dark)\">free-tier KEY</b> in the Free KEY field."}</span>
            </div>
            <div style="display:flex;align-items:flex-start;gap:6px;margin-bottom:4px">
              <span style="color:var(--mint-dark);font-size:13px;line-height:1.3">&#9679;</span>
              <span>${"To use premium models, enter your <b style=\"color:var(--mint-dark)\">personal paid KEY</b>."}</span>
            </div>
            <div style="margin-top:6px;padding-top:6px;border-top:1px dashed var(--border);text-align:center;font-size:11px;color:var(--text-muted)">
              ${"Script analysis runs with the <b style=\"color:var(--text-primary)\">selected model</b>."}
            </div>
          </div>
          <div style="text-align:center;margin-top:10px">
            <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener"
               style="display:inline-block;padding:5px 16px;border-radius:20px;background:linear-gradient(135deg, var(--mint), var(--mint-dark));color:var(--mint-contrast);font-size:11px;font-weight:600;text-decoration:none">
              ${"Get API Key →"}
            </a>
          </div>
        </div>
      </div>
    </div>`;

    document.body.appendChild(modal);

    // ── 모달 닫기 ──
    modal.querySelector('.modal-close').addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });


    // ── Free 모델 드롭다운 ──
    const freeBtn = modal.querySelector('#gmModelBtn');
    const freeDD = modal.querySelector('#gmFreeDropdown');
    const paidBtn = modal.querySelector('#gmPaidModelBtn');
    const paidDD = modal.querySelector('#gmPaidDropdown');

    freeBtn.addEventListener('click', (e) => { e.stopPropagation(); freeDD.style.display = freeDD.style.display === 'none' ? 'block' : 'none'; paidDD.style.display = 'none'; });
    paidBtn.addEventListener('click', (e) => { e.stopPropagation(); paidDD.style.display = paidDD.style.display === 'none' ? 'block' : 'none'; freeDD.style.display = 'none'; });
    document.addEventListener('click', function _closeDD() { freeDD.style.display = 'none'; paidDD.style.display = 'none'; }, { once: false });

    // ── 모델 선택 핸들러 ──
    modal.querySelectorAll('.gm-dropdown-item').forEach(item => {
        item.addEventListener('mouseenter', () => { item.style.background = 'var(--mint-light)'; });
        item.addEventListener('mouseleave', () => { item.style.background = 'transparent'; });
        item.addEventListener('click', () => {
            const modelName = item.dataset.model;
            APP.settings.geminiModel = modelName;
            if (typeof setActiveGeminiModel === 'function') setActiveGeminiModel(modelName);
            saveSettings();
            updateGeminiKeyStatus();
            modal.remove();
            showGeminiGuideModal();
            showToast("Model: " + (typeof getGeminiModelLabel === 'function' ? getGeminiModelLabel(modelName) : modelName), 'success');
        });
    });

    // ── 키 표시/숨김 토글 ──
    modal.querySelector('#gmFreeKeyToggle')?.addEventListener('click', () => {
        const inp = modal.querySelector('#gmFreeKeyInput');
        inp.type = inp.type === 'password' ? 'text' : 'password';
    });
    modal.querySelector('#gmPaidKeyToggle')?.addEventListener('click', () => {
        const inp = modal.querySelector('#gmPaidKeyInput');
        inp.type = inp.type === 'password' ? 'text' : 'password';
    });

    // ── 무료 키 등록/삭제 ──
    modal.querySelector('#gmFreeKeyRegister')?.addEventListener('click', () => {
        const val = modal.querySelector('#gmFreeKeyInput')?.value?.trim() || '';
        // ★ v1.1.7: 3차 폴백 검증 — AIza/AQ. + 미래 신형 prefix 까지 관대 허용
        //   잘못된 키면 실제 호출 시 getPromptErrorToast 의 API_KEY 분기가 안내함
        const _safeCharset = /^[A-Za-z0-9._\-\\]+$/;
        if (!val || val.length < 30 || !_safeCharset.test(val)) {
            showToast("Invalid API Key (must start with AIza or AQ.)", 'error');
            return;
        }
        APP.settings.geminiApiKey = val;
        chrome.storage.local.set({ apiKey: val });
        saveSettings();
        updateGeminiKeyStatus();
        modal.remove();
        showGeminiGuideModal();
        showToast("Free API Key registered", 'success');
    });
    modal.querySelector('#gmFreeKeyDelete')?.addEventListener('click', () => {
        APP.settings.geminiApiKey = '';
        chrome.storage.local.remove('apiKey');
        saveSettings();
        updateGeminiKeyStatus();
        modal.remove();
        showGeminiGuideModal();
        showToast("Free API Key deleted");
    });

    // ── 유료 키 등록/삭제 ──
    modal.querySelector('#gmPaidKeyRegister')?.addEventListener('click', () => {
        const val = modal.querySelector('#gmPaidKeyInput')?.value?.trim() || '';
        // ★ v1.1.7: 3차 폴백 검증 — AIza/AQ. + 미래 신형 prefix 까지 관대 허용
        //   잘못된 키면 실제 호출 시 getPromptErrorToast 의 API_KEY 분기가 안내함
        const _safeCharset = /^[A-Za-z0-9._\-\\]+$/;
        if (!val || val.length < 30 || !_safeCharset.test(val)) {
            showToast("Invalid API Key (must start with AIza or AQ.)", 'error');
            return;
        }
        APP.settings.geminiApiKeyPaid = val;
        chrome.storage.local.set({ apiKeyPaid: val });
        saveSettings();
        updateGeminiKeyStatus();
        modal.remove();
        showGeminiGuideModal();
        showToast("Paid API Key registered", 'success');
    });
    modal.querySelector('#gmPaidKeyDelete')?.addEventListener('click', () => {
        APP.settings.geminiApiKeyPaid = '';
        chrome.storage.local.remove('apiKeyPaid');
        saveSettings();
        updateGeminiKeyStatus();
        modal.remove();
        showGeminiGuideModal();
        showToast("Paid API Key deleted");
    });
}

/** @returns {{ message: string, duration: number }} */
function getPromptErrorToast(err) {
    const msg = (err?.message || '').toLowerCase();
    const name = (err?.name || '').toLowerCase();
    if (!msg && !name) return { message: "Prompt generation failed. Solution: Check your script and try again, or enter a different Gemini API key in Settings.", duration: 5000 };
    // ★ v1.1.7 (개선): GCP 'Generative Language API' 미활성화 / 차단 감지
    //   서버 응답: "403 - Requests to this API ... are blocked" / "API not enabled" / "service is disabled" 등
    //   유럽(EU) 지역 등에서 신형 키 발급 후 GCP 콘솔 활성화 필요한 케이스
    //   → 사용자에게 GCP 콘솔에서 'Generative Language API' 활성화하라고 명확히 안내
    if (
        /generativelanguage\.googleapis\.com.*(block|disabled)/i.test(msg) ||
        /\b403\b.*(block|blocked|disabled|not.?enabled)/i.test(msg) ||
        /(block|blocked|disabled|not.?enabled).*generativelanguage/i.test(msg) ||
        /api.*not.?enabled|service.*disabled|service_disabled/i.test(msg) ||
        /requests to this api .*are blocked/i.test(msg)
    ) {
        return { message: "⚠️ Key registered but Gemini API access denied. ① At console.cloud.google.com → API Library, enable 'Generative Language API'. ② Some regions (e.g., EU) may be restricted — try a different account.", duration: 10000 };
    }
    // ★ v1.1.7: API 키 명시적 에러 우선 감지 — 서버가 키를 거부한 경우 사용자 안내
    //   400 API_KEY_INVALID / 401 Unauthorized / 403 PERMISSION_DENIED / API key not valid 등
    //   신형 'AQ.' 키나 잘못 입력한 키가 서버에서 거절될 때 명확한 메시지로 안내
    if (
        /api[_\s-]?key[_\s-]?(invalid|not.?valid|missing|expired)/i.test(msg) ||
        /api.?key/i.test(msg) && /(invalid|reject|denied|not.?authorized|unauthorized|missing|expired)/i.test(msg) ||
        msg.includes('permission_denied') || msg.includes('permission denied') ||
        msg.includes('unauthenticated') || msg.includes('unauthorized') ||
        /\b(400|401|403)\b.*(api.?key|auth|permission|denied)/i.test(msg)
    ) {
        return { message: "⚠️ Please verify your API key is entered correctly. If using a new-format key (AQ.), the key may be invalid or lack permissions.", duration: 7000 };
    }
    // ★ 서버 과부하 먼저 감지 — 소진 오탐 방지. 다른 모델 선택 또는 재시도 유도
    if (msg.includes('429_server_busy') || msg.includes('서버 일시 과부하') || /\b(503|500|502|504)\b.*(server|busy|unavailable|overload|내부 오류)/i.test(msg)) {
        return { message: "⚠️ Gemini server temporarily overloaded. Select a different Gemini model or try again shortly.", duration: 7000 };
    }
    // 레이트리밋 — 키 소진 아님, 재시도 가능
    if (msg.includes('429_rate_limit') || msg.includes('레이트리밋') || /rate.*limit/i.test(msg)) {
        return { message: "⚠️ Gemini API per-minute rate limit. Please retry in 10-30 seconds.", duration: 7000 };
    }
    // 실제 쿼터 소진 — 키 교체 유도
    if (msg.includes('429') || msg.includes('사용량이 초과') || msg.includes('무료 사용량') || msg.includes('quota exhausted')) {
        return { message: "⚠️ API quota exhausted. Solution: Enter a different Gemini API key in Settings, or try again after 5pm KST (quota reset).", duration: 6000 };
    }
    if (msg.includes('시간 초과') || msg.includes('timeout') || name === 'aborterror') {
        return { message: "⏱️ Response timeout (15 min). Solution: Split your script into shorter parts and reduce the number of prompts, then try again.", duration: 6000 };
    }
    if (/token|토큰|max_tokens|resourceexhausted|context\s*length/i.test(msg)) {
        return { message: "📝 Token limit exceeded. Solution: Shorten the script or lower 'Number of prompts to generate', then try again.", duration: 6000 };
    }
    if (msg.includes('네트워크') || msg.includes('failed to fetch') || msg.includes('network')) {
        return { message: "🌐 Network error. Solution: Check your internet connection and try again.", duration: 5000 };
    }
    if (msg.includes('안전') || msg.includes('safety') || msg.includes('filter')) {
        return { message: "🛡️ Script flagged by safety filter. Solution: Edit sensitive content and try again.", duration: 5000 };
    }
    if (msg.includes('과부하') || msg.includes('503') || msg.includes('unavailable')) {
        return { message: "🔄 Server temporarily overloaded. Solution: Wait 1–2 minutes and try again.", duration: 5000 };
    }
    // ★ v1.1.7: fall-through — 알려진 에러 카테고리에 안 잡히면 API 키 확인 유도
    //   3차 폴백 관대 검증 통과 후 실제 API 호출 실패 시 가장 흔한 원인이 잘못된 키
    return { message: "⚠️ Please verify your API key is entered correctly. If using a new-format key (AQ.), the key may be invalid or lack permissions.", duration: 6000 };
}

function showToast(message, type = '', duration = 3000) {
    const toast = $('#toast');
    if (!toast) return;

    // ★ v1.1.9 fix: error 토스트는 사용자가 X 눌렀으면 30초간 재표시 차단
    //   기존 버그: 차단 감지 폴링이 매번 showToast 호출 → X 눌러도 즉시 재표시 → "안 닫힘" 체감
    //   개선: 함수 시작 부분에서 dismissal 검사 (UNUSUAL_ACTIVITY_STATUS 외 모든 showToast 경로 커버)
    if (type === 'error' && APP._toastDismissedAt) {
        const elapsed = Date.now() - APP._toastDismissedAt;
        if (elapsed < 30000) {
            console.log(`[TOAST] error 토스트 차단 — 사용자 dismissal 후 ${Math.round(elapsed/1000)}s 경과 (30s 미만)`);
            return;
        }
    }

    // 기존 타이머 취소
    if (toast._hideTimer) {
        clearTimeout(toast._hideTimer);
        toast._hideTimer = null;
    }

    // 즉시 보이게 (이전에 dismissal로 display:none 됐을 수 있음)
    toast.style.display = '';

    const normalizedMessage = String(message || '')
        .replace(/^[\s📤📥💾📂🔒⚠️✓✅👇⏹🚨📉💡⏸▶❌🎬🆕🔄⬇️✏️📋]+/u, '')
        .replace(/<[^>]*>/g, '')
        .trim();

    toast.textContent = '';
    const messageEl = document.createElement('span');
    messageEl.className = 'toast-message';
    messageEl.textContent = normalizedMessage || String(message || '').replace(/<[^>]*>/g, '');
    const closeEl = document.createElement('button');
    closeEl.type = 'button';
    closeEl.className = 'toast-close';
    closeEl.title = "Close";
    closeEl.setAttribute('aria-label', "Close");
    closeEl.textContent = '×';
    toast.append(messageEl, closeEl);
    toast.className = `toast ${type}`;

    // X 버튼 클릭 이벤트
    const closeBtn = closeEl;
    if (closeBtn) {
        closeBtn.onclick = (e) => {
            e.stopPropagation();
            e.preventDefault();
            // ★ v1.1.9 fix: 즉시 강제 숨김 (transition 기다리지 않음 + display:none 까지)
            //   → 폴링이 다시 showToast 호출해도 위 30초 차단으로 막힘
            toast.classList.remove('show');
            toast.style.display = 'none';
            if (toast._hideTimer) {
                clearTimeout(toast._hideTimer);
                toast._hideTimer = null;
            }
            // ★ v1.1.9 fix: 모든 error 토스트 X 클릭은 _toastDismissedAt 갱신
            //   → 30초 내 모든 후속 error 토스트 차단
            if (type === 'error') {
                APP._toastDismissedAt = Date.now();
                APP._unusualToastDismissedAt = Date.now();  // 하위 호환
                console.log('[TOAST] error 토스트 X 클릭 — 30초간 동일 류 차단');
            }
        };
    }

    requestAnimationFrame(() => {
        toast.classList.add('show');
    });

    // 자동 숨김 (duration이 0이면 수동 닫기만 가능)
    if (duration > 0) {
        toast._hideTimer = setTimeout(() => {
            toast.classList.remove('show');
            // ★ v1.1.8: transition(0.3s) 후 display:none 까지 — 잔존 클릭 차단 + 확실한 숨김
            setTimeout(() => {
                if (!toast.classList.contains('show')) toast.style.display = 'none';
            }, 350);
        }, duration);
    }
}

// =============================================
// FACTORY MODE FUNCTIONS
// =============================================

/**
 * 이미지 생성 완료 후 배치1 이미지를 Chrome Storage에 저장
 * @param {Array} prompts - 배치1 프롬프트 배열
 * @param {Array} images - 생성된 이미지 base64 배열
 */
async function saveBatch1Images(prompts, images) {
    const batch1Data = [];
    const filenames = APP.factory.batch1Filenames || [];


    for (let i = 0; i < prompts.length; i++) {
        const prompt = prompts[i];
        const imageBase64 = images[i];


        if (imageBase64) {
            const thumbnail = await createThumbnail(imageBase64, 150);  // ★ 화질 향상 (80 → 150)

            batch1Data.push({
                number: prompt.number || String(i + 1).padStart(2, '0'),
                base64: imageBase64,
                thumbnail: thumbnail,
                filename: filenames[i] || ''  // ★ 이미지 파일명 저장 (동영상 파일명 동기화용)
            });
        }
    }

    APP.factory.batch1Images = batch1Data;
    // ★ prompts는 grokSession.prompts에 이미 저장되어 있으므로 중복 저장 안함
    // APP.prompts를 참조하면 됨

    // Chrome Storage에 저장 (base64만 - prompts 중복 저장 제거)
    await new Promise(resolve => {
        chrome.storage.local.set({
            factoryBatch1Images: batch1Data
            // factoryBatch1Prompts 제거 → grokSession.prompts 재사용
        }, resolve);
    });

    return batch1Data;
}

/**
 * 이미지를 썸네일로 리사이즈
 * ★ unlimitedStorage 권한 사용 → 화질 향상 (80px → 150px, 70% → 75%)
 */
function createThumbnail(base64, maxSize = 150) {
    return new Promise((resolve) => {
        if (!base64 || typeof base64 !== 'string') {
            resolve('');
            return;
        }

        // base64가 data: 접두사 없으면 추가
        let src = base64;
        if (!base64.startsWith('data:')) {
            src = 'data:image/jpeg;base64,' + base64;
        }

        const img = new Image();
        img.onload = () => {
            try {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');

                let w = img.width, h = img.height;
                if (w > h) {
                    if (w > maxSize) { h = h * maxSize / w; w = maxSize; }
                } else {
                    if (h > maxSize) { w = w * maxSize / h; h = maxSize; }
                }

                canvas.width = Math.max(1, Math.floor(w));
                canvas.height = Math.max(1, Math.floor(h));
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                const result = canvas.toDataURL('image/jpeg', 0.75);  // ★ 품질 향상 (70% → 75%)
                resolve(result);
            } catch (e) {
                resolve(src);
            }
        };
        img.onerror = (e) => {
            resolve(src);  // 원본 반환
        };
        img.src = src;
    });
}

/**
 * 동영상 프롬프트 생성 (Gemini API 호출)
 */
async function generateVideoPrompts() {
    const btn = $('#btn-generate-video-prompts');
    if (!btn) return;

    const apiKey = getActiveApiKey();
    if (!apiKey) {
        const isOp = APP.settings.aiProvider === 'openai';
        showToast(isOp ? "未配置 API Key。请在设置中输入您的 API Key（如 DeepSeek/OpenAI 等）。" : "未配置 Gemini API Key。请在设置中输入您的 API Key。", 'error');
        return;
    }

    // 배치1 이미지가 있는지 확인
    if (APP.factory.batch1Images.length === 0) {
        // Storage에서 로드 시도
        const stored = await new Promise(resolve => {
            chrome.storage.local.get(['factoryBatch1Images'], resolve);
        });
        if (stored.factoryBatch1Images && stored.factoryBatch1Images.length > 0) {
            APP.factory.batch1Images = stored.factoryBatch1Images;
        } else {
            showToast("No batch 1 images found. Solution: Run 'Start image' or 'Auto generation' first, then click 'Generate video prompts'.", 'error');
            return;
        }
    }

    const originalText = btn.textContent;
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span> ${"GENERATING VIDEO PROMPTS..."}`;

    APP.isGeneratingPrompts = true;  // ★ Gemini API 호출 시작 (모드 전환 차단)

    try {
        const script = $('#scriptInput')?.value?.trim() || '';
        // ★ prompts는 grokSession에서 이미 APP.prompts로 로드됨 (중복 저장 제거)
        const imagePrompts = APP.prompts.slice(0, APP.factory.batch1Images.length);

        // Gemini API 호출하여 동영상 프롬프트 생성
        const videoPrompts = await generateVideoPromptsFromGemini(script, imagePrompts, apiKey);

        APP.factory.videoPrompts = videoPrompts;

        APP.factory.videoQueue = videoPrompts.map((vp, idx) => ({
            number: vp.number || String(idx + 1).padStart(2, '0'),
            characters: vp.characters || '',           // ★ 캐릭터 코드 (MCR, SC1 등)
            scriptText: vp.scriptText || '',           // ★ 대본 텍스트 (파일명용)
            imageBase64: APP.factory.batch1Images[idx]?.base64 || '',
            thumbnail: APP.factory.batch1Images[idx]?.thumbnail || '',
            originalFilename: APP.factory.batch1Images[idx]?.filename || '',  // ★ 이미지 파일명
            prompt: vp.videoPrompt || vp.prompt || 'Dynamic action, Active camera angle',
            status: 'pending',
            editMode: false
        }));

        // UI 렌더링
        renderVideoPromptList();

        // ★ 생성된 동영상프롬프트 박스 표시 및 텍스트 갱신
        updateGeneratedVideoPromptsText();
        $('#generatedVideoPromptsSection')?.classList.remove('hidden');

        // 버튼 섹션 표시
        $('#factoryVideoList')?.classList.remove('hidden');
        $('#factoryVideoActions')?.classList.remove('hidden');

        // ★ 동영상 생성 버튼으로 자동 스크롤
        setTimeout(() => {
            $('#factoryVideoActions')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 100);

        showToast(`${videoPrompts.length} ${" video prompts generated"}`, 'success');

        // AUTO 모드 또는 VIDEO AUTO 모드면 자동으로 동영상 생성 시작
        if (APP.factory.isAutoMode || APP.factory.isVideoAuto) {
            setTimeout(() => {
                $('#btn-start-video-generation')?.click();
            }, 1000);
        }

    } catch (err) {

        // ★ 오류 유형에 따른 토스트 + 이미지 프롬프트로 대체
        let toastMsg = '';
        const errorCode = err.code || '';

        if (errorCode === 'API_QUOTA') {
            toastMsg = 'API key quota exhausted — falling back to image prompts.';
        } else if (errorCode === 'API_ERROR') {
            toastMsg = `API error — falling back to image prompts. (${err.message.replace('API_ERROR:', '')})`;
        } else if (errorCode === 'PARSE_FAILED') {
            toastMsg = `JSON parse error — falling back to image prompts. (${err.message.replace('PARSE_FAILED:', '')})`;
        } else {
            toastMsg = `Error occurred — falling back to image prompts. (${err.message})`;
        }

        showToast(toastMsg, 'warning', 0);  // ★ 수동 닫기만 가능 (duration=0)

        // ★ 이미지 프롬프트 기반 기본 동영상 프롬프트 생성
        const imagePrompts = APP.prompts.slice(0, APP.factory.batch1Images.length);
        const fallbackVideoPrompts = imagePrompts.map((imgPrompt, idx) => ({
            number: imgPrompt.number || String(idx + 1).padStart(2, '0'),
            characters: imgPrompt.characters || '',
            scriptText: imgPrompt.scriptText || '',
            videoPrompt: 'slow camera movement, subtle animation'
        }));

        APP.factory.videoPrompts = fallbackVideoPrompts;

        // 동영상 큐 생성
        APP.factory.videoQueue = fallbackVideoPrompts.map((vp, idx) => ({
            number: vp.number || String(idx + 1).padStart(2, '0'),
            characters: vp.characters || '',
            scriptText: vp.scriptText || '',
            imageBase64: APP.factory.batch1Images[idx]?.base64 || '',
            thumbnail: APP.factory.batch1Images[idx]?.thumbnail || '',
            originalFilename: APP.factory.batch1Images[idx]?.filename || '',
            prompt: vp.videoPrompt || 'Dynamic action, Active camera angle',
            status: 'pending',
            editMode: false
        }));

        // UI 렌더링
        renderVideoPromptList();

        // ★ 생성된 동영상프롬프트 박스 표시 및 텍스트 갱신
        updateGeneratedVideoPromptsText();
        $('#generatedVideoPromptsSection')?.classList.remove('hidden');

        // 버튼 섹션 표시
        $('#factoryVideoList')?.classList.remove('hidden');
        $('#factoryVideoActions')?.classList.remove('hidden');

        // 동영상 생성 버튼으로 자동 스크롤
        setTimeout(() => {
            $('#factoryVideoActions')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 100);

        // AUTO 모드 또는 VIDEO AUTO 모드면 자동으로 동영상 생성 시작
        if (APP.factory.isAutoMode || APP.factory.isVideoAuto) {
            setTimeout(() => {
                $('#btn-start-video-generation')?.click();
            }, 1000);
        }

    } finally {
        btn.textContent = originalText;
        btn.disabled = false;
        APP.isGeneratingPrompts = false;  // ★ Gemini API 호출 완료 (모드 전환 허용)
    }
}

/**
 * 생성된 동영상프롬프트 박스 텍스트 갱신 (videoQueue → textarea)
 */
function updateGeneratedVideoPromptsText() {
    const textarea = $('#generatedVideoPromptsText');
    if (!textarea) return;
    const items = APP.factory.videoQueue;
    if (!items || items.length === 0) {
        textarea.value = '';
        return;
    }
    const text = items.map(item => {
        // 이미지프롬프트와 동일 형식: 1줄 번호, 2줄 캐릭터코드, 3줄 대본, 4줄+ 동영상프롬프트
        const chars = item.characters || '';
        const script = item.scriptText || '';
        return `[${item.number}]\n${chars}\n${script}\n${item.prompt || ''}`;
    }).join('\n\n');
    textarea.value = text;
}

/**
 * 편집된 동영상프롬프트 텍스트 파싱 → videoQueue 동기화
 * 형식: 이미지프롬프트와 동일
 * 1줄: [번호], 2줄: 캐릭터코드, 3줄: 대본, 4줄+: 동영상프롬프트
 */
function parseAndApplyVideoPromptsFromText(text) {
    const items = APP.factory.videoQueue;
    if (!items || items.length === 0) return false;
    const regex = /\[(\d+)\]\s*\n([^\n]*)\n([^\n]*)\n([\s\S]*?)(?=\[\d+\]\s*\n|$)/g;
    let match;
    let changed = false;
    while ((match = regex.exec(text)) !== null) {
        const num = match[1].padStart(2, '0');
        const rawChars = (match[2] || '').trim();
        const characters = (rawChars === 'BG') ? '' : rawChars;
        const scriptText = (match[3] || '').trim();
        const promptText = (match[4] || '').trim();
        const idx = items.findIndex(item => item.number === num);
        if (idx >= 0) {
            if (items[idx].characters !== characters) {
                items[idx].characters = characters;
                changed = true;
            }
            if (items[idx].scriptText !== scriptText) {
                items[idx].scriptText = scriptText;
                changed = true;
            }
            if (items[idx].prompt !== promptText) {
                items[idx].prompt = promptText;
                changed = true;
            }
        }
    }
    return changed;
}

/**
 * ★ Factory 비디오 큐 기반 통계 (progressBar/완료통계 단일 소스)
 */
function getVideoQueueStats() {
    const queue = APP.factory?.videoQueue || [];
    const success = queue.filter(i => i.status === 'completed').length;
    const fail = queue.filter(i => i.status === 'failed').length;
    const generating = queue.filter(i => i.status === 'generating' || i.status === 'active').length;
    return {
        success,
        fail,
        total: queue.length,
        displayCount: success + (generating > 0 ? 1 : 0)
    };
}

/**
 * ★ getVideoQueueStats() 기반 progressBar UI 업데이트 (Factory 비디오 전용)
 */
function updateVideoProgressBar() {
    const { success, fail, total, displayCount } = getVideoQueueStats();
    const pct = total > 0 ? Math.round((displayCount / total) * 100) : 0;

    const fillEl = $('#factoryProgressFill');
    const textEl = $('#factoryProgressText');
    if (fillEl) fillEl.style.cssText = `width: ${pct}% !important; height: 100%; min-height: 10px; background: linear-gradient(90deg, #5EEAD4, #14B8A6); border-radius: 5px;`;
    if (textEl) {
        textEl.textContent = fail > 0
            ? `${success} / ${total} (FAILED ${fail})`
            : `${displayCount} / ${total}`;
    }
}

/**
 * 동영상 프롬프트 목록 UI 렌더링
 */
function renderVideoPromptList() {
    const container = $('#factoryVideoList');
    if (!container) return;

    const items = APP.factory.videoQueue;
    if (!items || items.length === 0) {
        container.innerHTML = '<p class="info-text">No video prompts.</p>';
        return;
    }

    container.innerHTML = items.map((item, idx) => {
        const statusIcon = getVideoStatusIcon(item.status);
        const isEditing = item.editMode;
        const isCompleted = item.status === 'completed';
        const isFailed = item.status === 'failed';

        // 썸네일 우선, 없으면 원본 base64 사용
        const imgSrc = item.thumbnail || item.imageBase64 || '';
        const charCode = item.characters
            ? `<span class="prompt-char-code">${item.characters}</span>`
            : '<span class="prompt-char-code none">BG</span>';
        return `
        <div class="video-prompt-item ${item.status}" data-index="${idx}">
            <span class="video-prompt-number">${item.number}</span>
            ${charCode}
            <div class="video-prompt-thumbnail">
                ${imgSrc ? `<img src="${imgSrc}" alt="thumb">` : '<span class="no-thumb">No Image</span>'}
            </div>
            <div class="video-prompt-content">
                ${isEditing
                ? `<textarea class="video-prompt-edit" data-index="${idx}">${item.prompt}</textarea>`
                : `<span class="video-prompt-text">${item.prompt}</span>`
            }
            </div>
            <div class="video-prompt-actions">
                ${isEditing
                ? `<button class="btn-action btn-save" data-index="${idx}" title="Save">💾</button>`
                : `<button class="btn-action btn-edit" data-index="${idx}" title="Edit">✏️</button>`
            }
                ${(isCompleted || isFailed) ? `<button class="btn-action btn-regen" data-index="${idx}" title="Regenerate">🔄</button>` : ''}
            </div>
            <div class="video-prompt-status ${item.status}">${statusIcon}</div>
        </div>`;
    }).join('');

    // 이벤트 바인딩
    container.querySelectorAll('.btn-edit').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const idx = parseInt(e.target.dataset.index);
            APP.factory.videoQueue[idx].editMode = true;
            renderVideoPromptList();
        });
    });

    container.querySelectorAll('.btn-save').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const idx = parseInt(e.target.dataset.index);
            const textarea = container.querySelector(`textarea[data-index="${idx}"]`);
            if (textarea) {
                APP.factory.videoQueue[idx].prompt = textarea.value;
                APP.factory.videoQueue[idx].editMode = false;
                renderVideoPromptList();
                updateGeneratedVideoPromptsText();  // ★ 생성된 동영상프롬프트 박스 동기화
                showToast("Saved", 'success');
            }
        });
    });

    // ★ 개별 재생성 버튼 이벤트
    container.querySelectorAll('.btn-regen').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const idx = parseInt(e.target.dataset.index);
            regenerateSingleVideo(idx);
        });
    });

    // ★ 현재 생성 중인 항목으로 자동 스크롤 (박스 내부 스크롤)
    // 부모 컨테이너 스크롤(300ms) 완료 후 실행되도록 충분한 딜레이 적용
    setTimeout(() => {
        const generatingItem = container.querySelector('.video-prompt-item.generating');
        if (generatingItem) {
            // 컨테이너 내부에서의 상대적 스크롤 위치 계산
            const containerRect = container.getBoundingClientRect();
            const itemRect = generatingItem.getBoundingClientRect();

            // 항목이 컨테이너 뷰포트 밖에 있으면 스크롤
            if (itemRect.top < containerRect.top || itemRect.bottom > containerRect.bottom) {
                const scrollTop = generatingItem.offsetTop - container.offsetTop - (container.clientHeight / 2) + (generatingItem.clientHeight / 2);
                container.scrollTo({ top: Math.max(0, scrollTop), behavior: 'smooth' });
            }
        }
    }, 600);  // ★ 부모 스크롤(300ms) + 애니메이션(300ms) 완료 후 실행
}

/**
 * 동영상 상태 아이콘 반환 (imageToVideo 모드와 동일한 스타일)
 */
function getVideoStatusIcon(status) {
    // ★ imageToVideo와 동일한 스피너/아이콘 스타일 사용
    switch (status) {
        case 'pending': return '<span class="queue-status-icon pending">⏸</span>';
        case 'generating': return '<span class="queue-status-icon generating"><span class="queue-spinner"></span></span>';
        case 'completed': return '<span class="queue-status-icon success">✅</span>';
        case 'failed': return '<span class="queue-status-icon error">❌</span>';
        case 'skipped': return '<span class="queue-status-icon skipped">⏭️</span>';  // ★ 이미지 없어서 스킵
        default: return '<span class="queue-status-icon pending">⏸</span>';
    }
}

/**
 * ★ 개별 동영상 항목 상태만 업데이트 (전체 다시 그리지 않음 - 스크롤 유지)
 */
function updateVideoItemStatus(idx, status) {
    const container = $('#factoryVideoList');
    if (!container) return;

    const item = container.querySelector(`.video-prompt-item[data-index="${idx}"]`);
    if (!item) return;

    // 클래스 업데이트
    item.classList.remove('pending', 'generating', 'completed', 'failed');
    item.classList.add(status);

    // 상태 아이콘 업데이트
    const statusDiv = item.querySelector('.video-prompt-status');
    if (statusDiv) {
        statusDiv.className = `video-prompt-status ${status}`;
        statusDiv.innerHTML = getVideoStatusIcon(status);
    }

}

/**
 * ★ 특정 동영상 항목으로 스크롤 (스무스)
 */
function scrollToVideoItem(idx) {
    const container = $('#factoryVideoList');
    if (!container) return;

    const item = container.querySelector(`.video-prompt-item[data-index="${idx}"]`);
    if (!item) return;

    // 컨테이너 내부에서의 상대적 스크롤 위치 계산
    const containerRect = container.getBoundingClientRect();
    const itemRect = item.getBoundingClientRect();

    // 항목이 컨테이너 뷰포트 밖에 있으면 스크롤
    if (itemRect.top < containerRect.top || itemRect.bottom > containerRect.bottom) {
        const scrollTop = item.offsetTop - container.offsetTop - (containerRect.height / 2) + (itemRect.height / 2);
        container.scrollTo({
            top: Math.max(0, scrollTop),
            behavior: 'smooth'
        });
    }
}

/**
 * 동영상 생성 시작 (FACTORY 모드) - 완전 독립 코드
 * ★ 기존 imageToVideo 모드와 분리된 독립적인 로직
 */
async function startVideoGeneration() {
    // ★★★ 중복 실행 방지: 이미 실행 중이면 무시
    if (APP.factory.videoRunning) {
        return;
    }

    const queue = APP.factory.videoQueue;
    if (!queue || queue.length === 0) {
        showToast("No videos to generate. Solution: Click 'Generate video prompts' first, then 'Start video generation'.", 'error');
        return;
    }

    // ★★★ 핵심 수정: pending 항목만 처리 (failed 항목은 "실패 재생성" 버튼으로만 처리)
    // 이렇게 하면 "중지" 후 "재개" 시 같은 항목이 무한 반복되지 않음
    const pendingItems = queue.filter(item => item.status === 'pending');
    if (pendingItems.length === 0) {
        // failed 항목만 있는 경우 안내 메시지
        const failedCount = queue.filter(item => item.status === 'failed').length;
        if (failedCount > 0) {
            showToast("No pending items. Use 'Retry Failed' for failed items ({count})".replace('{count}', failedCount), 'info');
        } else {
            showToast("No videos to generate. Solution: Click 'Generate video prompts' first, then 'Start video generation'.", 'error');
        }
        return;
    }

    // ★ 이미지 없는 항목은 자동으로 failed 처리하고 스킵
    const missingImageItems = pendingItems.filter(item => !item.imageBase64 || item.imageBase64.length < 100);
    if (missingImageItems.length > 0) {
        const missingNums = missingImageItems.map(item => item.number).join(', ');

        // ★ 이미지 없는 항목을 'skipped' 상태로 변경 (generating 루프 방지)
        missingImageItems.forEach(item => {
            item.status = 'skipped';
            item.error = 'No image data';
        });

        renderVideoPromptList();
        showToast("{count} items without image → skipped ({nums})".replace('{count}', missingImageItems.length).replace('{nums}', missingNums), 'warning');
    }

    // ★ 이미지 있는 항목만 필터링해서 처리
    const validPendingItems = pendingItems.filter(item => item.imageBase64 && item.imageBase64.length >= 100);
    if (validPendingItems.length === 0) {
        showToast("No videos to generate. Solution: Click 'Generate video prompts' first, then 'Start video generation'.", 'error');
        return;
    }

    // Flow 탭 확인 및 첫 화면으로 이동
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url?.includes('flow.google.com')) {
        showToast("Flow page (flow.google.com) required. Please open flow.google.com in a new tab.", 'error');
        return;
    }
    const navigated = await navigateToFlowHomeAndWait(tab);
    if (!navigated) {
        showToast("Content Script injection failed. Please refresh the Flow page (flow.google.com).", 'error');
        return;
    }
    let updatedTab = await chrome.tabs.get(tab.id);
    const loaded = await ensureContentScriptLoaded(updatedTab);
    if (!loaded) {
        showToast("Content Script injection failed. Please refresh the Flow page (flow.google.com).", 'error');
        return;
    }
    updatedTab = await chrome.tabs.get(tab.id);

    // ★ Factory 비디오 전용 상태 설정 (APP.mode, APP.queue 변경 안 함!)
    APP.factory.isVideoPhase = true;
    APP.factory.videoRunning = true;
    APP.factory.videoPaused = false;
    APP.flowUi = APP.flowUi || {};
    APP.flowUi.lastProgressSeq = -1;  // phase 기반 progress 수신 허용 (이미지 phase seq와 충돌 방지)

    // ★ 이미지 생성 시 사용한 projectName 재사용 (같은 폴더에 저장)
    const projectName = APP.factory.projectName || $('#controlProjectName')?.value?.trim() || 'my_project';

    // ★ 다운로드 폴더 설정 (이미지와 동일한 폴더)
    chrome.runtime.sendMessage({
        type: 'SETUP_DOWNLOAD',
        folder: APP.settings.downloadFolder || 'AI4Next',
        subfolder: projectName
    });

    // UI 업데이트
    $('#btn-start-video-generation')?.classList.add('hidden');
    $('#factoryVideoCompletion')?.classList.add('hidden');
    $('#factoryVideoActions')?.classList.add('hidden');

    // ★ Factory 전용 컨트롤 버튼 표시 (일시정지/새프로젝트)
    $('#factoryControlButtons')?.classList.remove('hidden');
    const pauseBtn = $('#btn-factory-pause');
    if (pauseBtn) {
        pauseBtn.textContent = "⏸ PAUSE";
        pauseBtn.classList.remove('btn-primary');
        pauseBtn.classList.add('btn-secondary');
        pauseBtn.disabled = false;
    }

    // ★ Factory 전용 프로그레스바 표시 및 초기화
    const progressContainer = $('#factoryVideoProgress');
    if (progressContainer) {
        progressContainer.classList.remove('hidden');
        progressContainer.style.display = 'block';  // ★ 강제 표시
    } else {
    }

    // ★ 동영상 생성 진행 상황으로 스크롤
    setTimeout(() => {
        $('#factoryVideoProgress')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 300);

    // ★ Factory 비디오 재생성 버튼 숨김
    $('#btn-retry-failed-videos')?.classList.add('hidden');

    // ★ 첫 번째 유효 항목만 'generating'으로 (순차 실행)
    validPendingItems[0].status = 'generating';
    renderVideoPromptList();
    updateVideoProgressBar();  // 큐 기반 (단일소스)

    // payload 생성 (imageToVideo 형식) - ★ 이미지 있는 항목만
    const payloads = validPendingItems.map((item, idx) => ({
        promptIndex: idx,
        prompt: item.prompt || APP.settings.defaultVideoPrompt || 'Dynamic action, Active camera angle',
        number: item.number,
        characters: item.characters || '',      // ★ 캐릭터 코드 (파일명용)
        scriptText: item.scriptText || '',      // ★ 대본 텍스트 (파일명용)
        mode: 'imageToVideo',
        aspectRatio: APP.settings.aspectRatio || '16:9',
        images: [{
            base64: item.imageBase64,
            name: item.originalFilename || `factory_${item.number}.png`
        }],
        originalFilename: item.originalFilename || '',
        hasLazyImage: false
    }));

    const settings = {
        mode: 'imageToVideo',
        ...APP.settings,
        projectName,
        isFactoryVideoPhase: true
    };

    // ★ Factory 비디오 전용 프로그레스 핸들러
    const totalCount = validPendingItems.length;  // ★ 이미지 있는 항목만 카운트
    let completedCount = 0;
    // queue는 이미 함수 상단에서 선언됨 (4591번 줄)

    // ★★★ 이전 핸들러가 있으면 제거 (중복 등록 방지)
    if (APP.factory._videoProgressHandler) {
        chrome.runtime.onMessage.removeListener(APP.factory._videoProgressHandler);
    }

    const factoryVideoProgressHandler = (message) => {
        // ★★★ 핸들러 호출 확인 로그

        if (message.type === 'GENERATION_PROGRESS') {
            const data = message.data || {};
            const { promptIndex, status, displayNum, phase } = data;

            // ★ runVideoPipeline 포맷(phase 기반): handleProgress가 처리. 본 핸들러는 status 기반만 처리
            if (phase && (phase === 'submitting' || phase === 'chunk-downloading') && status == null) {
                return;  // handleProgress에 위임
            }

            // ★ displayNum 정규화: "1" → "01", "02" → "02", 1 → "01"
            let normalizedDisplayNum;
            if (typeof displayNum === 'number') {
                normalizedDisplayNum = String(displayNum).padStart(2, '0');
            } else if (typeof displayNum === 'string') {
                const numPart = parseInt(displayNum, 10);
                normalizedDisplayNum = isNaN(numPart) ? displayNum : String(numPart).padStart(2, '0');
            } else {
                // ★ displayNum이 없을 때: validPendingItems의 번호로 fallback
                // promptIndex는 payloads 배열 인덱스이므로, 해당 payload의 number를 찾아야 함
                // 하지만 여기서는 payloads에 접근할 수 없으므로 queue에서 generating인 항목을 찾음
                const generatingItem = queue.find(q => q.status === 'generating');
                if (generatingItem) {
                    normalizedDisplayNum = String(parseInt(generatingItem.number, 10) || 0).padStart(2, '0');
                } else {
                    normalizedDisplayNum = String(promptIndex + 1).padStart(2, '0');
                }
            }

            // ★ 상세 디버그 로그

            // ★ 정규화된 displayNum으로 매칭
            const targetItem = queue.find(item => {
                const normalizedItemNum = String(parseInt(item.number, 10) || 0).padStart(2, '0');
                return normalizedItemNum === normalizedDisplayNum;
            });


            if (targetItem) {
                // ★ 이미 완료/실패된 항목은 중복 카운트 방지
                const wasAlreadyDone = targetItem.status === 'completed' || targetItem.status === 'failed';
                const targetIdx = queue.indexOf(targetItem);

                if (status === 'completed') {
                    targetItem.status = 'completed';
                    if (!wasAlreadyDone) {
                        completedCount++;
                    }
                } else if (status === 'error') {
                    targetItem.status = 'failed';
                    if (!wasAlreadyDone) {
                        completedCount++;
                    }
                } else if (status === 'generating') {
                    // ★★★ 핵심 수정: 이미 완료된 항목은 generating으로 덮어쓰지 않음!
                    if (wasAlreadyDone) {
                        return;  // 이미 완료된 항목은 무시
                    }

                    // ★ 동시 스피너 방지: 먼저 모든 'generating' 항목을 'pending'으로 리셋
                    queue.forEach((item, idx) => {
                        if (item.status === 'generating' && idx !== targetIdx) {
                            item.status = 'pending';
                            // ★ 해당 DOM 요소만 상태 업데이트 (전체 다시 그리지 않음)
                            updateVideoItemStatus(idx, 'pending');
                        }
                    });
                    // 해당 항목만 'generating'으로 설정
                    targetItem.status = 'generating';
                }

                // ★ 큐 기반 progressBar 업데이트 (단일소스)
                updateVideoProgressBar();

                // ★ generating 상태일 때는 해당 항목만 업데이트 (스크롤 유지)
                // completed/error 일 때만 전체 다시 그림 (버튼 추가 등)
                if (status === 'generating') {
                    updateVideoItemStatus(targetIdx, 'generating');
                    scrollToVideoItem(targetIdx);
                } else {
                    renderVideoPromptList();
                    updateVideoProgressBar();
                }
            } else {
            }
        }

        if (message.type === 'GENERATION_COMPLETE') {
            chrome.runtime.onMessage.removeListener(factoryVideoProgressHandler);
            APP.factory._videoProgressHandler = null;  // ★ 참조 제거

            // ★ 일시정지 상태면 완료 UI 표시하지 않음 (한도 초과로 중단된 경우)
            if (APP.factory.videoPaused) {
                // 일시정지 상태 유지 - 재개 버튼만 표시
                APP.factory.videoRunning = false;
                // videoPaused는 true 유지
                // isVideoPhase는 true 유지 (재개 시 필요)
                renderVideoPromptList();
                return;
            }

            // queue 상태 동기화: 이전 성공(completed)은 유지, 재개/재시도 구간만 payload로 반영 (대기열 단일 소스)
            const data = message.data || {};
            const failedSet = new Set(Array.isArray(data.failedPromptIndices) ? data.failedPromptIndices : []);
            const successCount = Number(data.totalSuccess);
            const failCount = Number(data.totalFail);
            const processedCount = Number.isFinite(successCount) && Number.isFinite(failCount)
                ? successCount + failCount
                : totalCount;
            validPendingItems.forEach((item, idx) => {
                if (item.status === 'completed') return;  // 이미 성공한 항목은 절대 덮어쓰지 않음
                if (failedSet.has(idx)) item.status = 'failed';
                else if (idx < processedCount) item.status = 'completed';
                else item.status = 'pending';  // 시도 안 한 항목
            });
            renderVideoPromptList();

            // ★ 큐 기반 progressBar 업데이트 (단일소스)
            updateVideoProgressBar();

            // Factory 비디오 상태 리셋
            APP.factory.videoRunning = false;
            APP.factory.videoPaused = false;
            APP.factory.isVideoPhase = false;
            // ★ 그록팩토리 동일: 완료 후에도 일시정지+새프로젝트 유지
            const factoryPauseBtn = $('#btn-factory-pause');
            if (factoryPauseBtn) factoryPauseBtn.disabled = true;
            $('#factoryVideoProgress')?.classList.add('hidden');  // 프로그레스바 숨김

            showVideoCompletion();  // 큐 기반으로 내부에서 getVideoQueueStats() 사용

            if (APP.factory.isAutoMode && successCount > 0) {
            }
        }
    };

    // ★★★ 핸들러를 APP에 저장하고 등록
    APP.factory._videoProgressHandler = factoryVideoProgressHandler;
    chrome.runtime.onMessage.addListener(factoryVideoProgressHandler);

    // ★ START_GENERATION 메시지 전송

    chrome.tabs.sendMessage(updatedTab.id, {
        type: 'START_GENERATION',
        payloads,
        settings
    }, (response) => {
        if (chrome.runtime.lastError) {
            chrome.runtime.onMessage.removeListener(factoryVideoProgressHandler);
            validPendingItems.forEach(item => { item.status = 'failed'; });
            renderVideoPromptList();
            updateVideoProgressBar();
            showVideoCompletion();
            APP.factory.videoRunning = false;
            APP.factory.isVideoPhase = false;
            const factoryPauseBtn = $('#btn-factory-pause');
            if (factoryPauseBtn) factoryPauseBtn.disabled = true;
        }
    });
}

/**
 * 동영상 생성 완료 UI 표시 (imageToVideo 완료 UI와 동일한 스타일)
 */
function showVideoCompletion() {
    const section = $('#factoryVideoCompletion');
    if (!section) return;

    section.classList.remove('hidden');

    // ★ 완료 시 storage에서 일시정지 상태 제거
    chrome.storage.local.remove(['isPaused', 'pausedMode']);

    // ★ 큐 기반으로 progressBar 덮어쓰기 (메시지 data 무시 → 단일소스)
    updateVideoProgressBar();

    // ★ pending 항목 수 계산 (큐 기반)
    const stats = getVideoQueueStats();
    const { success: queueSuccess, fail: queueFail, total: totalItems } = stats;
    const processedCount = queueSuccess + queueFail;

    // ★ 완료 아이콘 및 타이틀 설정 (imageToVideo와 동일) — 큐 기반
    const iconEl = $('#factoryVideoCompletionIcon');
    const titleEl = $('#factoryVideoCompletionTitle');

    if (iconEl && titleEl) {
        // ★ processedCount가 totalItems 이상이면 최종 결과로 판단 (큐 기반)
        const isFullyProcessed = processedCount >= totalItems;
        if (isFullyProcessed && queueSuccess > 0 && queueFail === 0) {
            iconEl.textContent = '✅';
            titleEl.textContent = "ALL VIDEOS GENERATED!";
        } else if (isFullyProcessed && queueSuccess === 0) {
            iconEl.textContent = '❌';
            titleEl.textContent = "GENERATION FAILED";
        } else if (isFullyProcessed && queueSuccess > 0 && queueFail > 0) {
            iconEl.textContent = '⚠️';
            titleEl.textContent = "PARTIALLY COMPLETED";
        } else {
            iconEl.textContent = '⚠️';
            titleEl.textContent = "PARTIALLY COMPLETED";
        }
    }

    // 통계 표시 (큐 기반)
    const statsEl = $('#factoryVideoCompletionStats');
    if (statsEl) {
        statsEl.innerHTML = `<span class="stat-success">${queueSuccess}</span> ${"SUCCESS"} / <span class="stat-fail">${queueFail}</span> ${"FAILED"}`;
    }

    // 실패 재생성 버튼 표시/숨김 (큐 기반)
    const retryBtn = $('#btn-retry-failed-videos');
    const failedCountEl = $('#failedVideoCount');
    if (retryBtn && failedCountEl) {
        if (queueFail > 0) {
            retryBtn.classList.remove('hidden');
            failedCountEl.textContent = queueFail;
        } else {
            retryBtn.classList.add('hidden');
        }
    }

    // 시작 버튼 숨김 (완료 상태에서는 재생성 또는 새 프로젝트만 가능)
    $('#btn-start-video-generation')?.classList.add('hidden');

    // 프로그레스 섹션 숨김
    $('#section-progress')?.classList.add('hidden');

    // ★ 완료 섹션으로 자동 스크롤
    setTimeout(() => {
        $('#factoryVideoCompletion')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 100);

    // 토스트 메시지 (큐 기반)
    showToast(`${"DONE!"} ${queueSuccess}/${queueSuccess + queueFail}`);

    APP.factory.videoGenerationComplete = true;
    APP.factory.isProcessing = false;  // ★ Factory 프로세스 완료 (모드 전환 허용)
}

/**
 * Factory: 전체 이미지 재생성 (이미지 완료 후)
 */
function factoryRegenAllImages() {
    const sceneItems = APP.queue.filter(q => q.type !== 'characterRef');
    if (!sceneItems.length) {
        showToast("No items to process. Solution: Enter a script/prompt or upload images, then click 'Start generation' or 'Start video'.", 'error');
        return;
    }

    // ★ 모든 항목 상태 리셋
    sceneItems.forEach(item => {
        item.status = 'ready';
    });

    // ★ 프로그레스바 명시적 리셋
    if ($('#progressFill')) $('#progressFill').style.width = '0%';
    if ($('#progressText')) $('#progressText').textContent = `0 / ${sceneItems.length}`;
    if ($('#progressLog')) $('#progressLog').innerHTML = '';

    showQueue();
    APP.factory.isAutoMode = false;
    APP.factory.isFullAuto = false;    // ★ 재생성은 수동이므로 FULL AUTO 해제
    APP.factory.isVideoAuto = false;   // ★ 재생성은 수동이므로 VIDEO AUTO 해제
    startGeneration(true);
}

/**
 * Factory: 전체 동영상 재생성 (동영상 완료 후)
 */
function factoryRegenAllVideos() {
    const queue = APP.factory.videoQueue;
    if (!queue || queue.length === 0) {
        showToast("No videos to generate. Solution: Click 'Generate video prompts' first, then 'Start video generation'.", 'error');
        return;
    }
    // ★ 이미지 있는 항목만 pending으로 (skipped 항목은 제외)
    queue.forEach(item => {
        if (item.imageBase64 && item.imageBase64.length >= 100) {
            item.status = 'pending';
        }
    });
    renderVideoPromptList();
    updateVideoProgressBar();
    startVideoGeneration();
}

/**
 * 실패한 동영상 재생성
 */
async function retryFailedVideos() {
    const queue = APP.factory.videoQueue;
    const failedItems = queue.filter(item => item.status === 'failed');

    if (failedItems.length === 0) {
        showToast("No failed videos to regenerate. Solution: Run video generation first; then you can retry failed items only.", 'error');
        return;
    }

    // ★ 실패 항목 중 이미지 있는 것만 pending으로 변경
    failedItems.forEach(item => {
        if (item.imageBase64 && item.imageBase64.length >= 100) {
            item.status = 'pending';
        } else {
            item.status = 'skipped';  // 이미지 없으면 스킵
        }
    });

    renderVideoPromptList();
    updateVideoProgressBar();

    // 재생성 시작
    await startVideoGeneration();
}

/**
 * 개별 동영상 재생성 (완료/실패 항목 모두 가능)
 * ★ 같은 폴더에 같은 파일명으로 저장 → OS가 자동으로 (1), (2) 붙임
 */
async function regenerateSingleVideo(idx) {
    const queue = APP.factory.videoQueue;
    const item = queue[idx];

    if (!item) {
        showToast("Item not found. Solution: Start a new project or refresh the list and try again.", 'error');
        return;
    }

    if (!item.imageBase64 || item.imageBase64.length < 100) {
        showToast("Cannot regenerate without image. Solution: Generate the image for this item first, then retry.", 'error');
        return;
    }

    // Flow 탭 확인
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url?.includes('flow.google.com')) {
        showToast("Flow page (flow.google.com) required. Please open flow.google.com in a new tab.", 'error');
        return;
    }

    // 해당 항목만 pending으로 변경
    item.status = 'pending';
    renderVideoPromptList();
    updateVideoProgressBar();

    // ★ Factory 비디오 전용 상태 설정
    APP.factory.isVideoPhase = true;
    APP.factory.videoRunning = true;
    APP.factory.videoPaused = false;

    // ★ 이미지 생성 시 사용한 projectName 재사용 (같은 폴더에 저장)
    const projectName = APP.factory.projectName || $('#controlProjectName')?.value?.trim() || 'my_project';

    // 다운로드 폴더 설정 (이미지와 동일한 폴더)
    chrome.runtime.sendMessage({
        type: 'SETUP_DOWNLOAD',
        folder: APP.settings.downloadFolder || 'AI4Next',
        subfolder: projectName
    });

    // UI 업데이트
    $('#factoryVideoCompletion')?.classList.add('hidden');

    // ★ Factory 전용 프로그레스바 표시 및 초기화 (큐 기반)
    $('#factoryVideoProgress')?.classList.remove('hidden');
    updateVideoProgressBar();

    // 해당 항목만 generating으로
    item.status = 'generating';
    renderVideoPromptList();

    // payload 생성 (1개만) - ★ characters, scriptText 포함 (파일명 동기화)
    const payload = {
        promptIndex: 0,
        prompt: item.prompt || APP.settings.defaultVideoPrompt || 'Dynamic action, Active camera angle',
        number: item.number,
        characters: item.characters || '',      // ★ 캐릭터 코드 (파일명용)
        scriptText: item.scriptText || '',      // ★ 대본 텍스트 (파일명용)
        mode: 'imageToVideo',
        aspectRatio: APP.settings.aspectRatio || '16:9',
        images: [{
            base64: item.imageBase64,
            name: item.originalFilename || `factory_${item.number}.png`
        }],
        originalFilename: item.originalFilename || '',
        hasLazyImage: false
    };

    const settings = {
        mode: 'imageToVideo',
        ...APP.settings,
        projectName,
        isFactoryVideoPhase: true
    };

    // 개별 재생성 전용 프로그레스 핸들러
    const singleRegenHandler = (message) => {
        if (message.type === 'GENERATION_PROGRESS') {
            const { status, displayNum } = message.data || {};

            if (displayNum === item.number) {
                if (status === 'completed') {
                    item.status = 'completed';
                } else if (status === 'error') {
                    item.status = 'failed';
                } else if (status === 'generating') {
                    item.status = 'generating';
                }
                renderVideoPromptList();
                updateVideoProgressBar();
            }
        }

        if (message.type === 'GENERATION_COMPLETE') {
            chrome.runtime.onMessage.removeListener(singleRegenHandler);

            // Factory 비디오 상태 리셋
            APP.factory.videoRunning = false;
            APP.factory.videoPaused = false;
            APP.factory.isVideoPhase = false;

            // ★ Factory 전용 프로그레스 섹션 숨김
            $('#factoryVideoProgress')?.classList.add('hidden');

            // 완료 메시지
            if (item.status === 'completed') {
                const successMsg = "#{num} regeneration complete!".replace('{num}', item.number);
                showToast(successMsg, 'success');
            } else {
                const failMsg = "#{num} regeneration failed. Solution: Wait a moment, then click Regenerate again.".replace('{num}', item.number);
                showToast(failMsg, 'error');
            }

            renderVideoPromptList();
            updateVideoProgressBar();
        }
    };
    chrome.runtime.onMessage.addListener(singleRegenHandler);

    // START_GENERATION 메시지 전송 (1개만)

    chrome.tabs.sendMessage(tab.id, {
        type: 'START_GENERATION',
        payloads: [payload],
        settings
    }, (response) => {
        if (chrome.runtime.lastError) {
            chrome.runtime.onMessage.removeListener(singleRegenHandler);
            item.status = 'failed';
            renderVideoPromptList();
            updateVideoProgressBar();
            showToast("Regeneration failed. Solution: Wait a moment and try again.", 'error');
            APP.factory.videoRunning = false;
            APP.factory.isVideoPhase = false;
            $('#section-progress')?.classList.add('hidden');
        }
    });
}

/**
 * sleep 유틸리티
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * FACTORY 모드 이미지 생성 완료 후 호출되는 콜백
 * 기존 완료 로직에 hook으로 추가
 */
async function onFactoryImageGenerationComplete() {
    if (APP.mode !== 'factory') return;

    APP.factory.imageGenerationComplete = true;

    // 배치1 이미지 저장 (첫 번째 배치에서 생성된 이미지들)
    // 큐에서 성공한 이미지들의 base64 및 filename 추출
    // ★ status는 'done'으로 매핑됨 (completed → done)
    const successItems = APP.queue.filter(item =>
        item.type !== 'characterRef' && item.status === 'done' && item.imageBase64
    );

    if (successItems.length > 0) {
        // 배치1만 저장 (최대 25개)
        const batch1Items = successItems.slice(0, 25);
        const batch1Prompts = APP.prompts.slice(0, batch1Items.length);
        const batch1Images = batch1Items.map(item => item.imageBase64);

        // filename도 함께 저장 (동영상 파일명 동기화용)
        APP.factory.batch1Filenames = batch1Items.map(item => item.imageFilename || '');

        await saveBatch1Images(batch1Prompts, batch1Images);
    } else {
        APP.queue.filter(item => item.type !== 'characterRef').forEach((item, idx) => {
        });
    }

    // 동영상 섹션 표시
    $('#section-factory-video')?.classList.remove('hidden');

    // ★ 동영상 섹션으로 자동 스크롤
    setTimeout(() => {
        $('#section-factory-video')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);


    // AUTO 모드면 자동으로 동영상 프롬프트 생성 시작
    // 수동 모드면 "동영상 프롬프트 생성" 버튼 표시 (사용자 클릭 대기)
    if (APP.factory.isAutoMode) {
        // ★ UI가 먼저 렌더링된 후 자동 진행 (버튼 클릭 시뮬레이션)
        setTimeout(() => {
            $('#btn-generate-video-prompts')?.click();
        }, 1000);  // 1초 딜레이로 UI 확인 가능
    } else {
    }
}
