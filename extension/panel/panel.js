/**
 * 秋招求职助手 - Side Panel 逻辑（v5.0.0）
 *
 * 架构约束（决定了本文件的形状）：
 * Side Panel 是扩展页面（chrome-extension:// 源），**拿不到宿主页面的 DOM**。而插件的两个核心
 * 能力都必须操作宿主 DOM：一键收录要跑 03-parsers.js 解析当前页，字段速填要写进页面里聚焦的
 * 输入框。因此这两件事都要 panel → background → chrome.tabs.sendMessage → content script 走一趟
 * （见 MSG.SCAN_CURRENT_PAGE / MSG.FILL_FOCUSED_FIELD）。
 * 简历数据与暂存箱本来就是 chrome.runtime.sendMessage 到 background 读 chrome.storage.local，
 * 扩展页面同样能调，所以那部分零改动直接复用。
 *
 * 焦点为什么不会坏：点面板时宿主输入框确实失焦，但 content script 的 lastFocusedEl 只在宿主页面的
 * focusin/click/keyup/select 里更新，点面板不会清空它，所以「点输入框 → 点面板字段 → 填入 →
 * 再点下一个字段」可以连续做。这正是 Side Panel 比注入式抽屉更好的地方：浏览器压缩页面宽度
 * 而不是覆盖页面，用户能一边看表单一边点字段。
 *
 * 纯函数一律挂在 window.AJAPanel 上，供 autumn-mail-sync/test/extension-panel.js 用桩 DOM 单测；
 * init() 只在真实 DOM 就绪时执行，测试加载本文件不会触发渲染。
 */
'use strict';

