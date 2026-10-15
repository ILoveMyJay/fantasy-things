/**
 * FantasyFlowStudio - Universal AI Filmmaking Intelligence
 * 支持 Google Gemini 官方 API 以及全系 OpenAI 兼容第三方模型
 * (DeepSeek / ChatGPT / 硅基流动 / Kimi / 通义千问 / OpenRouter / 本地 Ollama 等)
 */

const FantasyAiClient = {
  /**
   * 鲁棒 JSON 提取器：能够处理思考标签 <think>...</think>、Markdown 代码块及容错字符
   */
  cleanAndParseJson(rawText) {
    if (!rawText || typeof rawText !== 'string') {
      throw new Error('模型返回内容为空');
    }

    // 1. 过滤思考模型特有的 <think>...</think> 标签 (如 DeepSeek-R1, QwQ 等)
    let cleaned = rawText.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

    // 2. 提取 ```json ... ``` 或 ``` ... ``` 中的代码块
    const codeBlockMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (codeBlockMatch && codeBlockMatch[1]) {
      cleaned = codeBlockMatch[1].trim();
    }

    // 3. 尝试直接解析
    try {
      return JSON.parse(cleaned);
    } catch (_) {}

    // 4. 寻找最外层的 JSON 边界 ({...} 或 [...])
    const firstBrace = cleaned.indexOf('{');
    const firstBracket = cleaned.indexOf('[');
    let startIdx = -1;
    let endIdx = -1;

    if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
      startIdx = firstBrace;
      endIdx = cleaned.lastIndexOf('}');
    } else if (firstBracket !== -1) {
      startIdx = firstBracket;
      endIdx = cleaned.lastIndexOf(']');
    }

    if (startIdx !== -1 && endIdx > startIdx) {
      const jsonSubstr = cleaned.slice(startIdx, endIdx + 1);
      try {
        return JSON.parse(jsonSubstr);
      } catch (err) {
        // 尝试去除末尾多余逗号 (Trailing commas)
        const fixedComma = jsonSubstr.replace(/,\s*([}\]])/g, '$1');
        try {
          return JSON.parse(fixedComma);
        } catch (_) {
          throw new Error(`JSON 解析失败: ${err.message}\n内容片段: ${jsonSubstr.slice(0, 150)}...`);
        }
      }
    }

    throw new Error(`无法从模型输出中识别有效的 JSON 结构。原始内容片段: ${rawText.slice(0, 150)}...`);
  },

  /**
   * 统一底层 API 调度
   */
  async callAiApi(settings, systemInstruction, userPrompt) {
    // 兼容传统传参 (若 settings 直接传入字符串 apiKey)
    let config = {};
    if (typeof settings === 'string') {
      config = { apiKey: settings, apiProvider: 'gemini', modelName: 'gemini-3.8-flash' };
    } else {
      config = { ...settings };
    }

    const provider = config.apiProvider || (config.apiBaseUrl?.includes('googleapis') ? 'gemini' : 'openai');
    const apiKey = (config.apiKey || config.geminiApiKey || '').trim();

    if (!apiKey) {
      throw new Error('请先在「⚙️ 设置」中配置 API Key');
    }

    // ==========================================
    // 1. Google Gemini 官方 API 协议
    // ==========================================
    if (provider === 'gemini') {
      let model = config.modelName || config.geminiModel || 'gemini-3.8-flash';
      // 自动升级已废弃的 gemini-2.5-flash
      if (model === 'gemini-2.5-flash') {
        model = 'gemini-3.8-flash';
      }

      let baseUrl = (config.apiBaseUrl || 'https://generativelanguage.googleapis.com').trim().replace(/\/+$/, '');
      const endpoint = `${baseUrl}/v1beta/models/${model}:generateContent?key=${apiKey}`;

      const payload = {
        contents: [
          {
            role: 'user',
            parts: [{ text: userPrompt }]
          }
        ],
        generationConfig: {
          temperature: 0.7,
          responseMimeType: 'application/json'
        }
      };

      if (systemInstruction) {
        payload.systemInstruction = {
          parts: [{ text: systemInstruction }]
        };
      }

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error?.message || `Gemini API 请求失败 (HTTP ${response.status})`);
      }

      const result = await response.json();
      const textContent = result.candidates?.[0]?.content?.parts?.[0]?.text;
      return this.cleanAndParseJson(textContent);
    }

    // ==========================================
    // 2. OpenAI 兼容协议 (DeepSeek / GPT / 硅基流动 / Kimi / Qwen 等)
    // ==========================================
    let baseUrl = (config.apiBaseUrl || 'https://api.deepseek.com/v1').trim().replace(/\/+$/, '');
    let endpoint = baseUrl;

    if (endpoint.endsWith('/chat/completions')) {
      // 已经是完整地址
    } else if (endpoint.endsWith('/v1')) {
      endpoint = `${endpoint}/chat/completions`;
    } else if (endpoint.includes('/v1/')) {
      endpoint = `${endpoint}/chat/completions`;
    } else {
      endpoint = `${endpoint}/v1/chat/completions`;
    }

    const model = config.modelName || 'deepseek-chat';

    const messages = [];
    if (systemInstruction) {
      messages.push({ role: 'system', content: systemInstruction });
    }
    messages.push({ role: 'user', content: userPrompt });

    const payload = {
      model,
      messages,
      temperature: 0.7
    };

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const msg = errorData.error?.message || errorData.message || `API 请求失败 (HTTP ${response.status})`;
      throw new Error(msg);
    }

    const result = await response.json();
    const content = result.choices?.[0]?.message?.content;
    return this.cleanAndParseJson(content);
  },

  /**
   * 测试 API 连接状态
   */
  async testConnection(settings) {
    const startTime = Date.now();
    const testPrompt = `请严格只输出如下 JSON，不要输出任何其他内容：{"status":"ok","message":"连接成功"}`;
    const result = await this.callAiApi(settings, 'You are an API testing assistant.', testPrompt);
    const latency = Date.now() - startTime;
    return { ok: true, latency, result };
  },

  /**
   * 1. 剧本角色 DNA 解析与四面图提示词生成
   */
  async extractCharacters(script, settings, maybeModel) {
    let config = settings;
    if (typeof settings === 'string') {
      config = { apiKey: settings, modelName: maybeModel || 'gemini-3.8-flash' };
    }

    const systemPrompt = `你是一位顶尖的好莱坞电影概念设定总监。
请深入分析用户的剧本/剧情故事，提取核心主角 (MCR: Main Character Reference) 与关键配角 (SC1 ~ SC3)。
为每个角色设计极具辨识度、细节丰富且可在 Google Flow 中保持高度一致性的视觉 DNA。

请务必输出合法的 JSON 格式，结构如下：
{
  "characters": [
    {
      "code": "MCR",
      "name": "中文角色名（如：艾伦）",
      "role": "主角 / 私家侦探",
      "gender": "male / female",
      "dna": "极为详尽的角色外貌与衣着特征描述（英文，包含年龄、发型、发色、五官、体态、标志性服装、材质纹理与饰品）",
      "turnaroundPrompt": "用于在 Google Flow 生成角色四面定妆转视图的完整英文提示词"
    }
  ]
}

要求：
1. turnaroundPrompt 必须遵循标准的四面视图公式：
"Character turnaround reference sheet, 4 views: front view, side view, three-quarter view, back view. Full body, neutral standing pose, clean solid white background. [角色DNA描述]. 8k, photorealistic cinematic lighting, ultra-detailed textures, masterpiece."
2. 角色名必须与剧本剧情完全吻合。`;

    const userPrompt = `剧本内容如下：\n\n${script}\n\n请解析角色视觉 DNA 与生成四面转视图提示词，以纯 JSON 格式输出。`;
    const result = await this.callAiApi(config, systemPrompt, userPrompt);
    return result.characters || [];
  },

  /**
   * 2. 剧本电影分镜头切分与提示词编排 (自动适配 Google Flow 双锚点与 Veo 运镜)
   */
  async generateStoryboard(script, characters = [], shotCount = 4, settings, maybeModel) {
    let config = settings;
    if (typeof settings === 'string') {
      config = { apiKey: settings, modelName: maybeModel || 'gemini-3.8-flash' };
    }

    const charactersContext = characters.map(c => `【${c.code}: ${c.name}】DNA: ${c.dna}`).join('\n');

    const systemPrompt = `你是一位享誉全球的电影分镜大师与视觉特效导演。
请将剧本拆解为 ${shotCount} 个具有强烈叙事张力与视觉美感的电影分镜头。
必须为每个分镜头生成：
1. 中文镜头叙事与动作描述
2. Google Flow 适用的英文生图提示词 (Prompt)：包含景别(Shot Type)、机位角度(Camera Angle)、艺术质感与灯光、环境细节、角色标签与DNA、精确动作。
3. Veo 适用的英文动态运镜提示词 (Video Prompt)：描述镜头运动动力学（推拉摇移、升降俯仰、升格慢速、光影变化等）。

请务必输出合法的 JSON 格式：
{
  "shots": [
    {
      "shotIndex": 1,
      "narrative": "中文镜头叙事描述",
      "shotType": "Full shot / Close-up / Establishing shot / Medium shot / Macro close-up",
      "cameraAngle": "Eye level / Low angle / Bird's eye / Dutch angle",
      "characterCode": "MCR / SC1 / None",
      "characterName": "角色名或无",
      "prompt": "完整的 Google Flow 英文生图提示词",
      "videoPrompt": "完整的 Veo 视频运镜提示词"
    }
  ]
}

提示词规范：
- 避免使用 [no name labels] 这类冗余负向词，使用标准电影级摄影构图。
- 视频运镜必须生动具象，例如: "Slow dolly forward toward Allen's intense eyes, rain droplets glistening on his leather coat, neon reflections pulsing in the background, cinematic shallow depth of field, 4k ultra-smooth motion."`;

    const userPrompt = `剧本内容：\n${script}\n\n已知角色设定：\n${charactersContext}\n\n请切分为 ${shotCount} 个分镜，以纯 JSON 输出。`;
    const result = await this.callAiApi(config, systemPrompt, userPrompt);
    return result.shots || [];
  },

  /**
   * 3. 单独为分镜补充或优化 Veo 动态运镜提示词
   */
  async deriveVideoMotionPrompts(shots, settings, maybeModel) {
    let config = settings;
    if (typeof settings === 'string') {
      config = { apiKey: settings, modelName: maybeModel || 'gemini-3.8-flash' };
    }

    const systemPrompt = `你是一位好莱坞电影摄影指导（Director of Photography）。
请分析这组静态分镜，为每一个分镜生成最契合场景氛围的 Veo 动态镜头运动提示词 (Video Motion Prompt)。
重点包含：Camera movement (Pan / Tilt / Dolly / Track / Crane / Orbit / Zoom), Subject subtle motion, Lighting dynamics, Cinematic depth of field.

输出 JSON 格式：
{
  "videoPrompts": [
    {
      "shotIndex": 1,
      "videoPrompt": "英文运镜描述"
    }
  ]
}`;

    const userPrompt = `分镜列表：\n${JSON.stringify(shots.map(s => ({ shotIndex: s.shotIndex, narrative: s.narrative, prompt: s.prompt })), null, 2)}`;
    const result = await this.callAiApi(config, systemPrompt, userPrompt);
    return result.videoPrompts || [];
  }
};

// 导出与全局挂载 (双兼容)
if (typeof window !== 'undefined') {
  window.FantasyAiClient = FantasyAiClient;
  window.FantasyGemini = FantasyAiClient;
}
