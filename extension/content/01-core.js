/**
 * 秋招求职与简历助手 - Content Script 01/05 核心基础设施（v5.0.0）
 * 常量、共享状态、光标追踪、Shadow Root 宿主与设计令牌样式、常驻收录胶囊、字段填入引擎
 * 注意：01-06 按序注入同一 isolated world，顶层 const/let/function 跨文件可见
 *
 * v5.0.0 的三处结构性变化：
 * 1. 全高注入抽屉（#aja-drawer，350px、top/bottom:20px）退役，改为紧凑的迷你收录卡片
 *    （#aja-capture-pop）——它跟随胶囊定位，用户把胶囊拖到页面空白处，表单就落在空白处，
 *    不再遮挡正在填写的网申表单。完整功能（暂存箱、简历字段库）迁到 Chrome 原生 Side Panel。
 * 2. 胶囊从「只能垂直拖 + 位置不持久化」改为 pointer 拖拽（支持触摸）、松手吸边、
 *    位置存 chrome.storage.local，刷新与跨页面都保持。
 * 3. 577 行 CSS 收敛为设计令牌（common/tokens.js）+ 组件样式，全部走 var(--aja-*)，
 *    跟随系统深浅主题；渐变、毛玻璃、彩色阴影、emoji 图标全部移除。
 */
'use strict';

// 网页版管理器页面：跳过 UI 注入（06-bridge.js 提供消息中继），其余页面正常初始化
const IS_TRACKER_PAGE = location.origin === AJA.TRACKER_ORIGIN && location.pathname.startsWith(AJA.TRACKER_PATH_PREFIX);
let shadow = null;
let host = null;

// ===== 顶层声明：05-capture 等跨文件引用，严禁包进块级作用域 =====
const MSG = AJA.MSG;
let lastFocusedEl = null;
let lastSelectionStart = null;
let lastSelectionEnd = null;
let toggleBtn = null;
let toastTimer = null;

// HTML 转义：唯一实现在 common/capture-form.js（Side Panel 也要用，而那里的 isolated world
// 看不到本文件的顶层函数）。这些数据可能来自任意招聘页解析，未转义直接拼 innerHTML 会形成注入面。
const escapeHtml = AJA.escapeHtml;

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

