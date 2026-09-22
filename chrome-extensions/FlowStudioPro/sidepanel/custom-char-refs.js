if(typeof console!=="undefined" && (typeof globalThis!=="undefined" && globalThis.__FLOW_SILENT__ === true)){console.log=function(){};console.warn=function(){};console.error=function(){};}
// ============================================================
// CUSTOM CHARACTER REFERENCES (PRO 2.0)
// - 6 slots (MCR, SC1~SC5): image upload + prompt input
// - Drag & drop + file click
// - Brand profile save/load/delete
// - Injection into generatePromptsFromScript via userProvidedCharRefs param
// ============================================================
// Depends on: APP (global), $, showToast, chrome.storage.local

(function () {
    'use strict';

    const CCR_CODES = ['MCR', 'SC1', 'SC2', 'SC3', 'SC4', 'SC5'];
    const MAX_BRAND_PROFILES = 20;
    const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8MB per image

    const ccrLabel = (code) => ({ MCR: 'Main', SC1: 'Sub 1', SC2: 'Sub 2', SC3: 'Sub 3', SC4: 'Sub 4', SC5: 'Sub 5' }[code] || code);

    // --- Core Init (called from initMainApp) ---
    async function initCustomCharRefs() {
        try {
            const stored = await chrome.storage.local.get(['customCharRefs', 'useCustomCharRefs', 'brandProfiles']);
            if (stored.customCharRefs && typeof stored.customCharRefs === 'object') {
                CCR_CODES.forEach(code => {
                    APP.customCharRefs[code] = stored.customCharRefs[code] || null;
                });
            }
            APP.useCustomCharRefs = !!stored.useCustomCharRefs;
            APP.brandProfiles = Array.isArray(stored.brandProfiles) ? stored.brandProfiles : [];
        } catch (e) {
            console.log('[CCR] storage load failed', e);
        }

        renderCustomRefGrid();
        bindCustomCharRefEvents();
        initCustomCharRefsCheckbox();
        initClearAllCustomRefsBtn();
        initSaveBrandBtn();
        initLoadBrandBtn();

        // ★ 체크박스 상태 복원 + 섹션 열림/닫힘 반영
        const checkbox = $('#useCustomCharRefsCheckbox');
        if (checkbox) checkbox.checked = APP.useCustomCharRefs;
        toggleCustomCharRefsSection(APP.useCustomCharRefs);
    }

    function toggleCustomCharRefsSection(open) {
        const section = $('#customCharRefsSection');
        if (!section) return;
        if (open) {
            section.classList.remove('hidden');
        } else {
            section.classList.add('hidden');
        }
    }

    // --- Grid Render ---
    function renderCustomRefGrid() {
        const grid = $('#customRefGrid');
        if (!grid) return;
        grid.innerHTML = CCR_CODES.map(code => {
            const slot = APP.customCharRefs[code];
            const hasImage = !!slot?.image;
            const hasContent = hasImage || !!slot?.prompt;
            return (
                '<div class="custom-ref-slot ' + (hasContent ? 'has-content' : '') + '" data-code="' + code + '">' +
                '  <div class="slot-header">' +
                '    <span class="slot-code">' + code + '</span>' +
                '    <small>' + ccrLabel(code) + '</small>' +
                '  </div>' +
                '  <div class="slot-dropzone" data-code="' + code + '" role="button" tabindex="0" aria-label="' + escapeHtml('Upload reference image for' + ' ' + code) + '">' +
                '    <input type="file" accept="image/*" hidden class="slot-file-input">' +
                '    <div class="slot-empty" ' + (hasImage ? 'style="display:none"' : '') + '>' + escapeHtml("📁 Drag or click") + '</div>' +
                '    <img class="slot-preview ' + (hasImage ? '' : 'hidden') + '" src="' + (hasImage ? slot.image : '') + '" alt="' + escapeHtml(code + ' reference image') + '">' +
                '    <button type="button" class="slot-remove ' + (hasImage ? '' : 'hidden') + '" data-code="' + code + '" aria-label="' + escapeHtml('Remove reference image for' + ' ' + code) + '">×</button>' +
                '  </div>' +
                '  <textarea class="slot-prompt" data-code="' + code + '" placeholder="' + escapeHtml("Paste the prompt that generated this image") + '">' + escapeHtml(slot?.prompt || '') + '</textarea>' +
                '  <input type="text" class="slot-name" data-code="' + code + '" placeholder="' + escapeHtml("Name (optional)") + '" value="' + escapeHtml(slot?.name || '') + '" maxlength="20">' +
                '</div>'
            );
        }).join('');
    }

    function bindCustomCharRefEvents() {
        const grid = $('#customRefGrid');
        if (!grid) return;

        grid.querySelectorAll('.slot-dropzone').forEach(zone => {
            const code = zone.dataset.code;
            const input = zone.querySelector('.slot-file-input');

            zone.addEventListener('click', (e) => {
                if (e.target.classList.contains('slot-remove')) return;
                // ★ 이미 이미지가 업로드된 슬롯은 클릭해도 파일 다이얼로그 열지 않음
                //   → FULL AUTO 중 스크롤/이동 시 실수 클릭으로 다이얼로그 팝업되는 버그 방지
                //   → 바꾸고 싶으면 × 버튼으로 먼저 제거 후 다시 업로드
                if (APP.customCharRefs[code] && APP.customCharRefs[code].image) return;
                input && input.click();
            });
            zone.addEventListener('keydown', (e) => {
                if (e.key !== 'Enter' && e.key !== ' ') return;
                e.preventDefault();
                if (APP.customCharRefs[code] && APP.customCharRefs[code].image) return;
                input && input.click();
            });

            if (input) {
                input.addEventListener('change', (e) => {
                    const file = e.target.files && e.target.files[0];
                    if (file) handleSlotImageFile(code, file);
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
                if (file && file.type.startsWith('image/')) handleSlotImageFile(code, file);
            });
        });

        grid.querySelectorAll('.slot-remove').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const code = btn.dataset.code;
                if (APP.customCharRefs[code]) {
                    APP.customCharRefs[code].image = '';
                    if (!APP.customCharRefs[code].prompt && !APP.customCharRefs[code].name) {
                        APP.customCharRefs[code] = null;
                    }
                    persistCustomCharRefs();
                    renderCustomRefGrid();
                    bindCustomCharRefEvents();
                }
            });
        });

        grid.querySelectorAll('.slot-prompt').forEach(ta => {
            ta.addEventListener('input', debounceSlotSave(ta.dataset.code));
        });
        grid.querySelectorAll('.slot-name').forEach(inp => {
            inp.addEventListener('input', debounceSlotSave(inp.dataset.code));
        });
    }

    const _slotSaveTimers = {};
    function debounceSlotSave(code) {
        return function () {
            clearTimeout(_slotSaveTimers[code]);
            _slotSaveTimers[code] = setTimeout(() => {
                const slotEl = $('.custom-ref-slot[data-code="' + code + '"]');
                if (!slotEl) return;
                const promptEl = slotEl.querySelector('.slot-prompt');
                const nameEl = slotEl.querySelector('.slot-name');
                const prompt = (promptEl && promptEl.value || '').trim();
                const name = (nameEl && nameEl.value || '').trim();
                const image = (APP.customCharRefs[code] && APP.customCharRefs[code].image) || '';

                if (!prompt && !name && !image) {
                    APP.customCharRefs[code] = null;
                } else {
                    APP.customCharRefs[code] = { image: image, prompt: prompt, name: name };
                }
                persistCustomCharRefs();
                slotEl.classList.toggle('has-content', !!(image || prompt));
            }, 400);
        };
    }

    function handleSlotImageFile(code, file) {
        if (!file) return;
        if (!file.type.startsWith('image/')) {
            showToast("仅支持上传图片文件", 'error');
            return;
        }
        if (file.size > MAX_IMAGE_BYTES) {
            const mb = Math.floor(MAX_IMAGE_BYTES / 1024 / 1024);
            showToast("图片体积过大（最大支持 {mb}MB）".replace('{mb}', mb), 'error');
            return;
        }
        const reader = new FileReader();
        reader.onload = (e) => {
            const base64 = e.target.result;
            const existing = APP.customCharRefs[code] || {};
            APP.customCharRefs[code] = {
                image: base64,
                prompt: existing.prompt || '',
                name: existing.name || ''
            };
            persistCustomCharRefs();
            renderCustomRefGrid();
            bindCustomCharRefEvents();
        };
        reader.onerror = () => showToast("图片读取失败", 'error');
        reader.readAsDataURL(file);
    }

    function persistCustomCharRefs() {
        chrome.storage.local.set({
            customCharRefs: APP.customCharRefs,
            useCustomCharRefs: APP.useCustomCharRefs,
            // ★ v1.1.2: 슬롯 데이터 전 모드 공유 — P2I도 동일 데이터 유지
            p2iCustomCharRefs: APP.customCharRefs,
            p2iUseCustomCharRefs: APP.useCustomCharRefs
        }).catch(() => {});
        APP.p2iCustomCharRefs = APP.customCharRefs;
        APP.p2iUseCustomCharRefs = APP.useCustomCharRefs;
        // ★ v1.1.3 fix: 재렌더 후 핸들러 재바인딩 필수 (innerHTML이 DOM 파괴 → 핸들러 소실)
        if (typeof renderCustomRefGridP2I === 'function') renderCustomRefGridP2I();
        if (typeof bindCustomCharRefEventsP2I === 'function') bindCustomCharRefEventsP2I();
    }

    // --- Master Checkbox ---
    function initCustomCharRefsCheckbox() {
        const checkbox = $('#useCustomCharRefsCheckbox');
        if (!checkbox || checkbox._bound) return;
        checkbox._bound = true;
        checkbox.addEventListener('change', () => {
            APP.useCustomCharRefs = checkbox.checked;
            persistCustomCharRefs();
            // ★ 체크박스 → 섹션 열림/닫힘 토글
            toggleCustomCharRefsSection(APP.useCustomCharRefs);
            // ★ v1.1.2: CCR 토글 전 모드 동기화 (한곳 ON/OFF → 전체 연동)
            APP.p2iUseCustomCharRefs = checkbox.checked;
            const p2iCb = document.getElementById('useCustomCharRefsCheckbox_p2i');
            if (p2iCb) p2iCb.checked = checkbox.checked;
            chrome.storage.local.set({ p2iUseCustomCharRefs: checkbox.checked }).catch(() => {});
            const p2iSection = document.getElementById('customCharRefsSection_p2i');
            if (p2iSection) { if (checkbox.checked) p2iSection.classList.remove('hidden'); else p2iSection.classList.add('hidden'); }
            if (!APP.useCustomCharRefs) {
                // CCR OFF → characterRefAssets 전체 클리어 (stale 커스텀 업로드 방지)
                APP.characterRefAssets = null;
                chrome.storage.local.remove('characterRefAssets').catch(() => {});
                if (typeof renderCharRefThumbnails === 'function') {
                    renderCharRefThumbnails(null);
                }
            }
            if (APP.useCustomCharRefs) {
                const filledSlots = CCR_CODES.filter(c => APP.customCharRefs[c] && APP.customCharRefs[c].image);
                const hasAny = filledSlots.length > 0;
                // ★ PRO 2.0: 이미지만 있고 프롬프트 없는 슬롯 검출 (Gemini 불일치 리스크)
                const imageOnlyCodes = filledSlots.filter(c => !APP.customCharRefs[c].prompt || !APP.customCharRefs[c].prompt.trim());

                if (!hasAny) {
                    showToast("👇 Upload images to the slots below", 'info');
                } else if (imageOnlyCodes.length > 0) {
                    const msg = "⚠️ Slots {codes} have no prompt. Gemini won't recognize these characters, and scene descriptions may not match the uploaded images. Please add prompts.".replace('{codes}', imageOnlyCodes.join(', '));
                    showToast(msg, 'warning', 8000);
                } else {
                    showToast("✓ Gemini will use your custom characters as-is", 'success');
                }
            }
        });
    }

    // --- Clear All ---
    function initClearAllCustomRefsBtn() {
        const btn = $('#clearAllCustomRefsBtn');
        if (!btn || btn._bound) return;
        btn._bound = true;
        btn.addEventListener('click', () => {
            const hasAny = CCR_CODES.some(c => APP.customCharRefs[c]);
            if (!hasAny) {
                showToast("没有可清空的内容", 'info');
                return;
            }
            if (!confirm("This will clear all 6 slots. Continue?")) return;
            CCR_CODES.forEach(c => { APP.customCharRefs[c] = null; });
            persistCustomCharRefs();
            renderCustomRefGrid();
            bindCustomCharRefEvents();
            showToast("已清空", 'success');
        });
    }

    // --- Brand Save ---
    function initSaveBrandBtn() {
        const btn = $('#saveBrandBtn');
        if (!btn || btn._bound) return;
        btn._bound = true;
        btn.addEventListener('click', () => {
            const hasAny = CCR_CODES.some(c => APP.customCharRefs[c] && (APP.customCharRefs[c].image || APP.customCharRefs[c].prompt));
            if (!hasAny) {
                showToast("没有可保存的角色，请先上传角色图或提示词", 'warning');
                return;
            }
            if (APP.brandProfiles.length >= MAX_BRAND_PROFILES) {
                showToast("Up to {max} brands can be saved".replace('{max}', MAX_BRAND_PROFILES), 'warning');
                return;
            }
            openSaveBrandModal();
        });

        const bindOnce = (id, fn) => {
            const el = $(id);
            if (el && !el._bound) { el._bound = true; el.addEventListener('click', fn); }
        };
        bindOnce('#btnCloseSaveBrandModal', closeSaveBrandModal);
        bindOnce('#btnCancelSaveBrand', closeSaveBrandModal);
        bindOnce('#btnConfirmSaveBrand', confirmSaveBrand);
    }

    function openSaveBrandModal() {
        const modal = $('#saveBrandModal');
        const input = $('#saveBrandName');
        const preview = $('#saveBrandPreview');
        if (!modal) return;
        if (input) input.value = '';
        if (preview) {
            preview.innerHTML = CCR_CODES.map(code => {
                const s = APP.customCharRefs[code];
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

    function closeSaveBrandModal() {
        const m = $('#saveBrandModal');
        if (m) m.classList.add('hidden');
    }

    function confirmSaveBrand() {
        const nameEl = $('#saveBrandName');
        const name = (nameEl && nameEl.value || '').trim();
        if (!name) {
            showToast("请输入角色库名称", 'error');
            return;
        }
        const existingIdx = APP.brandProfiles.findIndex(p => p.name === name);
        if (existingIdx >= 0) {
            if (!confirm("Brand '{name}' already exists. Overwrite?".replace('{name}', name))) return;
            APP.brandProfiles[existingIdx] = Object.assign({}, APP.brandProfiles[existingIdx], {
                characters: deepCloneCustomRefs(),
                updatedAt: Date.now()
            });
        } else {
            APP.brandProfiles.push({
                id: 'brand_' + Date.now(),
                name: name,
                characters: deepCloneCustomRefs(),
                createdAt: Date.now()
            });
        }
        chrome.storage.local.set({ brandProfiles: APP.brandProfiles })
            .then(() => {
                showToast("💾 角色库「{name}」已成功保存".replace('{name}', name), 'success');
                closeSaveBrandModal();
            })
            .catch(err => {
                console.log('[CCR] brand save failed', err);
                showToast("保存失败", 'error');
            });
    }

    function deepCloneCustomRefs() {
        const out = {};
        CCR_CODES.forEach(code => {
            const s = APP.customCharRefs[code];
            out[code] = s ? { image: s.image || '', prompt: s.prompt || '', name: s.name || '' } : null;
        });
        return out;
    }

    // --- Brand Load ---
    function initLoadBrandBtn() {
        const btn = $('#loadBrandBtn');
        if (!btn || btn._bound) return;
        btn._bound = true;
        btn.addEventListener('click', openLoadBrandModal);

        const bindOnce = (id, fn) => {
            const el = $(id);
            if (el && !el._bound) { el._bound = true; el.addEventListener('click', fn); }
        };
        bindOnce('#btnCloseLoadBrandModal', closeLoadBrandModal);
        bindOnce('#btnCloseLoadBrand', closeLoadBrandModal);
    }

    function openLoadBrandModal() {
        const modal = $('#loadBrandModal');
        if (!modal) return;
        renderBrandProfileList();
        modal.classList.remove('hidden');
    }

    function closeLoadBrandModal() {
        const m = $('#loadBrandModal');
        if (m) m.classList.add('hidden');
    }

    function renderBrandProfileList() {
        const list = $('#brandProfileList');
        const empty = $('#brandProfileEmpty');
        if (!list) return;

        if (APP.brandProfiles.length === 0) {
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
            const filledCount = CCR_CODES.filter(c => chars[c] && chars[c].image).length;
            let mcrImg = (chars.MCR && chars.MCR.image) || '';
            if (!mcrImg) {
                for (const c of CCR_CODES) {
                    if (chars[c] && chars[c].image) { mcrImg = chars[c].image; break; }
                }
            }
            const dateStr = new Date(profile.updatedAt || profile.createdAt || Date.now()).toLocaleDateString(locale);
            return (
                '<div class="brand-profile-card" data-id="' + profile.id + '">' +
                '  <div class="brand-profile-card-thumb">' +
                (mcrImg ? '<img src="' + mcrImg + '" alt="' + escapeHtml(profile.name) + '">' : '') +
                '  </div>' +
                '  <div class="brand-profile-card-info">' +
                '    <p class="brand-profile-card-name">' + escapeHtml(profile.name) + '</p>' +
                '    <p class="brand-profile-card-meta">' + filledCount + '/6 ' + charsLabel + ' · ' + dateStr + '</p>' +
                '  </div>' +
                '  <button type="button" class="brand-profile-card-delete" data-id="' + profile.id + '" title="' + escapeHtml(deleteTitle) + '">✕</button>' +
                '</div>'
            );
        }).join('');

        list.querySelectorAll('.brand-profile-card').forEach(card => {
            card.addEventListener('click', (e) => {
                if (e.target.classList.contains('brand-profile-card-delete')) return;
                loadBrandProfile(card.dataset.id);
            });
        });
        list.querySelectorAll('.brand-profile-card-delete').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                deleteBrandProfile(btn.dataset.id);
            });
        });
    }

    function loadBrandProfile(id) {
        const profile = APP.brandProfiles.find(p => p.id === id);
        if (!profile) return;
        CCR_CODES.forEach(code => {
            const src = profile.characters && profile.characters[code];
            APP.customCharRefs[code] = src ? { image: src.image || '', prompt: src.prompt || '', name: src.name || '' } : null;
        });
        persistCustomCharRefs();
        renderCustomRefGrid();
        bindCustomCharRefEvents();
        closeLoadBrandModal();
        showToast("📂 角色库「{name}」已成功载入".replace('{name}', profile.name), 'success');
    }

    function deleteBrandProfile(id) {
        const profile = APP.brandProfiles.find(p => p.id === id);
        if (!profile) return;
        if (!confirm("Delete brand '{name}'?".replace('{name}', profile.name))) return;
        APP.brandProfiles = APP.brandProfiles.filter(p => p.id !== id);
        chrome.storage.local.set({ brandProfiles: APP.brandProfiles })
            .then(() => {
                renderBrandProfileList();
                showToast("已成功删除", 'success');
            });
    }

    function escapeHtml(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    // --- Helpers for Gemini injection & Flow upload ---
    function buildUserProvidedCharRefsForGemini() {
        if (!APP.useCustomCharRefs) return null;
        const refs = [];
        CCR_CODES.forEach(code => {
            const slot = APP.customCharRefs[code];
            if (slot && slot.image && slot.prompt) {
                refs.push({
                    code: code,
                    name: slot.name || code,
                    description: extractDescriptionFromPrompt(slot.prompt),
                    prompt: slot.prompt,
                    refSheetPrompt: slot.prompt
                });
            }
        });
        return refs.length > 0 ? refs : null;
    }

    function extractDescriptionFromPrompt(text) {
        // ★ PRO 2.0: 글자수 제한 없음 — 사용자 입력 전체 보존
        if (!text) return '';
        return text.replace(/\s+/g, ' ').trim();
    }

    function buildCharRefAssetsFromCustom() {
        const assets = {};
        CCR_CODES.forEach(code => {
            const slot = APP.customCharRefs[code];
            if (slot && slot.image) {
                assets[code] = {
                    filename: code + '_custom.jpg',
                    base64: slot.image,
                    name: slot.name || code
                };
            }
        });
        return Object.keys(assets).length > 0 ? assets : null;
    }

    function hasCustomCharRef(code) {
        return !!(APP.customCharRefs && APP.customCharRefs[code] && APP.customCharRefs[code].image);
    }

    // ★ 본문 이미지 생성 시 characterRefAssets와 사용자 업로드를 병합
    // 기존 AI 생성분은 유지하되 사용자 업로드가 있는 코드는 덮어쓰기 (사용자 우선)
    function mergeCustomCharRefsIntoAssets(aiAssets) {
        if (!APP.useCustomCharRefs) return aiAssets || null;
        const merged = aiAssets && typeof aiAssets === 'object' ? Object.assign({}, aiAssets) : {};
        CCR_CODES.forEach(code => {
            const slot = APP.customCharRefs[code];
            if (slot && slot.image) {
                merged[code] = {
                    filename: code + '_custom.jpg',
                    base64: slot.image,
                    name: slot.name || code
                };
            }
        });
        return Object.keys(merged).length > 0 ? merged : null;
    }

    // Expose to window for sidepanel.js integration
    window.initCustomCharRefs = initCustomCharRefs;
    window.renderCustomRefGrid = renderCustomRefGrid;
    window.bindCustomCharRefEvents = bindCustomCharRefEvents;
    window.buildUserProvidedCharRefsForGemini = buildUserProvidedCharRefsForGemini;
    window.buildCharRefAssetsFromCustom = buildCharRefAssetsFromCustom;
    window.mergeCustomCharRefsIntoAssets = mergeCustomCharRefsIntoAssets;
    window.hasCustomCharRef = hasCustomCharRef;
    window.CCR_CODES = CCR_CODES;
})();
