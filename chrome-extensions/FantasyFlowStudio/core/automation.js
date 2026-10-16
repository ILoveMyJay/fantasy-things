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

    // 5. 若 CDP 未能成功，执行 DOM 级原生触发
    if (!cdpSuccess) {
      submitBtn.dispatchEvent(new PointerEvent('pointerdown', opts));
      submitBtn.dispatchEvent(new MouseEvent('mousedown', opts));
      submitBtn.dispatchEvent(new PointerEvent('pointerup', opts));
      submitBtn.dispatchEvent(new MouseEvent('mouseup', opts));
      submitBtn.click();
    }

    await sleep(1000);
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
   * 确保进入 Google Flow 角色管理/创建页面 (/character)
   */
  async function navigateToCharacterPage() {
    if (window.location.pathname.endsWith('/character')) return true;

    // 寻找左侧项目导航栏中的「角色」链接或按钮
    const charNavBtn = document.querySelector('a[href*="/character"]') ||
      [...document.querySelectorAll('button, div[role="button"], flow-nav-item, li')].find(el => {
        const txt = (el.textContent || '').trim();
        const sym = el.querySelector('.google-symbols')?.textContent?.trim() || '';
        return txt.includes('角色') || sym === 'accessibility_new';
      });

    if (charNavBtn) {
      await clickElement(charNavBtn);
      await sleep(1200);
      return true;
    }

    // 路由跳转兜底
    const match = window.location.href.match(/\/project\/([a-zA-Z0-9_-]+)/);
    if (match) {
      window.location.href = `https://flow.google.com/project/${match[1]}/character`;
      await sleep(1500);
      return true;
    }
    return false;
  }

  /**
   * 返回角色列表
   */
  async function returnToCharacterList() {
    const backBtn = document.querySelector('flow-character-edit-header button[aria-label="返回"], button[aria-label="返回"], button.back-button') ||
      [...document.querySelectorAll('button')].find(b => (b.querySelector('.google-symbols')?.textContent || '').trim() === 'arrow_back');
    if (backBtn && isElementVisible(backBtn)) {
      await clickElement(backBtn);
      await sleep(800);
    }
  }

  /**
   * 将画板上的定妆图导入为正式的 Flow 角色库实体并正名
   */
  async function syncCharacterToFlowLibrary(char, options = {}) {
    const targetName = char.name || '未命名角色';

    // 1. 确保在 /character 页面
    await navigateToCharacterPage();
    await sleep(600);

    // 2. 检查角色库是否已存在同名角色
    const existingTiles = [...document.querySelectorAll('flow-character-tile')];
    const alreadyBuilt = existingTiles.find(t => (t.textContent || '').includes(targetName));
    if (alreadyBuilt) {
      console.log(`[FantasyAutomation] 角色【${targetName}】已在 Flow 角色库中存在，跳过导入`);
      return { ok: true, skipped: true };
    }

    // 3. 如果已有待命名的角色卡片，直接进入编辑更名
    const unnamedTile = existingTiles.find(t => /未命名的角色|Unnamed/i.test(t.textContent || ''));
    if (unnamedTile) {
      console.log(`[FantasyAutomation] 发现待命名角色卡片，进入更名为【${targetName}】...`);
      await clickElement(unnamedTile);
      await sleep(1000);
      await renameCharacter(targetName);
      await returnToCharacterList();
      return { ok: true, renamed: true };
    }

    // 4. 如果页面处于角色列表视图，点击「新角色」按钮以打开创建视图
    const newCharBtn = [...document.querySelectorAll('button')].find(b => {
      const txt = (b.textContent || '').trim();
      return /新角色|New\s*character/i.test(txt);
    }) || document.querySelector('button.custom-tile-container');
    if (newCharBtn && isElementVisible(newCharBtn)) {
      await clickElement(newCharBtn);
      await sleep(800);
    }

    // 5. 点击「+ 从项目中添加」按钮 (若弹窗未处于打开状态)
    const isModalOpen = !!document.querySelector('div[role="dialog"][data-state="open"], .cdk-overlay-pane [role="dialog"], div[role="dialog"]');
    if (!isModalOpen) {
      let addFromProjectBtn = null;
      const startWait = Date.now();
      while (Date.now() - startWait < 6000) {
        addFromProjectBtn = [...document.querySelectorAll('button')].find(b => {
          const txt = (b.textContent || '').trim();
          return /从项目中添加|Add\s*from\s*project|프로젝트에서\s*추가/i.test(txt);
        }) || document.querySelector('flow-create-character-footer button:last-child');
        if (addFromProjectBtn && isElementVisible(addFromProjectBtn)) break;
        await sleep(250);
      }

      if (!addFromProjectBtn) {
        throw new Error('未在 Flow 角色页面找到「从项目中添加」按钮，请确认处于角色页面');
      }

      await clickElement(addFromProjectBtn);
      await sleep(800);
    }

    // 6. 等待项目素材选择弹窗加载
    let assetOptions = [];
    const modalWait = Date.now();
    while (Date.now() - modalWait < 8000) {
      assetOptions = [...document.querySelectorAll('[role="option"], div[class*="asset-item"], .asset-item, div[data-item-index], [data-item-index]')].filter(isElementVisible);
      if (assetOptions.length > 0) break;
      await sleep(300);
    }

    if (assetOptions.length === 0) {
      throw new Error('未在项目中找到已生成的定妆图素材，请先运行定妆图渲染');
    }

    // 7. 在素材弹窗中精准匹配该角色的定妆图
    const normName = targetName.toLowerCase();
    let matchedOption = assetOptions.find(opt => {
      const txt = (opt.textContent || '').toLowerCase();
      const alt = (opt.querySelector('img')?.alt || '').toLowerCase();
      return txt.includes(normName) || alt.includes(normName);
    });

    if (!matchedOption && char.turnaroundPrompt) {
      const snippet = char.turnaroundPrompt.slice(0, 30).toLowerCase();
      matchedOption = assetOptions.find(opt => {
        const txt = (opt.textContent || '').toLowerCase();
        const alt = (opt.querySelector('img')?.alt || '').toLowerCase();
        return txt.includes(snippet) || alt.includes(snippet);
      });
    }

    // 兜底：按索引顺序选择或首张可用定妆图
    if (!matchedOption) {
      const charIndex = options.index || 0;
      matchedOption = assetOptions[charIndex] || assetOptions[0];
    }

    await clickElement(matchedOption);
    await sleep(400);

    // 点击弹窗中的「添加媒体 / 添加到提示」确认按钮
    const ADD_BTN_REGEX = /添加媒体|添加到提示|添加到画板|Add\s*media|Add\s*to\s*prompt/i;
    let confirmBtn = [...document.querySelectorAll('div[role="dialog"] button, button')].find(b => {
      if (!isElementVisible(b) || b.disabled) return false;
      return ADD_BTN_REGEX.test((b.textContent || '').trim());
    });
    if (!confirmBtn) {
      const dialog = document.querySelector('div[role="dialog"]');
      if (dialog) {
        const btns = [...dialog.querySelectorAll('button')].filter(b => isElementVisible(b) && !b.disabled);
        confirmBtn = btns[btns.length - 1];
      }
    }
    if (confirmBtn) {
      await clickElement(confirmBtn);
      await sleep(800);
    }

    // 8. 填入角色名称与描述
    const nameInput = document.querySelector('flow-character-form input.name-input, input[aria-label="角色名称"], input[placeholder="角色名称"], flow-character-edit-header input.editable-text-input');
    if (nameInput) {
      setNativeInputValue(nameInput, targetName);
      await sleep(200);
    }

    const editor = document.querySelector('flow-character-prompt-input [contenteditable="true"], flow-create-character-footer [contenteditable="true"], .ProseMirror[contenteditable="true"], [contenteditable="true"][data-slate-editor="true"], textarea');
    if (editor && !editor.textContent?.trim()) {
      editor.focus();
      document.execCommand('selectAll', false, null);
      document.execCommand('insertText', false, char.prompt || targetName);
      editor.dispatchEvent(new InputEvent('input', { bubbles: true }));
      await sleep(300);
    }

    // 9. 提交创建角色
    await clickSubmit();
    await sleep(1500);

    // 10. 轮询等待 Flow 角色建模完成（出现「完成修改」按钮）
    const waitBuildStart = Date.now();
    let saveSuccess = false;
    while (Date.now() - waitBuildStart < 60000) {
      const doneBtn = [...document.querySelectorAll('button')].find(b => {
        if (!isElementVisible(b) || b.disabled) return false;
        const txt = (b.textContent || '').trim();
        const aria = b.getAttribute('aria-label') || '';
        return /完成修改|完成|保存|Save|Done/i.test(txt) || /完成修改|完成|保存|Save|Done/i.test(aria) ||
          b.querySelector('.google-symbols')?.textContent?.trim() === 'check';
      });

      if (doneBtn && isElementVisible(doneBtn)) {
        // 保存前再次确保名字正确
        const curNameInput = document.querySelector('flow-character-form input.name-input, input[aria-label="角色名称"], input[placeholder="角色名称"], flow-character-edit-header input.editable-text-input');
        if (curNameInput && curNameInput.value !== targetName) {
          setNativeInputValue(curNameInput, targetName);
          await sleep(200);
        }

        await clickElement(doneBtn);
        await sleep(1200);
        saveSuccess = true;
        break;
      }
      await sleep(1000);
    }

    // 11. 返回角色列表
    await returnToCharacterList();
    await sleep(800);

    // 12. 角色卡片更名二次校验（若列表卡片仍为“未命名的角色”，触发卡片菜单重命名）
    try {
      await renameCharacter(targetName);
    } catch (_) {}

    return { ok: true, name: targetName, saveSuccess };
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
  async function waitForNewGeneration(initialTilesOrCount, timeoutMs = 120000, onProgress = null) {
    const startTime = Date.now();
    const isCount = typeof initialTilesOrCount === 'number';
    const initialCount = isCount ? initialTilesOrCount : (initialTilesOrCount?.size || 0);
    const initialSet = isCount ? null : initialTilesOrCount;

    while (Date.now() - startTime < timeoutMs) {
      const tiles = getCanvasMediaTiles();
      const readyTiles = tiles.filter(t => t.isReady);

      if (initialSet) {
        const newTile = readyTiles.find(t => t.src && !initialSet.has(t.src) && !initialSet.has(t.id));
        if (newTile) {
          if (onProgress) onProgress({ status: 'done', tile: newTile });
          return newTile;
        }
      }

      if (readyTiles.length > initialCount) {
        // Google Flow 倒序网格：最新生成的媒体置于最前方 (index 0)
        const latest = readyTiles[0] || readyTiles[readyTiles.length - 1];
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
    navigateToCharacterPage,
    returnToCharacterList,
    syncCharacterToFlowLibrary,
    openAssetPickerModal,
    selectAssetInModal,
    switchFlowMode,
    getCanvasMediaTiles,
    waitForNewGeneration
  };
})();
