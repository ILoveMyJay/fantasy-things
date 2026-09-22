if(typeof console!=="undefined" && (typeof globalThis!=="undefined" && globalThis.__FLOW_SILENT__ === true)){console.log=function(){};console.warn=function(){};console.error=function(){};}
// MAIN world: Slate __reactFiber 직접 접근
// CSP 때문에 inline script inject 불가 → 별도 파일로 분리

// 준비 완료 신호
window.dispatchEvent(new CustomEvent('__flowBridgeReady'));

const PROMPT_EDITOR_SELECTOR = '[contenteditable="true"][data-slate-editor="true"], .ProseMirror[contenteditable="true"]';

function findPromptEditor() {
  return document.querySelector(PROMPT_EDITOR_SELECTOR);
}

function fillProseMirror(editor, text, replaceAll) {
  editor.focus();
  const range = document.createRange();
  range.selectNodeContents(editor);
  if (!replaceAll) range.collapse(false);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);

  if (replaceAll && !text && !editorMeaningfulText(editor).trim()) return;
  const command = replaceAll && !text ? 'delete' : 'insertText';
  if (!document.execCommand(command, false, text || null)) {
    throw new Error('提示词输入失败');
  }
}

function stripProseMirrorMentionTrigger(editor) {
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  const node = nodes.reverse().find(n => {
    if (!n.data.includes('@')) return false;
    const siblingIsChip = n.previousSibling?.classList?.contains('mention-chip') || n.nextSibling?.classList?.contains('mention-chip');
    return /^\s*@+\s*$/.test(n.data) || siblingIsChip;
  });
  if (!node) return;
  const at = node.data.lastIndexOf('@');
  const range = document.createRange();
  range.setStart(node, at);
  range.setEnd(node, at + 1);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  editor.focus();
  document.execCommand('delete');
}

function editorMeaningfulText(el) {
  if (!el) return '';
  let t = el.textContent || '';
  const ph = el.querySelectorAll('[data-slate-placeholder]');
  for (let i = 0; i < ph.length; i++) {
    const pt = ph[i].textContent || '';
    if (pt) t = t.split(pt).join('');
  }
  return t.replace(/[\uFEFF\u200B]/g, '');
}

function slatePlainText(slateEditor) {
  let s = '';
  const blocks = slateEditor.children || [];
  for (let i = 0; i < blocks.length; i++) {
    const leaves = blocks[i].children || [];
    for (let j = 0; j < leaves.length; j++) {
      if (typeof leaves[j]?.text === 'string') s += leaves[j].text;
    }
  }
  return s.replace(/[\uFEFF\u200B]/g, '');
}

