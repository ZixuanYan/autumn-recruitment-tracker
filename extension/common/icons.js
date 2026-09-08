/**
 * 秋招求职与简历助手 - 内联 SVG 图标表（v5.0.0）
 *
 * 为什么不用 emoji：v4.2.0 的 UI 里有 18 处 emoji 当图标（火箭 / 便签 / 图钉 / 文档 / 收件箱 /
 * 放大镜 / 地球 / 对勾 / 叉 / 警告 / 剪贴板 / 循环 / 庆祝 / 手指 / 下三角），这是「AI 生成感」
 * 最强的单一信号——emoji 在 Windows / macOS / Linux 上渲染成完全不同的图形，无法控制颜色与
 * 粗细，在深色主题下还会保持自己的彩色底，与界面配色永远对不上。
 *
 * 统一改为 24x24 viewBox 的线性图标：stroke="currentColor" 继承文字色（深浅主题自动适配），
 * 1.75 的描边粗细在 16px 渲染尺寸下清晰但不笨重，fill="none" 保证不会出现色块。
 * test/extension-ui.js 会断言这里不含任何硬编码 fill="#..." / stroke="#..."。
 */
(() => {
  'use strict';
  const root = typeof globalThis !== 'undefined' ? globalThis : self;
  root.AJA = root.AJA || {};

  // 每项都是 <svg> 的内部内容（path / circle / line），不含 svg 外壳
  const ICON = {
    // 品牌标记：坐标轴 + 上升折线，表达「投递进度追踪」，替代旧版的火箭 emoji
    logo: '<path d="M4 4v16h16"/><path d="M7.5 14.5l3.5-4 3 2.8L20 7"/>',
    // 简历字段库（胶囊文案与面板段标题）
    file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h4"/>',
    // 一键收录（新增一条投递）
    plus: '<path d="M12 5v14M5 12h14"/>',
    // 网页标题参考
    type: '<path d="M4 7V5h16v2M9 19h6M12 5v14"/>',
    // 暂存箱
    inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
    // 搜索字段
    search: '<circle cx="11" cy="11" r="7"/><path d="M20.5 20.5L16.2 16.2"/>',
    // 打开网页版管理器
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3.2 9.5h17.6M3.2 14.5h17.6"/><path d="M11.4 3.1a15.5 15.5 0 0 0 0 17.8M12.6 3.1a15.5 15.5 0 0 1 0 17.8"/>',
    // 确认 / 已填入
    check: '<path d="M20 6.5L9.4 17.1 4 11.7"/>',
    // 关闭 / 丢弃
    close: '<path d="M18 6L6 18M6 6l12 12"/>',
    // 识别告警（有字段没认出来）
    warn: '<path d="M10.3 3.9L1.9 18a2 2 0 0 0 1.7 3h16.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9.2v4.2M12 17.1h.01"/>',
    // 手风琴折叠箭头（替代旧版的 ▼ 字符）
    chevron: '<path d="M6 9.5l6 6 6-6"/>',
    // 复制到剪贴板
    copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    // 已更新暂存项（重复收录同一岗位时的反馈，替代旧版的循环 emoji）
    refresh: '<path d="M20.5 12a8.5 8.5 0 1 1-2.5-6"/><path d="M20.5 4v5h-5"/>'
  };
  root.AJA.ICON = ICON;

  /**
   * 生成完整 <svg> 标签。
   * @param {keyof ICON} name 图标名，未知名字返回空串（不抛错，避免一处笔误让整个面板渲染失败）
   * @param {number} size 渲染边长，默认 16
   * @param {string} cls 附加的 class
   */
  function svg(name, size, cls) {
    const body = ICON[name];
    if (!body) return '';
    const px = Number(size) > 0 ? Number(size) : 16;
    const extra = cls ? ` ${cls}` : '';
    return `<svg class="aja-ico${extra}" width="${px}" height="${px}" viewBox="0 0 24 24" fill="none" `
      + `stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" `
      + `aria-hidden="true" focusable="false">${body}</svg>`;
  }
  root.AJA.svg = svg;

  // 图标 + 文字的通用组合（按钮、段标题都用它，保证间距一致而不是各处手写 gap）
  function labeled(name, text, size) {
    return `${svg(name, size || 16)}<span>${text}</span>`;
  }
  root.AJA.iconLabel = labeled;
})();
