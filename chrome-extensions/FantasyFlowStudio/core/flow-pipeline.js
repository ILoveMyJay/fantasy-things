/**
 * FantasyFlowStudio - Flow Batch Pipeline Runner (ISOLATED World)
 * 调度 Google Flow 批量生图与一键生视频全自动闭环流水线。
 */

(() => {
  if (typeof window === 'undefined') return;
  if (window.__fantasyPipelineLoaded) {
    console.log('[FantasyPipeline] Already loaded, skipping duplicate registration.');
    return;
  }
  window.__fantasyPipelineLoaded = true;

  let activePipeline = null;
  let isPaused = false;
  let isStopped = false;

  function notifySidepanel(type, payload = {}) {
    try {
      chrome.runtime.sendMessage({
        type: 'PIPELINE_EVENT',
        event: type,
        ...payload
      }).catch(() => {});
    } catch (_) {}
  }

  async function checkControlSignal() {
    if (isStopped) {
      throw new Error('用户已手动停止流水线');
    }
    while (isPaused) {
      if (isStopped) throw new Error('用户已手动停止流水线');
      await window.FantasyAutomation.sleep(500);
    }
  }

  /**
   * 1. 批量生图流水线
   */
  async function runBatchImagePipeline(shots = [], options = {}) {
    if (activePipeline) {
      throw new Error(`当前已有流水线 [${activePipeline}] 正在运行中，请等待其完成或先点击停止。`);
    }

    isPaused = false;
    isStopped = false;
    activePipeline = 'IMAGE';

    notifySidepanel('BATCH_STARTED', { mode: 'IMAGE', total: shots.length });

    try {
      // 0. 确保位于项目主画板 /「所有媒体」页面
      await window.FantasyAutomation.navigateToProjectPage();
      await window.FantasyAutomation.sleep(600);

      // 确保切换至图片模式
      await window.FantasyAutomation.switchFlowMode('IMAGE');
      await window.FantasyAutomation.sleep(500);

      const delayBetweenShots = options.delayBetweenShots || 3000;
      const autoDownload = options.autoDownload !== false;

      for (let i = 0; i < shots.length; i++) {
        await checkControlSignal();
        const shot = shots[i];
        const shotIndex = i + 1;

        notifySidepanel('SHOT_START', {
          index: shotIndex,
          total: shots.length,
          shot,
          mode: 'IMAGE'
        });

        // 统计当前画板已就绪的媒体集合与数量
        const readyTilesBefore = window.FantasyAutomation.getCanvasMediaTiles().filter(t => t.isReady);
        const initialReadyState = {
          count: readyTilesBefore.length,
          readySet: new Set(readyTilesBefore.map(t => t.src))
        };

        // 1. 先清空上一分镜残留的提示词内容，防止累加污染
        await window.FantasyAutomation.fillPrompt('', true);
        await window.FantasyAutomation.sleep(200);

        let hasAttachedReference = false;
        // 2. 若需要附加角色一致性参考图 (Dual-Anchor 视觉锚点)
        if (shot.characterCode || shot.characterName) {
          notifySidepanel('ATTACHING_REFERENCE', { index: shotIndex, char: shot.characterName || shot.characterCode });
          try {
            await window.FantasyAutomation.openAssetPickerModal();
            await window.FantasyAutomation.selectAssetInModal(shot.characterName || shot.characterCode);
            await window.FantasyAutomation.sleep(400);
            hasAttachedReference = true;
          } catch (e) {
            console.warn('[FantasyPipeline] 附加角色参考图失败，继续进行文本渲染:', e);
          }
        }

        // 3. 填充提示词 (若已附加参考图卡片则追加在后，否则全新填入)
        notifySidepanel('FILLING_PROMPT', { index: shotIndex });
        await window.FantasyAutomation.fillPrompt(shot.prompt, !hasAttachedReference);
        await window.FantasyAutomation.sleep(600);

        // 4. 提交生成
        notifySidepanel('SUBMITTING', { index: shotIndex });
        await window.FantasyAutomation.clickSubmit();
        await window.FantasyAutomation.sleep(1500);

        // 5. 轮询等待新生成的图片磁贴就绪 (支持即时中断)
        notifySidepanel('WAITING_RENDER', { index: shotIndex });
        const newMedia = await window.FantasyAutomation.waitForNewGeneration(
          initialReadyState,
          150000,
          (progress) => {
            notifySidepanel('RENDER_PROGRESS', { index: shotIndex, ...progress });
          },
          () => isStopped
        );

        shot.generatedImageUrl = newMedia.src;
        shot.status = 'COMPLETED';

        // 自动下载归档
        if (autoDownload && newMedia.src) {
          const paddedIndex = String(shotIndex).padStart(2, '0');
          const filename = `shot_${paddedIndex}_image.png`;
          chrome.runtime.sendMessage({
            type: 'DOWNLOAD_FILE',
            url: newMedia.src,
            filename,
            folder: options.projectTitle || 'FantasyFlowStudio'
          }).catch(() => {});
        }

        notifySidepanel('SHOT_COMPLETED', {
          index: shotIndex,
          total: shots.length,
          shot,
          mediaUrl: newMedia.src
        });

        if (i < shots.length - 1) {
          await window.FantasyAutomation.sleep(delayBetweenShots);
        }
      }

      notifySidepanel('BATCH_ALL_COMPLETED', { mode: 'IMAGE', shots });
    } catch (err) {
      notifySidepanel('BATCH_ERROR', { error: err?.message || '批量生图异常中断' });
      throw err;
    } finally {
      activePipeline = null;
    }
  }

  /**
   * 2. 一键批量生视频流水线 (Veo 图生视频闭环)
   */
  async function runBatchVideoPipeline(shots = [], options = {}) {
    if (activePipeline) {
      throw new Error(`当前已有流水线 [${activePipeline}] 正在运行中，请等待其完成或先点击停止。`);
    }

    isPaused = false;
    isStopped = false;
    activePipeline = 'VIDEO';

    notifySidepanel('BATCH_STARTED', { mode: 'VIDEO', total: shots.length });

    try {
      // 0. 确保位于项目主画板 /「所有媒体」页面
      await window.FantasyAutomation.navigateToProjectPage();
      await window.FantasyAutomation.sleep(600);

      // 切换至视频生成模式
      await window.FantasyAutomation.switchFlowMode('VIDEO');
      await window.FantasyAutomation.sleep(600);

      const delayBetweenShots = options.delayBetweenShots || 4000;
      const autoDownload = options.autoDownload !== false;

      for (let i = 0; i < shots.length; i++) {
        await checkControlSignal();
        const shot = shots[i];
        const shotIndex = i + 1;

        notifySidepanel('SHOT_START', {
          index: shotIndex,
          total: shots.length,
          shot,
          mode: 'VIDEO'
        });

        const readyTilesBefore = window.FantasyAutomation.getCanvasMediaTiles().filter(t => t.isReady);
        const initialReadyState = {
          count: readyTilesBefore.length,
          readySet: new Set(readyTilesBefore.map(t => t.src))
        };

        // 1. 先清空上一分镜残留的提示词内容，防止累加污染
        await window.FantasyAutomation.fillPrompt('', true);
        await window.FantasyAutomation.sleep(200);

        let hasAttachedFrame = false;
        // 若分镜已有图片产物，从项目中附加为首帧 (Start Frame)
        if (shot.generatedImageUrl || shot.imageIndex !== undefined) {
          notifySidepanel('ATTACHING_START_FRAME', { index: shotIndex });
          try {
            await window.FantasyAutomation.openAssetPickerModal();
            // 在素材弹窗中选取最新生成的对应分镜图
            await window.FantasyAutomation.selectAssetInModal(shot.imageIndex || 0);
            await window.FantasyAutomation.sleep(500);
            hasAttachedFrame = true;
          } catch (e) {
            console.warn('[FantasyPipeline] 附加起始帧失败，回退纯文本视频生成:', e);
          }
        }

        // 注入镜头运动提示词 (若已附加起始帧则追加在后，否则全量填入)
        const videoPrompt = shot.videoPrompt || shot.prompt || 'Cinematic camera movement, slow motion, 4k';
        notifySidepanel('FILLING_PROMPT', { index: shotIndex, videoPrompt });
        await window.FantasyAutomation.fillPrompt(videoPrompt, !hasAttachedFrame);
        await window.FantasyAutomation.sleep(800);

        // 提交 Veo 视频生成
        notifySidepanel('SUBMITTING', { index: shotIndex });
        await window.FantasyAutomation.clickSubmit();
        await window.FantasyAutomation.sleep(2000);

        // 轮询等待新视频渲染就绪
        notifySidepanel('WAITING_RENDER', { index: shotIndex, mode: 'VIDEO' });
        const newMedia = await window.FantasyAutomation.waitForNewGeneration(
          initialReadyState,
          300000, // 视频渲染最长等待 5 分钟
          (progress) => {
            notifySidepanel('RENDER_PROGRESS', { index: shotIndex, mode: 'VIDEO', ...progress });
          },
          () => isStopped
        );

        shot.generatedVideoUrl = newMedia.src;
        shot.videoStatus = 'COMPLETED';

        // 自动下载视频
        if (autoDownload && newMedia.src) {
          const paddedIndex = String(shotIndex).padStart(2, '0');
          const filename = `shot_${paddedIndex}_video.mp4`;
          chrome.runtime.sendMessage({
            type: 'DOWNLOAD_FILE',
            url: newMedia.src,
            filename,
            folder: options.projectTitle || 'FantasyFlowStudio'
          }).catch(() => {});
        }

        notifySidepanel('SHOT_COMPLETED', {
          index: shotIndex,
          total: shots.length,
          shot,
          mediaUrl: newMedia.src,
          mode: 'VIDEO'
        });

        if (i < shots.length - 1) {
          await window.FantasyAutomation.sleep(delayBetweenShots);
        }
      }

      notifySidepanel('BATCH_ALL_COMPLETED', { mode: 'VIDEO', shots });
    } catch (err) {
      notifySidepanel('BATCH_ERROR', { error: err?.message || '批量生视频异常中断' });
      throw err;
    } finally {
      activePipeline = null;
    }
  }

  /**
   * 3. 全自动角色建库流水线 (阶段1：生成4面定妆图 -> 阶段2：导入Flow角色库并正名)
   */
  async function runAutoBuildCharactersPipeline(characters = [], options = {}) {
    if (activePipeline) {
      throw new Error(`当前已有流水线 [${activePipeline}] 正在运行中，请等待其完成或先点击停止。`);
    }

    isPaused = false;
    isStopped = false;
    activePipeline = 'CHARACTER_BUILD';

    notifySidepanel('BATCH_STARTED', { mode: 'CHARACTER_BUILD', total: characters.length });

    try {
      // 阶段 1：画板 4 视角定妆图渲染
      await window.FantasyAutomation.switchFlowMode('IMAGE');
      await window.FantasyAutomation.sleep(500);

      for (let i = 0; i < characters.length; i++) {
        await checkControlSignal();
        const char = characters[i];
        const charIndex = i + 1;

        notifySidepanel('CHAR_BUILD_START', {
          index: charIndex,
          total: characters.length,
          char
        });

        const readyTilesBefore = window.FantasyAutomation.getCanvasMediaTiles().filter(t => t.isReady);
        const initialReadyState = {
          count: readyTilesBefore.length,
          readySet: new Set(readyTilesBefore.map(t => t.src))
        };

        // 清空上一轮残留内容
        await window.FantasyAutomation.fillPrompt('', true);
        await window.FantasyAutomation.sleep(200);

        // 1. 注入 4 视角定妆图提示词
        notifySidepanel('FILLING_PROMPT', { index: charIndex, charName: char.name, mode: 'CHARACTER_BUILD' });
        await window.FantasyAutomation.fillPrompt(char.turnaroundPrompt, true);
        await window.FantasyAutomation.sleep(600 + Math.random() * 400);

        // 2. 提交生图
        notifySidepanel('SUBMITTING', { index: charIndex, charName: char.name, mode: 'CHARACTER_BUILD' });
        await window.FantasyAutomation.clickSubmit();
        await window.FantasyAutomation.sleep(1500);

        // 3. 轮询等待定妆图渲染就绪
        notifySidepanel('WAITING_RENDER', { index: charIndex, charName: char.name, mode: 'CHARACTER_BUILD' });
        const newMedia = await window.FantasyAutomation.waitForNewGeneration(
          initialReadyState,
          150000,
          (progress) => {
            notifySidepanel('RENDER_PROGRESS', { index: charIndex, mode: 'CHARACTER_BUILD', ...progress });
          },
          () => isStopped
        );

        char.turnaroundImageUrl = newMedia.src;
        char.status = 'COMPLETED';

        notifySidepanel('CHAR_BUILD_COMPLETED', {
          index: charIndex,
          total: characters.length,
          char,
          mediaUrl: newMedia.src
        });

        if (i < characters.length - 1) {
          const nextCharDelay = Math.floor(2000 + Math.random() * 1500);
          await window.FantasyAutomation.sleep(nextCharDelay);
        }
      }

      // 阶段 2：全自动将定妆图导入为 Flow「角色」库实体并正名
      await runSyncCharactersPipeline(characters, options, true);

      notifySidepanel('BATCH_ALL_COMPLETED', { mode: 'CHARACTER_BUILD', characters });
    } catch (err) {
      notifySidepanel('BATCH_ERROR', { error: err?.message || '自动角色建库中断' });
      throw err;
    } finally {
      activePipeline = null;
    }
  }

  /**
   * 4. 纯角色库导入与正名流水线 (当画板已有定妆图时，直接导入为 Flow 角色实体)
   */
  async function runSyncCharactersPipeline(characters = [], options = {}, isSubPipeline = false) {
    if (!isSubPipeline) {
      if (activePipeline) {
        throw new Error(`当前已有流水线 [${activePipeline}] 正在运行中，请等待其完成或先点击停止。`);
      }
      activePipeline = 'CHARACTER_SYNC';
    }

    isPaused = false;
    isStopped = false;

    notifySidepanel('CHAR_SYNC_START', { total: characters.length });

    try {
      for (let i = 0; i < characters.length; i++) {
        await checkControlSignal();
        const char = characters[i];
        const charIndex = i + 1;

        notifySidepanel('CHAR_BUILD_RENAMING', {
          index: charIndex,
          total: characters.length,
          charName: char.name
        });

        try {
          await window.FantasyAutomation.syncCharacterToFlowLibrary(char, { index: i, total: characters.length });
          notifySidepanel('CHAR_SYNC_COMPLETED', {
            index: charIndex,
            total: characters.length,
            charName: char.name
          });
        } catch (err) {
          console.warn(`[FantasyPipeline] 角色【${char.name}】导入 Flow 角色库提示:`, err?.message);
        }

        if (i < characters.length - 1) {
          // 角色之间的随机间隔 (模拟真人，1.5~2.5秒)
          const randomDelay = Math.floor(1500 + Math.random() * 1000);
          notifySidepanel('CHAR_BUILD_DELAY', {
            index: charIndex,
            charName: char.name,
            delaySeconds: (randomDelay / 1000).toFixed(1)
          });
          await window.FantasyAutomation.sleep(randomDelay);
        }
      }

      notifySidepanel('CHAR_SYNC_ALL_COMPLETED', { total: characters.length });
      // 角色入库与正名全部完成后，自动切回主画板 /「所有媒体」页面
      try {
        await window.FantasyAutomation.navigateToProjectPage();
      } catch (_) {}
    } finally {
      if (!isSubPipeline) {
        activePipeline = null;
      }
    }
  }

  // 监听 Sidepanel 与 Background 控制指令
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'PING') {
      sendResponse({ ok: true, alive: true, version: '1.0.0' });
      return true;
    }

    if (message.type === 'START_CHARACTERS_BUILD') {
      runAutoBuildCharactersPipeline(message.characters, message.options)
        .then(() => sendResponse({ ok: true }))
        .catch(err => sendResponse({ ok: false, error: err.message }));
      return true;
    }

    if (message.type === 'START_CHARACTERS_SYNC') {
      runSyncCharactersPipeline(message.characters, message.options)
        .then(() => sendResponse({ ok: true }))
        .catch(err => sendResponse({ ok: false, error: err.message }));
      return true;
    }

    if (message.type === 'START_IMAGE_BATCH') {
      runBatchImagePipeline(message.shots, message.options)
        .then(() => sendResponse({ ok: true }))
        .catch(err => sendResponse({ ok: false, error: err.message }));
      return true;
    }

    if (message.type === 'START_VIDEO_BATCH') {
      runBatchVideoPipeline(message.shots, message.options)
        .then(() => sendResponse({ ok: true }))
        .catch(err => sendResponse({ ok: false, error: err.message }));
      return true;
    }

    if (message.type === 'PAUSE_BATCH') {
      isPaused = true;
      notifySidepanel('BATCH_PAUSED');
      sendResponse({ ok: true });
      return true;
    }

    if (message.type === 'RESUME_BATCH') {
      isPaused = false;
      notifySidepanel('BATCH_RESUMED');
      sendResponse({ ok: true });
      return true;
    }

    if (message.type === 'STOP_BATCH') {
      isStopped = true;
      isPaused = false;
      notifySidepanel('BATCH_STOPPED');
      sendResponse({ ok: true });
      return true;
    }

    if (message.type === 'RENAME_CHARACTER') {
      const char = { name: message.name };
      window.FantasyAutomation.syncCharacterToFlowLibrary(char)
        .then(res => sendResponse({ ok: true, res }))
        .catch(err => sendResponse({ ok: false, error: err.message }));
      return true;
    }

    if (message.type === 'GET_CANVAS_STATUS') {
      const tiles = window.FantasyAutomation.getCanvasMediaTiles();
      sendResponse({ ok: true, tiles });
      return true;
    }
  });

  window.FantasyPipeline = {
    runBatchImagePipeline,
    runBatchVideoPipeline,
    runAutoBuildCharactersPipeline,
    runSyncCharactersPipeline
  };
})();
