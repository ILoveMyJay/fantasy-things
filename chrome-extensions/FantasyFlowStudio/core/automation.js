/**
 * FantasyFlowStudio - Core Automation Engine (ISOLATED World)
 * 提供对 Google Flow (flow.google.com) 的全流程 DOM 操作、输入注入、状态轮询与弹窗控制。
 * 具备双重注入防超时降级机制 (Slate Bridge + Native DOM Fallback)。
 */

(() => {
  if (typeof window === 'undefined') return;
  if (window.__fantasyAutomationLoaded) return;
  window.__fantasyAutomationLoaded = true;

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
   * 寻找生成提交按钮 (最高优先级的 开始生成 / arrow_forward / 生成 属性与容器匹配)
   */
  function findSubmitButton() {
    // 1. 🥇 1 优先级：多语言 aria-label 包含匹配（开始生成 / 生成 / Submit / Generate）
    try {
      const btns = document.querySelectorAll('button, [role="button"]');
      const SUBMIT_REGEX = /开始生成|生成|提交|Generate|Submit|생성|제출/i;
      for (let i = 0; i < btns.length; i++) {
        const btn = btns[i];
        if (!isElementVisible(btn)) continue;
        if (btn.getAttribute('aria-haspopup') === 'menu') continue; // 排除模型下拉框
        const label = btn.getAttribute('aria-label') || '';
        const text = (btn.textContent || '').trim();
        if (SUBMIT_REGEX.test(label) || SUBMIT_REGEX.test(text)) {
          return btn;
        }
      }
    } catch (_) {}

    // 2. 🥈 2 优先级：查找包含 'arrow_forward' 或 'send' 的图标元素，取其所属 button
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

    // 3. 🥉 3 优先级：在 Prompt Editor 所在的父容器/卡片内部定位提交按钮
    try {
      const editor = findPromptEditor();
      if (editor) {
        let container = editor.parentElement;
        for (let depth = 0; depth < 5 && container; depth++) {
          const btns = container.querySelectorAll('button, [role="button"]');
          for (let i = btns.length - 1; i >= 0; i--) {
            const btn = btns[i];
            if (!isElementVisible(btn)) continue;
            if (btn.getAttribute('aria-haspopup') === 'menu') continue;
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

    return null;
  }

  /**
   * 等待提交按钮进入就绪可点击状态 (等待 React 状态渲染完成)
   */
  async function waitForSubmitEnabled(timeout = 2000) {
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
   * 触发生成提交 (按钮点击 + 输入框 Enter 键盘事件双重保证)
   */
  async function clickSubmit() {
    // 1. 尝试寻找提交按钮并点击
    const submitBtn = await waitForSubmitEnabled(2000);
    let cdpSuccess = false;

    if (submitBtn) {
      try {
        submitBtn.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
      } catch (_) {}
      await sleep(80);

      const rect = submitBtn.getBoundingClientRect();
      const cx = Math.round(rect.left + rect.width / 2);
      const cy = Math.round(rect.top + rect.height / 2);

      const opts = { bubbles: true, cancelable: true, composed: true, clientX: cx, clientY: cy };
      submitBtn.dispatchEvent(new PointerEvent('pointerover', opts));
      submitBtn.dispatchEvent(new PointerEvent('pointerenter', opts));
      submitBtn.dispatchEvent(new MouseEvent('mouseover', opts));

      // 发起 CDP 硬件级点击
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
        }
      } catch (_) {}

      // 原生 DOM 事件兜底
      submitBtn.dispatchEvent(new PointerEvent('pointerdown', opts));
      submitBtn.dispatchEvent(new MouseEvent('mousedown', opts));
      submitBtn.dispatchEvent(new PointerEvent('pointerup', opts));
      submitBtn.dispatchEvent(new MouseEvent('mouseup', opts));
      submitBtn.click();
      await sleep(200);
    }

    // 2. ★ 核心加固：无论按钮是否点击成功，均在输入框派发 Enter 键盘事件
    const editor = findPromptEditor();
    if (editor) {
      editor.focus();
      editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
      editor.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
      editor.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
      editor.dispatchEvent(new Event('input', { bubbles: true }));
    }

    // 3. 触发 CDP 硬件级 Enter
    try {
      chrome.runtime.sendMessage({ type: 'CDP_PRESS_ENTER' }).catch(() => {});
    } catch (_) {}

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
   * 在角色详情编辑页 (/character/<id>) 中修改名称并保存
   */
  async function renameInCharacterEditPage(targetName) {
    if (!targetName) return false;

    // 1. 等待名称输入框就绪
    let nameInput = null;
    let headerInput = null;
    const startWait = Date.now();
    while (Date.now() - startWait < 5000) {
      nameInput = document.querySelector('flow-character-form input.name-input, input[aria-label="角色名称"], input[placeholder="角色名称"]');
      headerInput = document.querySelector('flow-character-edit-header input.editable-text-input, input[aria-label="可编辑文本"]');
      if (nameInput || headerInput) break;
      await sleep(200);
    }

    if (!nameInput && !headerInput) {
      console.warn('[FantasyAutomation] 未在详情页找到角色名称输入框');
      return false;
    }

    // 2. 双重设值：表单输入框 + 顶栏标题输入框
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;

    if (nameInput) {
      nameInput.focus();
      nativeSetter.call(nameInput, targetName);
      nameInput.dispatchEvent(new Event('input', { bubbles: true }));
      nameInput.dispatchEvent(new Event('change', { bubbles: true }));
      nameInput.dispatchEvent(new Event('blur', { bubbles: true }));
      await sleep(150);
    }

    if (headerInput) {
      headerInput.focus();
      nativeSetter.call(headerInput, targetName);
      headerInput.dispatchEvent(new Event('input', { bubbles: true }));
      headerInput.dispatchEvent(new Event('change', { bubbles: true }));
      headerInput.dispatchEvent(new Event('blur', { bubbles: true }));
      await sleep(150);
    }

    // 3. 点击「完成修改」保存
    const doneBtn = document.querySelector('flow-character-edit-header button[aria-label="完成修改"], button[aria-label="完成修改"]') ||
      [...document.querySelectorAll('button')].find(b => {
        const txt = (b.textContent || '').trim();
        const aria = b.getAttribute('aria-label') || '';
        const sym = (b.querySelector('.google-symbols, i, span')?.textContent || '').trim();
        return /完成修改|完成|保存|Save|Done/i.test(txt) || /完成修改|完成|保存|Save|Done/i.test(aria) || sym === 'check';
      });

    if (doneBtn) {
      doneBtn.click();
      await sleep(1200);
      return true;
    } else {
      if (nameInput) {
        nameInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
      }
      await sleep(600);
      return true;
    }
  }

  /**
   * 角色卡片更名正名（双引擎：优先卡片悬停就地更名，未果则自动无缝点击卡片进入详情页保存）
   */
  async function renameCharacterTile(targetName, options = {}) {
    if (!targetName) return false;

    // 0. 若当前已处于角色编辑详情页，直接在表单中设值保存
    if (/\/character\/[a-zA-Z0-9_-]+/.test(window.location.pathname) || document.querySelector('flow-character-edit-header, flow-character-form')) {
      return await renameInCharacterEditPage(targetName);
    }

    // 1. 确保位于角色页面 (/character)
    await navigateToCharacterPage();
    await sleep(400);

    // 2. 寻找目标角色卡片（优先寻找“未命名的角色”卡片）
    const findTargetTile = () => {
      const tiles = [...document.querySelectorAll('flow-character-tile, flow-tile-container, [class*="character-tile"], [data-tile-id]')];
      return tiles.find(t => /未命名的角色|Unnamed\s*character/i.test(t.textContent || '')) ||
             tiles.find(t => t.querySelector('img[alt*="角色"]') || t.querySelector('.character-tile-name')) ||
             (typeof options.index === 'number' && tiles[options.index]) ||
             tiles[tiles.length - 1];
    };

    let tile = findTargetTile();
    if (!tile) {
      const waitStart = Date.now();
      while (Date.now() - waitStart < 3000) {
        await sleep(250);
        tile = findTargetTile();
        if (tile) break;
      }
    }

    if (!tile) {
      console.warn('[FantasyAutomation] 未找到可命名的角色卡片');
      return false;
    }

    // ========================================================
    // 策略 1：卡片悬停 -> 更多选项 (⋮) -> 重命名 (In-place Rename)
    // ========================================================
    try {
      // 触发 hover 事件，激活卡片的 .hover-overlay
      tile.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      tile.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      tile.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
      await sleep(150);

      const moreBtn = tile.querySelector('button[aria-label="更多选项"], button[aria-label*="更多"], button[aria-label*="More"]') ||
        [...tile.querySelectorAll('button')].find(b => {
          const sym = (b.querySelector('.google-symbols, i, span')?.textContent || '').trim();
          return sym === 'more_vert' || sym === 'more_horiz';
        });

      if (moreBtn) {
        moreBtn.click();
        await sleep(350);

        // 匹配菜单项中的「重命名」
        const menuItems = [...document.querySelectorAll('.mat-mdc-menu-item, [role="menuitem"], .mat-menu-item')];
        const renameItem = menuItems.find(el => /重命名|Rename/i.test((el.textContent || '').trim()));

        if (renameItem) {
          renameItem.click();
          await sleep(350);

          const renameInput = document.querySelector('.rename-tile-overlay input.editable-text-input, .cdk-overlay-pane input, input.editable-text-input.editing') ||
                              document.activeElement;

          if (renameInput && renameInput.tagName === 'INPUT') {
            renameInput.focus();
            const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            nativeSetter.call(renameInput, targetName);
            renameInput.dispatchEvent(new Event('input', { bubbles: true }));
            renameInput.dispatchEvent(new Event('change', { bubbles: true }));
            await sleep(150);

            const confirmBtn = document.querySelector('.rename-tile-overlay button[aria-label="完成"], .cdk-overlay-pane button[aria-label="完成"]') ||
              [...document.querySelectorAll('.rename-tile-overlay button')].find(b => {
                const sym = (b.querySelector('.google-symbols, i, span')?.textContent || '').trim();
                return sym === 'done' || sym === 'check';
              });

            if (confirmBtn) {
              confirmBtn.click();
            } else {
              renameInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
              renameInput.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
            }
            await sleep(600);

            if (tile.textContent && tile.textContent.includes(targetName)) {
              console.log(`[FantasyAutomation] 策略1 (就地更名) 成功更新角色名为【${targetName}】`);
              return true;
            }
          }
        }
      }
    } catch (err) {
      console.warn('[FantasyAutomation] 策略1 就地更名遇阻，将自动切换至策略2 (详情页更名):', err?.message);
    }

    // ========================================================
    // 策略 2：直接点击角色卡片进入详情页 (/character/<id>) -> 修改名称 -> 完成修改
    // ========================================================
    console.log(`[FantasyAutomation] 启动策略2：点击角色卡片进入详情页正名为【${targetName}】...`);
    try {
      const clickable = tile.querySelector('img, .character-tile-container, span') || tile;
      await clickElement(clickable);
      await sleep(1000);

      const success = await renameInCharacterEditPage(targetName);
      if (success) {
        console.log(`[FantasyAutomation] 策略2 (详情页更名) 成功正名为【${targetName}】并已保存`);
        return true;
      }
    } catch (err2) {
      console.warn('[FantasyAutomation] 策略2 异常:', err2?.message);
    }

    return false;
  }

  /**
   * 角色重命名总入口
   */
  async function renameCharacter(name) {
    if (!name) return false;
    return await renameCharacterTile(name);
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
   * 确保返回 Google Flow 主画板 /「所有媒体」页面 (/project/<id>)
   */
  async function navigateToProjectPage() {
    const match = window.location.pathname.match(/\/project\/([a-zA-Z0-9_-]+)(.*)/);
    const subRoute = match ? match[2] : '';
    const isCharacterRoute = subRoute.includes('/character');
    const hasCanvasGrid = document.querySelectorAll('[data-tile-id], flow-grid-tile-container').length > 0;

    // 若已经处于主画布并且不在角色子路由下，无需重复点击导航
    if (!isCharacterRoute && (hasCanvasGrid || !subRoute || subRoute === '/' || subRoute === '/canvas')) {
      return true;
    }

    // 仅在侧边栏导航容器内部查找「所有媒体」按钮，防止触碰顶部项目名称菜单
    const sidebar = document.querySelector('flow-side-nav, nav, aside, [role="navigation"], .side-nav') || document.body;
    const allMediaNavBtn = [...sidebar.querySelectorAll('a, button, div[role="button"], flow-nav-item, li')].find(el => {
      const txt = (el.textContent || '').trim();
      const sym = (el.querySelector('.google-symbols, i, span')?.textContent || '').trim();
      return (txt.includes('所有媒体') || txt.includes('All media') || sym === 'grid_view') && !txt.includes('删除') && !txt.includes('回收站');
    });

    if (allMediaNavBtn) {
      const clickable = allMediaNavBtn.closest('a, button, [role="button"], flow-nav-item') || allMediaNavBtn;
      await clickElement(clickable);
      await sleep(1000);
      return true;
    }

    // 路由跳转兜底
    if (!isAlreadyOnCanvas && match) {
      window.location.href = `https://flow.google.com/project/${match[1]}`;
      await sleep(1500);
      return true;
    }

    return true;
  }

  /**
   * 从角色创建/编辑页面返回到角色列表页面
   * 注意：严禁在 /character 角色列表视图中触发，防止误点项目导航栏的「返回项目列表」按钮！
   */
  async function returnToCharacterList() {
    // 检查是否处于创建视图（包含「新角色」标题或描述输入框）或编辑视图 (/character/<id>)
    const isEditingOrCreating = /\/character\/[a-zA-Z0-9_-]+/.test(window.location.pathname) ||
      !!document.querySelector('flow-character-edit-header, flow-create-character-footer, flow-character-prompt-input');

    // 如果当前已经是角色列表网格（可见 flow-character-tile 或包含新角色按钮且无编辑页头），切勿点击返回！
    const isListGrid = !!document.querySelector('flow-character-tile, button.custom-tile-container') &&
      !document.querySelector('flow-character-edit-header, flow-create-character-footer');

    if (isListGrid && !isEditingOrCreating) {
      console.log('[FantasyAutomation] 当前已在角色列表，无需返回');
      return;
    }

    // 仅限在角色编辑或创建容器内部寻找返回按钮，严禁在项目主导航查找 arrow_back！
    const editContainer = document.querySelector('flow-character-edit-header, flow-create-character-header, .character-edit-view');
    let backBtn = null;
    if (editContainer) {
      backBtn = editContainer.querySelector('button[aria-label="返回"], button[aria-label="Back"], button.back-button') ||
        [...editContainer.querySelectorAll('button')].find(b => (b.querySelector('.google-symbols')?.textContent || '').trim() === 'arrow_back');
    }

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
    const existingTiles = [...document.querySelectorAll('flow-character-tile, flow-tile-container, [class*="character-tile"], [data-tile-id]')];
    const alreadyBuilt = existingTiles.find(t => (t.textContent || '').includes(targetName));
    if (alreadyBuilt) {
      console.log(`[FantasyAutomation] 角色【${targetName}】已在 Flow 角色库中存在，跳过导入`);
      return { ok: true, skipped: true };
    }

    // 3. ★ 核心优化：若已有待命名的角色卡片，直接启动更名正名！绝不重复创建新实体！
    const unnamedTile = existingTiles.find(t => /未命名的角色|Unnamed/i.test(t.textContent || ''));
    if (unnamedTile) {
      console.log(`[FantasyAutomation] 发现待命名角色卡片，直接启动更名正名为【${targetName}】...`);
      const renamed = await renameCharacterTile(targetName, options);
      if (renamed) {
        return { ok: true, renamed: true };
      }
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
    let matchedOption = null;

    // 优先：若有定妆图精确 URL，直接比对图片地址
    if (char.turnaroundImageUrl) {
      matchedOption = assetOptions.find(opt => {
        const img = opt.querySelector('img');
        return img && (img.src === char.turnaroundImageUrl || char.turnaroundImageUrl.includes(img.src) || img.src.includes(char.turnaroundImageUrl));
      });
    }

    // 次选：匹配角色中文名、代码(MCR/SC1)或角色标签
    if (!matchedOption) {
      const candidates = [targetName, char.code, char.role].filter(Boolean).map(s => s.toLowerCase());
      matchedOption = assetOptions.find(opt => {
        const txt = (opt.textContent || '').toLowerCase();
        const alt = (opt.querySelector('img')?.alt || '').toLowerCase();
        return candidates.some(c => txt.includes(c) || alt.includes(c));
      });
    }

    // 三选：匹配 4 视角提示词中的关键描述片段
    if (!matchedOption && char.turnaroundPrompt) {
      const snippet = char.turnaroundPrompt.slice(0, 30).toLowerCase();
      matchedOption = assetOptions.find(opt => {
        const txt = (opt.textContent || '').toLowerCase();
        const alt = (opt.querySelector('img')?.alt || '').toLowerCase();
        return txt.includes(snippet) || alt.includes(snippet);
      });
    }

    // 兜底：Google Flow 项目素材为倒序排列（最新在前），按时序计算对应索引
    if (!matchedOption) {
      const charIndex = typeof options.index === 'number' ? options.index : 0;
      const total = options.total || assetOptions.length;
      matchedOption = assetOptions[Math.max(0, (total - 1) - charIndex)] || assetOptions[charIndex] || assetOptions[0];
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
    try {
      await clickSubmit();
    } catch (submitErr) {
      console.warn('[FantasyAutomation] clickSubmit 异常，尝试在输入框按回车提交:', submitErr?.message);
      if (editor) {
        editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
      }
    }
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

    // 12. 角色卡片更名二次校验（若列表卡片仍为“未命名的角色”，触发卡片菜单就地重命名）
    try {
      await renameCharacterTile(targetName, options);
    } catch (_) {}

    return { ok: true, name: targetName, saveSuccess };
  }

  /**
   * 打开素材选择弹窗（点击 '+' 按钮或输入 '@'）
   */
  async function openAssetPickerModal() {
    // 0. 先关闭任何残留的无关下拉菜单 (如误触开启的项目重命名/删除菜单)
    try {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
      await sleep(100);
    } catch (_) {}

    // 1. 定位底部输入框容器，严格限定范围在输入框内，防止误触顶部导航项目菜单！
    const editor = findPromptEditor();
    const promptContainer = editor?.closest('.prompt-input-container, flow-prompt-input, flow-character-prompt-input, footer, [class*="prompt"]') ||
                            editor?.parentElement?.parentElement ||
                            document.querySelector('footer, [class*="footer"], [class*="prompt"]');

    let addBtn = null;
    if (promptContainer) {
      const buttons = [...promptContainer.querySelectorAll('button')].filter(isElementVisible);
      addBtn = buttons.find(b => {
        const label = b.getAttribute('aria-label') || '';
        const txt = (b.textContent || '').trim();
        const sym = (b.querySelector('.google-symbols, i, span')?.textContent || '').trim();
        return /添加素材|在提示框中添加素材|Add\s*media|素材/i.test(label) ||
               /添加素材|在提示框中添加素材|Add\s*media/i.test(txt) ||
               sym === 'add_2' || sym === 'add';
      });
    }

    if (!addBtn) {
      // 容错：在底部区域寻找带加号的按钮
      const bottomButtons = [...document.querySelectorAll('footer button, [class*="footer"] button, [class*="prompt"] button')].filter(isElementVisible);
      addBtn = bottomButtons.find(b => {
        const sym = (b.querySelector('.google-symbols, i, span')?.textContent || '').trim();
        return sym === 'add_2' || sym === 'add';
      });
    }

    if (addBtn) {
      await clickElement(addBtn);
      await sleep(350);

      // 如果弹出了下拉菜单（例如“从项目中添加”或“角色”）
      const menuItem = [...document.querySelectorAll('.mat-mdc-menu-item, [role="menuitem"]')].find(el => {
        if (!isElementVisible(el)) return false;
        const txt = (el.textContent || '').trim();
        return /从项目中添加|角色|素材|Project|Character/i.test(txt);
      });
      if (menuItem) {
        await clickElement(menuItem);
        await sleep(400);
      }
    } else {
      // 降级为在输入框输入 '@' 唤出提及选择浮层
      await fillPrompt('@', false);
      await sleep(350);
    }

    // 等待弹窗或下拉列表出现
    return await waitFor(() => {
      const dialog = document.querySelector('div[role="dialog"][data-state="open"], .cdk-overlay-pane [role="dialog"], [role="listbox"], .mat-mdc-menu-panel, .cdk-overlay-pane');
      return dialog && isElementVisible(dialog) ? dialog : null;
    }, 4000);
  }

  /**
   * 在弹窗中选择资产（角色参考图或分镜图片）并附加到提示词
   */
  async function selectAssetInModal(queryOrIndex) {
    const modal = document.querySelector('div[role="dialog"][data-state="open"], .cdk-overlay-pane, [role="listbox"], .mat-mdc-menu-panel');
    if (!modal) return false;

    await waitFor(() => modal.querySelectorAll('[role="option"], [data-item-index], .asset-item, .mat-mdc-menu-item, flow-character-tile').length > 0, 3000);
    const items = [...modal.querySelectorAll('[role="option"], [data-item-index], .asset-item, .mat-mdc-menu-item, flow-character-tile')];
    if (!items.length) return false;

    let targetItem = null;
    if (typeof queryOrIndex === 'number') {
      targetItem = items[queryOrIndex] || items[0];
    } else if (typeof queryOrIndex === 'string' && queryOrIndex.trim()) {
      const q = queryOrIndex.toLowerCase();
      // 匹配中英文名称、角色代码 (巴纳比 / Barnaby / MCR)
      targetItem = items.find(it => {
        const txt = (it.textContent || '').toLowerCase();
        const alt = (it.querySelector('img')?.alt || '').toLowerCase();
        return txt.includes(q) || alt.includes(q) || (q.includes('巴纳比') && txt.includes('巴纳比')) || (q.includes('barnaby') && (txt.includes('barnaby') || alt.includes('barnaby')));
      });
    }

    if (!targetItem) targetItem = items[0];

    const clickable = targetItem.querySelector('div, button') || targetItem;
    await clickElement(clickable);
    await sleep(300);

    // 检查是否有关闭或"添加到提示/添加媒体"按钮
    const confirmBtn = [...document.querySelectorAll('div[role="dialog"] button, button')].find(b =>
      /添加媒体|添加到提示|添加到画板|Add\s*media|Add\s*to\s*prompt/i.test(b.textContent || '')
    );

    if (confirmBtn && isElementVisible(confirmBtn)) {
      await clickElement(confirmBtn);
      await sleep(300);
    }

    await stripMentionTrigger();
    await sleep(300);
    return true;
  }

  /**
   * 查找底部提示词栏右侧的模型设置胶囊按钮 (如 "Nano Banana 2.1 🎦 x1" 或 "Veo 3.1 Lite")
   */
  function findModelSettingsBtn() {
    const submitBtn = findSubmitButton();
    if (submitBtn) {
      const container = submitBtn.closest('.input-actions, .prompt-bar-actions, [class*="action"], [class*="footer"]') || submitBtn.parentElement;
      if (container) {
        const btns = [...container.querySelectorAll('button')].filter(b => isElementVisible(b) && b !== submitBtn);
        const match = btns.find(b => /Nano|Banana|Veo|Imagen|x1|x2|x4|视频|Video|图片|Image/i.test(b.textContent || ''));
        if (match) return match;
      }
    }

    const allBtns = [...document.querySelectorAll('button, [role="button"]')].filter(isElementVisible);
    return allBtns.find(b => {
      const aria = b.getAttribute('aria-label') || '';
      if (aria.includes('开始生成') || aria.includes('生成')) return false;
      const txt = (b.textContent || '').trim();
      return /Nano\s*Banana|Banana|Veo|Imagen|🎦/i.test(txt) || (/\bx[1-4]\b/i.test(txt) && /Nano|Banana|Veo/i.test(txt));
    }) || null;
  }

  /**
   * 切换 Flow 生成模式 ('IMAGE' | 'VIDEO')
   * Google Flow 的模式切换位于底部 Prompt 输入框右侧的「模型/设置胶囊按钮」（例如 "Nano Banana 2.1 🎦 x1" 或 "Veo 3.1 Lite"）
   * 点击该按钮后，在弹出的设置浮层中切换「图片」或「视频」Tab
   */
  async function switchFlowMode(mode) {
    const isVideo = mode === 'VIDEO';

    // 1. 先检查是否已经处于目标模式
    const modelBtn = findModelSettingsBtn();
    if (modelBtn) {
      const curText = (modelBtn.textContent || '').trim();
      const alreadyVideo = /Veo|Video|视频|동영상/i.test(curText);
      const alreadyImage = /Banana|Nano|Imagen|Image|图片|이미지/i.test(curText);
      if (isVideo && alreadyVideo) {
        console.log('[FantasyAutomation] 当前已是视频模式:', curText);
        return true;
      }
      if (!isVideo && alreadyImage) {
        console.log('[FantasyAutomation] 当前已是图片模式:', curText);
        return true;
      }
    }

    // 2. 检查页面上是否已有直接外显的模式 Tab
    const targetPattern = isVideo ? /视频|Video|동영상/i : /图片|Image|이미지/i;
    const directTab = [...document.querySelectorAll('[role="tab"], button[id*="trigger-"]')].find(t => {
      if (!isElementVisible(t)) return false;
      const txt = (t.textContent || '').trim();
      const id = t.id || '';
      return targetPattern.test(txt) || (isVideo ? id.includes('VIDEO') : id.includes('IMAGE'));
    });

    if (directTab) {
      if (directTab.getAttribute('aria-selected') !== 'true') {
        await clickElement(directTab);
        await sleep(500);
      }
      return true;
    }

    // 3. 点击模型设置胶囊按钮打开设置面板
    if (!modelBtn) {
      console.warn('[FantasyAutomation] 未找到模型设置胶囊按钮');
      return false;
    }

    await clickElement(modelBtn);
    await sleep(600);

    // 4. 在弹出的设置面板中寻找 Video / Image 选项或 Tab
    const findModeTabInPanel = () => {
      const allTabs = [...document.querySelectorAll('[role="tab"], button, [role="menuitem"], [role="radio"], .mat-mdc-menu-item')].filter(isElementVisible);
      return allTabs.find(el => {
        const txt = (el.textContent || '').trim();
        const aria = el.getAttribute('aria-label') || '';
        const sym = (el.querySelector('.google-symbols, i, span')?.textContent || '').trim();
        const id = el.id || '';
        if (isVideo) {
          return /视频|Video|동영상/i.test(txt) || /视频|Video/i.test(aria) || sym === 'videocam' || id.includes('VIDEO');
        } else {
          return /图片|Image|이미지/i.test(txt) || /图片|Image/i.test(aria) || sym === 'image' || id.includes('IMAGE');
        }
      });
    };

    let panelTab = findModeTabInPanel();
    if (!panelTab) {
      await sleep(400);
      panelTab = findModeTabInPanel();
    }

    if (panelTab) {
      await clickElement(panelTab);
      await sleep(600);
    }

    // 5. 关闭设置面板 (按 Escape 或点击空白处)
    try {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
    } catch (_) {}
    await sleep(300);

    return true;
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
   * 轮询等待新生成结果产出（支持精确 Set 比对、数量递增检测与即时中断响应）
   */
  async function waitForNewGeneration(initialTilesOrCount, timeoutMs = 120000, onProgress = null, abortCheck = null) {
    const startTime = Date.now();
    let initialCount = 0;
    let initialSet = null;

    if (typeof initialTilesOrCount === 'number') {
      initialCount = initialTilesOrCount;
    } else if (initialTilesOrCount instanceof Set) {
      initialSet = initialTilesOrCount;
      initialCount = initialSet.size;
    } else if (initialTilesOrCount && typeof initialTilesOrCount === 'object') {
      initialCount = initialTilesOrCount.count || 0;
      initialSet = initialTilesOrCount.readySet || null;
    }

    while (Date.now() - startTime < timeoutMs) {
      if (typeof abortCheck === 'function' && abortCheck()) {
        throw new Error('用户已手动停止流水线');
      }

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
    renameInCharacterEditPage,
    renameCharacterTile,
    renameCharacter,
    navigateToCharacterPage,
    navigateToProjectPage,
    returnToCharacterList,
    syncCharacterToFlowLibrary,
    openAssetPickerModal,
    selectAssetInModal,
    switchFlowMode,
    getCanvasMediaTiles,
    waitForNewGeneration
  };
})();
