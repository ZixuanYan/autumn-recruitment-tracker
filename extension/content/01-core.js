/**
 * 秋招求职与简历助手 - Content Script 01/06 核心基础设施
 * 常量、共享状态、光标追踪、Shadow Root 宿主与样式、常驻胶囊按钮
 * 注意：01-06 按序注入同一 isolated world，顶层 const/let/function 跨文件可见
 */
'use strict';

// 网页版管理器页面：跳过侧边栏注入（06-bridge.js 提供消息中继），其余页面正常初始化
const IS_TRACKER_PAGE = location.origin === AJA.TRACKER_ORIGIN && location.pathname.startsWith(AJA.TRACKER_PATH_PREFIX);
let shadow = null;

// ===== 顶层声明：05-sidebar / 04-autofill 跨文件引用，严禁包进块级作用域 =====
const RESUME_STORAGE_KEY = AJA.RESUME_STORAGE_KEY;
const MSG = AJA.MSG;
let currentResumeData = AJA.DEFAULT_RESUME;
let lastFocusedEl = null;
let lastSelectionStart = null;
let lastSelectionEnd = null;
let toggleBtn = null;
let toastTimer = null;

// AI 辅助填写配置（仅本机 chrome.storage.local；供 04-autofill 的 AI 补全阶段读取）。
// 默认 null = 未配置 = 纯离线规则填充，零网络。Key 绝不进网页/云同步/备份。
AJA.aiConfig = null;
function loadAiConfig() {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get([AJA.AI_CONFIG_KEY], (res) => {
        if (chrome.runtime.lastError) return;
        AJA.aiConfig = (res && res[AJA.AI_CONFIG_KEY]) ? res[AJA.AI_CONFIG_KEY] : null;
      });
    }
  } catch (_) {}
}
loadAiConfig();
if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[AJA.AI_CONFIG_KEY]) {
      AJA.aiConfig = changes[AJA.AI_CONFIG_KEY].newValue || null;
    }
  });
}

// Toast 消息函数（桥接模式下无 shadow，静默忽略）
function showToast(msg) {
  if (!shadow) return;
  const existing = shadow.querySelector('.aja-toast');
  if (existing) existing.remove();
  if (toastTimer) clearTimeout(toastTimer);

  const t = document.createElement('div');
  t.className = 'aja-toast';
  t.textContent = msg;
  shadow.appendChild(t);

  toastTimer = setTimeout(() => {
    t.remove();
  }, 2000);
}

// HTML 转义（02-resume / 05-sidebar 渲染简历值与暂存箱时共用）。
// 这些数据可能来自任意招聘页解析，未转义直接拼 innerHTML 会在扩展 isolated world 形成注入面。
// 顶层声明，保证跨文件可见（与 showToast 同级，位于 if(IS_TRACKER_PAGE) 之前）。
function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, ch => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

