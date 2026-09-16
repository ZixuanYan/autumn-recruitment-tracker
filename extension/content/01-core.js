/**
 * 秋招求职与简历助手 - Content Script 01/06 核心基础设施（v5.6.0）
 * 常量、共享状态、光标追踪、Shadow Root 宿主与设计令牌样式、字段填入引擎、Toast
 * 注意：01-06 按序注入同一 isolated world，顶层 const/let/function 跨文件可见
 *
 * v5.6.0：常驻收录胶囊（#aja-toggle）与其唯一下游迷你收录卡片（#aja-capture-pop）整体退役
 * ——用户实测它并没有用：收录走 Side Panel（识别当前页面 → 核对 → 收录）已是完整链路，
 * 页面上不再注入任何常驻按钮（拖拽吸边、位置持久化、 AJA.dragMath 一并删除）。
 * 保留的职责全部服务 Side Panel：光标追踪与字段填入引擎（FILL_FOCUSED_FIELD）、
 * 解析当前页（SCAN_CURRENT_PAGE，引擎在 03-parsers.js）、toast 反馈。
 */
'use strict';

// 网页版管理器页面：跳过 UI 注入（06-bridge.js 提供消息中继），其余页面正常初始化
const IS_TRACKER_PAGE = location.origin === AJA.TRACKER_ORIGIN && location.pathname.startsWith(AJA.TRACKER_PATH_PREFIX);
let shadow = null;
let host = null;

// ===== 顶层声明：06-bridge 等跨文件引用，严禁包进块级作用域 =====
const MSG = AJA.MSG;
let lastFocusedEl = null;
let lastSelectionStart = null;
let lastSelectionEnd = null;
let toastTimer = null;

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

function copyToClipboard(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(String(text)).catch(() => {});
  } catch (_) {}
}

/**
 * 把一段文本填入宿主页面最后聚焦的输入框。
 *
 * 这段逻辑是 v4.x 踩坑积累的成果，三处细节必须逐字保留，否则在真实网申系统上会静默失败：
 * 1. 用 Object.getOwnPropertyDescriptor(proto,'value').set 原生 setter 写值——直接赋 el.value
 *    会被 React/Vue 的受控组件覆盖回去（表现为"填了又空"）；
 * 2. 派发冒泡的 input + change 事件，通知宿主框架更新内部状态；
 * 3. 写完后 focus() + setSelectionRange() 把光标停在插入内容末尾，方便用户接着手打。
 *
 * Side Panel 形态下这条链路依然成立：点面板时宿主输入框确实会失焦，但 lastFocusedEl 只在
 * 宿主页面的 focusin/click/keyup/select 里更新（见下方 updateActiveSelection），点面板不会
 * 清空它，所以「点输入框 → 点面板字段 → 填入 → 再点下一个字段」可以连续做。
 *
 * @returns {'filled'|'copied'|'no-value'} filled=已写入宿主输入框；copied=无有效目标或写入
 *   失败，已回退到复制剪贴板（调用方据此提示用户手动粘贴）
 */
function fillFocusedField(value) {
  const text = String(value == null ? '' : value);
  if (!text) return 'no-value';

  const targetEl = lastFocusedEl;
  if (!targetEl || !document.contains(targetEl)) {
    copyToClipboard(text);
    return 'copied';
  }
  try {
    if (targetEl instanceof HTMLInputElement || targetEl instanceof HTMLTextAreaElement) {
      const prevVal = targetEl.value || '';

      // 获取当前光标位置（如选区存在则替换选区，如无选区则直接在光标处插入）
      let start = (typeof targetEl.selectionStart === 'number' && targetEl.selectionStart >= 0)
        ? targetEl.selectionStart
        : ((typeof lastSelectionStart === 'number' && lastSelectionStart >= 0) ? lastSelectionStart : prevVal.length);

      let end = (typeof targetEl.selectionEnd === 'number' && targetEl.selectionEnd >= 0)
        ? targetEl.selectionEnd
        : ((typeof lastSelectionEnd === 'number' && lastSelectionEnd >= 0) ? lastSelectionEnd : start);

      if (start > prevVal.length) start = prevVal.length;
      if (end > prevVal.length) end = prevVal.length;

      const newVal = prevVal.slice(0, start) + text + prevVal.slice(end);

      const proto = (targetEl instanceof HTMLTextAreaElement) ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) {
        setter.call(targetEl, newVal);
      } else {
        targetEl.value = newVal;
      }

      // 触发 input 与 change 事件通知网页端框架 (Vue/React/Angular)
      targetEl.dispatchEvent(new Event('input', { bubbles: true }));
      targetEl.dispatchEvent(new Event('change', { bubbles: true }));

      // 将光标定位在新插入内容的末尾并聚焦
      targetEl.focus();
      const nextCursorPos = start + text.length;
      try {
        targetEl.setSelectionRange(nextCursorPos, nextCursorPos);
        lastSelectionStart = nextCursorPos;
        lastSelectionEnd = nextCursorPos;
      } catch (_) {}
      return 'filled';
    }
    if (targetEl.isContentEditable) {
      targetEl.focus();
      document.execCommand('insertText', false, text);
      return 'filled';
    }
    copyToClipboard(text);
    return 'copied';
  } catch (err) {
    console.warn('[秋招助手] 插入文本异常', err);
    copyToClipboard(text);
    return 'copied';
  }
}

