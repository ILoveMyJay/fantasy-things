/**
 * FantasyFlowStudio - Flow Batch Pipeline Runner (ISOLATED World)
 * 调度 Google Flow 批量生图与一键生视频全自动闭环流水线。
 */

(() => {
  if (typeof window === 'undefined') return;

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
    isPaused = false;
    isStopped = false;
    activePipeline = 'IMAGE';

    notifySidepanel('BATCH_STARTED', { mode: 'IMAGE', total: shots.length });

    try {
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

        // 统计当前画板磁贴数量
        const initialTiles = window.FantasyAutomation.getCanvasMediaTiles().filter(t => t.isReady).length;

        // 若需要附加角色一致性参考图 (Dual-Anchor 视觉锚点)
        if (shot.characterCode || shot.characterName) {
          notifySidepanel('ATTACHING_REFERENCE', { index: shotIndex, char: shot.characterName || shot.characterCode });
          try {
            await window.FantasyAutomation.openAssetPickerModal();
            await window.FantasyAutomation.selectAssetInModal(shot.characterName || shot.characterCode);
            await window.FantasyAutomation.sleep(400);
          } catch (e) {
            console.warn('[FantasyPipeline] 附加角色参考图失败，继续进行文本渲染:', e);
          }
        }

        // 填充提示词 (包含 MCR 语义 DNA 锚点)
        notifySidepanel('FILLING_PROMPT', { index: shotIndex });
        await window.FantasyAutomation.fillPrompt(shot.prompt, true);
        await window.FantasyAutomation.sleep(600);

        // 提交生成
        notifySidepanel('SUBMITTING', { index: shotIndex });
        await window.FantasyAutomation.clickSubmit();
        await window.FantasyAutomation.sleep(1500);

        // 轮询等待新生成的图片磁贴就绪
        notifySidepanel('WAITING_RENDER', { index: shotIndex });
        const newMedia = await window.FantasyAutomation.waitForNewGeneration(
          initialTiles,
          150000,
          (progress) => {
            notifySidepanel('RENDER_PROGRESS', { index: shotIndex, ...progress });
          }
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
    isPaused = false;
    isStopped = false;
    activePipeline = 'VIDEO';

    notifySidepanel('BATCH_STARTED', { mode: 'VIDEO', total: shots.length });

    try {
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

        const initialTiles = window.FantasyAutomation.getCanvasMediaTiles().filter(t => t.isReady).length;

        // 若分镜已有图片产物，从项目中附加为首帧 (Start Frame)
        if (shot.generatedImageUrl || shot.imageIndex !== undefined) {
          notifySidepanel('ATTACHING_START_FRAME', { index: shotIndex });
          try {
            await window.FantasyAutomation.openAssetPickerModal();
            // 在素材弹窗中选取最新生成的对应分镜图
            await window.FantasyAutomation.selectAssetInModal(shot.imageIndex || 0);
            await window.FantasyAutomation.sleep(500);
          } catch (e) {
            console.warn('[FantasyPipeline] 附加起始帧失败，回退纯文本视频生成:', e);
          }
        }

        // 注入镜头运动提示词
        const videoPrompt = shot.videoPrompt || shot.prompt || 'Cinematic camera movement, slow motion, 4k';
        notifySidepanel('FILLING_PROMPT', { index: shotIndex, videoPrompt });
        await window.FantasyAutomation.fillPrompt(videoPrompt, false);
        await window.FantasyAutomation.sleep(800);

        // 提交 Veo 视频生成
        notifySidepanel('SUBMITTING', { index: shotIndex });
        await window.FantasyAutomation.clickSubmit();
        await window.FantasyAutomation.sleep(2000);

        // 轮询等待新视频渲染就绪
        notifySidepanel('WAITING_RENDER', { index: shotIndex, mode: 'VIDEO' });
        const newMedia = await window.FantasyAutomation.waitForNewGeneration(
          initialTiles,
          300000, // 视频渲染最长等待 5 分钟
          (progress) => {
            notifySidepanel('RENDER_PROGRESS', { index: shotIndex, mode: 'VIDEO', ...progress });
          }
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
   * 3. 全自动角色建库流水线 (自动生成 4 视角定妆图 + 随机延时 + 自动更名正名)
   */
  async function runAutoBuildCharactersPipeline(characters = [], options = {}) {
    isPaused = false;
    isStopped = false;
    activePipeline = 'CHARACTER_BUILD';

    notifySidepanel('BATCH_STARTED', { mode: 'CHARACTER_BUILD', total: characters.length });

    try {
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

        const initialTiles = window.FantasyAutomation.getCanvasMediaTiles().filter(t => t.isReady).length;

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
          initialTiles,
          150000,
          (progress) => {
            notifySidepanel('RENDER_PROGRESS', { index: charIndex, mode: 'CHARACTER_BUILD', ...progress });
          }
        );

        char.turnaroundImageUrl = newMedia.src;
        char.status = 'COMPLETED';

        // 4. 随机等待间隔 (模拟真人，让 Flow DOM 充分提交就绪)
        const randomDelay = Math.floor(2200 + Math.random() * 2000);
        notifySidepanel('CHAR_BUILD_DELAY', {
          index: charIndex,
          charName: char.name,
          delaySeconds: (randomDelay / 1000).toFixed(1)
        });
        await window.FantasyAutomation.sleep(randomDelay);

        // 5. 自动更名 (穿透受控组件，改名为正名)
        notifySidepanel('CHAR_BUILD_RENAMING', { index: charIndex, charName: char.name });
        try {
          await window.FantasyAutomation.renameCharacter(char.name);
          await window.FantasyAutomation.sleep(800);
        } catch (err) {
          console.warn('[FantasyPipeline] 自动更名提示:', err?.message);
        }

        notifySidepanel('CHAR_BUILD_COMPLETED', {
          index: charIndex,
          total: characters.length,
          char,
          mediaUrl: newMedia.src
        });

        // 角色之间的随机间隔 (3~5 秒)
        if (i < characters.length - 1) {
          const nextCharDelay = Math.floor(3000 + Math.random() * 2000);
          await window.FantasyAutomation.sleep(nextCharDelay);
        }
      }

      notifySidepanel('BATCH_ALL_COMPLETED', { mode: 'CHARACTER_BUILD', characters });
    } catch (err) {
      notifySidepanel('BATCH_ERROR', { error: err?.message || '自动角色建库中断' });
      throw err;
    } finally {
      activePipeline = null;
    }
  }

  // 监听 Sidepanel 与 Background 控制指令
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'START_CHARACTERS_BUILD') {
      runAutoBuildCharactersPipeline(message.characters, message.options)
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
      window.FantasyAutomation.renameCharacter(message.name)
        .then(ok => sendResponse({ ok }))
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
    runBatchVideoPipeline
  };
})();