if (IS_TRACKER_PAGE) {
  console.log('[秋招求职与简历助手] 检测到网页版管理器，进入桥接模式（不注入侧边栏）');
} else {

// 扩展重载后旧注入会残留僵尸节点（旧 world 已销毁、事件已断），直接移除重建
document.getElementById('autumn-job-assistant-host')?.remove();


  function updateActiveSelection(el) {
    if (!el) return;
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      lastFocusedEl = el;
      try {
        lastSelectionStart = el.selectionStart;
        lastSelectionEnd = el.selectionEnd;
      } catch (_) {}
    } else if (el.isContentEditable) {
      lastFocusedEl = el;
    }
  }

  // ================= 监听宿主页面聚焦与光标交互事件 =================
  document.addEventListener('focusin', (e) => updateActiveSelection(e.target), true);
  document.addEventListener('click', (e) => updateActiveSelection(e.target), true);
  document.addEventListener('keyup', (e) => updateActiveSelection(e.target), true);
  document.addEventListener('select', (e) => updateActiveSelection(e.target), true);

  // ================= 创建宿主容器与 Shadow Root =================
  const host = document.createElement('div');
  host.id = 'autumn-job-assistant-host';
  document.documentElement.appendChild(host);

  shadow = host.attachShadow({ mode: 'open' });

  // ================= 注入 Shadow DOM 核心样式 =================
  const style = document.createElement('style');
  style.textContent = `
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; }
    
    /* 悬浮吸边胶囊按钮 */
    #aja-toggle {
      position: fixed;
      top: 180px;
      right: 0;
      z-index: 2147483646;
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 8px 12px 8px 10px;
      background: linear-gradient(135deg, #5367e9, #4053cb);
      color: #fff;
      font-size: 13px;
      font-weight: 600;
      border: 1px solid rgba(255, 255, 255, 0.3);
      border-right: none;
      border-radius: 20px 0 0 20px;
      box-shadow: 0 4px 16px rgba(64, 83, 203, 0.35);
      cursor: pointer;
      user-select: none;
      transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
    }
    #aja-toggle:hover {
      padding-left: 14px;
      background: linear-gradient(135deg, #6275f0, #4c5fd6);
      box-shadow: 0 6px 20px rgba(64, 83, 203, 0.45);
    }
    #aja-toggle.hidden {
      display: none;
    }

    /* 侧边滑出抽屉面板 */
    #aja-drawer {
      position: fixed;
      top: 20px;
      right: 20px;
      bottom: 20px;
      width: 350px;
      max-height: calc(100vh - 40px);
      z-index: 2147483647;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      background: rgba(255, 255, 255, 0.98);
      backdrop-filter: blur(16px);
      border: 1px solid #e2e8f0;
      border-radius: 16px;
      box-shadow: 0 12px 40px rgba(15, 23, 42, 0.18);
      user-select: none;
      transition: transform 0.28s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.25s ease;
      transform: translateX(0);
      opacity: 1;
    }
    #aja-drawer.collapsed {
      transform: translateX(calc(100% + 30px));
      opacity: 0;
      pointer-events: none;
    }

    /* 顶部标题栏 */
    .drawer-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-shrink: 0;
      padding: 12px 14px;
      background: linear-gradient(135deg, #4f64ee, #3d51cc);
      color: #fff;
      border-radius: 15px 15px 0 0;
      cursor: move;
    }
    .brand-area {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .brand-icon {
      display: grid;
      place-items: center;
      width: 24px;
      height: 24px;
      background: rgba(255, 255, 255, 0.2);
      border-radius: 6px;
      font-size: 14px;
    }
    .brand-title {
      font-size: 14px;
      font-weight: 700;
      letter-spacing: 0.3px;
    }
    .shortcut-badge {
      font-size: 10px;
      background: rgba(255, 255, 255, 0.22);
      padding: 2px 6px;
      border-radius: 4px;
      font-weight: normal;
      color: #e0e7ff;
    }
    .ver-badge {
      flex-shrink: 0;
      font-size: 9.5px;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      background: rgba(255, 255, 255, 0.16);
      padding: 1px 5px;
      border-radius: 4px;
      color: #c7d2fe;
      letter-spacing: .02em;
    }
    .close-btn {
      background: none;
      border: none;
      color: #fff;
      cursor: pointer;
      font-size: 18px;
      line-height: 1;
      padding: 2px 6px;
      border-radius: 4px;
      opacity: 0.8;
      transition: opacity 0.15s;
    }
    .close-btn:hover {
      opacity: 1;
      background: rgba(255, 255, 255, 0.2);
    }

    /* 抽屉内容滚动区域 */
    .drawer-body {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      padding: 10px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .drawer-body::-webkit-scrollbar {
      width: 5px;
    }
    .drawer-body::-webkit-scrollbar-thumb {
      background: #cbd5e1;
      border-radius: 4px;
    }
    /* 关键修复：.drawer-body 是 flex 列，子项默认 flex-shrink:1；而 .pending-box 有 overflow:hidden，
       作为 flex 子项时 min-height:auto 会解析为 0 → 矮窗口下被压缩并裁掉内容（暂存箱/AI 面板"显示不全、滚不动"）。
       禁止所有直接子项收缩，让 .drawer-body 成为唯一滚动容器。 */
    .drawer-body > * {
      flex-shrink: 0;
    }

    /* 一键收录卡片 */
    .capture-card {
      background: linear-gradient(145deg, #f0f4ff, #e6edff);
      border: 1px solid #c7d7fe;
      border-radius: 12px;
      padding: 10px;
    }
    .capture-btn {
      width: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      padding: 8px 12px;
      background: #5367e9;
      color: #fff;
      border: none;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 650;
      cursor: pointer;
      transition: background 0.15s, transform 0.1s;
    }
    .capture-btn:hover {
      background: #4053cb;
      transform: translateY(-1px);
    }
    .capture-btn:active {
      transform: translateY(0);
    }
    .autofill-btn {
      width: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      padding: 8px 12px;
      margin-top: 6px;
      background: linear-gradient(135deg, #f59e0b, #d97706);
      color: #fff;
      border: none;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 650;
      cursor: pointer;
      transition: background 0.15s, transform 0.1s, box-shadow 0.15s;
      box-shadow: 0 2px 4px rgba(217, 119, 6, 0.2);
    }
    .autofill-btn:hover {
      background: linear-gradient(135deg, #d97706, #b45309);
      transform: translateY(-1px);
      box-shadow: 0 4px 6px rgba(217, 119, 6, 0.25);
    }
    .autofill-btn:active {
      transform: translateY(0);
    }
    .autofill-warning-tip {
      font-size: 10.5px;
      color: #b45309;
      text-align: center;
      margin-top: 4px;
      line-height: 1.2;
      opacity: 0.9;
    }

    /* 暂存箱 */
    .pending-box {
      margin-top: 12px;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      background: #f8fafc;
      overflow: hidden;
    }
    .pending-toggle {
      display: flex;
      align-items: center;
      gap: 7px;
      width: 100%;
      padding: 9px 12px;
      border: 0;
      background: transparent;
      color: #334155;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
    }
    .pending-toggle:hover { background: #eef2f7; }
    .pending-count {
      margin-left: auto;
      min-width: 20px;
      padding: 1px 7px;
      border-radius: 999px;
      background: #5b6cfa;
      color: #fff;
      font-size: 11px;
      text-align: center;
    }
    .pending-list {
      border-top: 1px solid #e2e8f0;
      max-height: 180px;
      overflow-y: auto;
    }
    .pending-item {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 8px 10px;
      border-bottom: 1px solid #f1f5f9;
    }
    .pending-item:last-child { border-bottom: 0; }
    .pending-item-main {
      flex: 1;
      min-width: 0;
      cursor: pointer;
    }
    .pending-item-main:hover .pending-item-title { color: #5b6cfa; }
    .pending-item-title {
      font-size: 12.5px;
      font-weight: 600;
      color: #1e293b;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .pending-item-meta {
      font-size: 11px;
      color: #94a3b8;
      margin-top: 1px;
    }
    .pending-item-discard {
      flex: 0 0 auto;
      width: 22px;
      height: 22px;
      border: 0;
      border-radius: 6px;
      background: #fee2e2;
      color: #dc2626;
      font-size: 11px;
      cursor: pointer;
    }
    .pending-item-discard:hover { background: #fecaca; }

    /* 简历来源提示 */
    .resume-source-hint {
      margin: 14px 0 8px;
      padding: 7px 10px;
      border-radius: 8px;
      background: #eef2ff;
      color: #4338ca;
      font-size: 11.5px;
      line-height: 1.4;
    }

    /* 快速微调确认表单 */
    .capture-form {
      display: none;
      margin-top: 10px;
      padding-top: 10px;
      border-top: 1px dashed #bfdbfe;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .capture-form.hidden {
      display: none;
    }
    .title-hint {
      font-size: 11px;
      color: #64748b;
      background: #f8fafc;
      border: 1px dashed #e2e8f0;
      border-radius: 6px;
      padding: 5px 8px;
      line-height: 1.4;
      word-break: break-all;
      cursor: pointer;
    }
    .title-hint:hover {
      background: #eef2ff;
      border-color: #a5b4fc;
    }
    .title-hint-label {
      color: #94a3b8;
      font-size: 10px;
      margin-bottom: 2px;
    }
    .form-group {
      display: flex;
      flex-direction: column;
      gap: 3px;
    }
    .form-group label {
      font-size: 11px;
      font-weight: 600;
      color: #475569;
    }
    .form-group input, .form-group select {
      padding: 5px 8px;
      font-size: 12px;
      border: 1px solid #cbd5e1;
      border-radius: 6px;
      background: #fff;
      color: #1e293b;
      outline: none;
    }
    .form-group input:focus, .form-group select:focus {
      border-color: #5367e9;
      box-shadow: 0 0 0 2px rgba(83, 103, 233, 0.15);
    }
    /* 修复：抽屉整体 user-select:none 会让输入框中已有文本无法选中/替换（表现为"配置存了就改不了"）；输入控件必须可选可编辑 */
    #aja-drawer input, #aja-drawer textarea {
      user-select: text;
      -webkit-user-select: text;
    }
    /* 修复：AI 配置面板复用了 .pending-list(为暂存队列设 max-height:180px)，内容更高会被裁剪；此处放开高度 */
    #aja-ai-panel {
      max-height: none;
      overflow: visible;
      padding: 10px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    #aja-ai-panel.hidden { display: none; }
    .form-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 6px;
    }
    .form-actions {
      display: flex;
      gap: 6px;
      margin-top: 4px;
    }
    .btn-save-record {
      flex: 1;
      padding: 6px;
      background: #24a475;
      color: #fff;
      border: none;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
    }
    .btn-save-record:hover {
      background: #1e8b63;
    }
    .btn-cancel-capture {
      padding: 6px 10px;
      background: #f1f5f9;
      color: #64748b;
      border: 1px solid #cbd5e1;
      border-radius: 6px;
      font-size: 12px;
      cursor: pointer;
    }
    .btn-cancel-capture:hover {
      background: #e2e8f0;
    }

    /* 简历模块手风琴折叠 */
    .resume-section {
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      background: #fff;
      overflow: hidden;
    }
    .section-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 10px;
      background: #f8fafc;
      font-size: 12px;
      font-weight: 700;
      color: #334155;
      cursor: pointer;
      transition: background 0.15s;
    }
    .section-header:hover {
      background: #f1f5f9;
    }
    .section-arrow {
      font-size: 10px;
      transition: transform 0.2s;
      color: #94a3b8;
    }
    .resume-section.collapsed .section-arrow {
      transform: rotate(-90deg);
    }
    .section-content {
      padding: 6px 8px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .resume-section.collapsed .section-content {
      display: none;
    }

    /* 经历行卡片 */
    .exp-row {
      background: #f8fafc;
      border: 1px solid #f1f5f9;
      border-radius: 6px;
      padding: 6px;
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
    }
    .exp-row-title {
      width: 100%;
      font-size: 11px;
      font-weight: 700;
      color: #4f64ee;
      margin-bottom: 2px;
      border-bottom: 1px dashed #e2e8f0;
      padding-bottom: 2px;
    }

    /* 填充数据字段按钮 */
    .field-btn {
      display: inline-flex;
      align-items: center;
      padding: 4px 7px;
      background: #ffffff;
      border: 1px solid #d1d5db;
      border-radius: 6px;
      color: #1e293b;
      font-size: 11px;
      cursor: pointer;
      transition: all 0.12s;
      max-width: 100%;
      text-align: left;
    }
    .field-btn:hover {
      background: #eff6ff;
      border-color: #93c5fd;
      color: #1d4ed8;
      transform: translateY(-1px);
    }
    .field-btn:active {
      background: #dbeafe;
      transform: translateY(0);
    }
    .field-key {
      color: #64748b;
      font-size: 10px;
      margin-right: 4px;
      white-space: nowrap;
    }
    .field-key::after {
      content: ':';
    }
    .field-val {
      font-weight: 550;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 190px;
    }

    /* 抽屉底部快捷操作 */
    .drawer-footer {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-shrink: 0;
      padding: 10px 12px;
      background: #f8fafc;
      border-top: 1px solid #e2e8f0;
      border-radius: 0 0 15px 15px;
    }
    .footer-btn {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 5px;
      padding: 7px 10px;
      font-size: 12px;
      font-weight: 600;
      border-radius: 8px;
      border: 1px solid #cbd5e1;
      background: #fff;
      color: #334155;
      cursor: pointer;
      transition: all 0.15s;
    }
    .footer-btn:hover {
      background: #eff6ff;
      border-color: #93c5fd;
      color: #4f64ee;
    }

    /* 提示 Toast */
    .aja-toast {
      position: absolute;
      top: 16px;
      left: 50%;
      transform: translateX(-50%);
      background: #1e293b;
      color: #fff;
      padding: 7px 14px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 500;
      box-shadow: 0 4px 14px rgba(0,0,0,0.2);
      pointer-events: none;
      z-index: 999;
      animation: fadeIn .2s ease;
      white-space: nowrap;
    }
    @keyframes fadeIn {
      from { opacity: 0; transform: translate(-50%, -6px); }
      to { opacity: 1; transform: translate(-50%, 0); }
    }
  `;
  shadow.appendChild(style);


