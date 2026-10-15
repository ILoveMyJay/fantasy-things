/**
 * FantasyFlowStudio - MAIN World Slate & React Bridge
 * 负责在页面主上下文（MAIN World）直接操作 Slate.js Fiber 树与富文本编辑器，
 * 解决 ISOLATED World 无法直接访问页面内部 React 实例与 Slate 状态的问题。
 */

(() => {
  if (typeof window === 'undefined') return;

  // 发送准备就绪信号
  window.dispatchEvent(new CustomEvent('__fantasyBridgeReady'));

  if (window.__fantasyBridgeInstalled) return;
  window.__fantasyBridgeInstalled = true;

  const PROMPT_EDITOR_SELECTOR = '[contenteditable="true"][data-slate-editor="true"], .ProseMirror[contenteditable="true"], div[contenteditable="true"], [contenteditable="true"]';

  function findPromptEditor() {
    return document.querySelector(PROMPT_EDITOR_SELECTOR);
  }

  function getEditorMeaningfulText(el) {
    if (!el) return '';
    let text = el.textContent || '';
    const placeholders = el.querySelectorAll('[data-slate-placeholder]');
    for (let i = 0; i < placeholders.length; i++) {
      const pText = placeholders[i].textContent || '';
      if (pText) text = text.split(pText).join('');
    }
    return text.replace(/[\uFEFF\u200B]/g, '');
  }

  function getSlatePlainText(slateEditor) {
    let s = '';
    const blocks = slateEditor.children || [];
    for (let i = 0; i < blocks.length; i++) {
      const leaves = blocks[i].children || [];
      for (let j = 0; j < leaves.length; j++) {
        if (typeof leaves[j]?.text === 'string') {
          s += leaves[j].text;
        }
      }
    }
    return s.replace(/[\uFEFF\u200B]/g, '');
  }

  function removeFromSlateTextEnd(slateEditor, count) {
    let left = count;
    const blocks = slateEditor.children || [];
    for (let i = blocks.length - 1; i >= 0 && left > 0; i--) {
      const leaves = blocks[i].children || [];
      for (let j = leaves.length - 1; j >= 0 && left > 0; j--) {
        const live = (slateEditor.children || [])[i]?.children?.[j];
        const liveText = typeof live?.text === 'string' ? live.text : '';
        if (!liveText) continue;
        const cut = Math.min(left, liveText.length);
        slateEditor.apply({
          type: 'remove_text',
          path: [i, j],
          offset: liveText.length - cut,
          text: liveText.slice(liveText.length - cut)
        });
        left -= cut;
      }
    }
  }

  function fillProseMirror(editor, text, replaceAll) {
    editor.focus();
    const range = document.createRange();
    range.selectNodeContents(editor);
    if (!replaceAll) {
      range.collapse(false);
    }
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);

    if (replaceAll && !text && !getEditorMeaningfulText(editor).trim()) return;
    const command = replaceAll && !text ? 'delete' : 'insertText';
    if (!document.execCommand(command, false, text || null)) {
      throw new Error('ProseMirror 提示词执行失败');
    }
  }

  function waitForCommitThenDedup(editor, slateEditor, text, before, done) {
    const started = Date.now();
    const tick = () => {
      try {
        const after = getEditorMeaningfulText(editor);
        const committed = !!after && after !== before;
        if (committed || Date.now() - started > 400) {
          const slateAfter = getSlatePlainText(slateEditor);
          if (text === '@') {
            let plain = slateAfter;
            const prefix = before || '';
            while (true) {
              const suffix = (plain.startsWith(prefix) ? plain.slice(prefix.length) : plain).replace(/^\s+/, '');
              if (!suffix.startsWith('@@')) break;
              removeFromSlateTextEnd(slateEditor, 1);
              plain = getSlatePlainText(slateEditor);
            }
          } else {
            const slateHasTwoCopies = !!(text && (slateAfter === text + text || slateAfter === before + text + text || slateAfter.endsWith(text + text)));
            if (slateHasTwoCopies) {
              removeFromSlateTextEnd(slateEditor, text.length);
            }
          }
        } else {
          setTimeout(tick, 16);
          return;
        }
      } catch (_) {}
      done();
    };
    setTimeout(tick, 0);
  }

  // 监听 ISOLATED World 的提示词填充请求
  window.addEventListener('__fantasyFillPrompt', (e) => {
    const id = e.detail?.id;
    const text = e.detail?.text;
    const replaceAll = !!e.detail?.replaceAll;

    const emitDone = (ok, error = null) => {
      window.dispatchEvent(new CustomEvent('__fantasyFillPromptDone', {
        detail: { id, ok, error }
      }));
    };

    if (!text && !replaceAll) {
      emitDone(true);
      return;
    }

    try {
      const editor = findPromptEditor();
      if (!editor) {
        throw new Error('未在页面中找到 Flow 提示词输入框');
      }

      // 1. 若为 ProseMirror 架构
      if (editor.matches('.ProseMirror')) {
        fillProseMirror(editor, text || '', replaceAll);
        setTimeout(() => emitDone(true), 0);
        return;
      }

      // 2. 若为 React / Slate.js 架构
      const fiberKey = Object.keys(editor).find(k => k.startsWith('__reactFiber'));
      let fiber = editor[fiberKey];
      let slateEditor = null;
      while (fiber) {
        if (fiber.memoizedProps?.editor) { slateEditor = fiber.memoizedProps.editor; break; }
        if (fiber.stateNode?.editor) { slateEditor = fiber.stateNode.editor; break; }
        fiber = fiber.return;
      }

      if (!slateEditor) {
        // Fallback: 尝试原生 execCommand
        editor.focus();
        if (replaceAll) {
          document.execCommand('selectAll', false, null);
        }
        document.execCommand('insertText', false, text || '');
        emitDone(true);
        return;
      }

      const beforeMeaningful = getEditorMeaningfulText(editor);
      editor.focus();

      // 完全清空并替换
      if (replaceAll) {
        try {
          editor.focus();
          document.execCommand('selectAll');
          document.execCommand('delete');
        } catch (_) {}
        try {
          const point = { path: [0, 0], offset: 0 };
          if (slateEditor.selection != null) slateEditor.selection = { anchor: point, focus: point };
          if (slateEditor.history) slateEditor.history = { redos: [], undos: [] };
          slateEditor.children = [{ type: 'paragraph', children: [{ text: '' }] }];
        } catch (_) {}
      }

      // 光标定位计算：非 replaceAll 时移动到文档末尾（防止覆盖已有的参考图卡片）
      let selPoint = { path: [0, 0], offset: 0 };
      if (!replaceAll) {
        try {
          const children = slateEditor.children || [];
          if (children.length) {
            const lastIdx = children.length - 1;
            const lastNode = children[lastIdx];
            const leaves = (lastNode && lastNode.children) ? lastNode.children : [{ text: '' }];
            const leafIdx = leaves.length - 1;
            const leafText = (leaves[leafIdx] && typeof leaves[leafIdx].text === 'string') ? leaves[leafIdx].text : '';
            selPoint = { path: [lastIdx, leafIdx], offset: leafText.length };
          }
        } catch (_) {
          selPoint = { path: [0, 0], offset: 0 };
        }
      }

      slateEditor.apply({
        type: 'set_selection',
        properties: null,
        newProperties: { anchor: selPoint, focus: selPoint }
      });

      slateEditor.deleteFragment();

      if (text) {
        slateEditor.insertText(text);
      }

      if (text) {
        waitForCommitThenDedup(editor, slateEditor, text, beforeMeaningful, () => emitDone(true));
      } else {
        emitDone(true);
      }
    } catch (err) {
      emitDone(false, err?.message || '输入提示词异常');
    }
  });

  // 清除残留的 '@' 字符事件
  window.addEventListener('__fantasyStripMentionTrigger', (e) => {
    const id = e.detail?.id;
    const emitDone = (ok, error = null) => {
      window.dispatchEvent(new CustomEvent('__fantasyStripMentionTriggerDone', {
        detail: { id, ok, error }
      }));
    };

    try {
      const editor = findPromptEditor();
      if (!editor) { emitDone(false, '未找到输入框'); return; }

      const fiberKey = Object.keys(editor).find(k => k.startsWith('__reactFiber'));
      let fiber = editor[fiberKey];
      let slateEditor = null;
      while (fiber) {
        if (fiber.memoizedProps?.editor) { slateEditor = fiber.memoizedProps.editor; break; }
        if (fiber.stateNode?.editor) { slateEditor = fiber.stateNode.editor; break; }
        fiber = fiber.return;
      }

      if (slateEditor) {
        const blocks = slateEditor.children || [];
        for (let i = 0; i < blocks.length; i++) {
          const leaves = blocks[i].children || [];
          for (let j = 0; j < leaves.length; j++) {
            const leaf = leaves[j];
            if (typeof leaf?.text === 'string' && leaf.text.includes('@')) {
              for (let k = leaf.text.length - 1; k >= 0; k--) {
                if (leaf.text[k] === '@') {
                  slateEditor.apply({ type: 'remove_text', path: [i, j], offset: k, text: '@' });
                }
              }
            }
          }
        }
      }
      emitDone(true);
    } catch (err) {
      emitDone(false, err?.message);
    }
  });
})();
