/**
 * FantasyFlowStudio - Sidepanel Main Application Controller
 * 组织视图状态机、流程跳转、Gemini 任务调度与 Content Script 通信。
 */

(() => {
  // 全局应用状态
  const state = {
    settings: {},
    script: '',
    characters: [],
    shots: [],
    currentStep: 1,
    imageBatchRunning: false,
    videoBatchRunning: false,
    activeTabId: null
  };

  const DEMO_SCRIPT = `公元2089年，新东京的雨夜。
私家侦探艾伦（男，32岁，凌乱黑发，身穿深褐色做旧皮风衣与高领黑色战术毛衣）撑着一把哑光黑雨伞，伫立在霓虹倒影斑驳的街角。
他推开一家隐藏在地下深处的赛博酒吧铁门，闪烁的全息投影映照出他冷峻警惕的眼神。
艾伦走到吧台前坐下，从怀中掏出一枚微光闪烁的量子记忆芯片，芯片上脉动着冰蓝色的数据流。`;

  // UI 元素引用
  const el = {
    // Header
    connectionStatus: document.getElementById('connectionStatus'),
    // Nav tabs
    navTabs: document.querySelectorAll('.nav-tab'),
    tabContents: document.querySelectorAll('.tab-content'),
    // Stepper
    stepNodes: document.querySelectorAll('.step-node'),
    stepPanels: document.querySelectorAll('.step-panel'),
    // Step 1
    scriptInput: document.getElementById('scriptInput'),
    btnLoadDemoScript: document.getElementById('btnLoadDemoScript'),
    btnAnalyzeCharacters: document.getElementById('btnAnalyzeCharacters'),
    btnAutoBuildAllCharacters: document.getElementById('btnAutoBuildAllCharacters'),
    charactersList: document.getElementById('charactersList'),
    charCountBadge: document.getElementById('charCountBadge'),
    btnGoToStep2: document.getElementById('btnGoToStep2'),
    // Step 2
    shotCountSelect: document.getElementById('shotCountSelect'),
    btnGenerateStoryboard: document.getElementById('btnGenerateStoryboard'),
    shotsList: document.getElementById('shotsList'),
    shotsCountBadge: document.getElementById('shotsCountBadge'),
    btnBackToStep1: document.getElementById('btnBackToStep1'),
    btnGoToStep3: document.getElementById('btnGoToStep3'),
    // Step 3
    imageBatchBadge: document.getElementById('imageBatchBadge'),
    imageBatchStats: document.getElementById('imageBatchStats'),
    imageProgressBar: document.getElementById('imageProgressBar'),
    imageBatchStatusText: document.getElementById('imageBatchStatusText'),
    btnStartImageBatch: document.getElementById('btnStartImageBatch'),
    btnPauseImageBatch: document.getElementById('btnPauseImageBatch'),
    btnStopImageBatch: document.getElementById('btnStopImageBatch'),
    galleryCountBadge: document.getElementById('galleryCountBadge'),
    imageGalleryGrid: document.getElementById('imageGalleryGrid'),
    allImagesDoneCard: document.getElementById('allImagesDoneCard'),
    btnGoToStep4: document.getElementById('btnGoToStep4'),
    btnBackToStep2: document.getElementById('btnBackToStep2'),
    btnDirectToStep4: document.getElementById('btnDirectToStep4'),
    // Step 4
    videoBatchBadge: document.getElementById('videoBatchBadge'),
    videoBatchStats: document.getElementById('videoBatchStats'),
    videoProgressBar: document.getElementById('videoProgressBar'),
    videoBatchStatusText: document.getElementById('videoBatchStatusText'),
    btnStartVideoBatch: document.getElementById('btnStartVideoBatch'),
    btnPauseVideoBatch: document.getElementById('btnPauseVideoBatch'),
    btnStopVideoBatch: document.getElementById('btnStopVideoBatch'),
    videoGalleryCountBadge: document.getElementById('videoGalleryCountBadge'),
    videoGalleryGrid: document.getElementById('videoGalleryGrid'),
    btnBackToStep3: document.getElementById('btnBackToStep3'),
    // Tab 2: Prompt Studio
    rawPromptsInput: document.getElementById('rawPromptsInput'),
    promptDelayInput: document.getElementById('promptDelayInput'),
    promptAutoDownload: document.getElementById('promptAutoDownload'),
    btnStartRawBatch: document.getElementById('btnStartRawBatch'),
    btnStopRawBatch: document.getElementById('btnStopRawBatch'),
    logConsole: document.getElementById('logConsole'),
    btnClearLogs: document.getElementById('btnClearLogs'),
    // Tab 3: Settings
    selectPreset: document.getElementById('selectPreset'),
    selectApiProvider: document.getElementById('selectApiProvider'),
    inputApiBaseUrl: document.getElementById('inputApiBaseUrl'),
    inputApiKey: document.getElementById('inputApiKey'),
    btnToggleApiKey: document.getElementById('btnToggleApiKey'),
    inputModelName: document.getElementById('inputModelName'),
    btnTestApiConnection: document.getElementById('btnTestApiConnection'),
    testConnectionStatus: document.getElementById('testConnectionStatus'),
    inputProjectTitle: document.getElementById('inputProjectTitle'),
    selectAspectRatio: document.getElementById('selectAspectRatio'),
    btnSaveSettings: document.getElementById('btnSaveSettings'),
    btnResetProject: document.getElementById('btnResetProject'),
    // Toast
    toastContainer: document.getElementById('toastContainer')
  };

  function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    el.toastContainer.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 250);
    }, 3200);
  }

  function appendLog(text, level = 'info') {
    if (!el.logConsole) return;
    const line = document.createElement('div');
    line.className = `log-line ${level}`;
    const time = new Date().toLocaleTimeString();
    line.textContent = `[${time}] ${text}`;
    el.logConsole.appendChild(line);
    el.logConsole.scrollTop = el.logConsole.scrollHeight;
  }

  // 获取当前活动标签页
  async function checkActiveTab() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab && tab.url && tab.url.includes('flow.google.com')) {
        state.activeTabId = tab.id;
        el.connectionStatus.className = 'connection-status connected';
        el.connectionStatus.querySelector('.status-text').textContent = '已连接 Google Flow';
        // 确保 content scripts 与 bridge 注入
        chrome.runtime.sendMessage({ type: 'ENSURE_CONTENT_SCRIPTS', tabId: tab.id }).catch(() => {});
        return true;
      } else {
        state.activeTabId = null;
        el.connectionStatus.className = 'connection-status';
        el.connectionStatus.querySelector('.status-text').textContent = '未处于 Flow 画板页面';
        return false;
      }
    } catch (_) {
      return false;
    }
  }

  // 切换顶部 Tab
  function switchTab(tabId) {
    el.navTabs.forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tabId));
    el.tabContents.forEach(content => content.classList.toggle('active', content.id === tabId));
  }

  // 切换向导步骤
  function setWizardStep(step) {
    state.currentStep = step;
    el.stepNodes.forEach(node => {
      const s = parseInt(node.dataset.step, 10);
      node.classList.toggle('active', s === step);
      node.classList.toggle('completed', s < step);
    });
    el.stepPanels.forEach((panel, idx) => {
      panel.classList.toggle('active', idx + 1 === step);
    });
    saveState();
  }

  // 保存当前制片状态
  async function saveState() {
    state.script = el.scriptInput.value;
    await window.FantasyStorage.saveProjectState({
      script: state.script,
      characters: state.characters,
      shots: state.shots,
      currentStep: state.currentStep
    });
  }

  // 恢复制片状态
  async function loadState() {
    state.settings = await window.FantasyStorage.getSettings();
    if (el.selectApiProvider) el.selectApiProvider.value = state.settings.apiProvider || 'openai';
    if (el.inputApiBaseUrl) el.inputApiBaseUrl.value = state.settings.apiBaseUrl || 'https://api.deepseek.com/v1';
    if (el.inputApiKey) el.inputApiKey.value = state.settings.apiKey || '';
    if (el.inputModelName) el.inputModelName.value = state.settings.modelName || 'deepseek-chat';
    if (el.inputProjectTitle) el.inputProjectTitle.value = state.settings.projectTitle || 'FantasyFlowStudio';
    if (el.selectAspectRatio) el.selectAspectRatio.value = state.settings.aspectRatio || '16:9';

    // 匹配快捷预设
    if (el.selectPreset) {
      const url = state.settings.apiBaseUrl || '';
      const model = state.settings.modelName || '';
      if (url.includes('api.deepseek.com') && model.includes('deepseek-chat')) {
        el.selectPreset.value = 'deepseek';
      } else if (url.includes('siliconflow')) {
        el.selectPreset.value = 'siliconflow';
      } else if (url.includes('api.openai.com')) {
        el.selectPreset.value = 'openai';
      } else if (url.includes('googleapis')) {
        el.selectPreset.value = 'gemini';
      } else if (url.includes('openrouter')) {
        el.selectPreset.value = 'openrouter';
      } else if (url.includes('11434')) {
        el.selectPreset.value = 'ollama';
      } else {
        el.selectPreset.value = 'custom';
      }
    }

    const saved = await window.FantasyStorage.getProjectState();
    if (saved) {
      state.script = saved.script || '';
      el.scriptInput.value = state.script;
      state.characters = saved.characters || [];
      state.shots = saved.shots || [];
      renderCharacters();
      renderShots();
      renderGalleries();
      setWizardStep(saved.currentStep || 1);
    }
  }

  // 渲染角色列表
  function renderCharacters() {
    el.charCountBadge.textContent = `${state.characters.length} 个角色`;
    if (!state.characters.length) {
      el.charactersList.innerHTML = '<div class="empty-placeholder">暂无角色，请点击上方解析剧本</div>';
      return;
    }

    el.charactersList.innerHTML = state.characters.map((c, i) => `
      <div class="character-card" data-index="${i}">
        <div class="char-header">
          <div class="char-title-group">
            <span class="char-code-badge">${c.code}</span>
            <span class="char-name">${c.name}</span>
            <span class="badge">${c.role || '角色'}</span>
          </div>
        </div>
        <div class="char-dna">${c.dna}</div>
        <div class="char-actions">
          <button class="btn-secondary btn-generate-turnaround" data-index="${i}">
            🎨 在 Flow 中渲染【${c.name}】四面定妆图 (可选)
          </button>
          <button class="btn-secondary btn-rename-flow-char" data-name="${c.name}">
            🏷 将 Flow 角色名修改为「${c.name}」
          </button>
        </div>
      </div>
    `).join('');

    // 绑定角色卡片事件
    el.charactersList.querySelectorAll('.btn-generate-turnaround').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const idx = parseInt(e.currentTarget.dataset.index, 10);
        const char = state.characters[idx];
        if (!char) return;
        const connected = await checkActiveTab();
        if (!connected) { showToast('请在 Flow 画板页面中操作', 'error'); return; }

        const originalText = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = `<span>⏳</span> 正在提交【${char.name}】定妆图...`;

        chrome.tabs.sendMessage(state.activeTabId, {
          type: 'START_IMAGE_BATCH',
          shots: [{ prompt: char.turnaroundPrompt }],
          options: { autoDownload: false }
        }, (res) => {
          btn.disabled = false;
          btn.innerHTML = originalText;
          if (res?.ok) {
            showToast(`已成功向 Flow 提交【${char.name}】四面定妆图渲染！`, 'success');
          } else {
            showToast(`提交失败: ${res?.error || '无法与画板建立通信'}`, 'error');
          }
        });
      });
    });

    el.charactersList.querySelectorAll('.btn-rename-flow-char').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const name = e.currentTarget.dataset.name;
        const connected = await checkActiveTab();
        if (!connected) { showToast('请在 Flow 角色管理页面操作', 'error'); return; }

        chrome.tabs.sendMessage(state.activeTabId, {
          type: 'RENAME_CHARACTER',
          name
        }, (res) => {
          if (res?.ok) {
            showToast(`成功将角色更名为「${name}」！`, 'success');
          } else {
            showToast(`更名响应: ${res?.error || '请确认当前处于角色编辑或磁贴页面'}`, 'warn');
          }
        });
      });
    });
  }

  // 渲染分镜列表
  function renderShots() {
    el.shotsCountBadge.textContent = `${state.shots.length} 个分镜`;
    if (!state.shots.length) {
      el.shotsList.innerHTML = '<div class="empty-placeholder">暂无分镜，请点击上方按钮生成</div>';
      return;
    }

    el.shotsList.innerHTML = state.shots.map((s, i) => `
      <div class="shot-card" data-index="${i}">
        <div class="shot-card-header">
          <span class="shot-index-badge">分镜 #${String(s.shotIndex || i + 1).padStart(2, '0')}</span>
          <span class="badge">${s.shotType || '全景'} · ${s.cameraAngle || '视平机位'}</span>
          ${s.characterName ? `<span class="badge" style="color:var(--accent-indigo);border-color:var(--accent-indigo);">${s.characterName}</span>` : ''}
        </div>
        <div class="shot-narrative">${s.narrative}</div>
        
        <div class="shot-prompt-label">Google Flow 生图提示词：</div>
        <textarea class="custom-textarea shot-prompt-input" rows="3" data-field="prompt" data-index="${i}">${s.prompt}</textarea>
        
        <div class="shot-prompt-label" style="color:var(--accent-cyan);">Veo 运镜动力学提示词：</div>
        <textarea class="custom-textarea shot-prompt-input" rows="2" data-field="videoPrompt" data-index="${i}">${s.videoPrompt || ''}</textarea>
      </div>
    `).join('');

    // 绑定内容修改监听
    el.shotsList.querySelectorAll('.shot-prompt-input').forEach(ta => {
      ta.addEventListener('input', (e) => {
        const idx = parseInt(e.target.dataset.index, 10);
        const field = e.target.dataset.field;
        if (state.shots[idx]) {
          state.shots[idx][field] = e.target.value;
          saveState();
        }
      });
    });
  }

  // 渲染画廊展示
  function renderGalleries() {
    // 图片画廊
    const completedImages = state.shots.filter(s => s.generatedImageUrl);
    el.galleryCountBadge.textContent = `${completedImages.length} 张`;
    if (completedImages.length) {
      el.imageGalleryGrid.innerHTML = completedImages.map(s => `
        <div class="gallery-item">
          <img src="${s.generatedImageUrl}" class="gallery-thumb" alt="Shot ${s.shotIndex}">
          <div class="gallery-item-footer">
            <span>分镜 #${s.shotIndex}</span>
            <a href="${s.generatedImageUrl}" target="_blank" class="btn-text">查看大图</a>
          </div>
        </div>
      `).join('');
    } else {
      el.imageGalleryGrid.innerHTML = '<div class="empty-placeholder">渲染开始后，分镜产物将在此实时展现</div>';
    }

    // 检查是否全部完成
    if (state.shots.length > 0 && completedImages.length === state.shots.length) {
      el.allImagesDoneCard.style.display = 'flex';
    } else {
      el.allImagesDoneCard.style.display = 'none';
    }

    // 视频画廊
    const completedVideos = state.shots.filter(s => s.generatedVideoUrl);
    el.videoGalleryCountBadge.textContent = `${completedVideos.length} 个视频`;
    if (completedVideos.length) {
      el.videoGalleryGrid.innerHTML = completedVideos.map(s => `
        <div class="gallery-item">
          <video src="${s.generatedVideoUrl}" class="gallery-thumb" controls></video>
          <div class="gallery-item-footer">
            <span>分镜 #${s.shotIndex}</span>
            <a href="${s.generatedVideoUrl}" target="_blank" class="btn-text">下载视频</a>
          </div>
        </div>
      `).join('');
    } else {
      el.videoGalleryGrid.innerHTML = '<div class="empty-placeholder">视频渲染完成后将自动展示并下载</div>';
    }
  }

  // 事件监听设置
  function initEventListeners() {
    // Nav Tabs
    el.navTabs.forEach(btn => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    // Stepper nodes
    el.stepNodes.forEach(node => {
      node.addEventListener('click', () => {
        setWizardStep(parseInt(node.dataset.step, 10));
      });
    });

    // Step 1: 加载示例剧本
    el.btnLoadDemoScript.addEventListener('click', () => {
      el.scriptInput.value = DEMO_SCRIPT;
      showToast('已加载赛博朋克示例剧本！', 'info');
      saveState();
    });

    // Step 1: AI 解析角色
    el.btnAnalyzeCharacters.addEventListener('click', async () => {
      const script = el.scriptInput.value.trim();
      if (!script) { showToast('请先输入故事剧本', 'warn'); return; }
      if (!state.settings.apiKey) { showToast('请先在「⚙️ 设置」中配置 API Key', 'error'); return; }

      el.btnAnalyzeCharacters.disabled = true;
      el.btnAnalyzeCharacters.innerHTML = '<span>⏳</span> 正在解析角色视觉 DNA...';

      try {
        const characters = await window.FantasyAiClient.extractCharacters(
          script,
          state.settings
        );
        state.characters = characters;
        renderCharacters();
        saveState();
        showToast(`成功提取 ${characters.length} 个角色设定！`, 'success');
      } catch (err) {
        showToast(`解析失败: ${err.message}`, 'error');
      } finally {
        el.btnAnalyzeCharacters.disabled = false;
        el.btnAnalyzeCharacters.innerHTML = '<span>✨</span> AI 解析角色视觉 DNA';
      }
    });

    // Step 1: 一键全自动角色建库 (自动出定妆图 + 随机延时正名)
    if (el.btnAutoBuildAllCharacters) {
      el.btnAutoBuildAllCharacters.addEventListener('click', async () => {
        if (!state.characters.length) {
          showToast('请先解析出故事角色设定', 'warn');
          return;
        }
        const connected = await checkActiveTab();
        if (!connected) {
          showToast('请在 Flow 画板页面中操作', 'error');
          return;
        }

        el.btnAutoBuildAllCharacters.disabled = true;
        el.btnAutoBuildAllCharacters.innerHTML = '<span>⏳</span> 正在全自动建库中 (出图 + 随机延时正名)...';
        appendLog(`🚀 启动全自动角色建库流水线，共 ${state.characters.length} 个角色...`, 'info');

        chrome.tabs.sendMessage(state.activeTabId, {
          type: 'START_CHARACTERS_BUILD',
          characters: state.characters,
          options: { autoDownload: false }
        }, (res) => {
          if (!res?.ok) {
            el.btnAutoBuildAllCharacters.disabled = false;
            el.btnAutoBuildAllCharacters.innerHTML = '<span>⚡</span> 一键全自动建库：渲染定妆图 + 随机间隔更名';
            showToast(`启动失败: ${res?.error || '无法与画板建立通信'}`, 'error');
          }
        });
      });
    }

    el.btnGoToStep2.addEventListener('click', () => setWizardStep(2));

    // Step 2: 自动编排分镜
    el.btnGenerateStoryboard.addEventListener('click', async () => {
      const script = el.scriptInput.value.trim();
      if (!script) { showToast('请返回步骤 1 提供剧本', 'warn'); return; }
      if (!state.settings.apiKey) { showToast('请先在「⚙️ 设置」中配置 API Key', 'error'); return; }

      const shotCount = parseInt(el.shotCountSelect.value, 10);
      el.btnGenerateStoryboard.disabled = true;
      el.btnGenerateStoryboard.innerHTML = '<span>⏳</span> 电影分镜与运镜编排中...';

      try {
        const shots = await window.FantasyAiClient.generateStoryboard(
          script,
          state.characters,
          shotCount,
          state.settings
        );
        state.shots = shots;
        renderShots();
        saveState();
        showToast(`成功编排 ${shots.length} 个分镜头！`, 'success');
      } catch (err) {
        showToast(`编排分镜失败: ${err.message}`, 'error');
      } finally {
        el.btnGenerateStoryboard.disabled = false;
        el.btnGenerateStoryboard.innerHTML = '<span>🎬</span> 自动切分电影分镜';
      }
    });

    el.btnBackToStep1.addEventListener('click', () => setWizardStep(1));
    el.btnGoToStep3.addEventListener('click', () => setWizardStep(3));

    // Step 3: 批量生图流水线控制
    el.btnStartImageBatch.addEventListener('click', async () => {
      if (!state.shots.length) { showToast('没有可渲染的分镜清单', 'warn'); return; }
      const connected = await checkActiveTab();
      if (!connected) { showToast('请确保当前标签页处于 flow.google.com 项目中', 'error'); return; }

      el.btnStartImageBatch.disabled = true;
      el.btnPauseImageBatch.disabled = false;
      el.btnStopImageBatch.disabled = false;
      el.imageBatchBadge.textContent = '运行中';

      chrome.tabs.sendMessage(state.activeTabId, {
        type: 'START_IMAGE_BATCH',
        shots: state.shots,
        options: {
          projectTitle: state.settings.projectTitle,
          delayBetweenShots: state.settings.delayBetweenShots || 3500,
          autoDownload: state.settings.autoDownload
        }
      }, (res) => {
        if (!res?.ok) {
          showToast(`启动失败: ${res?.error || '无法与画板建立通信'}`, 'error');
          el.btnStartImageBatch.disabled = false;
          el.btnPauseImageBatch.disabled = true;
          el.btnStopImageBatch.disabled = true;
          el.imageBatchBadge.textContent = '异常';
        }
      });
    });

    el.btnPauseImageBatch.addEventListener('click', () => {
      if (!state.activeTabId) return;
      const isPaused = el.btnPauseImageBatch.textContent.includes('继续');
      if (isPaused) {
        chrome.tabs.sendMessage(state.activeTabId, { type: 'RESUME_BATCH' });
        el.btnPauseImageBatch.innerHTML = '<span>⏸</span> 暂停';
      } else {
        chrome.tabs.sendMessage(state.activeTabId, { type: 'PAUSE_BATCH' });
        el.btnPauseImageBatch.innerHTML = '<span>▶</span> 继续';
      }
    });

    el.btnStopImageBatch.addEventListener('click', () => {
      if (!state.activeTabId) return;
      chrome.tabs.sendMessage(state.activeTabId, { type: 'STOP_BATCH' });
      el.btnStartImageBatch.disabled = false;
      el.btnPauseImageBatch.disabled = true;
      el.btnStopImageBatch.disabled = true;
      el.imageBatchBadge.textContent = '已停止';
    });

    el.btnBackToStep2.addEventListener('click', () => setWizardStep(2));
    el.btnGoToStep4.addEventListener('click', () => setWizardStep(4));
    el.btnDirectToStep4.addEventListener('click', () => setWizardStep(4));

    // Step 4: 一键图生视频流水线控制
    el.btnStartVideoBatch.addEventListener('click', async () => {
      if (!state.shots.length) { showToast('分镜清单为空', 'warn'); return; }
      const connected = await checkActiveTab();
      if (!connected) { showToast('请确保处于 flow.google.com 项目中', 'error'); return; }

      el.btnStartVideoBatch.disabled = true;
      el.btnPauseVideoBatch.disabled = false;
      el.btnStopVideoBatch.disabled = false;
      el.videoBatchBadge.textContent = '运行中';

      chrome.tabs.sendMessage(state.activeTabId, {
        type: 'START_VIDEO_BATCH',
        shots: state.shots,
        options: {
          projectTitle: state.settings.projectTitle,
          delayBetweenShots: 4000,
          autoDownload: state.settings.autoDownload
        }
      }, (res) => {
        if (!res?.ok) {
          showToast(`启动失败: ${res?.error || '无法与画板建立通信'}`, 'error');
          el.btnStartVideoBatch.disabled = false;
          el.btnPauseVideoBatch.disabled = true;
          el.btnStopVideoBatch.disabled = true;
          el.videoBatchBadge.textContent = '异常';
        }
      });
    });

    el.btnPauseVideoBatch.addEventListener('click', () => {
      if (!state.activeTabId) return;
      const isPaused = el.btnPauseVideoBatch.textContent.includes('继续');
      if (isPaused) {
        chrome.tabs.sendMessage(state.activeTabId, { type: 'RESUME_BATCH' });
        el.btnPauseVideoBatch.innerHTML = '<span>⏸</span> 暂停';
      } else {
        chrome.tabs.sendMessage(state.activeTabId, { type: 'PAUSE_BATCH' });
        el.btnPauseVideoBatch.innerHTML = '<span>▶</span> 继续';
      }
    });

    el.btnStopVideoBatch.addEventListener('click', () => {
      if (!state.activeTabId) return;
      chrome.tabs.sendMessage(state.activeTabId, { type: 'STOP_BATCH' });
      el.btnStartVideoBatch.disabled = false;
      el.btnPauseVideoBatch.disabled = true;
      el.btnStopVideoBatch.disabled = true;
      el.videoBatchBadge.textContent = '已停止';
    });

    el.btnBackToStep3.addEventListener('click', () => setWizardStep(3));

    // Tab 2: 自由批量生图
    el.btnStartRawBatch.addEventListener('click', async () => {
      const rawText = el.rawPromptsInput.value.trim();
      if (!rawText) { showToast('请输入提示词', 'warn'); return; }
      const connected = await checkActiveTab();
      if (!connected) { showToast('请连接 Flow 画板页面', 'error'); return; }

      const prompts = rawText.split('\n').map(p => p.trim()).filter(Boolean);
      const shots = prompts.map((prompt, idx) => ({ shotIndex: idx + 1, prompt }));

      el.btnStartRawBatch.disabled = true;
      el.btnStopRawBatch.disabled = false;
      appendLog(`开始批量提交 ${shots.length} 条提示词...`, 'info');

      chrome.tabs.sendMessage(state.activeTabId, {
        type: 'START_IMAGE_BATCH',
        shots,
        options: {
          projectTitle: 'RawPromptStudio',
          delayBetweenShots: parseInt(el.promptDelayInput.value, 10) || 3500,
          autoDownload: el.promptAutoDownload.checked
        }
      }, (res) => {
        if (!res?.ok) {
          appendLog(`批量任务异常: ${res?.error}`, 'error');
          el.btnStartRawBatch.disabled = false;
          el.btnStopRawBatch.disabled = true;
        }
      });
    });

    el.btnStopRawBatch.addEventListener('click', () => {
      if (!state.activeTabId) return;
      chrome.tabs.sendMessage(state.activeTabId, { type: 'STOP_BATCH' });
      el.btnStartRawBatch.disabled = false;
      el.btnStopRawBatch.disabled = true;
      appendLog('用户已停止批量生图任务', 'warn');
    });

    el.btnClearLogs.addEventListener('click', () => {
      el.logConsole.innerHTML = '';
    });

    // Tab 3: 设置与模型管理
    el.btnToggleApiKey.addEventListener('click', () => {
      el.inputApiKey.type = el.inputApiKey.type === 'password' ? 'text' : 'password';
    });

    // 快捷预设切换
    if (el.selectPreset) {
      el.selectPreset.addEventListener('change', () => {
        const val = el.selectPreset.value;
        if (val === 'deepseek') {
          el.selectApiProvider.value = 'openai';
          el.inputApiBaseUrl.value = 'https://api.deepseek.com/v1';
          el.inputModelName.value = 'deepseek-chat';
          el.inputApiKey.placeholder = '输入 DeepSeek API Key (sk-...)';
        } else if (val === 'siliconflow') {
          el.selectApiProvider.value = 'openai';
          el.inputApiBaseUrl.value = 'https://api.siliconflow.cn/v1';
          el.inputModelName.value = 'deepseek-ai/DeepSeek-V3';
          el.inputApiKey.placeholder = '输入硅基流动 API Key (sk-...)';
        } else if (val === 'openai') {
          el.selectApiProvider.value = 'openai';
          el.inputApiBaseUrl.value = 'https://api.openai.com/v1';
          el.inputModelName.value = 'gpt-4o';
          el.inputApiKey.placeholder = '输入 OpenAI API Key (sk-...)';
        } else if (val === 'gemini') {
          el.selectApiProvider.value = 'gemini';
          el.inputApiBaseUrl.value = 'https://generativelanguage.googleapis.com';
          el.inputModelName.value = 'gemini-3.8-flash';
          el.inputApiKey.placeholder = '输入 Google AI Studio API Key (AIzaSy...)';
        } else if (val === 'openrouter') {
          el.selectApiProvider.value = 'openai';
          el.inputApiBaseUrl.value = 'https://openrouter.ai/api/v1';
          el.inputModelName.value = 'deepseek/deepseek-chat';
          el.inputApiKey.placeholder = '输入 OpenRouter API Key (sk-or-...)';
        } else if (val === 'ollama') {
          el.selectApiProvider.value = 'openai';
          el.inputApiBaseUrl.value = 'http://localhost:11434/v1';
          el.inputModelName.value = 'qwen2.5';
          el.inputApiKey.placeholder = '本地无需 API Key，可填 ollama';
          if (!el.inputApiKey.value) el.inputApiKey.value = 'ollama';
        }
      });
    }

    if (el.selectApiProvider) {
      el.selectApiProvider.addEventListener('change', () => {
        const prov = el.selectApiProvider.value;
        if (prov === 'gemini') {
          if (!el.inputApiBaseUrl.value || el.inputApiBaseUrl.value.includes('deepseek')) {
            el.inputApiBaseUrl.value = 'https://generativelanguage.googleapis.com';
          }
          if (!el.inputModelName.value || el.inputModelName.value.includes('deepseek')) {
            el.inputModelName.value = 'gemini-3.8-flash';
          }
        } else {
          if (!el.inputApiBaseUrl.value || el.inputApiBaseUrl.value.includes('googleapis')) {
            el.inputApiBaseUrl.value = 'https://api.deepseek.com/v1';
          }
          if (!el.inputModelName.value || el.inputModelName.value.includes('gemini')) {
            el.inputModelName.value = 'deepseek-chat';
          }
        }
      });
    }

    // 测试模型连接
    if (el.btnTestApiConnection) {
      el.btnTestApiConnection.addEventListener('click', async () => {
        const currentTestSettings = {
          apiProvider: el.selectApiProvider.value,
          apiBaseUrl: el.inputApiBaseUrl.value.trim(),
          apiKey: el.inputApiKey.value.trim(),
          modelName: el.inputModelName.value.trim()
        };

        if (!currentTestSettings.apiKey) {
          showToast('请先输入 API Key 再进行测试', 'warn');
          el.testConnectionStatus.className = 'test-connection-status error';
          el.testConnectionStatus.textContent = '❌ 请先填写 API Key';
          return;
        }

        el.btnTestApiConnection.disabled = true;
        el.testConnectionStatus.className = 'test-connection-status testing';
        el.testConnectionStatus.textContent = '正在测试连接...';

        try {
          const res = await window.FantasyAiClient.testConnection(currentTestSettings);
          el.testConnectionStatus.className = 'test-connection-status success';
          el.testConnectionStatus.textContent = `✅ 连接成功！(耗时 ${res.latency}ms)`;
          showToast('模型连接成功！', 'success');
        } catch (err) {
          el.testConnectionStatus.className = 'test-connection-status error';
          el.testConnectionStatus.textContent = `❌ 连接失败: ${err.message}`;
          showToast(`测试失败: ${err.message}`, 'error');
        } finally {
          el.btnTestApiConnection.disabled = false;
        }
      });
    }

    el.btnSaveSettings.addEventListener('click', async () => {
      state.settings.apiProvider = el.selectApiProvider ? el.selectApiProvider.value : 'openai';
      state.settings.apiBaseUrl = el.inputApiBaseUrl ? el.inputApiBaseUrl.value.trim() : 'https://api.deepseek.com/v1';
      state.settings.apiKey = el.inputApiKey ? el.inputApiKey.value.trim() : '';
      state.settings.modelName = el.inputModelName ? el.inputModelName.value.trim() : 'deepseek-chat';
      // 兼容旧字段
      state.settings.geminiApiKey = state.settings.apiKey;
      state.settings.geminiModel = state.settings.modelName;

      state.settings.projectTitle = el.inputProjectTitle.value.trim() || 'FantasyFlowStudio';
      state.settings.aspectRatio = el.selectAspectRatio.value;
      await window.FantasyStorage.saveSettings(state.settings);
      showToast('设置保存成功！', 'success');
    });

    el.btnResetProject.addEventListener('click', async () => {
      if (confirm('确定要清空当前项目的剧本、角色与分镜数据吗？')) {
        await window.FantasyStorage.clearProject();
        state.script = '';
        state.characters = [];
        state.shots = [];
        el.scriptInput.value = '';
        renderCharacters();
        renderShots();
        renderGalleries();
        setWizardStep(1);
        showToast('项目数据已重置', 'info');
      }
    });
  }

  // 监听来自 Flow 页面流水线的事件更新
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type !== 'PIPELINE_EVENT') return;

    const event = message.event;
    const isVideo = message.mode === 'VIDEO';

    if (event === 'BATCH_STARTED') {
      appendLog(`[${message.mode}] 流水线正式启动，总计 ${message.total} 个镜头`, 'info');
    }

    if (event === 'SHOT_START') {
      const idx = message.index;
      const total = message.total;
      const pct = Math.round(((idx - 1) / total) * 100);

      if (isVideo) {
        el.videoBatchStats.textContent = `${idx} / ${total}`;
        el.videoProgressBar.style.width = `${pct}%`;
        el.videoBatchStatusText.textContent = `正在为分镜 #${idx} 准备 Veo 运镜与首帧...`;
      } else {
        el.imageBatchStats.textContent = `${idx} / ${total}`;
        el.imageProgressBar.style.width = `${pct}%`;
        el.imageBatchStatusText.textContent = `正在准备分镜 #${idx} 提示词与一致性参考...`;
      }
      appendLog(`开始处理分镜 #${idx}: ${message.shot.narrative || message.shot.prompt.slice(0, 30)}...`, 'info');
    }

    if (event === 'ATTACHING_REFERENCE') {
      if (!isVideo) el.imageBatchStatusText.textContent = `正在附加角色【${message.char}】的一致性参考图...`;
      appendLog(`附加角色【${message.char}】参考图`, 'info');
    }

    if (event === 'ATTACHING_START_FRAME') {
      el.videoBatchStatusText.textContent = `正在为分镜 #${message.index} 挂载关键帧图片为首帧...`;
      appendLog(`分镜 #${message.index} 挂载首帧素材`, 'info');
    }

    if (event === 'FILLING_PROMPT') {
      const txt = isVideo ? '注入 Veo 镜头动力学提示词' : '注入电影生图提示词';
      if (isVideo) el.videoBatchStatusText.textContent = txt;
      else el.imageBatchStatusText.textContent = txt;
      appendLog(`分镜 #${message.index} ${txt}`, 'info');
    }

    if (event === 'SUBMITTING') {
      if (isVideo) el.videoBatchStatusText.textContent = `已向 Veo 提交渲染任务...`;
      else el.imageBatchStatusText.textContent = `已向 Google Flow 提交渲染...`;
      appendLog(`分镜 #${message.index} 提交生成`, 'info');
    }

    if (event === 'RENDER_PROGRESS') {
      const elapsed = message.elapsed ? ` (${message.elapsed}秒)` : '';
      if (isVideo) el.videoBatchStatusText.textContent = `Veo 动态渲染计算中${elapsed}...`;
      else el.imageBatchStatusText.textContent = `Flow 画板渲染生成中${elapsed}...`;
    }

    if (event === 'SHOT_COMPLETED') {
      const idx = message.index;
      const total = message.total;
      const pct = Math.round((idx / total) * 100);

      if (isVideo) {
        el.videoProgressBar.style.width = `${pct}%`;
        el.videoBatchStats.textContent = `${idx} / ${total}`;
        el.videoBatchStatusText.textContent = `分镜 #${idx} 动态视频渲染完成！`;
        if (state.shots[idx - 1]) state.shots[idx - 1].generatedVideoUrl = message.mediaUrl;
      } else {
        el.imageProgressBar.style.width = `${pct}%`;
        el.imageBatchStats.textContent = `${idx} / ${total}`;
        el.imageBatchStatusText.textContent = `分镜 #${idx} 生图渲染完成！`;
        if (state.shots[idx - 1]) state.shots[idx - 1].generatedImageUrl = message.mediaUrl;
      }

      renderGalleries();
      saveState();
      appendLog(`分镜 #${idx} 渲染完成并已归档！`, 'success');
    }

    if (event === 'CHAR_BUILD_START') {
      appendLog(`[角色建库 ${message.index}/${message.total}] 开始处理角色【${message.char.name}】...`, 'info');
      showToast(`[${message.index}/${message.total}] 开始自动处理【${message.char.name}】`, 'info');
    }

    if (event === 'CHAR_BUILD_DELAY') {
      appendLog(`[角色建库] 为模拟真人操作，随机等待 ${message.delaySeconds} 秒后进行自动更名...`, 'info');
    }

    if (event === 'CHAR_BUILD_RENAMING') {
      appendLog(`[角色建库] 正在为 Flow 角色自动正名为「${message.charName}」...`, 'info');
    }

    if (event === 'CHAR_BUILD_COMPLETED') {
      appendLog(`[角色建库] 角色【${message.char.name}】四面定妆图与正名已顺利完成！`, 'success');
      showToast(`角色【${message.char.name}】建库完成！`, 'success');
      saveState();
    }

    if (event === 'BATCH_ALL_COMPLETED') {
      if (message.mode === 'CHARACTER_BUILD') {
        if (el.btnAutoBuildAllCharacters) {
          el.btnAutoBuildAllCharacters.disabled = false;
          el.btnAutoBuildAllCharacters.innerHTML = '<span>✅</span> 全自动角色建库已完成';
        }
        appendLog('恭喜！所有角色定妆图与更名正名已全部自动建库完成！', 'success');
        showToast('🎉 所有角色四面定妆与正名已全自动建库完成！', 'success');
        return;
      }

      if (isVideo) {
        el.videoProgressBar.style.width = '100%';
        el.videoBatchBadge.textContent = '完成';
        el.videoBatchStatusText.textContent = '🎉 全部分镜视频已全部渲染完毕！';
        el.btnStartVideoBatch.disabled = false;
        el.btnPauseVideoBatch.disabled = true;
        el.btnStopVideoBatch.disabled = true;
      } else {
        el.imageProgressBar.style.width = '100%';
        el.imageBatchBadge.textContent = '完成';
        el.imageBatchStatusText.textContent = '🎉 全部分镜图片已全部生成完毕！';
        el.btnStartImageBatch.disabled = false;
        el.btnPauseImageBatch.disabled = true;
        el.btnStopImageBatch.disabled = true;
        el.allImagesDoneCard.style.display = 'flex';
      }
      el.btnStartRawBatch.disabled = false;
      el.btnStopRawBatch.disabled = true;
      appendLog(`恭喜！[${message.mode}] 全套分镜已完整出炉！`, 'success');
      showToast('恭喜！全部分镜渲染流水线已顺利完成！', 'success');
    }

    if (event === 'BATCH_ERROR') {
      appendLog(`流水线错误: ${message.error}`, 'error');
      showToast(`流水线中断: ${message.error}`, 'error');
      if (el.btnAutoBuildAllCharacters) {
        el.btnAutoBuildAllCharacters.disabled = false;
        el.btnAutoBuildAllCharacters.innerHTML = '<span>⚡</span> 一键全自动建库：渲染定妆图 + 随机间隔更名';
      }
      el.btnStartImageBatch.disabled = false;
      el.btnStartVideoBatch.disabled = false;
      el.btnStartRawBatch.disabled = false;
    }
  });

  // 定期检测标签页连接
  setInterval(checkActiveTab, 3000);

  // 初始化
  (async () => {
    initEventListeners();
    await loadState();
    await checkActiveTab();
  })();
})();
