/**
 * FantasyFlowStudio - Centralized Flow DOM Selectors & Regex
 * Multi-lingual compatibility across Chinese, English, Korean, etc.
 * Note: All CSS selectors must be standard browser-compliant (no jQuery pseudo-selectors like :contains or :has-text).
 */

const FANTASY_SELECTORS = {
  // 提示词输入框
  PROMPT_EDITOR: '[contenteditable="true"][data-slate-editor="true"], .ProseMirror[contenteditable="true"], div[contenteditable="true"], [contenteditable="true"]',

  // 提交生成按钮 (纯标准 CSS 属性匹配)
  SUBMIT_BUTTON: 'button[aria-label*="Generate"], button[aria-label*="生成"], button[aria-label*="생성"]',

  // 画板磁贴容器
  TILE_CONTAINER: '[data-tile-id], flow-grid-tile-container',

  // 资产附加与上传弹窗触发按钮 (+)
  ADD_ASSET_BUTTON: 'button.add-menu-trigger, button[aria-haspopup="dialog"], button[aria-label*="Add"], button[aria-label*="添加"]',

  // 弹窗角色/图片选项条目
  ASSET_OPTION_ITEM: '[role="option"], div[class*="asset-item"], .asset-item, div[data-item-index], [data-item-index]',

  // 弹窗确认按钮多语言正则
  CONFIRM_MEDIA_REGEX: /添加媒体|添加到提示|添加到画板|Add\s*media|Add\s*to\s*prompt|미디어\s*추가|프롬프트에\s*추가/i,

  // 从项目中添加按钮正则
  ADD_FROM_PROJECT_REGEX: /从项目中添加|Add\s*from\s*project|프로젝트에서\s*추가/i,

  // 角色库与详情页元素
  CHARACTER_NAV_REGEX: /角色|Characters?|캐릭터/i,
  CHARACTER_TILE: 'flow-character-tile',
  CHARACTER_TILE_NAME: '.character-tile-name',
  CHARACTER_NAME_INPUT: 'flow-character-form input.name-input, input[aria-label="角色名称"], input[placeholder="角色名称"], flow-character-edit-header input.editable-text-input',
  CHARACTER_SAVE_BUTTON: 'flow-character-edit-header button[aria-label="完成修改"], button[aria-label="完成修改"]',
  CHARACTER_MORE_BUTTON: 'button[aria-label="更多选项"], button[aria-label="More options"]',
  RENAME_MENU_ITEM_REGEX: /重命名|Rename|이름\s*변경/i,
  RENAME_OVERLAY_INPUT: '.rename-tile-overlay input.editable-text-input, input.editable-text-input.editing, .cdk-overlay-pane input',
  RENAME_OVERLAY_CONFIRM: '.rename-tile-overlay button[aria-label="完成"], .cdk-overlay-pane button[aria-label="完成"]'
};

if (typeof window !== 'undefined') {
  window.FANTASY_SELECTORS = FANTASY_SELECTORS;
}
