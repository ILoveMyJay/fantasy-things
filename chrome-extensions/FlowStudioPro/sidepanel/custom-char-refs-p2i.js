if(typeof console!=="undefined"){console.log=function(){};console.warn=function(){};console.error=function(){};}
// ============================================================
// CUSTOM CHARACTER REFERENCES — P2I (프롬프트→이미지 모드 전용)
// ============================================================
// ★ v1.6: custom-char-refs.js 의 완전 독립 복사본
//   - 함수: *P2I 접미사 / DOM id: _p2i 접미사 / APP 필드: p2i* 접두사
//   - 6 슬롯 (MCR, SC1~SC5): 이미지 업로드 + 프롬프트 + 이름
//   - 드래그앤드롭 + 파일 클릭
//   - 브랜드 프로필 저장/불러오기/삭제 (★ APP.brandProfiles 공유)
//   - ★ P2I 전용 파싱: 사용자 프롬프트에서 캐릭터 코드/이름 감지 → 해당 이미지 자동 첨부
//   - ★ 브랜드 저장 시 이미지 슬롯에 이름 필수 검증
// Depends on: APP (global), $, showToast, chrome.storage.local, CCR_CODES (window global)
// ============================================================

(function () {
    'use strict';

    // ★ CCR_CODES 는 custom-char-refs.js 가 window에 노출한 공용 상수를 사용
    //   (중복 정의 방지 — 같은 스코프에서 const 재선언 불가)
    const CCR_CODES_P2I = (typeof window !== 'undefined' && Array.isArray(window.CCR_CODES))
        ? window.CCR_CODES
        : ['MCR', 'SC1', 'SC2', 'SC3', 'SC4', 'SC5'];
    const MAX_BRAND_PROFILES_P2I = 20;
    const MAX_IMAGE_BYTES_P2I = 8 * 1024 * 1024; // 8MB per image

    // i18n 안전 래퍼
    const ccrLabelP2I = (code) => ({ MCR: 'Main', SC1: 'Sub 1', SC2: 'Sub 2', SC3: 'Sub 3', SC4: 'Sub 4', SC5: 'Sub 5' }[code] || code);

    // --- Core Init (called from initMainApp) ---
    async function initCustomCharRefsP2I() {
        try {
            // ★ P2I: storage 키 분리 (p2iCustomCharRefs, p2iUseCustomCharRefs) + 공유 키 (brandProfiles)
            const stored = await chrome.storage.local.get(['p2iCustomCharRefs', 'p2iUseCustomCharRefs', 'brandProfiles']);
            if (!APP.p2iCustomCharRefs) {
                APP.p2iCustomCharRefs = { MCR: null, SC1: null, SC2: null, SC3: null, SC4: null, SC5: null };
            }
            if (stored.p2iCustomCharRefs && typeof stored.p2iCustomCharRefs === 'object') {
                CCR_CODES_P2I.forEach(code => {
                    APP.p2iCustomCharRefs[code] = stored.p2iCustomCharRefs[code] || null;
                });
            }
            APP.p2iUseCustomCharRefs = stored.p2iUseCustomCharRefs !== false;
            // ★ brandProfiles 는 대본 모드와 공유 — 이미 initCustomCharRefs 에서 로드되었을 수 있음
            //   재로드 시 덮어쓰지 않도록 기존 값 유지
            if (Array.isArray(stored.brandProfiles) && !Array.isArray(APP.brandProfiles)) {
                APP.brandProfiles = stored.brandProfiles;
            } else if (!Array.isArray(APP.brandProfiles)) {
                APP.brandProfiles = Array.isArray(stored.brandProfiles) ? stored.brandProfiles : [];
            }
        } catch (e) {
            console.log('[CCR-P2I] storage load failed', e);
        }

        renderCustomRefGridP2I();
        bindCustomCharRefEventsP2I();
        initCustomCharRefsCheckboxP2I();
        initClearAllCustomRefsBtnP2I();
        initSaveBrandBtnP2I();
        initLoadBrandBtnP2I();

        // ★ v1.1.2: 초기 로드 — 슬롯 데이터 동기화 (Factory 마스터) + 토글 OFF
        // ★ v1.1.3 fix: 재렌더 후 핸들러 재바인딩 필수 — innerHTML이 기존 DOM 파괴해서 dragover 등 모든 핸들러 소실됨
        //   누락 시: SC3~SC5 등 빈 슬롯의 드래그앤드롭 동작 안 함 (Factory 마스터 모드에서)
        const _fHas = CCR_CODES_P2I.some(c => APP.customCharRefs?.[c]?.image);
        const _pHas = CCR_CODES_P2I.some(c => APP.p2iCustomCharRefs?.[c]?.image);
        if (_fHas) {
            CCR_CODES_P2I.forEach(c => { APP.p2iCustomCharRefs[c] = APP.customCharRefs?.[c] || null; });
            renderCustomRefGridP2I();
            bindCustomCharRefEventsP2I();  // ← 누락되어 있던 재바인딩
        } else if (_pHas) {
            CCR_CODES_P2I.forEach(c => { if (!APP.customCharRefs) APP.customCharRefs = {}; APP.customCharRefs[c] = APP.p2iCustomCharRefs?.[c] || null; });
            if (typeof renderCustomRefGrid === 'function') renderCustomRefGrid();
            if (typeof bindCustomCharRefEvents === 'function') bindCustomCharRefEvents();  // ← Factory도 동일하게 재바인딩
        }
        // Keep the simplified Prompt→Image reference workflow enabled by default.
        APP.useCustomCharRefs = false;
        APP.characterRefAssets = null;
        chrome.storage.local.remove('characterRefAssets').catch(() => {});
        const _factoryCb = document.getElementById('useCustomCharRefsCheckbox');
        if (_factoryCb) _factoryCb.checked = false;
        const _factorySection = document.getElementById('customCharRefsSection');
        if (_factorySection) _factorySection.classList.add('hidden');

        // ★ 체크박스 상태 복원 + 섹션 열림/닫힘 반영
        const checkbox = $('#useCustomCharRefsCheckbox_p2i');
        if (checkbox) checkbox.checked = APP.p2iUseCustomCharRefs;
        toggleCustomCharRefsSectionP2I(APP.p2iUseCustomCharRefs);
    }

    function toggleCustomCharRefsSectionP2I(open) {
        const section = $('#customCharRefsSection_p2i');
        if (!section) return;
        if (open) {
            section.classList.remove('hidden');
        } else {
            section.classList.add('hidden');
        }
    }

    // --- Grid Render ---
    function renderCustomRefGridP2I() {
        const grid = $('#customRefGrid_p2i');
        if (!grid) return;
        grid.innerHTML = CCR_CODES_P2I.map(code => {
            const slot = APP.p2iCustomCharRefs ? APP.p2iCustomCharRefs[code] : null;
            const hasImage = !!(slot && slot.image);
            const hasContent = hasImage || !!(slot && slot.prompt);
            return (
                '<div class="custom-ref-slot ' + (hasContent ? 'has-content' : '') + '" data-code="' + code + '">' +
                '  <div class="slot-header">' +
                '    <span class="slot-code">Ref ' + (CCR_CODES_P2I.indexOf(code) + 1) + '</span>' +
                '    <small>Image</small>' +
                '  </div>' +
                '  <div class="slot-dropzone" data-code="' + code + '" role="button" tabindex="0" aria-label="' + escapeHtmlP2I('Upload reference image for ' + code) + '">' +
                '    <input type="file" accept="image/*" hidden class="slot-file-input">' +
                '    <div class="slot-empty" ' + (hasImage ? 'style="display:none"' : '') + '>' + escapeHtmlP2I('Drop or click') + '</div>' +
                '    <img class="slot-preview ' + (hasImage ? '' : 'hidden') + '" src="' + (hasImage ? slot.image : '') + '" alt="' + escapeHtmlP2I(code + ' reference image') + '">' +
                '    <button type="button" class="slot-remove ' + (hasImage ? '' : 'hidden') + '" data-code="' + code + '" aria-label="' + escapeHtmlP2I('Remove reference image for ' + code) + '">×</button>' +
                '  </div>' +
                '  <textarea class="slot-prompt hidden" data-code="' + code + '" placeholder="' + escapeHtmlP2I('Optional note for this reference') + '">' + escapeHtmlP2I((slot && slot.prompt) || '') + '</textarea>' +
                '  <input type="text" class="slot-name hidden" data-code="' + code + '" placeholder="' + escapeHtmlP2I('Name/code to match in prompts') + '" value="' + escapeHtmlP2I((slot && slot.name) || '') + '" maxlength="32">' +
                '</div>'
            );
        }).join('');
    }

    function bindCustomCharRefEventsP2I() {
        const grid = $('#customRefGrid_p2i');
        if (!grid) return;

        grid.querySelectorAll('.slot-dropzone').forEach(zone => {
            const code = zone.dataset.code;
            const input = zone.querySelector('.slot-file-input');

            zone.addEventListener('click', (e) => {
                if (e.target.classList.contains('slot-remove')) return;
                // ★ 이미 이미지 있으면 클릭으로 다이얼로그 안 열기 (FULL AUTO 중 실수 팝업 방지)
                //   바꾸려면 × 로 제거 후 재업로드
                if (APP.p2iCustomCharRefs[code] && APP.p2iCustomCharRefs[code].image) return;
                input && input.click();
            });
            zone.addEventListener('keydown', (e) => {
                if (e.key !== 'Enter' && e.key !== ' ') return;
                e.preventDefault();
                if (APP.p2iCustomCharRefs[code] && APP.p2iCustomCharRefs[code].image) return;
                input && input.click();
            });

            if (input) {
                input.addEventListener('change', (e) => {
                    const file = e.target.files && e.target.files[0];
                    if (file) handleSlotImageFileP2I(code, file);
                });
            }

            zone.addEventListener('dragover', (e) => {
                e.preventDefault();
                zone.classList.add('dragover');
            });
            zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
            zone.addEventListener('drop', (e) => {
                e.preventDefault();
                zone.classList.remove('dragover');
                const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
                if (file && file.type.startsWith('image/')) handleSlotImageFileP2I(code, file);
            });
        });

        grid.querySelectorAll('.slot-remove').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const code = btn.dataset.code;
                if (APP.p2iCustomCharRefs[code]) {
                    APP.p2iCustomCharRefs[code].image = '';
                    if (!APP.p2iCustomCharRefs[code].prompt && !APP.p2iCustomCharRefs[code].name) {
                        APP.p2iCustomCharRefs[code] = null;
                    }
                    persistCustomCharRefsP2I();
                    renderCustomRefGridP2I();
                    bindCustomCharRefEventsP2I();
                }
            });
        });

        grid.querySelectorAll('.slot-prompt').forEach(ta => {
            ta.addEventListener('input', debounceSlotSaveP2I(ta.dataset.code));
        });
        grid.querySelectorAll('.slot-name').forEach(inp => {
            inp.addEventListener('input', debounceSlotSaveP2I(inp.dataset.code));
        });
    }

    const _slotSaveTimersP2I = {};
    function debounceSlotSaveP2I(code) {
        return function () {
            clearTimeout(_slotSaveTimersP2I[code]);
            _slotSaveTimersP2I[code] = setTimeout(() => {
                const slotEl = $('#customRefGrid_p2i .custom-ref-slot[data-code="' + code + '"]');
                if (!slotEl) return;
                const promptEl = slotEl.querySelector('.slot-prompt');
                const nameEl = slotEl.querySelector('.slot-name');
                const prompt = (promptEl && promptEl.value || '').trim();
                const name = (nameEl && nameEl.value || '').trim();
                const image = (APP.p2iCustomCharRefs[code] && APP.p2iCustomCharRefs[code].image) || '';

                if (!prompt && !name && !image) {
                    APP.p2iCustomCharRefs[code] = null;
                } else {
                    APP.p2iCustomCharRefs[code] = { image: image, prompt: prompt, name: name };
                }
                persistCustomCharRefsP2I();
                slotEl.classList.toggle('has-content', !!(image || prompt));
            }, 400);
        };
    }

    function handleSlotImageFileP2I(code, file) {
        if (!file) return;
        if (!file.type.startsWith('image/')) {
            showToast("仅支持上传图片文件", 'error');
            return;
        }
        if (file.size > MAX_IMAGE_BYTES_P2I) {
            const mb = Math.floor(MAX_IMAGE_BYTES_P2I / 1024 / 1024);
            showToast("图片体积过大（最大支持 {mb}MB）".replace('{mb}', mb), 'error');
            return;
        }
        const reader = new FileReader();
        reader.onload = (e) => {
            const base64 = e.target.result;
            const existing = APP.p2iCustomCharRefs[code] || {};
            APP.p2iCustomCharRefs[code] = {
                image: base64,
                prompt: existing.prompt || '',
                name: existing.name || ''
            };
            persistCustomCharRefsP2I();
            renderCustomRefGridP2I();
            bindCustomCharRefEventsP2I();
        };
        reader.onerror = () => showToast("图片读取失败", 'error');
        reader.readAsDataURL(file);
    }

    function persistCustomCharRefsP2I() {
        chrome.storage.local.set({
            p2iCustomCharRefs: APP.p2iCustomCharRefs,
            p2iUseCustomCharRefs: APP.p2iUseCustomCharRefs,
            // ★ v1.1.2: 슬롯 데이터 전 모드 공유 — Factory도 동일 데이터 유지
            customCharRefs: APP.p2iCustomCharRefs,
            useCustomCharRefs: APP.p2iUseCustomCharRefs
        }).catch(() => {});
        APP.customCharRefs = APP.p2iCustomCharRefs;
        APP.useCustomCharRefs = APP.p2iUseCustomCharRefs;
        // ★ v1.1.3 fix: 재렌더 후 핸들러 재바인딩 필수 (innerHTML이 DOM 파괴 → 핸들러 소실)
        if (typeof renderCustomRefGrid === 'function') renderCustomRefGrid();
        if (typeof bindCustomCharRefEvents === 'function') bindCustomCharRefEvents();
        // ★ 슬롯 상태 변화 → 큐 뱃지 자동 재계산
        if (typeof window.refreshP2IQueueBadges === 'function') window.refreshP2IQueueBadges();
    }

    // --- Master Checkbox ---
    function initCustomCharRefsCheckboxP2I() {
        const checkbox = $('#useCustomCharRefsCheckbox_p2i');
        if (!checkbox || checkbox._boundP2I) return;
        checkbox._boundP2I = true;
        checkbox.addEventListener('change', () => {
            APP.p2iUseCustomCharRefs = checkbox.checked;
            persistCustomCharRefsP2I();
            toggleCustomCharRefsSectionP2I(APP.p2iUseCustomCharRefs);
            // ★ v1.1.2: CCR 토글 전 모드 동기화 (한곳 ON/OFF → 전체 연동)
            // persistCustomCharRefsP2I()가 이미 Factory 스토리지에도 저장하므로 별도 저장 불필요
            const factoryCb = document.getElementById('useCustomCharRefsCheckbox');
            if (factoryCb) factoryCb.checked = checkbox.checked;
            const factorySection = document.getElementById('customCharRefsSection');
            if (factorySection) { if (checkbox.checked) factorySection.classList.remove('hidden'); else factorySection.classList.add('hidden'); }
            if (!checkbox.checked) {
                // CCR OFF → characterRefAssets 전체 클리어
                APP.characterRefAssets = null;
                chrome.storage.local.remove('characterRefAssets').catch(() => {});
                if (typeof renderCharRefThumbnails === 'function') renderCharRefThumbnails(null);
            }
            if (APP.p2iUseCustomCharRefs) {
                const filledSlots = CCR_CODES_P2I.filter(c => APP.p2iCustomCharRefs[c] && APP.p2iCustomCharRefs[c].image);
                const hasAny = filledSlots.length > 0;
                // ★ P2I: 이미지만 있고 이름 없는 슬롯 검출 (파싱 매칭 불가능)
                const imageOnlyCodes = filledSlots.filter(c => !APP.p2iCustomCharRefs[c].name || !APP.p2iCustomCharRefs[c].name.trim());

                if (!hasAny) {
                    showToast("👇 Upload images to the slots below", 'info');
                } else if (imageOnlyCodes.length > 0) {
                    const msg = "⚠️ Missing names in slots: {codes}. Add a name or use {codeList} code in the prompt to match"
                        .replace('{codes}', imageOnlyCodes.join(', '))
                        .replace('{codeList}', imageOnlyCodes.join('/'));
                    showToast(msg, 'warning', 8000);
                } else {
                    showToast("✓ 当提示词中包含角色名称或代码时，角色参考图将自动附带引用", 'success');
                }
            }
        });
    }

    // --- Clear All ---
    function initClearAllCustomRefsBtnP2I() {
        const btn = $('#clearAllCustomRefsBtn_p2i');
        if (!btn || btn._boundP2I) return;
        btn._boundP2I = true;
        btn.addEventListener('click', () => {
            const hasAny = CCR_CODES_P2I.some(c => APP.p2iCustomCharRefs[c]);
            if (!hasAny) {
                showToast("没有可清空的内容", 'info');
                return;
            }
            if (!confirm("This will clear all 6 slots. Continue?")) return;
            CCR_CODES_P2I.forEach(c => { APP.p2iCustomCharRefs[c] = null; });
            persistCustomCharRefsP2I();
            renderCustomRefGridP2I();
            bindCustomCharRefEventsP2I();
            showToast("已清空", 'success');
        });
    }

    // --- Brand Save ---
    function initSaveBrandBtnP2I() {
        const btn = $('#saveBrandBtn_p2i');
        if (!btn || btn._boundP2I) return;
        btn._boundP2I = true;
        btn.addEventListener('click', () => {
            const hasAny = CCR_CODES_P2I.some(c => APP.p2iCustomCharRefs[c] && (APP.p2iCustomCharRefs[c].image || APP.p2iCustomCharRefs[c].prompt));
            if (!hasAny) {
                showToast("没有可保存的角色，请先上传角色图或提示词", 'warning');
                return;
            }
            if (APP.brandProfiles.length >= MAX_BRAND_PROFILES_P2I) {
                showToast("Up to {max} brands can be saved".replace('{max}', MAX_BRAND_PROFILES_P2I), 'warning');
                return;
            }
            openSaveBrandModalP2I();
        });

        const bindOnce = (id, fn) => {
            const el = $(id);
            if (el && !el._boundP2I) { el._boundP2I = true; el.addEventListener('click', fn); }
        };
        bindOnce('#btnCloseSaveBrandModal_p2i', closeSaveBrandModalP2I);
        bindOnce('#btnCancelSaveBrand_p2i', closeSaveBrandModalP2I);
        bindOnce('#btnConfirmSaveBrand_p2i', confirmSaveBrandP2I);
    }

    function openSaveBrandModalP2I() {
        const modal = $('#saveBrandModal_p2i');
        const input = $('#saveBrandName_p2i');
        const preview = $('#saveBrandPreview_p2i');
        if (!modal) return;
        if (input) input.value = '';
        if (preview) {
            preview.innerHTML = CCR_CODES_P2I.map(code => {
                const s = APP.p2iCustomCharRefs[code];
                const hasImg = !!(s && s.image);
                return (
                    '<div class="preview-slot ' + (hasImg ? '' : 'empty') + '">' +
                    (hasImg ? '<img src="' + s.image + '" alt="' + code + '">' : '') +
                    '<div class="code-label">' + code + '</div>' +
                    '</div>'
                );
            }).join('');
        }
        modal.classList.remove('hidden');
        setTimeout(() => input && input.focus(), 100);
    }

    function closeSaveBrandModalP2I() {
        const m = $('#saveBrandModal_p2i');
        if (m) m.classList.add('hidden');
    }

    function confirmSaveBrandP2I() {
        const nameEl = $('#saveBrandName_p2i');
        const name = (nameEl && nameEl.value || '').trim();
        if (!name) {
            showToast("请输入角色库名称", 'error');
            return;
        }

        // ★ P2I v1.6 (결정 5): 이미지 업로드된 슬롯인데 이름이 비어있으면 저장 차단
        //   이름이 없으면 프롬프트 파싱에서 매칭 불가능 → 브랜드 저장 전 강제 입력
        const imagesWithoutName = CCR_CODES_P2I.filter(code => {
            const slot = APP.p2iCustomCharRefs[code];
            return slot && slot.image && (!slot.name || !slot.name.trim());
        });
        if (imagesWithoutName.length > 0) {
            const msg = "⚠️ Enter slot names before saving brand: {codes} slot(s) have empty names"
                .replace('{codes}', imagesWithoutName.join(', '));
            showToast(msg, 'error', 6000);
            return;
        }

        const existingIdx = APP.brandProfiles.findIndex(p => p.name === name);
        if (existingIdx >= 0) {
            if (!confirm("Brand '{name}' already exists. Overwrite?".replace('{name}', name))) return;
            APP.brandProfiles[existingIdx] = Object.assign({}, APP.brandProfiles[existingIdx], {
                characters: deepCloneCustomRefsP2I(),
                updatedAt: Date.now()
            });
        } else {
            APP.brandProfiles.push({
                id: 'brand_' + Date.now(),
                name: name,
                characters: deepCloneCustomRefsP2I(),
                createdAt: Date.now()
            });
        }
        chrome.storage.local.set({ brandProfiles: APP.brandProfiles })
            .then(() => {
                showToast("💾 角色库「{name}」已成功保存".replace('{name}', name), 'success');
                closeSaveBrandModalP2I();
            })
            .catch(err => {
                console.log('[CCR-P2I] brand save failed', err);
                showToast("保存失败", 'error');
            });
    }

    function deepCloneCustomRefsP2I() {
        const out = {};
        CCR_CODES_P2I.forEach(code => {
            const s = APP.p2iCustomCharRefs[code];
            out[code] = s ? { image: s.image || '', prompt: s.prompt || '', name: s.name || '' } : null;
        });
        return out;
    }

    // --- Brand Load ---
    function initLoadBrandBtnP2I() {
        const btn = $('#loadBrandBtn_p2i');
        if (!btn || btn._boundP2I) return;
        btn._boundP2I = true;
        btn.addEventListener('click', openLoadBrandModalP2I);

        const bindOnce = (id, fn) => {
            const el = $(id);
            if (el && !el._boundP2I) { el._boundP2I = true; el.addEventListener('click', fn); }
        };
        bindOnce('#btnCloseLoadBrandModal_p2i', closeLoadBrandModalP2I);
        bindOnce('#btnCloseLoadBrand_p2i', closeLoadBrandModalP2I);
    }

    function openLoadBrandModalP2I() {
        const modal = $('#loadBrandModal_p2i');
        if (!modal) return;
        renderBrandProfileListP2I();
        modal.classList.remove('hidden');
    }

    function closeLoadBrandModalP2I() {
        const m = $('#loadBrandModal_p2i');
        if (m) m.classList.add('hidden');
    }

    function renderBrandProfileListP2I() {
        const list = $('#brandProfileList_p2i');
        const empty = $('#brandProfileEmpty_p2i');
        if (!list) return;

        // ★ APP.brandProfiles 는 대본 모드와 공유 — 저장된 모든 브랜드 표시
        if (!Array.isArray(APP.brandProfiles) || APP.brandProfiles.length === 0) {
            list.innerHTML = '';
            if (empty) empty.classList.remove('hidden');
            return;
        }
        if (empty) empty.classList.add('hidden');

        const sorted = APP.brandProfiles.slice().sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt));

        const locale = 'en-US';
        const charsLabel = "characters";
        const deleteTitle = "Delete";

        list.innerHTML = sorted.map(profile => {
            const chars = profile.characters || {};
            const filledCount = CCR_CODES_P2I.filter(c => chars[c] && chars[c].image).length;
            let mcrImg = (chars.MCR && chars.MCR.image) || '';
            if (!mcrImg) {
                for (const c of CCR_CODES_P2I) {
                    if (chars[c] && chars[c].image) { mcrImg = chars[c].image; break; }
                }
            }
            const dateStr = new Date(profile.updatedAt || profile.createdAt || Date.now()).toLocaleDateString(locale);
            return (
                '<div class="brand-profile-card" data-id="' + profile.id + '">' +
                '  <div class="brand-profile-card-thumb">' +
                (mcrImg ? '<img src="' + mcrImg + '" alt="' + escapeHtmlP2I(profile.name) + '">' : '') +
                '  </div>' +
                '  <div class="brand-profile-card-info">' +
                '    <p class="brand-profile-card-name">' + escapeHtmlP2I(profile.name) + '</p>' +
                '    <p class="brand-profile-card-meta">' + filledCount + '/6 ' + charsLabel + ' · ' + dateStr + '</p>' +
                '  </div>' +
                '  <button type="button" class="brand-profile-card-delete" data-id="' + profile.id + '" title="' + escapeHtmlP2I(deleteTitle) + '">✕</button>' +
                '</div>'
            );
        }).join('');

        list.querySelectorAll('.brand-profile-card').forEach(card => {
            card.addEventListener('click', (e) => {
                if (e.target.classList.contains('brand-profile-card-delete')) return;
                loadBrandProfileP2I(card.dataset.id);
            });
        });
        list.querySelectorAll('.brand-profile-card-delete').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                deleteBrandProfileP2I(btn.dataset.id);
            });
        });
    }

    function loadBrandProfileP2I(id) {
        const profile = APP.brandProfiles.find(p => p.id === id);
        if (!profile) return;
        // ★ 현재 모드(P2I) 슬롯에만 반영 — 대본 모드 슬롯은 건드리지 않음
        CCR_CODES_P2I.forEach(code => {
            const src = profile.characters && profile.characters[code];
            APP.p2iCustomCharRefs[code] = src ? { image: src.image || '', prompt: src.prompt || '', name: src.name || '' } : null;
        });
        persistCustomCharRefsP2I();
        renderCustomRefGridP2I();
        bindCustomCharRefEventsP2I();
        closeLoadBrandModalP2I();
        showToast("📂 角色库「{name}」已成功载入".replace('{name}', profile.name), 'success');
    }

    function deleteBrandProfileP2I(id) {
        const profile = APP.brandProfiles.find(p => p.id === id);
        if (!profile) return;
        if (!confirm("Delete brand '{name}'?".replace('{name}', profile.name))) return;
        APP.brandProfiles = APP.brandProfiles.filter(p => p.id !== id);
        chrome.storage.local.set({ brandProfiles: APP.brandProfiles })
            .then(() => {
                renderBrandProfileListP2I();
                showToast("已成功删除", 'success');
            });
    }

    function escapeHtmlP2I(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    // --- Helpers for Flow upload ---
    function buildCharRefAssetsFromCustomP2I() {
        const assets = {};
        if (!APP.p2iCustomCharRefs) return null;
        CCR_CODES_P2I.forEach(code => {
            const slot = APP.p2iCustomCharRefs[code];
            if (slot && slot.image) {
                assets[code] = {
                    filename: code + '_p2i_custom.jpg',
                    base64: slot.image,
                    name: slot.name || code
                };
            }
        });
        return Object.keys(assets).length > 0 ? assets : null;
    }

    function hasCustomCharRefP2I(code) {
        return !!(APP.p2iCustomCharRefs && APP.p2iCustomCharRefs[code] && APP.p2iCustomCharRefs[code].image);
    }

    // ============================================================
    // ★ P2I v1.6 전용: 프롬프트 파싱 + 이미지 자산 빌드
    // ============================================================

    /**
     * ★ 각 코드에 대한 별칭(alias) 매핑
     * - 코드: 원본 (예: MCR, SC1)
     * - 한국어 별칭: 주연/주인공/조연N (여러 표현 대응)
     * - 영어 별칭: Main/Sub1 (다국어 사용자 대응)
     * - 각 캐릭터의 사용자 지정 이름(slot.name) 은 런타임에 추가 감지
     */
    // ★ v1.1.3: 다국어 폴백 매칭 — convertCharacterCodes 영어 변환 + 주요 언어 네이티브 표현
    //   convertCharacterCodes: MCR→"The main character", SC1→"The second character" ...
    //   → 변환 후 영어 표현 누락 시 매칭 실패 → 영어/일본어/중국어/베트남어/스페인어/힌디어 추가
    const CODE_ALIASES_P2I = {
        MCR: [
            // 코드
            'MCR',
            // 영어 (변환 후 + 자연 표현)
            'Main', 'main character', 'The main character', 'protagonist',
            // 한국어
            '주연', '주인공', '메인', '메인캐릭터', '메인캐릭', '주인공캐릭터',
            // 일본어
            '主人公', '主役', 'メインキャラ', 'メインキャラクター',
            // 중국어
            '主角', '主要角色',
            // 베트남어
            'nhân vật chính', 'vai chính',
            // 스페인어
            'personaje principal', 'protagonista',
            // 힌디어
            'मुख्य पात्र', 'नायक',
        ],
        SC1: [
            'SC1', 'Sub1', 'second character', 'The second character',
            '조연1', '서브1', '조연 1', '서브 1',
            'サブ1', 'サブキャラ1', '脇役1', '第二のキャラクター',
            '配角1', '次要角色1',
            'nhân vật phụ 1', 'vai phụ 1',
            'personaje secundario 1', 'segundo personaje',
            'सहायक पात्र 1', 'दूसरा पात्र',
        ],
        SC2: [
            'SC2', 'Sub2', 'third character', 'The third character',
            '조연2', '서브2', '조연 2', '서브 2',
            'サブ2', 'サブキャラ2', '脇役2', '第三のキャラクター',
            '配角2', '次要角色2',
            'nhân vật phụ 2', 'vai phụ 2',
            'personaje secundario 2', 'tercer personaje',
            'सहायक पात्र 2', 'तीसरा पात्र',
        ],
        SC3: [
            'SC3', 'Sub3', 'fourth character', 'The fourth character',
            '조연3', '서브3', '조연 3', '서브 3',
            'サブ3', 'サブキャラ3', '脇役3', '第四のキャラクター',
            '配角3', '次要角色3',
            'nhân vật phụ 3', 'vai phụ 3',
            'personaje secundario 3', 'cuarto personaje',
            'सहायक पात्र 3', 'चौथा पात्र',
        ],
        SC4: [
            'SC4', 'Sub4', 'fifth character', 'The fifth character',
            '조연4', '서브4', '조연 4', '서브 4',
            'サブ4', 'サブキャラ4', '脇役4', '第五のキャラクター',
            '配角4', '次要角色4',
            'nhân vật phụ 4', 'vai phụ 4',
            'personaje secundario 4', 'quinto personaje',
            'सहायक पात्र 4', 'पाँचवा पात्र',
        ],
        SC5: [
            'SC5', 'Sub5', 'sixth character', 'The sixth character',
            '조연5', '서브5', '조연 5', '서브 5',
            'サブ5', 'サブキャラ5', '脇役5', '第六のキャラクター',
            '配角5', '次要角色5',
            'nhân vật phụ 5', 'vai phụ 5',
            'personaje secundario 5', 'sexto personaje',
            'सहायक पात्र 5', 'छठा पात्र',
        ],
    };

    /**
     * 사용자 프롬프트에서 등장하는 캐릭터 코드 감지
     *
     * 매칭 규칙 (OR 조건 — 하나라도 맞으면 해당 코드 매칭):
     *   1. 코드 자체: MCR / SC1 / SC2 / SC3 / SC4 / SC5 (영문 word boundary, 대소문자 무시)
     *   2. 한글 별칭: 주연 / 주인공 / 조연1~5 / 서브1~5 (부분 문자열 포함)
     *   3. 영문 별칭: Main / Sub1~5 (word boundary, 대소문자 무시)
     *   4. 슬롯 사용자 이름: slot.name (부분 문자열 포함)
     *
     * 예시 (MCR 슬롯에 이름 "김하늘" 입력 시):
     *   - "MCR이 걷는다" → MCR 매칭 (코드)
     *   - "주연이 말했다" → MCR 매칭 (한글 별칭)
     *   - "주인공은 웃었다" → MCR 매칭 (한글 별칭)
     *   - "Main character walks" → MCR 매칭 (영문 별칭)
     *   - "김하늘이 놀았다" → MCR 매칭 (사용자 이름)
     *   - "김학자가 말했다" → 매칭 없음 ("김하늘" 미포함)
     *
     * 이름 매칭은 slot.image + slot.name 모두 있을 때만 활성.
     */
    function parseCharacterCodesFromPromptP2I(promptText) {
        if (!promptText || typeof promptText !== 'string') return [];
        const detected = new Set();
        // ★ v1.1.3: 다국어 매칭 — Latin script(스페인어/베트남어 등) 대소문자 무시 위해 소문자 캐시
        const promptLower = promptText.toLowerCase();

        // 1차: 코드 + 별칭 감지
        CCR_CODES_P2I.forEach(code => {
            const aliases = CODE_ALIASES_P2I[code] || [code];
            for (const alias of aliases) {
                // 영문/숫자만으로 이루어진 별칭 → word boundary 매칭 (대소문자 무시)
                const isEnglishOnly = /^[A-Za-z0-9]+$/.test(alias);
                if (isEnglishOnly) {
                    // \bMCR\b — "김하늘MCR" 같은 false positive 방지
                    const pattern = new RegExp('\\b' + alias + '\\b', 'i');
                    if (pattern.test(promptText)) {
                        detected.add(code);
                        break;  // 하나라도 매칭되면 이 코드 확정, 나머지 별칭 스킵
                    }
                } else {
                    // 한글/공백/다국어 별칭 → 부분 문자열 포함 검사 (대소문자 무시)
                    //   "주연이", "주인공은", "조연1이", "조연 1 과", "Second Character", "PROTAGONISTA" 모두 매칭
                    if (promptLower.includes(alias.toLowerCase())) {
                        detected.add(code);
                        break;
                    }
                }
            }
        });

        // 2차: 슬롯 사용자 이름 매칭 (이미지 + 이름 모두 있을 때만) — 대소문자 무시
        if (APP.p2iCustomCharRefs) {
            CCR_CODES_P2I.forEach(code => {
                if (detected.has(code)) return;
                const slot = APP.p2iCustomCharRefs[code];
                if (slot && slot.image && slot.name && slot.name.trim()) {
                    const name = slot.name.trim();
                    if (promptLower.includes(name.toLowerCase())) detected.add(code);
                }
            });
        }

        // ※ 단순 규칙 — 코드/한글별칭/영문별칭/슬롯이름(단일)만 사용.

        return Array.from(detected);
    }

    /**
     * 단일 프롬프트에 해당하는 캐릭터 이미지만 추출
     * - CCR 체크박스 OFF: null 반환 (이미지 첨부 없이 생성)
     * - 프롬프트에 캐릭터 코드/이름 없음: null 반환
     * - 매칭된 캐릭터만 assets 포함
     */
    function buildActiveCharRefAssetsForPromptP2I(promptText) {
        if (!APP.p2iUseCustomCharRefs) return null;

        const detectedCodes = parseCharacterCodesFromPromptP2I(promptText);
        if (detectedCodes.length === 0) return null;

        const allAssets = buildCharRefAssetsFromCustomP2I();
        if (!allAssets) return null;

        const assets = {};
        detectedCodes.forEach(code => {
            if (allAssets[code]) assets[code] = allAssets[code];
        });
        return Object.keys(assets).length > 0 ? assets : null;
    }

    // ============================================================
    // Expose to window for sidepanel.js integration
    // ============================================================
    window.initCustomCharRefsP2I = initCustomCharRefsP2I;
    window.renderCustomRefGridP2I = renderCustomRefGridP2I;
    window.bindCustomCharRefEventsP2I = bindCustomCharRefEventsP2I;
    window.buildCharRefAssetsFromCustomP2I = buildCharRefAssetsFromCustomP2I;
    window.hasCustomCharRefP2I = hasCustomCharRefP2I;
    window.parseCharacterCodesFromPromptP2I = parseCharacterCodesFromPromptP2I;
    window.buildActiveCharRefAssetsForPromptP2I = buildActiveCharRefAssetsForPromptP2I;

    // ★ 새 프로젝트 시 호출 — 6개 슬롯만 초기화 (체크박스/브랜드프로파일 유지)
    //   - confirm 미발동 (resetProject 흐름에서 조용히 초기화)
    //   - "사용" 체크박스 상태는 유지 → 브랜드 로드로 바로 다른 세트 주입 가능
    //   - brandProfiles 는 공유 자산이므로 건드리지 않음
    window.resetAllCustomCharRefsP2I = function resetAllCustomCharRefsP2I() {
        if (!APP.p2iCustomCharRefs) {
            APP.p2iCustomCharRefs = { MCR: null, SC1: null, SC2: null, SC3: null, SC4: null, SC5: null };
        } else {
            CCR_CODES_P2I.forEach(c => { APP.p2iCustomCharRefs[c] = null; });
        }
        chrome.storage.local.set({ p2iCustomCharRefs: APP.p2iCustomCharRefs }).catch(() => {});
        if (typeof renderCustomRefGridP2I === 'function') renderCustomRefGridP2I();
        if (typeof bindCustomCharRefEventsP2I === 'function') bindCustomCharRefEventsP2I();
    };
})();