// 拖拽定位的纯数学（挂到 AJA 供 test/extension-ui.js 单测：吸边判定与边界 clamp 是
// 「胶囊拖到窗口外找不回来」这类问题的唯一防线，必须可测）
AJA.dragMath = {
  // 松手吸边：比较胶囊中心点到左右边缘的距离，贴回更近的一侧
  pickSide(centerX, viewportW) {
    const cx = Number(centerX) || 0, vw = Number(viewportW) || 0;
    if (vw <= 0) return 'right';
    return (vw / 2 - cx) >= 0 ? 'left' : 'right';
  },
  // 垂直边界 clamp：留 margin，且视口比按钮还矮时不至于算出负区间
  clampTop(top, viewportH, btnH, margin) {
    const m = Number(margin) >= 0 ? Number(margin) : 8;
    const h = Number(btnH) > 0 ? Number(btnH) : 32;
    const vh = Number(viewportH) > 0 ? Number(viewportH) : 0;
    const max = Math.max(m, vh - h - m);
    const t = Number(top) || m;
    return Math.min(Math.max(m, t), max);
  },
  // 迷你卡片定位：放在胶囊内侧，空间不足则贴视口边缘（窄窗口下允许覆盖胶囊，
  // 否则卡片会被挤到视口外彻底看不见）
  placePop(btnRect, popW, popH, opts) {
    const o = opts || {};
    const gap = Number(o.gap) >= 0 ? Number(o.gap) : 8;
    const margin = Number(o.margin) >= 0 ? Number(o.margin) : 8;
    const vw = Number(o.viewportW) > 0 ? Number(o.viewportW) : 0;
    const vh = Number(o.viewportH) > 0 ? Number(o.viewportH) : 0;
    const b = btnRect || { left: 0, right: 0, top: 0, width: 0, height: 0 };
    const pw = Number(popW) > 0 ? Number(popW) : 300;
    const ph = Number(popH) > 0 ? Number(popH) : 200;

    let left = o.side === 'left' ? (b.right + gap) : (b.left - gap - pw);
    if (left < margin) left = margin;
    if (vw > 0 && left + pw > vw - margin) left = Math.max(margin, vw - pw - margin);

    let top = Number(b.top) || margin;
    if (vh > 0 && top + ph > vh - margin) top = Math.max(margin, vh - ph - margin);
    return { left: Math.round(left), top: Math.round(top) };
  }
};

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

    .aja-ico { flex: 0 0 auto; display: block; }

    /* ---------- 常驻收录胶囊：吸边、可拖拽、跟随系统深浅主题 ---------- */
    #aja-toggle {
      position: fixed;
      z-index: 2147483646;
      display: flex;
      align-items: center;
      gap: var(--aja-space-2);
      padding: 6px 10px;
      background: var(--aja-bg);
      color: var(--aja-text);
      font-size: var(--aja-font-sm);
      font-weight: 600;
      line-height: 1.4;
      border: 1px solid var(--aja-border-soft);
      border-radius: var(--aja-radius-pill);
      box-shadow: 0 2px 8px var(--aja-shadow);
      cursor: pointer;
      user-select: none;
      -webkit-user-select: none;
      /* pointer 拖拽必需：否则触摸设备上拖动胶囊会同时滚动宿主页面 */
      touch-action: none;
      transition: background-color var(--aja-motion-fast) var(--aja-motion-ease),
                  border-color var(--aja-motion-fast) var(--aja-motion-ease),
                  color var(--aja-motion-fast) var(--aja-motion-ease);
    }
    /* hover 只改颜色，绝不改 padding/transform——旧版 hover 时 padding-left 从 10px 变 14px，
       按钮会"跳"一下，是廉价感的典型来源 */
    #aja-toggle:hover { background: var(--aja-bg-hover); border-color: var(--aja-accent); color: var(--aja-accent); }
    /* 玻璃：胶囊浮在别人的招聘页面上，.72 半透明 + blur 让它与宿主内容自然分离，
       这是插件里玻璃收益最大的一处（比 Side Panel 顶栏更明显，因为背后是真实网页内容）。
       hover 时玻璃会让 hover 底色透出宿主内容，所以 @supports 内把 hover 恢复成不透明。 */
    @supports (backdrop-filter: blur(20px)) or (-webkit-backdrop-filter: blur(20px)) {
      #aja-toggle { background: var(--aja-glass); backdrop-filter: saturate(180%) blur(20px); -webkit-backdrop-filter: saturate(180%) blur(20px); }
      #aja-toggle:hover { background: var(--aja-bg-hover); }
    }
    /* 吸边：贴住的一侧去掉圆角与边框，视觉上像从屏幕边缘抽出的标签 */
    #aja-toggle.is-right { border-right: 0; border-radius: var(--aja-radius-pill) 0 0 var(--aja-radius-pill); }
    #aja-toggle.is-left  { border-left: 0;  border-radius: 0 var(--aja-radius-pill) var(--aja-radius-pill) 0; }
    #aja-toggle.is-dragging {
      transition: none;
      cursor: grabbing;
      opacity: .92;
      border-width: 1px;
      border-radius: var(--aja-radius-pill);
    }
    #aja-toggle .toggle-label { white-space: nowrap; }

    /* ---------- 迷你收录卡片 ---------- */
    #aja-capture-pop {
      position: fixed;
      z-index: 2147483647;
      width: 300px;
      max-height: calc(100vh - 16px);
      overflow-y: auto;
      background: var(--aja-bg);
      color: var(--aja-text);
      border: 1px solid var(--aja-border-soft);
      border-radius: var(--aja-radius-lg);
      box-shadow: 0 12px 40px var(--aja-shadow);
      padding: var(--aja-space-4);
    }
    /* 迷你卡片同样用玻璃（浮在招聘页面上）；阴影从 2px/8px 升档到 lift（12px/40px），
       因为卡片面积大、需要比胶囊更强的分离感。降级同胶囊：不支持时留在上面的不透明 bg。 */
    @supports (backdrop-filter: blur(20px)) or (-webkit-backdrop-filter: blur(20px)) {
      #aja-capture-pop { background: var(--aja-glass); backdrop-filter: saturate(180%) blur(20px); -webkit-backdrop-filter: saturate(180%) blur(20px); }
    }
    /* [hidden] 守卫：本规则块设了 display，必须显式压回 none，否则收起后仍占据空间并吞掉点击
       （网页版踩过四次同类缺陷，见 test/web-check.js 的同款守卫） */
    #aja-capture-pop[hidden] { display: none; }
    #aja-capture-pop::-webkit-scrollbar { width: 6px; }
    #aja-capture-pop::-webkit-scrollbar-thumb { background: var(--aja-border); border-radius: var(--aja-radius-sm); }

    .pop-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--aja-space-3);
      padding-bottom: var(--aja-space-3);
      margin-bottom: var(--aja-space-4);
      border-bottom: 1px solid var(--aja-border-soft);
    }
    .pop-title {
      display: flex;
      align-items: center;
      gap: var(--aja-space-2);
      font-size: var(--aja-font-md);
      font-weight: 650;
      color: var(--aja-text);
    }
    .pop-close {
      display: grid;
      place-items: center;
      width: 22px;
      height: 22px;
      border: 0;
      border-radius: var(--aja-radius-sm);
      background: transparent;
      color: var(--aja-text-mute);
      cursor: pointer;
      transition: background-color var(--aja-motion-fast) var(--aja-motion-ease),
                  color var(--aja-motion-fast) var(--aja-motion-ease);
    }
    .pop-close:hover { background: var(--aja-bg-hover); color: var(--aja-text); }
    .pop-actions { display: flex; align-items: center; gap: var(--aja-space-1); }

    /* 收录表单的组件样式不在这里：它与表单模板同源，放在 common/capture-form.js 的 css()，
       由下方 applyTheme() 拼接注入。迷你卡片与 Side Panel 共用同一份，避免样式各自漂移。 */

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
  `;

  // 主题跟随：系统深浅色切换时只重建令牌段，组件样式全走 var(--aja-*)，因此无需改动。
  // 这里刻意用「令牌段 + 组件段」整体重拼，而不是在已有文本里查找位置做替换——
  // 后者依赖字符串定位，组件样式一改就会静默错位（拼出半截 CSS，界面直接花掉）。
  const style = document.createElement('style');
  function applyTheme(scheme) {
    style.textContent = AJA.tokensToCssVars(scheme, ':host') + COMPONENT_CSS + AJA.CaptureForm.css();
  }
  applyTheme(AJA.currentScheme());
  AJA.onSchemeChange(applyTheme);
  shadow.appendChild(style);

  // ================= 常驻收录胶囊（轻量 DOM，迷你卡片首次唤起时才完整构建）=================
  toggleBtn = document.createElement('div');
  toggleBtn.id = 'aja-toggle';
  toggleBtn.className = 'is-right';
  toggleBtn.setAttribute('role', 'button');
  toggleBtn.setAttribute('tabindex', '0');
  toggleBtn.title = `收录当前岗位 v${AJA.VERSION}\n可拖拽移动，松手自动吸边（位置会记住）\n暂存箱与简历字段速填在侧边面板里：点浏览器工具栏的扩展图标`;
  toggleBtn.innerHTML = `${AJA.svg('plus', 14)}<span class="toggle-label">收录岗位</span>`;
  shadow.appendChild(toggleBtn);

  // ================= 胶囊位置：读写持久化 =================
  const UI_KEY = AJA.UI_STORAGE_KEY;
  let togglePos = { side: 'right', top: 180 };

  function applyTogglePos() {
    if (!toggleBtn) return;
    const h = toggleBtn.offsetHeight || 32;
    togglePos.top = AJA.dragMath.clampTop(togglePos.top, window.innerHeight, h, 8);
    toggleBtn.style.top = `${Math.round(togglePos.top)}px`;
    const isLeft = togglePos.side === 'left';
    toggleBtn.classList.toggle('is-left', isLeft);
    toggleBtn.classList.toggle('is-right', !isLeft);
    toggleBtn.style.left = isLeft ? '0px' : 'auto';
    toggleBtn.style.right = isLeft ? 'auto' : '0px';
    if (!AJA.positionCapturePop) return;
    AJA.positionCapturePop();
  }
  AJA.applyTogglePos = applyTogglePos;

  function loadTogglePos() {
    try {
      chrome.storage.local.get([UI_KEY], (res) => {
        const saved = res && res[UI_KEY];
        if (saved && typeof saved === 'object') {
          if (saved.side === 'left' || saved.side === 'right') togglePos.side = saved.side;
          if (Number(saved.top) > 0) togglePos.top = Number(saved.top);
        }
        applyTogglePos();
      });
    } catch (_) {
      applyTogglePos();
    }
  }
  function saveTogglePos() {
    try {
      chrome.storage.local.set({ [UI_KEY]: { side: togglePos.side, top: Math.round(togglePos.top) } });
    } catch (_) {}
  }
  AJA.getTogglePos = () => ({ side: togglePos.side, top: togglePos.top });

  // ================= 胶囊拖拽：pointer events + 松手吸边 =================
  // 旧版用 mousedown + document.mousemove，只改 style.top（不能左右移），且鼠标移出按钮就丢事件；
  // 改用 pointer capture 后鼠标/触摸/笔统一处理，移出元素仍持续收到 move。
  let dragState = null;
  let suppressClick = false; // 拖拽位移超过阈值则抑制随后的 click，避免重定位胶囊后卡片被误弹开

  toggleBtn.addEventListener('pointerdown', (e) => {
    if (typeof e.button === 'number' && e.button !== 0) return;
    const rect = toggleBtn.getBoundingClientRect();
    dragState = {
      id: e.pointerId,
      moved: false,
      startX: e.clientX,
      startY: e.clientY,
      originLeft: rect.left,
      originTop: rect.top,
      w: rect.width,
      h: rect.height
    };
    try { toggleBtn.setPointerCapture(e.pointerId); } catch (_) {}
    e.preventDefault();
  });

  toggleBtn.addEventListener('pointermove', (e) => {
    if (!dragState || e.pointerId !== dragState.id) return;
    const dx = e.clientX - dragState.startX;
    const dy = e.clientY - dragState.startY;
    // 4px 阈值：手抖不算拖拽，否则单击会被吞掉
    if (!dragState.moved && Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
    dragState.moved = true;
    toggleBtn.classList.add('is-dragging');
    const maxTop = AJA.dragMath.clampTop(dragState.originTop + dy, window.innerHeight, dragState.h, 8);
    const left = Math.min(Math.max(0, dragState.originLeft + dx), Math.max(0, window.innerWidth - dragState.w));
    toggleBtn.style.left = `${Math.round(left)}px`;
    toggleBtn.style.right = 'auto';
    toggleBtn.style.top = `${Math.round(maxTop)}px`;
  });

  function endDrag(e, commit) {
    if (!dragState || (e && e.pointerId !== dragState.id)) return;
    const wasMoved = dragState.moved;
    try { toggleBtn.releasePointerCapture(dragState.id); } catch (_) {}
    toggleBtn.classList.remove('is-dragging');
    if (wasMoved && commit) {
      const rect = toggleBtn.getBoundingClientRect();
      togglePos.side = AJA.dragMath.pickSide(rect.left + rect.width / 2, window.innerWidth);
      togglePos.top = AJA.dragMath.clampTop(rect.top, window.innerHeight, rect.height, 8);
      applyTogglePos();
      saveTogglePos();
    } else if (wasMoved) {
      applyTogglePos(); // 取消：回到拖拽前的吸边位置
    }
    suppressClick = wasMoved;
    dragState = null;
  }
  toggleBtn.addEventListener('pointerup', (e) => endDrag(e, true));
  toggleBtn.addEventListener('pointercancel', (e) => endDrag(e, false));

  // 点击胶囊：首次唤起时构建迷你卡片再展开
  function openCapture() {
    if (suppressClick) { suppressClick = false; return; }
    if (AJA.ensureCaptureUI) AJA.ensureCaptureUI();
    if (AJA.toggleCapturePop) AJA.toggleCapturePop(true);
  }
  toggleBtn.addEventListener('click', openCapture);
  // 键盘可达：胶囊有 tabindex，Enter/Space 等价于点击（HTML 拖拽对键盘用户不可用）
  toggleBtn.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') { e.preventDefault(); openCapture(); }
  });

  // 窗口尺寸变化后重新 clamp，避免窗口变小后胶囊留在视口外找不回来
  let resizeTimer = null;
  window.addEventListener('resize', () => {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => applyTogglePos(), 150);
  });

  // ================= 迷你卡片开关与定位 =================
  function positionCapturePop() {
    const pop = shadow && shadow.getElementById('aja-capture-pop');
    if (!pop || pop.hidden || !toggleBtn) return;
    const btn = toggleBtn.getBoundingClientRect();
    // 卡片必须先可见才能量到尺寸；hidden 时 offsetWidth/Height 为 0
    const pos = AJA.dragMath.placePop(btn, pop.offsetWidth || 300, pop.offsetHeight || 200, {
      side: togglePos.side,
      viewportW: window.innerWidth,
      viewportH: window.innerHeight,
      gap: 8,
      margin: 8
    });
    pop.style.left = `${pos.left}px`;
    pop.style.top = `${pos.top}px`;
  }
  AJA.positionCapturePop = positionCapturePop;

  function toggleCapturePop(open) {
    const pop = shadow && shadow.getElementById('aja-capture-pop');
    if (!pop) return;
    const want = typeof open === 'boolean' ? open : pop.hidden;
    pop.hidden = !want;
    if (want) {
      positionCapturePop();
      if (AJA.onCaptureOpen) AJA.onCaptureOpen();
    }
  }
  AJA.toggleCapturePop = toggleCapturePop;

  // Esc 关闭卡片
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const pop = shadow && shadow.getElementById('aja-capture-pop');
    if (pop && !pop.hidden) { pop.hidden = true; e.preventDefault(); }
  });

  // 点击卡片外部关闭。Shadow DOM 下 e.target 会被重定向为宿主节点，
  // 必须用 composedPath() 判断点击是否落在插件 UI 内部。
  document.addEventListener('pointerdown', (e) => {
    const pop = shadow && shadow.getElementById('aja-capture-pop');
    if (!pop || pop.hidden) return;
    const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
    if (path.indexOf(host) > -1) return;
    pop.hidden = true;
  }, true);

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

  loadTogglePos();

} // end !IS_TRACKER_PAGE
