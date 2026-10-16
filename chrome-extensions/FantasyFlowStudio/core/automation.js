/**
 * FantasyFlowStudio - Core Automation Engine (ISOLATED World)
 * 提供对 Google Flow (flow.google.com) 的全流程 DOM 操作、输入注入、状态轮询与弹窗控制。
 * 具备双重注入防超时降级机制 (Slate Bridge + Native DOM Fallback)。
 */

(() => {
  if (typeof window === 'undefined') return;

  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  function gaussianDelay(min = 150, max = 350) {
    const u = Math.random() + Math.random();
    const factor = u / 2;
    return Math.floor(min + factor * (max - min));
  }

  async function waitFor(conditionFn, timeout = 10000, interval = 100) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      try {
        const res = await conditionFn();
        if (res) return res;
      } catch (_) {}
      await sleep(interval);
    }
    return null;
  }

  function isElementVisible(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 &&
      style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
  }

  function findPromptEditor() {
    const sel = (window.FANTASY_SELECTORS && window.FANTASY_SELECTORS.PROMPT_EDITOR) ||
      '[contenteditable="true"][data-slate-editor="true"], .ProseMirror[contenteditable="true"], div[contenteditable="true"], [contenteditable="true"]';
    return document.querySelector(sel);
  }

  /**
   * 原生 DOM 提示词填充降级方案（100% 成功率，防止任何 Bridge 通信超时）
   */
  function nativeFillPrompt(editor, text, replaceAll = true) {
    if (!editor) return false;
    try {
      editor.focus();
      const sel = window.getSelection();
      const range = document.createRange();

      if (replaceAll) {
        range.selectNodeContents(editor);
        sel.removeAllRanges();
        sel.addRange(range);
        document.execCommand('delete', false, null);
      } else {
        range.selectNodeContents(editor);
        range.collapse(false); // 移至末尾
        sel.removeAllRanges();
        sel.addRange(range);
      }

      if (text) {
        const ok = document.execCommand('insertText', false, text);
        if (!ok) {
          editor.textContent = (replaceAll ? '' : editor.textContent) + text;
        }
      }

      editor.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      editor.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    } catch (e) {
      console.warn('[FantasyFlowStudio] nativeFillPrompt fallback error:', e);
      return false;
    }
  }

  /**
   * 填充提示词：优先调用 MAIN world Slate Fiber，超时 1200ms 则平滑降级至 Native DOM
   */
  async function fillPrompt(text, replaceAll = true) {
    const editor = findPromptEditor();
    if (!editor) {
      throw new Error('未在 Flow 画板页面找到提示词输入框，请确认您已打开 flow.google.com 项目');
    }

    const eventId = 'req_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);

    const bridgePromise = new Promise((resolve, reject) => {
      const handler = (e) => {
        if (e.detail?.id === eventId) {
          window.removeEventListener('__fantasyFillPromptDone', handler);
          if (e.detail?.ok) {
            resolve(true);
          } else {
            reject(new Error(e.detail?.error || 'Bridge 提示词输入失败'));
          }
        }
      };
      window.addEventListener('__fantasyFillPromptDone', handler);

      window.dispatchEvent(new CustomEvent('__fantasyFillPrompt', {
        detail: { id: eventId, text, replaceAll }
      }));
    });

    const timeoutPromise = new Promise((resolve) => setTimeout(() => resolve('TIMEOUT'), 1200));

    try {
      const raceResult = await Promise.race([bridgePromise, timeoutPromise]);
      if (raceResult === 'TIMEOUT') {
        console.warn('[FantasyFlowStudio] Slate Bridge 响应超时，自动切换至原生 DOM 注入...');
        return nativeFillPrompt(editor, text, replaceAll);
      }
      return true;
    } catch (err) {
      console.warn('[FantasyFlowStudio] Slate Bridge 失败，切换至原生 DOM 注入:', err?.message);
      return nativeFillPrompt(editor, text, replaceAll);
    }
  }

  /**
   * 清除残留的 '@'
   */
  async function stripMentionTrigger() {
    const eventId = 'strip_' + Date.now();
    return new Promise((resolve) => {
      const handler = (e) => {
        if (e.detail?.id === eventId) {
          window.removeEventListener('__fantasyStripMentionTriggerDone', handler);
          resolve(e.detail?.ok);
        }
      };
      window.addEventListener('__fantasyStripMentionTriggerDone', handler);
      window.dispatchEvent(new CustomEvent('__fantasyStripMentionTrigger', { detail: { id: eventId } }));
      setTimeout(() => resolve(false), 500);
    });
  }

  /**
   * 模拟高精度平滑点击
   */
  async function clickElement(el) {
    if (!el) return false;
    try {
      el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
      await sleep(40);
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const opts = { bubbles: true, cancelable: true, composed: true, clientX: cx, clientY: cy };

      el.dispatchEvent(new PointerEvent('pointerover', opts));
      el.dispatchEvent(new PointerEvent('pointerenter', opts));
      el.dispatchEvent(new MouseEvent('mouseover', opts));
      el.dispatchEvent(new MouseEvent('mouseenter', opts));
      el.dispatchEvent(new PointerEvent('pointerdown', opts));
      el.dispatchEvent(new MouseEvent('mousedown', opts));
      el.dispatchEvent(new PointerEvent('pointerup', opts));
      el.dispatchEvent(new MouseEvent('mouseup', opts));
      el.click();
      return true;
    } catch (e) {
      try { el.click(); return true; } catch (_) { return false; }
    }
  }

  /**
   * 寻找生成提交按钮 (最高优先级的 arrow_forward 图标定位 + 容器遍历 + 属性匹配)
   */
  function findSubmitButton() {
    // 1. 🥇 1 优先级：查找包含 'arrow_forward' 或 'send' 的图标元素，取其所属 button
    try {
      const icons = document.querySelectorAll('.google-symbols, i, span');
      for (let i = 0; i < icons.length; i++) {
        const icon = icons[i];
        const text = (icon.textContent || '').trim();
        if (text === 'arrow_forward' || text === 'send') {
          const btn = icon.closest('button, [role="button"]') || icon.parentElement;
          if (btn && isElementVisible(btn)) return btn;
        }
      }
    } catch (_) {}

    // 2. 🥈 2 优先级：在 Prompt Editor 所在的父容器/卡片内部定位提交按钮
    try {
      const editor = findPromptEditor();
      if (editor) {
        let container = editor.parentElement;
        for (let depth = 0; depth < 5 && container; depth++) {
          const btns = container.querySelectorAll('button, [role="button"]');
          for (let i = btns.length - 1; i >= 0; i--) {
            const btn = btns[i];
            if (!isElementVisible(btn)) continue;
            if (btn.getAttribute('aria-haspopup') === 'menu') continue; // 排除模型切换下拉框
            const label = btn.getAttribute('aria-label') || '';
            if (/close|clear|cancel|关闭/i.test(label)) continue;

            const sym = btn.querySelector('.google-symbols, i, span');
            const symText = (sym?.textContent || '').trim();
            if (symText === 'arrow_forward' || symText === 'send') return btn;

            // 如果位于卡片右侧且带有图标
            const rect = btn.getBoundingClientRect();
            if (rect.width >= 24 && rect.height >= 24 && (btn.querySelector('.google-symbols') || btn.querySelector('svg'))) {
              return btn;
            }
          }
          container = container.parentElement;
        }
      }
    } catch (_) {}

    // 3. 🥉 3 优先级：多语言 aria-label 精准匹配 (排除 menu 下拉)
    try {
      const btns = document.querySelectorAll('button, [role="button"]');
      const SUBMIT_REGEX = /^(生成|提交|Generate|Submit|생성|제출)$/i;
      for (let i = 0; i < btns.length; i++) {
        const btn = btns[i];
        if (!isElementVisible(btn)) continue;
        if (btn.getAttribute('aria-haspopup') === 'menu') continue;
        const label = btn.getAttribute('aria-label') || '';
        if (SUBMIT_REGEX.test(label) || SUBMIT_REGEX.test((btn.textContent || '').trim())) {
          return btn;
        }
      }
    } catch (_) {}

    return null;
  }

  /**
   * 等待提交按钮进入就绪可点击状态 (等待 React 状态渲染完成)
   */
  async function waitForSubmitEnabled(timeout = 3000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const btn = findSubmitButton();
      if (btn && !btn.disabled && btn.getAttribute('aria-disabled') !== 'true' && btn.getAttribute('data-state') !== 'disabled') {
        return btn;
      }
      await sleep(100);
    }
    return findSubmitButton();
  }

  /**
   * 触发生成提交按钮 (优先 CDP 硬件级真实鼠标事件 isTrusted=true，突破 Flow 提交防护)
   */
  async function clickSubmit() {
    // 1. 等待提交按钮变为可点击状态
    const submitBtn = await waitForSubmitEnabled(3000);
    if (!submitBtn) {
      throw new Error('未找到 Flow 生成提交按钮，请确认当前已处于 flow.google.com 项目画板并且输入框可用');
    }

    // 2. 滚动并测量坐标
    try {
      submitBtn.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    } catch (_) {}
    await sleep(80);

    const rect = submitBtn.getBoundingClientRect();
    const cx = Math.round(rect.left + rect.width / 2);
    const cy = Math.round(rect.top + rect.height / 2);

    // 3. 产生 UI hover / pointer 视觉反馈
    const opts = { bubbles: true, cancelable: true, composed: true, clientX: cx, clientY: cy };
    submitBtn.dispatchEvent(new PointerEvent('pointerover', opts));
    submitBtn.dispatchEvent(new PointerEvent('pointerenter', opts));
    submitBtn.dispatchEvent(new MouseEvent('mouseover', opts));

    // 4. 发起 CDP 硬件级真实鼠标点击 (isTrusted=true)
    let cdpSuccess = false;
    try {
      const cdpRes = await new Promise((resolve) => {
        chrome.runtime.sendMessage({
          type: 'CDP_CLICK',
          x: cx,
          y: cy,
          selector: '.google-symbols, span, i'
        }, (res) => {
          resolve(res || { ok: false, error: 'no response' });
        });
      });

      if (cdpRes && cdpRes.ok) {
        cdpSuccess = true;
        console.log('[FantasyAutomation] CDP 硬件级真实点击成功:', cdpRes);
      } else {
        console.warn('[FantasyAutomation] CDP 点击未成功，回退到原生点击方案:', cdpRes?.error);
      }
    } catch (e) {
      console.warn('[FantasyAutomation] CDP 通信异常，回退原生:', e);
    }

    // 5. 若 CDP 未能成功，或者作为双重保险，执行 DOM 级原生触发
    if (!cdpSuccess) {
      submitBtn.dispatchEvent(new PointerEvent('pointerdown', opts));
      submitBtn.dispatchEvent(new MouseEvent('mousedown', opts));
      submitBtn.dispatchEvent(new PointerEvent('pointerup', opts));
      submitBtn.dispatchEvent(new MouseEvent('mouseup', opts));
      submitBtn.click();
    }

    // 6. 等待并检查：若未被消费，尝试通过 CDP Enter 辅助确认提交
    await sleep(600);
    const editor = findPromptEditor();
    if (editor && (editor.textContent || '').trim().length > 0) {
      try {
        await new Promise((resolve) => {
          chrome.runtime.sendMessage({ type: 'CDP_PRESS_ENTER' }, resolve);
        });
      } catch (_) {}
    }

    await sleep(600);
    return true;
  }

  /**
   * Angular / React 原生 Input 设值（突破受控组件封装）
   */
  function setNativeInputValue(input, value) {
    if (!input) return false;
    input.focus();
    const descriptor = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
    if (descriptor && descriptor.set) {
      descriptor.set.call(input, value);
    } else {
      input.value = value;
    }
    input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    input.dispatchEvent(new Event('blur', { bubbles: true, composed: true }));
    return true;
  }

  /**
   * 角色重命名（支持 Flow 角色详情页或角色磁贴菜单）
   */
  async function renameCharacter(name) {
    if (!name) return false;

    // 1. 尝试角色编辑表单中的输入框
    const formInput = document.querySelector('flow-character-form input.name-input, flow-character-edit-header input.editable-text-input, input[aria-label="角色名称"]');
    if (formInput && isElementVisible(formInput)) {
      setNativeInputValue(formInput, name);
      await sleep(150);
      const saveBtn = document.querySelector('flow-character-edit-header button[aria-label="完成修改"], button[aria-label="完成修改"]');
      if (saveBtn) await clickElement(saveBtn);
      return true;
    }

    // 2. 尝试磁贴右键/菜单重命名
    const tile = document.querySelector('flow-character-tile');
    if (tile) {
      const moreBtn = tile.querySelector('button[aria-label="更多选项"], button[aria-label="More options"]');
      if (moreBtn) {
        await clickElement(moreBtn);
        await sleep(200);

        const renameMenuItem = [...document.querySelectorAll('[role="menuitem"], button')]
          .find(el => /重命名|Rename|이름\s*변경/i.test(el.textContent || ''));
        if (renameMenuItem) {
          await clickElement(renameMenuItem);
          await sleep(200);

          const overlayInput = document.querySelector('.rename-tile-overlay input, .cdk-overlay-pane input');
          if (overlayInput) {
            setNativeInputValue(overlayInput, name);
            await sleep(100);
            overlayInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
            const confirmBtn = document.querySelector('.rename-tile-overlay button[aria-label="完成"]');
            if (confirmBtn) await clickElement(confirmBtn);
            return true;
          }
        }
      }
    }
    return false;
  }

  /**
   * 打开素材选择弹窗（点击 '+' 按钮或输入 '@'）
   */
  async function openAssetPickerModal() {
    // 优先寻找 '+' 按钮
    let addBtn = null;
    try {
      addBtn = document.querySelector('button.add-menu-trigger, button[aria-haspopup="dialog"]');
    } catch (_) {}

    if (!addBtn) {
      const buttons = document.querySelectorAll('button');
      for (let i = 0; i < buttons.length; i++) {
        const b = buttons[i];
        const sym = b.querySelector('.google-symbols, i, span')?.textContent?.trim();
        if (sym === 'add_2' || sym === 'add') {
          addBtn = b;
          break;
        }
        const label = b.getAttribute('aria-label') || '';
        if (/添加|Add|추가/i.test(label) && b.getAttribute('aria-haspopup')) {
          addBtn = b;
          break;
        }
      }
    }

    if (addBtn) {
      await clickElement(addBtn);
      await sleep(200);
    } else {
      // 降级为在输入框输入 '@'
      await fillPrompt('@', false);
      await sleep(250);
    }

    // 等待弹窗出现
    return await waitFor(() => {
      const dialog = document.querySelector('div[role="dialog"][data-state="open"], .cdk-overlay-pane [role="dialog"], [role="listbox"]');
      return dialog && isElementVisible(dialog) ? dialog : null;
    }, 4000);
  }

  /**
   * 在弹窗中选择资产（角色参考图或分镜图片）并附加到提示词
   */
  async function selectAssetInModal(queryOrIndex) {
    const modal = document.querySelector('div[role="dialog"][data-state="open"], .cdk-overlay-pane, [role="listbox"]');
    if (!modal) return false;

    await waitFor(() => modal.querySelectorAll('[role="option"], [data-item-index], .asset-item').length > 0, 3000);
    const items = [...modal.querySelectorAll('[role="option"], [data-item-index], .asset-item')];
    if (!items.length) return false;

    let targetItem = null;
    if (typeof queryOrIndex === 'number') {
      targetItem = items[queryOrIndex] || items[0];
    } else if (typeof queryOrIndex === 'string' && queryOrIndex.trim()) {
      const q = queryOrIndex.toLowerCase();
      targetItem = items.find(it => (it.textContent || '').toLowerCase().includes(q) || (it.querySelector('img')?.alt || '').toLowerCase().includes(q));
    }

    if (!targetItem) targetItem = items[0];

    const clickable = targetItem.querySelector('div') || targetItem;
    await clickElement(clickable);
    await sleep(200);

    // 检查是否有关闭或"添加到提示/添加媒体"按钮
    const confirmBtn = [...modal.querySelectorAll('button')].find(b =>
      /添加媒体|添加到提示|添加到画板|Add\s*media|Add\s*to\s*prompt/i.test(b.textContent || '')
    );

    if (confirmBtn && isElementVisible(confirmBtn)) {
      await clickElement(confirmBtn);
    }

    await stripMentionTrigger();
    await sleep(300);
    return true;
  }

  /**
   * 切换 Flow 生成模式 ('IMAGE' | 'VIDEO')
   */
  async function switchFlowMode(mode) {
    const isVideo = mode === 'VIDEO';
    const targetPattern = isVideo ? /视频|Video|동영상/i : /图片|Image|이미지/i;

    const tabs = [...document.querySelectorAll('[role="tab"], button[id*="trigger-"]')];
    const targetTab = tabs.find(t => targetPattern.test(t.textContent || '') || (isVideo ? t.id.includes('VIDEO') : t.id.includes('IMAGE')));

    if (targetTab && targetTab.getAttribute('aria-selected') !== 'true') {
      await clickElement(targetTab);
      await sleep(400);
      return true;
    }
    return false;
  }

  /**
   * 获取画板上所有已完成的媒体磁贴信息
   */
  function getCanvasMediaTiles() {
    const tiles = [...document.querySelectorAll('[data-tile-id], flow-grid-tile-container')];
    return tiles.map(tile => {
      const id = tile.getAttribute('data-tile-id') || '';
      const img = tile.querySelector('img');
      const video = tile.querySelector('video');
      const src = img?.src || video?.src || '';
      const isReady = !!src && !src.startsWith('blob:') && !src.includes('data:image/svg') &&
        (src.includes('getMediaUrlRedirect') || src.includes('flow-content.google') || src.startsWith('http'));
      return {
        id,
        tile,
        type: video ? 'video' : 'image',
        src,
        isReady
      };
    });
  }

  /**
   * 轮询等待新生成结果产出（磁贴计数增加且图片/视频加载就绪）
   */
  async function waitForNewGeneration(initialCount, timeoutMs = 120000, onProgress = null) {
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
      const tiles = getCanvasMediaTiles();
      const readyTiles = tiles.filter(t => t.isReady);

      if (readyTiles.length > initialCount) {
        const latest = readyTiles[readyTiles.length - 1];
        if (onProgress) onProgress({ status: 'done', tile: latest });
        return latest;
      }

      const elapsed = Math.round((Date.now() - startTime) / 1000);
      if (onProgress) onProgress({ status: 'generating', elapsed });
      await sleep(1500);
    }
    throw new Error(`生成超时 (${timeoutMs / 1000}秒未检测到新媒体生成就绪)`);
  }

  // 挂载到 window 供 pipeline 与 sidepanel 调度使用
  window.FantasyAutomation = {
    sleep,
    gaussianDelay,
    waitFor,
    isElementVisible,
    findPromptEditor,
    fillPrompt,
    stripMentionTrigger,
    clickElement,
    clickSubmit,
    setNativeInputValue,
    renameCharacter,
    openAssetPickerModal,
    selectAssetInModal,
    switchFlowMode,
    getCanvasMediaTiles,
    waitForNewGeneration
  };
})();
