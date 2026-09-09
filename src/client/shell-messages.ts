import { defineMessages } from './i18n.ts'
export const SHELL_MESSAGES = defineMessages({
  pet: { zh: '用量小宠物', en: 'Token Pet' },
  renderError: { zh: '用量小宠物无法显示。请刷新页面。技术详情：', en: 'Token Pet could not render. Refresh the page. Technical details:' },
  showStats: { zh: '查看用量统计', en: 'Show usage statistics' },
  hideStats: { zh: '收起统计', en: 'Hide usage statistics' },
  contextTitle: { zh: '当前上下文窗口占用率', en: 'Current context window usage' },
  context: { zh: '上下文 {percent}%', en: 'Context {percent}%' },
  enhance: { zh: '增强提示词', en: 'Enhance' },
  enhanceTitle: { zh: '打开增强提示词抽屉（不会切换当前标签）', en: 'Open prompt enhancement without switching tabs' },
  refresh: { zh: '刷新', en: 'Refresh' },
  refreshTitle: { zh: '刷新账本、趋势与当前会话统计', en: 'Refresh usage snapshots' },
  collapse: { zh: '收起', en: 'Hide' },
  collapseTitle: { zh: '收起浮窗面板（宠物仍保留）', en: 'Hide the panel and keep the pet visible' },
  resize: { zh: '拖动等比例缩放；按住 Shift 可自由调整宽高', en: 'Drag to resize proportionally; hold Shift to resize freely' },
  drawer: { zh: '提示词增强', en: 'Prompt enhancement' },
})
