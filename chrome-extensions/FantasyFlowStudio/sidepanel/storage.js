/**
 * FantasyFlowStudio - Sidepanel Storage Manager
 * 封装 chrome.storage.local，管理多模型 API 配置 (Gemini / OpenAI / DeepSeek / 硅基流动等)、剧本历史与分镜状态。
 */

const FantasyStorage = {
  // 默认配置
  DEFAULT_SETTINGS: {
    apiProvider: 'openai', // 'openai' (通用第三方兼容协议) 或 'gemini' (Google 官方)
    apiBaseUrl: 'https://api.deepseek.com/v1',
    apiKey: '',
    modelName: 'deepseek-chat',
    // 兼容字段
    geminiApiKey: '',
    geminiModel: 'gemini-3.8-flash',
    projectTitle: '我的科幻短片',
    delayBetweenShots: 3500,
    autoDownload: true,
    aspectRatio: '16:9',
    videoLength: '5s'
  },

  async getSettings() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['fantasySettings'], (res) => {
        const settings = { ...this.DEFAULT_SETTINGS, ...(res.fantasySettings || {}) };

        // 迁移兼容：若之前保存了 geminiApiKey 且 apiKey 为空
        if (!settings.apiKey && settings.geminiApiKey) {
          settings.apiKey = settings.geminiApiKey;
        }
        // 迁移过时的 gemini-2.5-flash -> gemini-3.8-flash
        if (settings.geminiModel === 'gemini-2.5-flash') {
          settings.geminiModel = 'gemini-3.8-flash';
        }
        if (settings.modelName === 'gemini-2.5-flash') {
          settings.modelName = 'gemini-3.8-flash';
        }

        resolve(settings);
      });
    });
  },

  async saveSettings(settings) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ fantasySettings: settings }, () => {
        resolve(true);
      });
    });
  },

  async getProjectState() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['fantasyProjectState'], (res) => {
        resolve(res.fantasyProjectState || {
          script: '',
          characters: [],
          shots: [],
          currentStep: 1,
          batchStatus: 'idle'
        });
      });
    });
  },

  async saveProjectState(state) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ fantasyProjectState: state }, () => {
        resolve(true);
      });
    });
  },

  async clearProject() {
    return new Promise((resolve) => {
      chrome.storage.local.remove(['fantasyProjectState'], () => {
        resolve(true);
      });
    });
  }
};

if (typeof window !== 'undefined') {
  window.FantasyStorage = FantasyStorage;
}