(() => {
  const MSG = AJA.MSG;
  const escapeHtml = AJA.escapeHtml;

  // ================= 纯函数（可单测）=================

  /**
   * 判定当前标签页属于哪一类，决定状态条文案与按钮可用性。
   * Side Panel 跨标签页保持打开，用户切页后如果面板不更新，就会在 A 公司的页面上点收录、
   * 存进去的却是 B 公司的链接——所以这个判定必须每次切页都重跑。
   * @returns {'ok'|'tracker'|'unsupported'}
   */
  function classifyPage(url) {
    const u = String(url || '');
    if (!u) return 'unsupported';
    // 只有 http/https 页面才注入了 content script；edge:// 、chrome-extension:// 、
    // 扩展商店页、DevTools 等一律不支持
    if (!/^https?:\/\//i.test(u)) return 'unsupported';
    try {
      const p = new URL(u);
      if (p.origin === AJA.TRACKER_ORIGIN && p.pathname.startsWith(AJA.TRACKER_PATH_PREFIX)) return 'tracker';
    } catch (_) {
      return 'unsupported';
    }
    return 'ok';
  }

  // 从 URL 取主机名（失败返回空串，状态条会退化成通用文案）
  function hostOf(url) {
    try { return new URL(String(url || '')).hostname; } catch (_) { return ''; }
  }

  /**
   * 统计简历里已填写的字段数。
   *
   * 两段规则刻意不对称，对齐 common/default-resume.js 的真实结构：
   * - 数组段（教育 / 实习 / 项目经历）的每个 item 带 _rowName 作段名元数据，必须跳过下划线键；
   * - 对象段（优先信息 / 基本信息 / 竞赛与技能）不存在下划线键，直接统计非空值。
   *
   * renderResumeHtml 渲染 chip 用的是同一套规则。两者一旦漂移就会出现
   * 「徽标说填了 8 项、展开只有 6 个 chip」这类对不上的现象，
   * test/extension-ui.js 有一条断言专门盯 chip 数与计数必须相等。
   */
  function countResumeFilledFields(resume) {
    let n = 0;
    try {
      for (const sec of Object.values(resume || {})) {
        if (Array.isArray(sec)) {
          for (const item of sec) {
            if (item && typeof item === 'object') {
              for (const [k, v] of Object.entries(item)) {
                if (!k.startsWith('_') && v != null && String(v).trim() !== '') n++;
              }
            }
          }
        } else if (sec && typeof sec === 'object') {
          for (const v of Object.values(sec)) { if (v != null && String(v).trim() !== '') n++; }
        }
      }
    } catch (_) { n = 0; }
    return n;
  }

  function truncate(text, max) {
    const s = String(text == null ? '' : text);
    const n = Number(max) > 0 ? Number(max) : 12;
    return s.length > n ? `${s.slice(0, n)}…` : s;
  }

  /**
   * 渲染简历字段库 HTML。
   * chip 的值用 encodeURIComponent 存进 data-val：简历内容可能含引号与尖括号，
   * 直接拼进属性会破坏 DOM 甚至形成注入面（数据来自用户在网页版填的任意文本）。
   */
  function renderResumeHtml(resume) {
    if (!resume || typeof resume !== 'object') return '';
    const chip = (k, v) => {
      const strVal = String(v);
      return `<button class="p-chip" type="button" data-key="${escapeHtml(k)}" data-val="${encodeURIComponent(strVal)}" title="${escapeHtml(k)}: ${escapeHtml(strVal)}">`
        + `<span class="p-chip-key">${escapeHtml(k)}</span>`
        + `<span class="p-chip-val">${escapeHtml(strVal)}</span></button>`;
    };
    let html = '';
    for (const [sectionName, sectionData] of Object.entries(resume)) {
      if (!sectionData) continue;
      // 「优先信息」是网申最常填的一组，默认展开；其余折叠，避免面板一打开就是几百个 chip
      const collapsed = sectionName === '优先信息' ? '' : ' is-collapsed';
      let rows = '';
      if (Array.isArray(sectionData)) {
        // 多段经历（教育 / 实习 / 项目）：每段一个卡片，段名来自 _rowName
        sectionData.forEach(item => {
          if (!item || typeof item !== 'object') return;
          let inner = '';
          if (item._rowName) inner += `<div class="p-exp-title">${escapeHtml(item._rowName)}</div>`;
          for (const [k, v] of Object.entries(item)) {
            if (k.startsWith('_') || v === undefined || v === null || v === '') continue;
            inner += chip(k, v);
          }
          if (inner) rows += `<div class="p-exp-row">${inner}</div>`;
        });
      } else if (typeof sectionData === 'object') {
        let inner = '';
        for (const [k, v] of Object.entries(sectionData)) {
          if (v === undefined || v === null || v === '') continue;
          inner += chip(k, v);
        }
        if (inner) rows += `<div class="p-exp-row">${inner}</div>`;
      }
      if (!rows) continue;
      html += `<div class="p-res-sec${collapsed}">`
        + `<button class="p-res-head" type="button"><span>${escapeHtml(sectionName)}</span>`
        + `<span class="p-res-arrow">${AJA.svg('chevron', 13)}</span></button>`
        + `<div class="p-res-body"${collapsed ? ' hidden' : ''}>${rows}</div></div>`;
    }
    return html || '<div class="p-empty">简历还没有内容。到网页版管理器的「我的简历」填写后会自动同步到这里。</div>';
  }

  /**
   * 把 background 的失败原因翻成人话。
   * 这里最容易出「点了没反应」的体验问题：Side Panel 与页面之间隔了一层 background，
   * 任何一环断了都只有一个 reason 字符串，不翻译用户就只能猜。
   */
  function reasonText(res) {
    const r = String((res && res.reason) || '');
    if (r === 'no-content-script') return '当前页面还没注入插件脚本，请刷新页面后重试';
    if (r === 'no-tab') return '没有找到活动标签页';
    if (r === 'no-response') return '页面没有响应，请刷新页面后重试';
    if (r === 'parser-unavailable') return '解析引擎未就绪，请刷新页面后重试';
    if (r === 'parse-error') return `解析失败：${(res && res.message) || '未知错误'}`;
    return (res && res.message) || '操作失败，请刷新页面后重试';
  }

  // 状态条文案（返回 { html, warn, canCapture }）
  function pageState(kind, url) {
    const host = hostOf(url);
    if (kind === 'tracker') {
      return {
        warn: true,
        canCapture: false,
        html: '<span>当前页是<b>网页版管理器</b>，不需要插件辅助。收录与速填请在招聘网站上使用。</span>'
      };
    }
    if (kind === 'unsupported') {
      // 非 http/https 时不要念 hostname：edge://extensions 的 hostname 是 "extensions"，
      // 显示成「当前页面 extensions 无法收录」对用户是噪音，不如直接说清是哪一类页面
      const internal = !/^https?:\/\//i.test(String(url || ''));
      const label = internal ? '浏览器内部页 / 扩展页' : (host || '此页面');
      return {
        warn: true,
        canCapture: false,
        html: `<span><b>${escapeHtml(label)}</b>无法收录或速填，请切换到招聘网站后再用。</span>`
      };
    }
    return {
      warn: false,
      canCapture: true,
      html: `<span>当前页：<b>${escapeHtml(host)}</b> · 可收录与速填</span>`
    };
  }

  const api = { classifyPage, hostOf, countResumeFilledFields, truncate, renderResumeHtml, reasonText, pageState };
  if (typeof window !== 'undefined') window.AJAPanel = api;
  else if (typeof globalThis !== 'undefined') globalThis.AJAPanel = api;

  // ================= 通信 =================

  // 回调式封装（与 content 侧 safeSendMessage 同签名，CaptureForm.save 两端都能用）
  function send(message, onResult, onError) {
    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.id) {
      if (onError) onError('扩展连接不可用，请重新打开面板');
      return;
    }
    try {
      chrome.runtime.sendMessage(message, (res) => {
        // 必须消费 lastError，否则控制台刷 "Unchecked runtime.lastError"
        if (chrome.runtime.lastError) {
          if (onError) onError(chrome.runtime.lastError.message || '扩展通信失败');
          return;
        }
        if (onResult) onResult(res);
      });
    } catch (err) {
      if (onError) onError(err && err.message ? err.message : '扩展通信异常');
    }
  }

  function sendAsync(message) {
    return new Promise((resolve, reject) => send(message, resolve, reject));
  }

  // ================= 运行时状态 =================
  let els = null;
  let formEls = null;
  let resumeData = AJA.DEFAULT_RESUME || {};
  let currentTabId = null;
  let currentTabUrl = '';
  // 保存记录时用的链接必须来自目标页（SCAN_CURRENT_PAGE 的返回），
  // 绝不能用 location.href——那是 chrome-extension:// 的面板地址，存进记录就是废数据
  let capturedPageUrl = '';
  let toastTimer = null;

  function toast(msg) {
    if (!els || !els.toast) return;
    els.toast.textContent = String(msg == null ? '' : msg);
    els.toast.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { els.toast.hidden = true; }, 2200);
  }

  // 经 background 中转到目标标签页的 content script
  async function sendToTab(type, extra) {
    if (!Number.isInteger(currentTabId)) {
      await refreshTab();
    }
    if (!Number.isInteger(currentTabId)) return { ok: false, reason: 'no-tab' };
    try {
      return await sendAsync(Object.assign({ type, tabId: currentTabId }, extra || {}));
    } catch (err) {
      return { ok: false, reason: 'send-error', message: err && err.message ? err.message : String(err) };
    }
  }

  // ================= 当前页状态 =================
  async function refreshTab() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      currentTabId = tab && typeof tab.id === 'number' ? tab.id : null;
      currentTabUrl = (tab && tab.url) || '';
    } catch (_) {
      currentTabId = null;
      currentTabUrl = '';
    }
    renderPageState();
  }

  function renderPageState() {
    if (!els) return;
    const kind = classifyPage(currentTabUrl);
    const st = pageState(kind, currentTabUrl);
    els.pagestate.innerHTML = st.html;
    els.pagestate.classList.toggle('is-warn', !!st.warn);
    els.scanBtn.disabled = !st.canCapture;
    // 换页后上一次的解析结果已失效，收起表单避免用户把 A 公司的数据存成 B 公司的链接
    if (formEls && formEls.form) formEls.form.hidden = true;
    capturedPageUrl = '';
  }

  // ================= 段落折叠 =================
  function bindSection(headEl, bodyEl, arrowEl) {
    if (!headEl || !bodyEl) return;
    headEl.addEventListener('click', () => {
      const open = bodyEl.hidden;
      bodyEl.hidden = !open;
      headEl.setAttribute('aria-expanded', String(open));
    });
  }

  // ================= 一键收录 =================
  async function scan() {
    if (!els) return;
    els.scanBtn.disabled = true;
    const res = await sendToTab(MSG.SCAN_CURRENT_PAGE);
    renderPageState();
    els.scanBtn.disabled = classifyPage(currentTabUrl) !== 'ok';
    if (!res || !res.ok) {
      toast(reasonText(res));
      return;
    }
    capturedPageUrl = res.url || currentTabUrl;
    const detected = Object.assign({}, res.data, { pageTitle: res.title || '' });
    if (formEls.form) formEls.form.hidden = false;
    AJA.CaptureForm.fillForm(formEls, detected);
    if (detected._sources) console.debug('[秋招助手] 采集来源', detected._sources);
    // 自动聚焦第一个没识别出来的字段（都识别出来则聚焦公司名），方便快速修正
    const target = AJA.CaptureForm.firstEmptyField(formEls, detected);
    if (target) setTimeout(() => { try { target.focus(); } catch (_) {} }, 30);
  }

  function saveCapture() {
    const record = AJA.CaptureForm.collect(formEls, capturedPageUrl || currentTabUrl);
    AJA.CaptureForm.save(record, {
      send,
      toast,
      onDone: (saved) => {
        if (!saved) return;
        if (formEls.form) formEls.form.hidden = true;
        refreshPending();
      }
    });
  }

  // ================= 暂存箱 =================
  function renderPending(list) {
    const items = Array.isArray(list) ? list : [];
    els.pendCount.textContent = String(items.length);
    els.pendCount.hidden = items.length === 0;
    if (!items.length) {
      els.pendList.innerHTML = '<div class="p-empty">暂存箱是空的。在招聘网站点「识别当前页面」并保存后，'
        + '如果网页版管理器没打开，记录会先排在这里。</div>';
      return;
    }
    els.pendList.innerHTML = items.map(item => `
      <div class="p-pend-item" data-id="${escapeHtml(item.id)}">
        <div class="p-pend-main" data-fill="${escapeHtml(item.id)}" title="点击回填收录表单，可修改后重新保存">
          <div class="p-pend-title">${escapeHtml(item.company)} · ${escapeHtml(item.position)}</div>
          <div class="p-pend-meta">${escapeHtml(item.applicationDate || '')} · ${escapeHtml(item.stage || '已投递')}${item.companyType ? ` · ${escapeHtml(item.companyType)}` : ''}</div>
          ${item.variantOf ? `<div class="p-pend-variant" title="这不是重复堆积：同一家公司的岗位名相近（括号里通常是城市/方向/批次），已作为独立一条暂存">与「${escapeHtml(item.variantOf)}」是同公司的相近岗位</div>` : ''}
        </div>
        <button class="p-pend-discard" type="button" data-discard="${escapeHtml(item.id)}" title="丢弃这条暂存">${AJA.svg('close', 13)}</button>
      </div>`).join('');
  }

  let pendingCache = [];

  async function refreshPending() {
    try {
      const res = await sendAsync({ type: MSG.GET_PENDING_RECORDS });
      pendingCache = (res && res.ok && Array.isArray(res.records)) ? res.records : [];
    } catch (_) {
      pendingCache = [];
    }
    renderPending(pendingCache);
  }

  function onPendingClick(event) {
    const discardId = event.target.getAttribute && event.target.getAttribute('data-discard');
    if (discardId) {
      send({ type: MSG.REMOVE_PENDING_RECORD, id: discardId }, () => refreshPending(), () => refreshPending());
      return;
    }
    const fillEl = event.target.closest && event.target.closest('[data-fill]');
    const fillId = fillEl && fillEl.getAttribute('data-fill');
    if (!fillId) return;
    const item = pendingCache.find(r => r && r.id === fillId);
    if (!item) return;
    // 回填走 common/capture-form.js 的 fillFromPending：企业性质必须一并带回，
    // 否则重复收录同一岗位时会把已选过的性质冲成「未设置」（test/extension-bridge.js 盯着这一环）
    AJA.CaptureForm.fillFromPending(formEls, item);
    capturedPageUrl = item.applicationUrl || capturedPageUrl;
    if (formEls.form) formEls.form.hidden = false;
    openSection('capture');
    toast('已回填收录表单，可修改后重新保存');
  }

  // ================= 简历字段库 =================
  function renderResume() {
    const n = countResumeFilledFields(resumeData);
    els.resCount.textContent = String(n);
    els.resCount.hidden = n === 0;
    els.resumeList.innerHTML = renderResumeHtml(resumeData);
    renderResumeStatus(n);
    applyFilter();
  }

  function renderResumeStatus(n) {
    const filled = Number(n) > 0;
    // 这里必须插值 n 而不是 filled：filled 是布尔值，写成 ${filled} 会渲染成「已填 true 项」。
    // 迁移自旧版 refreshResumeStatus 时踩了这个坑，由 test/extension-panel.js 的桩 DOM 跑 init() 抓到
    // （静态断言与纯函数单测都发现不了：文案模板本身合法，只有真实渲染才看得出）。
    els.resumeStatus.textContent = filled ? `简历：已同步（已填 ${Number(n)} 项）` : '简历：未同步 · 点此去网页版配置';
    els.resumeStatus.classList.toggle('is-empty', !filled);
    els.resumeStatus.onclick = filled ? null : () => openTracker();
  }

  async function loadResume() {
    try {
      const res = await sendAsync({ type: MSG.GET_RESUME_DATA });
      resumeData = (res && res.ok && res.data) ? res.data : (AJA.DEFAULT_RESUME || {});
    } catch (_) {
      resumeData = AJA.DEFAULT_RESUME || {};
    }
    renderResume();
  }

  // 搜索过滤：按字段名/内容过滤 chip；命中段自动展开；空查询恢复全部
  function applyFilter() {
    if (!els || !els.resumeList) return;
    const q = String(els.resumeSearch.value || '').trim().toLowerCase();
    els.resumeList.querySelectorAll('.p-res-sec').forEach(sec => {
      let visible = 0;
      sec.querySelectorAll('.p-chip').forEach(chipEl => {
        const txt = (chipEl.textContent || '').toLowerCase();
        const key = (chipEl.getAttribute('data-key') || '').toLowerCase();
        const hit = !q || txt.includes(q) || key.includes(q);
        chipEl.style.display = hit ? '' : 'none';
        if (hit) visible++;
      });
      sec.querySelectorAll('.p-exp-row').forEach(row => {
        const any = Array.from(row.querySelectorAll('.p-chip')).some(c => c.style.display !== 'none');
        row.style.display = any ? '' : 'none';
      });
      if (q) {
        const hit = visible > 0;
        sec.style.display = hit ? '' : 'none';
        if (hit) {
          sec.classList.remove('is-collapsed');
          const body = sec.querySelector('.p-res-body');
          if (body) body.hidden = false;
        }
      } else {
        sec.style.display = '';
      }
    });
  }

  async function onChipClick(chipEl) {
    const value = decodeURIComponent(chipEl.getAttribute('data-val') || '');
    if (!value) return;
    const key = chipEl.getAttribute('data-key') || '';
    const res = await sendToTab(MSG.FILL_FOCUSED_FIELD, { value, key });
    if (res && res.ok) {
      toast(`已填入：${truncate(value, 12)}`);
      return;
    }
    // content 侧写入失败时已自行回退到复制剪贴板（result='copied'），这里如实转告
    if (res && res.result === 'copied') {
      toast('未聚焦输入框，已复制到剪贴板，请粘贴');
      return;
    }
    toast(reasonText(res));
  }

  function onChipCopy(chipEl) {
    const value = decodeURIComponent(chipEl.getAttribute('data-val') || '');
    if (!value) return;
    const key = chipEl.getAttribute('data-key') || '';
    if (!navigator.clipboard || !navigator.clipboard.writeText) {
      toast('当前环境不支持剪贴板');
      return;
    }
    navigator.clipboard.writeText(value)
      .then(() => toast(`已复制：${key ? key + ' → ' : ''}${truncate(value, 20)}`))
      .catch(() => toast('复制失败，请手动选择文本'));
  }

  // ================= 其它 =================
  function openTracker() {
    try { chrome.tabs.create({ url: AJA.TRACKER_URL }); } catch (_) { window.open(AJA.TRACKER_URL, '_blank'); }
  }

  function openSection(name) {
    if (name !== 'capture' || !els) return;
    els.capBody.hidden = false;
    els.capHead.setAttribute('aria-expanded', 'true');
  }

  // ================= 初始化 =================
  function init() {
    const $ = (id) => document.getElementById(id);
    els = {
      logo: $('p-logo'), ver: $('p-ver'), pagestate: $('p-pagestate'),
      capHead: $('p-cap-head'), capBody: $('p-cap-body'), capArrow: $('p-cap-arrow'),
      scanBtn: $('p-scan-btn'), scanIco: $('p-scan-ico'), formHost: $('p-form-host'),
      pendHead: $('p-pend-head'), pendBody: $('p-pend-body'), pendArrow: $('p-pend-arrow'),
      pendCount: $('p-pend-count'), pendList: $('p-pend-list'),
      resHead: $('p-res-head'), resBody: $('p-res-body'), resArrow: $('p-res-arrow'),
      resCount: $('p-res-count'), resumeStatus: $('p-resume-status'),
      resumeSearch: $('p-resume-search'), resumeList: $('p-resume-list'), searchIco: $('p-search-ico'),
      openTracker: $('p-open-tracker'), globeIco: $('p-globe-ico'), toast: $('p-toast')
    };

    // 图标与版本徽标
    els.logo.innerHTML = AJA.svg('logo', 15);
    els.ver.textContent = `v${AJA.VERSION}`;
    els.scanIco.innerHTML = AJA.svg('search', 14);
    els.searchIco.innerHTML = AJA.svg('search', 14);
    els.globeIco.innerHTML = AJA.svg('globe', 14);
    els.capArrow.innerHTML = AJA.svg('chevron', 13);
    els.pendArrow.innerHTML = AJA.svg('chevron', 13);
    els.resArrow.innerHTML = AJA.svg('chevron', 13);

    // 设计令牌 + 收录表单样式（表单样式与模板同源，见 common/capture-form.js 的 css()）
    const themeStyle = document.createElement('style');
    document.head.appendChild(themeStyle);
    const applyTheme = (scheme) => {
      themeStyle.textContent = AJA.tokensToCssVars(scheme, ':root') + AJA.CaptureForm.css();
    };
    applyTheme(AJA.currentScheme());
    AJA.onSchemeChange(applyTheme);

    // 收录表单：模板来自 common，两端同一份
    els.formHost.innerHTML = AJA.CaptureForm.html();
    formEls = AJA.CaptureForm.els(document);
    if (formEls.form) formEls.form.hidden = true;
    AJA.CaptureForm.fillOptions(formEls.stage, formEls.companyType);

    // 段落折叠
    bindSection(els.capHead, els.capBody);
    bindSection(els.pendHead, els.pendBody);
    bindSection(els.resHead, els.resBody);

    // 事件
    els.scanBtn.addEventListener('click', scan);
    if (formEls.saveBtn) formEls.saveBtn.addEventListener('click', saveCapture);
    if (formEls.cancelBtn) formEls.cancelBtn.addEventListener('click', () => { formEls.form.hidden = true; });
    if (formEls.titleHint) {
      formEls.titleHint.addEventListener('click', () => {
        const title = formEls.titleText.textContent || '';
        if (!title || !navigator.clipboard) return;
        navigator.clipboard.writeText(title).then(() => toast('网页标题已复制到剪贴板')).catch(() => {});
      });
    }
    els.pendList.addEventListener('click', onPendingClick);
    els.resumeSearch.addEventListener('input', applyFilter);
    els.resumeList.addEventListener('click', (e) => {
      const head = e.target.closest && e.target.closest('.p-res-head');
      if (head) {
        const sec = head.closest('.p-res-sec');
        const body = sec && sec.querySelector('.p-res-body');
        if (!sec || !body) return;
        const collapsed = sec.classList.toggle('is-collapsed');
        body.hidden = collapsed;
        return;
      }
      const chipEl = e.target.closest && e.target.closest('.p-chip');
      if (chipEl) onChipClick(chipEl);
    });
    // 右键 chip = 复制（与旧版抽屉一致的肌肉记忆）
    els.resumeList.addEventListener('contextmenu', (e) => {
      const chipEl = e.target.closest && e.target.closest('.p-chip');
      if (!chipEl) return;
      e.preventDefault();
      onChipCopy(chipEl);
    });
    els.openTracker.addEventListener('click', openTracker);

    // 跨 UI 同步：迷你卡片（content script）保存记录、网页版下发简历，都会写 chrome.storage.local，
    // 面板监听同一份存储即可自动刷新，不需要额外的广播消息
    if (chrome.storage && chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') return;
        if (changes[AJA.RESUME_STORAGE_KEY]) {
          resumeData = changes[AJA.RESUME_STORAGE_KEY].newValue || AJA.DEFAULT_RESUME || {};
          renderResume();
        }
        if (changes[AJA.PENDING_KEY]) refreshPending();
      });
    }

    // 标签页切换 / 导航后刷新当前页状态
    if (chrome.tabs) {
      chrome.tabs.onActivated.addListener(() => refreshTab());
      chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
        if (tab && tab.active) refreshTab();
      });
    }

    refreshTab();
    refreshPending();
    loadResume();
    console.log(`[秋招求职与简历助手] Side Panel v${AJA.VERSION} 已就绪`);
  }

  if (typeof document !== 'undefined' && document.getElementById) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
  }
})();
