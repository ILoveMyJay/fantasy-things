/**
 * custom-char-refs.js — 向后兼容垫片
 * 实际功能已全面升级并合并至 asset-manager.js (支持 CCR 角色 + SCR 场景双锚点)
 */
if (typeof initAssetManager === 'function') {
    window.initCustomCharRefs = window.initAssetManager;
}
