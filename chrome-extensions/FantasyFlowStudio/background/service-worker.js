/**
 * FantasyFlowStudio - Background Service Worker (Manifest V3)
 * Handles sidepanel configuration, dynamic bridge injection, downloads, and automation support.
 */

// 1. 配置点击扩展图标直接打开 Side Panel (Chrome 116+)
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((err) => {
  console.warn('[FantasyFlowSW] setPanelBehavior error:', err);
});

// 2. 下载映射缓存 (处理动态子目录归档)
const pendingDownloads = new Map();

chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  if (pendingDownloads.has(item.id)) {
    const meta = pendingDownloads.get(item.id);
    pendingDownloads.delete(item.id);
    if (meta?.filename) {
      suggest({ filename: meta.filename, conflictAction: 'uniquify' });
      return true;
    }
  }
  suggest();
  return true;
});

// 3. CDP 调试支持（人类化轨迹与点击支持）
let cdpBusy = false;
const cdpQueue = [];

async function withCdp(tabId, fn, { skipIfBusy = false } = {}) {
  if (skipIfBusy && cdpBusy) return { ok: false, skipped: true };
  while (cdpBusy) {
    await new Promise((r) => cdpQueue.push(r));
  }
  cdpBusy = true;
  const target = { tabId };
  let attached = false;
  try {
    await chrome.debugger.attach(target, '1.3');
    attached = true;
    return await fn(target);
  } catch (e) {
    return { ok: false, error: e?.message };
  } finally {
    if (attached) {
      try { await chrome.debugger.detach(target); } catch (_) {}
    }
    cdpBusy = false;
    const next = cdpQueue.shift();
    if (next) next();
  }
}

// 4. 运行时消息分发
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'PING') {
    sendResponse({ alive: true });
    return true;
  }

  // 确保 Main World Bridge 动态就绪
  if (message.type === 'ENSURE_MAIN_BRIDGE') {
    (async () => {
      let tabId = sender.tab?.id || message.tabId;
      if (!tabId) {
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        tabId = activeTab?.id;
      }
      if (!tabId) {
        sendResponse({ ok: false, error: 'no tab id' });
        return;
      }
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          world: 'MAIN',
          files: ['core/bridge.js']
        });
        sendResponse({ ok: true });
      } catch (err) {
        console.warn('[FantasyFlowSW] 动态注入 bridge.js 失败:', err?.message);
        sendResponse({ ok: false, error: err?.message });
      }
    })();
    return true;
  }

  // 确保全套 Content Scripts 注入 (用于重新加载后的自愈)
  if (message.type === 'ENSURE_CONTENT_SCRIPTS') {
    (async () => {
      let tabId = sender.tab?.id || message.tabId;
      if (!tabId) {
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        tabId = activeTab?.id;
      }
      if (!tabId) {
        sendResponse({ ok: false, error: 'no tab id' });
        return;
      }
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          world: 'MAIN',
          files: ['core/bridge.js']
        });
        await chrome.scripting.executeScript({
          target: { tabId },
          files: [
            'core/selectors.js',
            'core/automation.js',
            'core/flow-pipeline.js'
          ]
        });
        sendResponse({ ok: true });
      } catch (err) {
        sendResponse({ ok: false, error: err?.message });
      }
    })();
    return true;
  }

  // 资产/媒体自动下载
  if (message.type === 'DOWNLOAD_FILE') {
    (async () => {
      try {
        const { url, filename, folder } = message;
        if (!url) {
          sendResponse({ ok: false, error: 'no url' });
          return;
        }
        const rootFolder = folder || 'FantasyFlowStudio';
        const targetFilename = filename ? `${rootFolder}/${filename}` : `${rootFolder}/media_${Date.now()}.jpg`;

        const downloadId = await chrome.downloads.download({
          url,
          filename: targetFilename,
          saveAs: false,
          conflictAction: 'uniquify'
        });

        pendingDownloads.set(downloadId, { filename: targetFilename });
        sendResponse({ ok: true, downloadId });
      } catch (err) {
        sendResponse({ ok: false, error: err?.message });
      }
    })();
    return true;
  }

  // CDP 仿真移动
  if (message.type === 'CDP_MOVE_TO') {
    const tabId = sender.tab?.id;
    if (!tabId) { sendResponse({ ok: false }); return true; }
    (async () => {
      const r = await withCdp(tabId, async (target) => {
        await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
          type: 'mouseMoved',
          x: Math.round(message.x),
          y: Math.round(message.y),
          buttons: 0
        });
        return { ok: true };
      }, { skipIfBusy: true });
      sendResponse(r);
    })();
    return true;
  }
});
