if (typeof console !== "undefined" && (typeof globalThis !== "undefined" && globalThis.__FLOW_SILENT__ === true)) {
    console.log = function () { }; console.warn = function () { }; console.error = function () { };
}
/**
 * asset-manager.js — Flow Studio Pro 统一资产管理中枢
 * 管理两大影视连续性锚点：
 * 1. CCR (Character Consistency References) — 6 槽位角色锁定 (MCR + SC1~SC5)
 * 2. SCR (Scene Consistency References) — 4 槽位场景锁定 (SCN1~SCN4)
 * 深度对齐 Google Flow 原生 @mention 与 Ingredients 体系
 */

(function () {
    'use strict';

    const CCR_CODES = ['MCR', 'SC1', 'SC2', 'SC3', 'SC4', 'SC5'];
    const SCR_CODES = ['SCN1', 'SCN2', 'SCN3', 'SCN4'];
    const MAX_ASSET_PROFILES = 30;
    const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8MB

    const ccrLabel = (code) => ({
        MCR: '主角 (MCR)',
        SC1: '配角 1 (SC1)',
        SC2: '配角 2 (SC2)',
        SC3: '配角 3 (SC3)',
        SC4: '配角 4 (SC4)',
        SC5: '配角 5 (SC5)'
    }[code] || code);

    const scrLabel = (code) => ({
        SCN1: '主场景 (SCN1)',
        SCN2: '副场景 A (SCN2)',
        SCN3: '副场景 B (SCN3)',
        SCN4: '特写/环境 (SCN4)'
    }[code] || code);

    function safeEscape(str) {
        if (typeof escapeHtml === 'function') return escapeHtml(str);
        if (str === null || str === undefined) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    // --- 初始化入口 (由 sidepanel.js initMainApp 调用) ---
    async function initAssetManager() {
        if (!window.APP) return;

        // 初始化 APP 字段
        if (!APP.customCharRefs) APP.customCharRefs = {};
        CCR_CODES.forEach(code => { if (!APP.customCharRefs[code]) APP.customCharRefs[code] = null; });

        if (!APP.customSceneRefs) APP.customSceneRefs = {};
        SCR_CODES.forEach(code => { if (!APP.customSceneRefs[code]) APP.customSceneRefs[code] = null; });

        try {
            const stored = await chrome.storage.local.get([
                'customCharRefs', 'useCustomCharRefs',
                'customSceneRefs', 'useCustomSceneRefs',
                'brandProfiles'
            ]);

            if (stored.customCharRefs && typeof stored.customCharRefs === 'object') {
                CCR_CODES.forEach(code => {
                    APP.customCharRefs[code] = stored.customCharRefs[code] || null;
                });
            }
            if (stored.customSceneRefs && typeof stored.customSceneRefs === 'object') {
                SCR_CODES.forEach(code => {
                    APP.customSceneRefs[code] = stored.customSceneRefs[code] || null;
                });
            }

            APP.useCustomCharRefs = !!stored.useCustomCharRefs;
            APP.useCustomSceneRefs = !!stored.useCustomSceneRefs;
            APP.brandProfiles = Array.isArray(stored.brandProfiles) ? stored.brandProfiles : [];
        } catch (e) {
            console.warn('[AssetManager] 本地存储加载异常', e);
        }

        renderCustomRefGrid();
        renderSceneRefGrid();
        bindAssetManagerEvents();
        initAssetToggles();
        initBrandProfileActions();

        // 状态更新
        const charCb = document.getElementById('useCustomCharRefsCheckbox');
        if (charCb) charCb.checked = APP.useCustomCharRefs;
        toggleSection('customCharRefsSection', APP.useCustomCharRefs);

        const sceneCb = document.getElementById('useCustomSceneRefsCheckbox');
        if (sceneCb) sceneCb.checked = APP.useCustomSceneRefs;
        toggleSection('customSceneRefsSection', APP.useCustomSceneRefs);
    }

    function toggleSection(id, open) {
        const el = document.getElementById(id);
        if (!el) return;
        el.classList.toggle('hidden', !open);
    }

    // --- 渲染 CCR 角色栅格 ---
    function renderCustomRefGrid() {
        const grid = document.getElementById('customRefGrid');
        if (!grid) return;

        grid.innerHTML = CCR_CODES.map(code => {
            const slot = APP.customCharRefs?.[code];
            const hasImage = !!slot?.image;
            const hasContent = hasImage || !!slot?.prompt;
            const slotName = slot?.name || '';
            const slotPrompt = slot?.prompt || '';

            return `
                <div class="custom-ref-slot ${hasContent ? 'has-content' : ''}" data-code="${code}" data-type="char">
                    <div class="slot-header">
                        <span class="slot-code">${safeEscape(code)}</span>
                        <small>${safeEscape(ccrLabel(code))}</small>
                    </div>
                    <div class="slot-dropzone" data-code="${code}" data-type="char" role="button" tabindex="0" aria-label="上传 ${code} 参考图">
                        <input type="file" accept="image/*" hidden class="slot-file-input">
                        <div class="slot-empty" style="${hasImage ? 'display:none' : ''}">📁 点击或拖放图片</div>
                        <img class="slot-preview ${hasImage ? '' : 'hidden'}" src="${hasImage ? safeEscape(slot.image) : ''}" alt="${code} 参考图">
                        <button type="button" class="slot-remove ${hasImage ? '' : 'hidden'}" data-code="${code}" data-type="char" aria-label="清除参考图">×</button>
                    </div>
                    <textarea class="slot-prompt" data-code="${code}" data-type="char" placeholder="角色固定外貌特征 / 生成该图的提示词...">${safeEscape(slotPrompt)}</textarea>
                    <input type="text" class="slot-name" data-code="${code}" data-type="char" placeholder="匹配名称/标签 (如 @Hero)" value="${safeEscape(slotName)}" maxlength="24">
                </div>
            `;
        }).join('');
    }

    // --- 渲染 SCR 场景栅格 ---
    function renderSceneRefGrid() {
        const grid = document.getElementById('sceneRefGrid');
        if (!grid) return;

        grid.innerHTML = SCR_CODES.map(code => {
            const slot = APP.customSceneRefs?.[code];
            const hasImage = !!slot?.image;
            const hasContent = hasImage || !!slot?.prompt;
            const slotName = slot?.name || '';
            const slotPrompt = slot?.prompt || '';

            return `
                <div class="custom-ref-slot scene-slot ${hasContent ? 'has-content' : ''}" data-code="${code}" data-type="scene">
                    <div class="slot-header">
                        <span class="slot-code">${safeEscape(code)}</span>
                        <small>${safeEscape(scrLabel(code))}</small>
                    </div>
                    <div class="slot-dropzone" data-code="${code}" data-type="scene" role="button" tabindex="0" aria-label="上传 ${code} 场景空镜">
                        <input type="file" accept="image/*" hidden class="slot-file-input">
                        <div class="slot-empty" style="${hasImage ? 'display:none' : ''}">🏙️ 点击或拖放场景图</div>
                        <img class="slot-preview ${hasImage ? '' : 'hidden'}" src="${hasImage ? safeEscape(slot.image) : ''}" alt="${code} 场景图">
                        <button type="button" class="slot-remove ${hasImage ? '' : 'hidden'}" data-code="${code}" data-type="scene" aria-label="清除场景图">×</button>
                    </div>
                    <textarea class="slot-prompt" data-code="${code}" data-type="scene" placeholder="空间透视、材质构景与全局光影特征...">${safeEscape(slotPrompt)}</textarea>
                    <input type="text" class="slot-name" data-code="${code}" data-type="scene" placeholder="场景标签 (如 @CyberBar)" value="${safeEscape(slotName)}" maxlength="24">
                </div>
            `;
        }).join('');
    }

    // --- 事件委托与绑定 ---
    function bindAssetManagerEvents() {
        // 使用委托监听角色与场景栅格操作
        ['customRefGrid', 'sceneRefGrid'].forEach(gridId => {
            const grid = document.getElementById(gridId);
            if (!grid) return;

            // 点击触发选择文件或移除
            grid.addEventListener('click', (e) => {
                const removeBtn = e.target.closest('.slot-remove');
                if (removeBtn) {
                    const code = removeBtn.dataset.code;
                    const type = removeBtn.dataset.type;
                    removeSlotImage(code, type);
                    return;
                }

                const dropzone = e.target.closest('.slot-dropzone');
                if (dropzone) {
                    const code = dropzone.dataset.code;
                    const type = dropzone.dataset.type;
                    const targetStore = type === 'scene' ? APP.customSceneRefs : APP.customCharRefs;
                    if (targetStore?.[code]?.image) return; // 已有图片不误弹
                    const input = dropzone.querySelector('.slot-file-input');
                    if (input) input.click();
                }
            });

            // 文件变更
            grid.addEventListener('change', (e) => {
                const input = e.target.closest('.slot-file-input');
                if (!input || !input.files || !input.files[0]) return;
                const dropzone = input.closest('.slot-dropzone');
                const code = dropzone?.dataset.code;
                const type = dropzone?.dataset.type;
                if (code) handleImageFile(input.files[0], code, type);
            });

            // 拖放处理
            grid.addEventListener('dragover', (e) => {
                const dropzone = e.target.closest('.slot-dropzone');
                if (dropzone) {
                    e.preventDefault();
                    dropzone.classList.add('dragover');
                }
            });

            grid.addEventListener('dragleave', (e) => {
                const dropzone = e.target.closest('.slot-dropzone');
                if (dropzone) dropzone.classList.remove('dragover');
            });

            grid.addEventListener('drop', (e) => {
                const dropzone = e.target.closest('.slot-dropzone');
                if (!dropzone) return;
                e.preventDefault();
                dropzone.classList.remove('dragover');
                const code = dropzone.dataset.code;
                const type = dropzone.dataset.type;
                const file = e.dataTransfer?.files?.[0];
                if (file && file.type.startsWith('image/')) {
                    handleImageFile(file, code, type);
                }
            });

            // 文本和名称修改 (防抖保存)
            grid.addEventListener('input', (e) => {
                const slotEl = e.target.closest('.custom-ref-slot');
                if (!slotEl) return;
                const code = slotEl.dataset.code;
                const type = slotEl.dataset.type;
                const promptEl = slotEl.querySelector('.slot-prompt');
                const nameEl = slotEl.querySelector('.slot-name');

                const targetStore = type === 'scene' ? APP.customSceneRefs : APP.customCharRefs;
                if (!targetStore[code]) targetStore[code] = { image: null, prompt: '', name: '' };
                targetStore[code].prompt = promptEl?.value?.trim() || '';
                targetStore[code].name = nameEl?.value?.trim() || '';

                const hasContent = !!targetStore[code].image || !!targetStore[code].prompt;
                slotEl.classList.toggle('has-content', hasContent);

                debounceSaveAssets(type);
            });
        });
    }

    let saveTimerChar = null;
    let saveTimerScene = null;
    function debounceSaveAssets(type) {
        if (type === 'scene') {
            clearTimeout(saveTimerScene);
            saveTimerScene = setTimeout(() => {
                chrome.storage.local.set({ customSceneRefs: APP.customSceneRefs }).catch(() => { });
            }, 500);
        } else {
            clearTimeout(saveTimerChar);
            saveTimerChar = setTimeout(() => {
                chrome.storage.local.set({ customCharRefs: APP.customCharRefs }).catch(() => { });
            }, 500);
        }
    }

    function removeSlotImage(code, type) {
        const targetStore = type === 'scene' ? APP.customSceneRefs : APP.customCharRefs;
        if (!targetStore[code]) return;
        targetStore[code].image = null;
        if (type === 'scene') {
            renderSceneRefGrid();
            chrome.storage.local.set({ customSceneRefs: APP.customSceneRefs });
        } else {
            renderCustomRefGrid();
            chrome.storage.local.set({ customCharRefs: APP.customCharRefs });
        }
    }

    function handleImageFile(file, code, type) {
        if (file.size > MAX_IMAGE_BYTES) {
            if (typeof showToast === 'function') showToast("图片文件超过 8MB 限制，请先压缩", 'warning');
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            const base64 = e.target?.result;
            if (!base64) return;
            const targetStore = type === 'scene' ? APP.customSceneRefs : APP.customCharRefs;
            if (!targetStore[code]) targetStore[code] = { image: null, prompt: '', name: '' };
            targetStore[code].image = base64;

            if (type === 'scene') {
                renderSceneRefGrid();
                chrome.storage.local.set({ customSceneRefs: APP.customSceneRefs });
            } else {
                renderCustomRefGrid();
                chrome.storage.local.set({ customCharRefs: APP.customCharRefs });
            }
        };
        reader.readAsDataURL(file);
    }

    function initAssetToggles() {
        const charCb = document.getElementById('useCustomCharRefsCheckbox');
        if (charCb) {
            charCb.addEventListener('change', (e) => {
                APP.useCustomCharRefs = e.target.checked;
                toggleSection('customCharRefsSection', APP.useCustomCharRefs);
                chrome.storage.local.set({ useCustomCharRefs: APP.useCustomCharRefs });
            });
        }

        const sceneCb = document.getElementById('useCustomSceneRefsCheckbox');
        if (sceneCb) {
            sceneCb.addEventListener('change', (e) => {
                APP.useCustomSceneRefs = e.target.checked;
                toggleSection('customSceneRefsSection', APP.useCustomSceneRefs);
                chrome.storage.local.set({ useCustomSceneRefs: APP.useCustomSceneRefs });
            });
        }

        const clearCharBtn = document.getElementById('clearAllCustomRefsBtn');
        if (clearCharBtn) {
            clearCharBtn.addEventListener('click', () => {
                if (!confirm("确定要清空全部 6 个角色槽位吗？")) return;
                CCR_CODES.forEach(code => { APP.customCharRefs[code] = null; });
                renderCustomRefGrid();
                chrome.storage.local.set({ customCharRefs: APP.customCharRefs });
            });
        }

        const clearSceneBtn = document.getElementById('clearAllSceneRefsBtn');
        if (clearSceneBtn) {
            clearSceneBtn.addEventListener('click', () => {
                if (!confirm("确定要清空全部 4 个场景槽位吗？")) return;
                SCR_CODES.forEach(code => { APP.customSceneRefs[code] = null; });
                renderSceneRefGrid();
                chrome.storage.local.set({ customSceneRefs: APP.customSceneRefs });
            });
        }
    }

    function initBrandProfileActions() {
        // 导出资产库 (包含角色与场景)
        const exportBtn = document.getElementById('exportBrandsBtn');
        if (exportBtn) {
            exportBtn.addEventListener('click', () => {
                const payload = {
                    schema: 'flowstudio-asset-profiles',
                    version: '2.1.0',
                    exportedAt: new Date().toISOString(),
                    charRefs: APP.customCharRefs,
                    sceneRefs: APP.customSceneRefs,
                    brandProfiles: APP.brandProfiles || []
                };
                const jsonStr = JSON.stringify(payload, null, 2);
                const blob = new Blob([jsonStr], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const stamp = new Date().toISOString().slice(0, 10);
                const a = document.createElement('a');
                a.href = url;
                a.download = `FlowStudio_Assets_${stamp}.json`;
                a.click();
                URL.revokeObjectURL(url);
                if (typeof showToast === 'function') showToast("✅ 角色与场景资产库已成功导出", 'success');
            });
        }

        // 导入资产库
        const importBtn = document.getElementById('importBrandsBtn');
        const fileInput = document.getElementById('brandImportFileInput');
        if (importBtn && fileInput) {
            importBtn.addEventListener('click', () => fileInput.click());
            fileInput.addEventListener('change', async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                try {
                    const text = await file.text();
                    const data = JSON.parse(text);
                    if (data.charRefs && typeof data.charRefs === 'object') {
                        CCR_CODES.forEach(c => {
                            if (data.charRefs[c]) APP.customCharRefs[c] = data.charRefs[c];
                        });
                        renderCustomRefGrid();
                        chrome.storage.local.set({ customCharRefs: APP.customCharRefs });
                    }
                    if (data.sceneRefs && typeof data.sceneRefs === 'object') {
                        SCR_CODES.forEach(s => {
                            if (data.sceneRefs[s]) APP.customSceneRefs[s] = data.sceneRefs[s];
                        });
                        renderSceneRefGrid();
                        chrome.storage.local.set({ customSceneRefs: APP.customSceneRefs });
                    }
                    if (Array.isArray(data.brandProfiles)) {
                        APP.brandProfiles = data.brandProfiles;
                        chrome.storage.local.set({ brandProfiles: APP.brandProfiles });
                    }
                    if (typeof showToast === 'function') showToast("🎉 资产库成功导入并生效！", 'success');
                } catch (err) {
                    if (typeof showToast === 'function') showToast("⚠️ JSON 解析失败，请检查文件格式", 'error');
                }
                fileInput.value = '';
            });
        }
    }

    // 暴露全局变量与接口
    window.CCR_CODES = CCR_CODES;
    window.SCR_CODES = SCR_CODES;
    window.initAssetManager = initAssetManager;
    window.renderCustomRefGrid = renderCustomRefGrid;
    window.renderSceneRefGrid = renderSceneRefGrid;
})();