function removeFromSlateTextEnd(slateEditor, n) {
  let left = n;
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

function isExactInsertedDup(before, after, text) {
  if (!text || !after) return false;
  if (after === text + text) return true;
  if (after === before + text + text) return true;
  if (before && after.startsWith(before) && after.slice(before.length) === text + text) return true;
  return false;
}

/** insertText 직후 DOM은 아직 placeholder. 다음 틱에 React가 T+T 로 커밋하면 한 카피만 남김. */
function waitForCommitThenDedup(editor, slateEditor, text, before, done) {
  const started = Date.now();
  const tick = () => {
    try {
      const after = editorMeaningfulText(editor);
      const committed = !!after && after !== before;
      if (committed || Date.now() - started > 400) {
        const slateAfter = slatePlainText(slateEditor);
        if (text === '@') {
          let plain = slateAfter;
          const prefix = before || '';
          while (true) {
            const suffix = (plain.startsWith(prefix) ? plain.slice(prefix.length) : plain).replace(/^\s+/, '');
            if (!suffix.startsWith('@@')) break;
            removeFromSlateTextEnd(slateEditor, 1);
            plain = slatePlainText(slateEditor);
          }
        } else {
          const dupDom = isExactInsertedDup(before, after, text);
          const dupSlate = isExactInsertedDup(before, slateAfter, text);
          const slateHasTwoCopies = !!(text && (slateAfter === text + text || slateAfter === before + text + text || slateAfter.endsWith(text + text)));
          if ((dupDom || dupSlate) && slateHasTwoCopies) {
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

window.addEventListener('__flowFillPrompt', (e) => {
  const text = e.detail?.text;
  const replaceAll = !!e.detail?.replaceAll;
  const emitDone = (ok, error) => {
    window.dispatchEvent(new CustomEvent('__flowFillPromptDone', { detail: { ok, error } }));
  };

  // 빈 텍스트 + replaceAll 아님 = ping, 바로 완료 응답
  if (!text && !replaceAll) {
    window.dispatchEvent(new CustomEvent('__flowFillPromptDone', { detail: { ok: true } }));
    return;
  }

  try {
    const editor = findPromptEditor();
    if (!editor) throw new Error('에디터 없음');

    if (editor.matches('.ProseMirror')) {
      fillProseMirror(editor, text || '', replaceAll);
      setTimeout(() => emitDone(true), 0);
      return;
    }

    const fiberKey = Object.keys(editor).find(k => k.startsWith('__reactFiber'));
    let fiber = editor[fiberKey];
    let slateEditor = null;
    while (fiber) {
      if (fiber.memoizedProps?.editor) { slateEditor = fiber.memoizedProps.editor; break; }
      if (fiber.stateNode?.editor) { slateEditor = fiber.stateNode.editor; break; }
      fiber = fiber.return;
    }
    if (!slateEditor) throw new Error('Slate 인스턴스 없음');

    const beforeMeaningful = editorMeaningfulText(editor);

    editor.focus();

    // replaceAll: 기존 내용(플레이스홀더 "무엇을..." 등) 전부 지우고 교체 — 대본투이미지와 동일한 깨끗한 입력
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
        if (slateEditor.children) slateEditor.children = [{ type: 'paragraph', children: [{ text: '' }] }];
      } catch (_) {}
    }

    // selection 강제 설정 (새 프로젝트 시 null 방지 — Flow submit이 state를 올바르게 읽도록)
    // ★ v1.1.8: replaceAll=false(이미지투동영상·팩토리 비디오)일 때는 [0,0]이 이미지 void 노드일 수 있음.
    //   그 위치에 insertText 하면 텍스트가 무시되어 "Prompt must be provided" 발생.
    //   → 이미지가 있으면 문서 끝(마지막 텍스트 노드)으로 selection을 이동시켜 거기에 입력.
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
      } catch (_) { selPoint = { path: [0, 0], offset: 0 }; }
    }
    slateEditor.apply({
      type: 'set_selection',
      properties: null,
      newProperties: { anchor: selPoint, focus: selPoint }
    });

    // collapsed selection이므로 deleteFragment는 no-op (이미지 노드 보존). replaceAll일 때만 의미 있음.
    slateEditor.deleteFragment();
    if (text === '@') {
      try {
        editor.dispatchEvent(new KeyboardEvent('keydown', {
          key: '@', code: 'Digit2', keyCode: 50, which: 50,
          bubbles: true, cancelable: true, composed: true
        }));
      } catch (_) {}
    }
    if (text) slateEditor.insertText(text);
    if (text === '@') {
      try {
        editor.dispatchEvent(new InputEvent('input', {
          inputType: 'insertText', data: '@', bubbles: true, composed: true
        }));
        editor.dispatchEvent(new KeyboardEvent('keyup', {
          key: '@', code: 'Digit2', keyCode: 50, which: 50,
          bubbles: true, composed: true
        }));
      } catch (_) {}
    }

    // React commit 후 같은 청크가 T+T 로 붙으면 한 카피 제거. @ 도 @@ → @ (피커용 트리거 하나 유지).
    if (text) {
      waitForCommitThenDedup(editor, slateEditor, text, beforeMeaningful, () => emitDone(true));
      return;
    }

    emitDone(true);
  } catch (err) {
    window.dispatchEvent(new CustomEvent('__flowFillPromptDone', { detail: { ok: false, error: err.message } }));
  }
});

function isChipLeaf(n) {
  return !!(n && typeof n.text !== 'string');
}

function collectMentionTriggerAts(slateEditor) {
  const removals = [];
  const blocks = slateEditor.children || [];
  for (let i = 0; i < blocks.length; i++) {
    const leaves = blocks[i].children || [];
    for (let j = 0; j < leaves.length; j++) {
      const leaf = leaves[j];
      if (typeof leaf?.text !== 'string' || !leaf.text.includes('@')) continue;
      const prev = j > 0 ? leaves[j - 1] : null;
      const next = j + 1 < leaves.length ? leaves[j + 1] : null;
      const onlyTrigger = /^[\s]*@+[\s]*$/.test(leaf.text);
      if (!onlyTrigger && !isChipLeaf(prev) && !isChipLeaf(next)) continue;
      for (let k = leaf.text.length - 1; k >= 0; k--) {
        if (leaf.text[k] === '@') removals.push({ path: [i, j], offset: k, text: '@' });
      }
    }
  }
  if (removals.length) return removals;
  for (let i = blocks.length - 1; i >= 0; i--) {
    const leaves = blocks[i].children || [];
    for (let j = leaves.length - 1; j >= 0; j--) {
      const leaf = leaves[j];
      if (typeof leaf?.text !== 'string' || !/^[\s]*@+[\s]*$/.test(leaf.text)) continue;
      for (let k = leaf.text.length - 1; k >= 0; k--) {
        if (leaf.text[k] === '@') removals.push({ path: [i, j], offset: k, text: '@' });
      }
      return removals;
    }
  }
  return removals;
}

function stripMentionTriggerAts(slateEditor) {
  const removals = collectMentionTriggerAts(slateEditor);
  removals.sort((a, b) => {
    if (a.path[0] !== b.path[0]) return b.path[0] - a.path[0];
    if (a.path[1] !== b.path[1]) return b.path[1] - a.path[1];
    return b.offset - a.offset;
  });
  for (let k = 0; k < removals.length; k++) {
    try { slateEditor.apply({ type: 'remove_text', ...removals[k] }); } catch (_) {}
  }
}

/** After Flow inserts a mention chip, the typed trigger "@" often remains as a text node.
 *  React may commit the leftover @ on the next tick (same race as prompt T+T), so strip twice. */
window.addEventListener('__flowStripMentionTriggerAt', () => {
  const emit = (ok, error) => {
    window.dispatchEvent(new CustomEvent('__flowStripMentionTriggerAtDone', { detail: { ok, error } }));
  };
  try {
    const editor = findPromptEditor();
    if (!editor) throw new Error('에디터 없음');
    if (editor.matches('.ProseMirror')) {
      stripProseMirrorMentionTrigger(editor);
      setTimeout(() => {
        try { stripProseMirrorMentionTrigger(editor); } catch (_) {}
        emit(true);
      }, 80);
      return;
    }
    const fiberKey = Object.keys(editor).find(k => k.startsWith('__reactFiber'));
    let fiber = editor[fiberKey];
    let slateEditor = null;
    while (fiber) {
      if (fiber.memoizedProps?.editor) { slateEditor = fiber.memoizedProps.editor; break; }
      if (fiber.stateNode?.editor) { slateEditor = fiber.stateNode.editor; break; }
      fiber = fiber.return;
    }
    if (!slateEditor) throw new Error('Slate 인스턴스 없음');

    stripMentionTriggerAts(slateEditor);
    setTimeout(() => {
      try { stripMentionTriggerAts(slateEditor); } catch (_) {}
      setTimeout(() => {
        try { stripMentionTriggerAts(slateEditor); } catch (_) {}
        emit(true);
      }, 80);
    }, 0);
  } catch (err) {
    emit(false, err.message);
  }
});

window.addEventListener('__flowPrepareUploadInput', () => {
  const emit = (ok, error) => window.dispatchEvent(new CustomEvent('__flowPrepareUploadInputDone', {
    detail: { ok, error }
  }));
  const nativeClick = HTMLInputElement.prototype.click;
  let restored = false;
  const restore = () => {
    if (restored) return;
    restored = true;
    HTMLInputElement.prototype.click = nativeClick;
  };

  HTMLInputElement.prototype.click = function (...args) {
    if (this.type === 'file') return;
    return nativeClick.apply(this, args);
  };

  try {
    const uploadBtn = document.querySelector('button.sidebar-upload-btn') || [...document.querySelectorAll('button')].find(btn =>
      btn.querySelector('.google-symbols')?.textContent?.trim() === 'upload'
    );
    if (!uploadBtn) throw new Error('Flow upload button not found');
    uploadBtn.click();

    const started = Date.now();
    const poll = () => {
      const input = [...document.querySelectorAll('input[type="file"]')].find(el =>
        /image\/|\.(?:png|jpe?g|webp|gif|heif|heic)\b/i.test(el.accept || '')
      );
      if (input) {
        restore();
        emit(true);
      } else if (Date.now() - started >= 2000) {
        restore();
        emit(false, 'Flow image upload input not created');
      } else {
        setTimeout(poll, 50);
      }
    };
    poll();
  } catch (error) {
    restore();
    emit(false, error.message);
  }
});