// ================= 常驻胶囊按钮（轻量 DOM，侧边栏抽屉首次唤起时才完整构建）=================
toggleBtn = document.createElement('div');
toggleBtn.id = 'aja-toggle';
toggleBtn.title = `展开秋招求职助手 v${AJA.VERSION} (Ctrl/⌘+Shift+F，鼠标悬停可查看版本号)`;
toggleBtn.innerHTML = '<span>📝</span><span>简历助手</span>';
shadow.appendChild(toggleBtn);

// 拖拽位移超过阈值则抑制随后的 click，避免重定位胶囊后面板被误弹开（在 mousedown/mousemove 中维护）
let toggleDragMoved = false;

// 点击胶囊：首次唤起时构建完整侧边栏再展开
toggleBtn.addEventListener('click', () => {
  if (toggleDragMoved) { toggleDragMoved = false; return; }
  if (AJA.ensureSidebarUI) AJA.ensureSidebarUI();
  if (AJA.toggleDrawer) AJA.toggleDrawer(true);
});

// 悬浮胶囊垂直拖拽定位
let isDraggingToggle = false; // 仅本文件使用，可留块内
let toggleStartY = 0;
let toggleStartTop = 0;

toggleBtn.addEventListener('mousedown', (e) => {
  isDraggingToggle = true;
  toggleDragMoved = false;
  toggleStartY = e.clientY;
  toggleStartTop = toggleBtn.getBoundingClientRect().top;
  e.preventDefault();
});

document.addEventListener('mousemove', (e) => {
  if (!isDraggingToggle) return;
  const dy = e.clientY - toggleStartY;
  if (Math.abs(dy) > 4) toggleDragMoved = true;
  const newTop = Math.min(Math.max(20, toggleStartTop + dy), window.innerHeight - 60);
  toggleBtn.style.top = `${newTop}px`;
});

document.addEventListener('mouseup', () => {
  isDraggingToggle = false;
});

// ================= 快捷键 Ctrl/⌘+Shift+F（浏览器级 chrome.commands + 页面内监听双保险）=================
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'F' || e.key === 'f')) {
    e.preventDefault();
    if (AJA.ensureSidebarUI) AJA.ensureSidebarUI();
    if (AJA.toggleDrawer) AJA.toggleDrawer();
  }
});

// 浏览器级快捷键转发（background 的 chrome.commands 发来）
chrome.runtime.onMessage.addListener((request) => {
  if (request && request.type === MSG.TOGGLE_SIDEBAR && window.self === window.top) {
    if (AJA.ensureSidebarUI) AJA.ensureSidebarUI();
    if (AJA.toggleDrawer) AJA.toggleDrawer();
  }
});

} // end !IS_TRACKER_PAGE
