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

// 3. CDP 调试支持（人类化轨迹与硬件级点击）
let cdpBusy = false;
const cdpQueue = [];
const _lastMousePos = new Map();

function _gauss(min, max) {
  const u1 = Math.random() || 1e-9;
  const u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  const mean = (min + max) / 2;
  const std = (max - min) / 4;
  return Math.max(min, Math.min(max, mean + z * std));
}

async function _cdpHumanMouseMove(target, tx, ty) {
  const tabId = target.tabId;
  const prev = _lastMousePos.get(tabId);
  let sx, sy;
  if (prev) {
    sx = prev.x + _gauss(-20, 20);
    sy = prev.y + _gauss(-20, 20);
  } else {
    sx = tx + _gauss(-200, 200);
    sy = ty + _gauss(-150, 150);
  }
  sx = Math.max(0, sx);
  sy = Math.max(0, sy);

  const sendMove = async (mx, my) => {
    try {
      await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: Math.round(mx),
        y: Math.round(my),
        buttons: 0
      });
    } catch (_) {}
  };

  const bezier = (t, p0, p1, p2) => {
    const mt = 1 - t;
    return mt * mt * p0 + 2 * mt * t * p1 + t * t * p2;
  };

  const dx = tx - sx;
  const dy = ty - sy;
  const dist = Math.hypot(dx, dy);
  const steps = Math.max(4, Math.min(24, Math.round(dist / _gauss(8, 20))));
  const midX = (sx + tx) / 2;
  const midY = (sy + ty) / 2;
  const perpAngle = Math.atan2(dy, dx) + Math.PI / 2;
  const bow = _gauss(0.05, 0.3) * dist * (Math.random() < 0.5 ? 1 : -1);
  const cpx = midX + Math.cos(perpAngle) * bow;
  const cpy = midY + Math.sin(perpAngle) * bow;

  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const jx = _gauss(-1, 1);
    const jy = _gauss(-1, 1);
    await sendMove(bezier(t, sx, cpx, tx) + jx, bezier(t, sy, cpy, ty) + jy);
    await new Promise(r => setTimeout(r, _gauss(4, 12)));
  }
  _lastMousePos.set(tabId, { x: tx, y: ty });
}

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
        sendResponse({ ok: false, error: '未找到目标标签页' });
        return;
      }
      try {
        // 先发送 PING 检测是否已经处于存活通信状态
        const isAlive = await new Promise((resolve) => {
          chrome.tabs.sendMessage(tabId, { type: 'PING' }, (res) => {
            if (chrome.runtime.lastError || !res?.ok) {
              resolve(false);
            } else {
              resolve(true);
            }
          });
        });

        if (isAlive) {
          sendResponse({ ok: true, alreadyLoaded: true });
          return;
        }

        // 注入 MAIN Bridge
        await chrome.scripting.executeScript({
          target: { tabId },
          world: 'MAIN',
          files: ['core/bridge.js']
        }).catch(() => {});

        // 注入 ISOLATED 核心自动化流水线
        await chrome.scripting.executeScript({
          target: { tabId },
          files: [
            'core/selectors.js',
            'core/automation.js',
            'core/flow-pipeline.js'
          ]
        });

        // 稍作等待以确保消息监听器挂载
        await new Promise(r => setTimeout(r, 200));

        // 二次验证通信状态
        const verified = await new Promise((resolve) => {
          chrome.tabs.sendMessage(tabId, { type: 'PING' }, (res) => {
            if (chrome.runtime.lastError || !res?.ok) {
              resolve(false);
            } else {
              resolve(true);
            }
          });
        });

        sendResponse({ ok: true, injected: true, verified });
      } catch (err) {
        console.warn('[FantasyFlowSW] 动态注入 Content Scripts 失败:', err);
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

  // CDP 硬件级真实鼠标点击 (isTrusted=true 突破 Flow 提交防护)
  if (message.type === 'CDP_CLICK') {
    let tabId = sender.tab?.id || message.tabId;
    (async () => {
      if (!tabId) {
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        tabId = activeTab?.id;
      }
      if (!tabId) {
        sendResponse({ ok: false, error: '未找到目标标签页' });
        return;
      }

      const { x, y, selector } = message;
      const r = await withCdp(tabId, async (target) => {
        await new Promise(r2 => setTimeout(r2, selector ? 300 : 60));
        let fx = x;
        let fy = y;

        if (selector) {
          try {
            const evalResult = await chrome.debugger.sendCommand(target, 'Runtime.evaluate', {
              expression: `(() => {
                const icons = [...document.querySelectorAll('${selector}')];
                const icon = icons.find(i => (i.textContent || '').trim() === 'arrow_forward') ||
                             icons.find(i => /arrow_forward|send/i.test((i.textContent || '').trim()));
                const btn = icon?.closest('button, [role="button"]') || icon?.parentElement;
                if (!btn) return null;
                const r = btn.getBoundingClientRect();
                return JSON.stringify({
                  x: Math.round(r.left + r.width / 2),
                  y: Math.round(r.top + r.height / 2),
                  w: Math.round(r.width),
                  h: Math.round(r.height)
                });
              })()`,
              returnByValue: true
            });
            const parsed = evalResult?.result?.value ? JSON.parse(evalResult.result.value) : null;
            if (parsed && parsed.x > 0 && parsed.y > 0) {
              const jx = Math.min(6, Math.floor((parsed.w || 0) * 0.2));
              const jy = Math.min(4, Math.floor((parsed.h || 0) * 0.2));
              const ox = jx > 0 ? (Math.floor(Math.random() * (jx * 2 + 1)) - jx) : 0;
              const oy = jy > 0 ? (Math.floor(Math.random() * (jy * 2 + 1)) - jy) : 0;
              fx = parsed.x + ox;
              fy = parsed.y + oy;
              console.log(`[FantasyFlowSW] CDP 重新校准坐标: (${x},${y}) -> (${fx},${fy})`);
            }
          } catch (coordErr) {
            console.warn('[FantasyFlowSW] CDP 坐标重新测量异常，使用原坐标:', coordErr?.message);
          }
        }

        // 人类化轨迹移动
        await _cdpHumanMouseMove(target, fx, fy);
        await new Promise(r2 => setTimeout(r2, 40 + Math.random() * 60));

        // 真实鼠标按下 (isTrusted = true)
        await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
          type: 'mousePressed',
          x: fx,
          y: fy,
          button: 'left',
          clickCount: 1
        });

        await new Promise(r2 => setTimeout(r2, 60 + Math.random() * 60));

        // 真实鼠标松开 (isTrusted = true)
        await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
          type: 'mouseReleased',
          x: fx,
          y: fy,
          button: 'left',
          clickCount: 1
        });

        _lastMousePos.set(tabId, { x: fx, y: fy });
        return { ok: true, coords: { x: fx, y: fy } };
      });

      sendResponse(r);
    })();
    return true;
  }

  // CDP 键盘 Enter 事件
  if (message.type === 'CDP_PRESS_ENTER') {
    let tabId = sender.tab?.id || message.tabId;
    (async () => {
      if (!tabId) {
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        tabId = activeTab?.id;
      }
      if (!tabId) {
        sendResponse({ ok: false, error: '未找到目标标签页' });
        return;
      }

      const r = await withCdp(tabId, async (target) => {
        await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', {
          type: 'rawKeyDown',
          key: 'Enter',
          code: 'Enter',
          windowsVirtualKeyCode: 13,
          nativeVirtualKeyCode: 13
        });
        await new Promise(r2 => setTimeout(r2, 60));
        await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', {
          type: 'keyUp',
          key: 'Enter',
          code: 'Enter',
          windowsVirtualKeyCode: 13,
          nativeVirtualKeyCode: 13
        });
        return { ok: true };
      });
      sendResponse(r);
    })();
    return true;
  }
});