// 拖拽定位的纯数学随胶囊一起退役（v5.6.0）：吸边判定与迷你卡片定位只服务已删除的
// #aja-toggle / #aja-capture-pop，没有别的消费方。

if (IS_TRACKER_PAGE) {
  console.log('[秋招求职与简历助手] 检测到网页版管理器，进入桥接模式（不注入 UI）');
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
  host = document.createElement('div');
  host.id = 'autumn-job-assistant-host';
  document.documentElement.appendChild(host);

  shadow = host.attachShadow({ mode: 'open' });

  // ================= 样式的组件段（令牌段按主题生成后拼在它前面）=================
  const COMPONENT_CSS = `
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; }
    :host { all: initial; }

    /* ---------- Toast ---------- */
    /* toast 从黑底白字改为玻璃白（与网页版 v4.10.0 的 toast 同语言）：
       圆角用矩形档 lg 而非胶囊（toast 常是标题+副文本两行，胶囊会压行）、
       时长走 slow 档 320ms（设计资源 SpecList 明确 toast 属 320ms 档）、玻璃配方同胶囊。 */
    .aja-toast {
      position: fixed;
      top: 16px;
      left: 50%;
      transform: translateX(-50%);
      max-width: 80vw;
      background: var(--aja-bg);
      color: var(--aja-text);
      border: 1px solid var(--aja-border-soft);
      padding: 8px 16px;
      border-radius: var(--aja-radius-lg);
      font-size: var(--aja-font-sm);
      font-weight: 500;
      box-shadow: 0 12px 40px var(--aja-shadow);
      pointer-events: none;
      z-index: 2147483647;
      animation: aja-fade-in var(--aja-motion-slow) var(--aja-motion-ease);
    }
    @supports (backdrop-filter: blur(20px)) or (-webkit-backdrop-filter: blur(20px)) {
      .aja-toast { background: var(--aja-glass); backdrop-filter: saturate(180%) blur(20px); -webkit-backdrop-filter: saturate(180%) blur(20px); }
    }
    @keyframes aja-fade-in {
      from { opacity: 0; }
      to { opacity: 1; }
    }
    /* 前庭敏感用户的动效总开关（shadow root 版本）。
       toast 的样式活在 Shadow DOM 里，外面的文档级媒体查询进不来，
       所以必须在这段 COMPONENT_CSS 里自带一份。媒体查询在 shadow root 内照常生效。 */
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after {
        animation-duration: .01ms !important;
        animation-iteration-count: 1 !important;
        transition-duration: .01ms !important;
        scroll-behavior: auto !important;
      }
    }
  `;

  // 主题跟随：系统深浅色切换时只重建令牌段，组件样式全走 var(--aja-*)，因此无需改动。
  // 这里刻意用「令牌段 + 组件段」整体重拼，而不是在已有文本里查找位置做替换——
  // 后者依赖字符串定位，组件样式一改就会静默错位（拼出半截 CSS，界面直接花掉）。
  const style = document.createElement('style');
  function applyTheme(scheme) {
    style.textContent = AJA.tokensToCssVars(scheme, ':host') + COMPONENT_CSS;
  }
  applyTheme(AJA.currentScheme());
  AJA.onSchemeChange(applyTheme);
  shadow.appendChild(style);

  // ================= Side Panel 的远程调用入口 =================
  // Side Panel 是扩展页面，无法直接访问宿主 DOM，所以解析当前页与填入字段都要经
  // background 中转到这里。解析引擎 extractPageJobData 在 03-parsers.js，零改动复用。
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (!request || !request.type || window.self !== window.top) return;

    if (request.type === MSG.SCAN_CURRENT_PAGE) {
      try {
        const data = (typeof extractPageJobData === 'function') ? extractPageJobData() : null;
        if (!data) { sendResponse({ ok: false, reason: 'parser-unavailable' }); return; }
        // url 与 title 一并回传：Side Panel 保存记录时要用目标页的 URL，
        // 绝不能用面板自己的 location（那是 chrome-extension:// 地址）
        sendResponse({ ok: true, data, title: document.title || '', url: location.href });
      } catch (err) {
        sendResponse({ ok: false, reason: 'parse-error', message: err && err.message ? err.message : String(err) });
      }
      return;
    }

    if (request.type === MSG.FILL_FOCUSED_FIELD) {
      const result = fillFocusedField(request.value);
      if (result === 'filled') showToast(`已填入：${String(request.value).slice(0, 12)}${String(request.value).length > 12 ? '…' : ''}`);
      else if (result === 'copied') showToast('未聚焦输入框，已复制到剪贴板，请粘贴');
      sendResponse({ ok: result === 'filled', result });
    }
  });

} // end !IS_TRACKER_PAGE
