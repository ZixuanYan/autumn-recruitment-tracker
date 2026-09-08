/**
 * 秋招求职与简历助手 - 收录表单共享模板（v5.0.0）
 *
 * 为什么要有这个文件：收录表单同时出现在两个地方——content script 的迷你收录卡片（点胶囊弹出）
 * 与 Side Panel 的「一键收录」段。这两端运行在完全不同的上下文（isolated world vs 扩展页面），
 * 无法共享 DOM，但可以共享 HTML 模板、字段 id、下拉选项生成、置信提示渲染与保存链路。
 * 抽到这里之后，字段增删只改一处；否则两端各写一份，迟早出现「面板存进去的少了企业性质」这类漂移。
 *
 * 本文件同时提供 AJA.escapeHtml：收录提示会拼接解析器产出的 source 标识，两端都需要转义，
 * 而 01-core.js 的顶层 escapeHtml 在扩展页面里并不存在，所以实现收敛到这里作为唯一事实源。
 */
(() => {
  'use strict';
  const root = typeof globalThis !== 'undefined' ? globalThis : self;
  root.AJA = root.AJA || {};

  // HTML 转义（唯一实现）。这些数据可能来自任意招聘页解析，未转义直接拼 innerHTML 会形成注入面。
  if (typeof root.AJA.escapeHtml !== 'function') {
    root.AJA.escapeHtml = function escapeHtml(value) {
      return String(value == null ? '' : value).replace(/[&<>"']/g, ch => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
      ));
    };
  }
  const escapeHtml = root.AJA.escapeHtml;

  // 采集来源的中文标签：让用户知道每个字段是从页面哪里认出来的，便于判断该不该信
  const DETECT_SOURCE_LABELS = {
    jsonld: '结构化数据', domain: '官方域名', logo: '页面 Logo', selector: '页面元素',
    breadcrumb: '面包屑', h1: '页面主标题', generic: '页面元素', og: 'OpenGraph',
    title: '网页标题', 'document.title': '网页标题', subdomain: '子域名', detected: '页面内容'
  };

  function detectSourceLabel(source) {
    const s = String(source || '');
    if (!s) return '';
    if (s.indexOf('ats:') === 0) return `${s.slice(4)} 解析器`;
    return DETECT_SOURCE_LABELS[s] || s;
  }

  /**
   * 收录表单 HTML（不含外层容器，由各端插进自己的卡片 / 段落里）。
   * 字段 id 沿用 v4.2.0 的命名，保存链路与既有测试断言都依赖它们。
   */
  function html() {
    const svg = root.AJA.svg || (() => '');
    return `
      <div class="capture-form" id="aja-capture-form">
        <div class="title-hint" id="cap-title-hint" title="点击复制网页标题">
          <div class="title-hint-label">${svg('type', 12)}<span>网页标题（参考）</span></div>
          <div class="title-hint-text" id="cap-title-text"></div>
        </div>
        <div class="detect-hint" id="cap-detect-hint" hidden></div>
        <div class="form-group">
          <label for="cap-company">公司名称</label>
          <input type="text" id="cap-company" placeholder="例如：字节跳动" autocomplete="off">
        </div>
        <div class="form-group">
          <label for="cap-position">投递岗位</label>
          <input type="text" id="cap-position" placeholder="例如：AI产品经理" autocomplete="off">
        </div>
        <div class="form-row">
          <div class="form-group">
            <label for="cap-city">目标城市</label>
            <input type="text" id="cap-city" placeholder="例如：北京" autocomplete="off">
          </div>
          <div class="form-group">
            <label for="cap-stage">投递阶段</label>
            <select id="cap-stage"></select>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label for="cap-date">投递日期</label>
            <input type="date" id="cap-date">
          </div>
          <div class="form-group">
            <label for="cap-company-type">企业性质</label>
            <select id="cap-company-type"></select>
          </div>
        </div>
        <div class="form-actions">
          <button class="btn-save-record" id="cap-save-btn" type="button">${svg('check', 14)}<span>确认存入看板</span></button>
          <button class="btn-cancel-capture" id="cap-cancel-btn" type="button">收起</button>
        </div>
      </div>`;
  }

  /**
   * 表单的组件样式（两端共用）。
   * 和 html() 放在一起是刻意的：模板与样式同源，改一处就不会出现「迷你卡片好看、面板错位」。
   * 全部走 var(--aja-*)，因此深浅主题自动适配；调用方负责先注入 tokensToCssVars。
   * 选择器一律用 .capture-form 作用域而不是 #aja-capture-pop 这类端上专有的 id，
   * 这样同一份 CSS 在 Shadow DOM 与扩展页面里都成立。
   */
  function css() {
    return `
    /* 模板里的 SVG 图标自带 .aja-ico，样式随模板一起走，两端不必各自再定义一遍 */
    .aja-ico { flex: 0 0 auto; display: block; }
    .capture-form { display: flex; flex-direction: column; gap: var(--aja-space-3); }
    .capture-form[hidden] { display: none; }
    .title-hint {
      padding: var(--aja-space-2) var(--aja-space-3);
      background: var(--aja-bg-sub);
      border: 1px solid var(--aja-border-soft);
      border-radius: var(--aja-radius-md);
      font-size: var(--aja-font-xs);
      color: var(--aja-text-sub);
      line-height: 1.45;
      word-break: break-all;
      cursor: pointer;
      transition: border-color var(--aja-motion-fast) var(--aja-motion-ease);
    }
    .title-hint:hover { border-color: var(--aja-accent); }
    .title-hint-label {
      display: flex;
      align-items: center;
      gap: var(--aja-space-1);
      color: var(--aja-text-mute);
      font-size: 10px;
      margin-bottom: 2px;
    }
    .title-hint-text { color: var(--aja-text-sub); }
    /* 解析器「宁空勿错」，识别不出的字段留空并在这里明确告知需要人工补填 */
    .detect-hint {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: var(--aja-space-1);
      padding: var(--aja-space-2) var(--aja-space-3);
      background: var(--aja-bg-sub);
      border: 1px solid var(--aja-border-soft);
      border-radius: var(--aja-radius-md);
      font-size: var(--aja-font-xs);
      line-height: 1.5;
      color: var(--aja-text-sub);
    }
    .detect-hint[hidden] { display: none; }
    .detect-hint.warn {
      background: var(--aja-warn-soft);
      border-color: var(--aja-warn);
      color: var(--aja-warn);
    }
    .detect-hint-src { width: 100%; color: var(--aja-text-mute); }
    .form-group { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
    .form-group label { font-size: var(--aja-font-xs); font-weight: 600; color: var(--aja-text-sub); }
    .form-group input, .form-group select {
      width: 100%;
      padding: 5px var(--aja-space-3);
      font-size: var(--aja-font-sm);
      font-family: inherit;
      color: var(--aja-text);
      background: var(--aja-bg);
      border: 1px solid var(--aja-border);
      border-radius: var(--aja-radius-pill);
      outline: none;
      transition: border-color var(--aja-motion-fast) var(--aja-motion-ease);
    }
    .form-group input:focus, .form-group select:focus {
      border-color: var(--aja-accent);
      box-shadow: 0 0 0 2px var(--aja-accent-soft);
    }
    /* 关键修复（v4.x 遗留，必须保留）：容器整体 user-select:none 会让输入框里已有的文本
       无法选中/替换，表现为"配置存了就改不了"；输入控件必须可选可编辑 */
    .capture-form input, .capture-form textarea, .capture-form select {
      user-select: text;
      -webkit-user-select: text;
    }
    .form-row { display: grid; grid-template-columns: 1fr 1fr; gap: var(--aja-space-2); }
    .form-actions { display: flex; gap: var(--aja-space-2); margin-top: var(--aja-space-1); }
    .btn-save-record {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: var(--aja-space-1);
      padding: 6px;
      color: #fff;
      background: var(--aja-accent);
      border: 1px solid var(--aja-accent);
      border-radius: var(--aja-radius-pill);
      font-size: var(--aja-font-sm);
      font-weight: 600;
      font-family: inherit;
      cursor: pointer;
      transition: background-color var(--aja-motion-fast) var(--aja-motion-ease),
                  border-color var(--aja-motion-fast) var(--aja-motion-ease);
    }
    .btn-save-record:hover { background: var(--aja-accent-hover); border-color: var(--aja-accent-hover); }
    .btn-cancel-capture {
      padding: 6px 10px;
      color: var(--aja-text-sub);
      background: var(--aja-bg);
      border: 1px solid var(--aja-border);
      border-radius: var(--aja-radius-pill);
      font-size: var(--aja-font-sm);
      font-family: inherit;
      cursor: pointer;
      transition: background-color var(--aja-motion-fast) var(--aja-motion-ease),
                  color var(--aja-motion-fast) var(--aja-motion-ease);
    }
    .btn-cancel-capture:hover { background: var(--aja-bg-hover); color: var(--aja-text); }
    `;
  }

  /**
   * 生成两个下拉的选项。
   * 阶段由 AJA.STAGES 统一生成（与网页版 STAGE_PRESETS 单一事实源）；
   * 企业性质首项固定「未设置」value=''，解析器从不猜企业性质（页面上没有可靠依据，
   * 猜错比留空更糟），所以始终由用户手动选一次。
   */
  function fillOptions(stageSel, typeSel) {
    if (stageSel) stageSel.innerHTML = (root.AJA.STAGES || []).map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');
    if (typeSel) {
      typeSel.innerHTML = `<option value="">${escapeHtml(root.AJA.COMPANY_TYPE_UNSET || '未设置')}</option>`
        + (root.AJA.COMPANY_TYPES || []).map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('');
    }
  }

  // 从根节点（ShadowRoot 或 document）一次性取出全部字段元素，避免两端各写一遍 querySelector
  function els(scope) {
    const q = (sel) => (scope && scope.querySelector ? scope.querySelector(sel) : null);
    return {
      form: q('#aja-capture-form'),
      titleHint: q('#cap-title-hint'),
      titleText: q('#cap-title-text'),
      detectHint: q('#cap-detect-hint'),
      company: q('#cap-company'),
      position: q('#cap-position'),
      city: q('#cap-city'),
      stage: q('#cap-stage'),
      date: q('#cap-date'),
      companyType: q('#cap-company-type'),
      saveBtn: q('#cap-save-btn'),
      cancelBtn: q('#cap-cancel-btn')
    };
  }

  // 解析结果回填表单
  function fillForm(e, detected) {
    const d = detected || {};
    if (e.company) e.company.value = d.company || '';
    if (e.position) e.position.value = d.position || '';
    if (e.city) e.city.value = d.city || '';
    if (e.stage) e.stage.value = d.stage || '';
    if (e.date) e.date.value = d.applicationDate || '';
    if (e.titleText) e.titleText.textContent = d.pageTitle || '';
    if (e.titleHint) e.titleHint.title = `点击复制: ${d.pageTitle || ''}`;
    renderDetectHint(e.detectHint, d);
  }

  // 自动聚焦到第一个没识别出来的字段（都识别出来则聚焦公司名），方便快速修正
  function firstEmptyField(e, detected) {
    const d = detected || {};
    if (!d.company) return e.company;
    if (!d.position) return e.position;
    if (!d.city) return e.city;
    return e.company;
  }

  /**
   * 暂存项回填表单：点暂存箱里的某条 → 表单填回它的值，可修改后重新保存。
   * 放在 common 而不是各端自己写，是因为 test/extension-bridge.js 有一条跨仓库契约断言盯着
   * 「回填必须带 companyType」——企业性质漏回填会让用户重复收录时把已选过的性质冲成未设置，
   * 网页端洞察的企业性质统计就永远缺这一维。断言有唯一落点，才不会两端各改一半。
   */
  function fillFromPending(e, item) {
    const it = item || {};
    if (e.company) e.company.value = it.company || '';
    if (e.position) e.position.value = it.position || '';
    if (e.city) e.city.value = it.city || '';
    if (e.stage) e.stage.value = it.stage || '已投递';
    if (e.date) e.date.value = it.applicationDate || '';
    // 企业性质：暂存项里没有该选项时 select.value 会落回 ''（未设置），不会抛错
    if (e.companyType) e.companyType.value = it.companyType || '';
  }

  /**
   * 渲染采集置信提示：解析器「宁空勿错」，识别不出的字段会留空，这里明确告知需要人工补填。
   */
  function renderDetectHint(hintEl, detected) {
    if (!hintEl) return;
    const d = detected || {};
    const missing = [];
    if (!d.company) missing.push('公司名称');
    if (!d.position) missing.push('投递岗位');
    if (!d.city) missing.push('目标城市');
    const sources = d._sources || {};
    const srcText = ['company', 'position', 'city']
      .filter(k => d[k] && sources[k])
      .map(k => `${k === 'company' ? '公司' : k === 'position' ? '岗位' : '城市'}来自${detectSourceLabel(sources[k])}`)
      .join(' · ');
    const svg = root.AJA.svg || (() => '');
    if (missing.length) {
      hintEl.className = 'detect-hint warn';
      hintEl.innerHTML = `${svg('warn', 13)}<span>未能从页面识别出：<b>${missing.map(escapeHtml).join('、')}</b>，请手动补填后再保存。</span>`
        + (srcText ? `<div class="detect-hint-src">${escapeHtml(srcText)}</div>` : '');
    } else {
      hintEl.className = 'detect-hint';
      // 企业性质从来不自动识别，所以识别全中时也要提一句，否则用户不会注意到这个下拉，
      // 洞察的企业性质统计就一直缺这一维。
      hintEl.innerHTML = `<span>已自动识别，请核对后保存；「企业性质」需手动选一次（央国企 / 民企 / 外企）。</span>`
        + (srcText ? `<div class="detect-hint-src">${escapeHtml(srcText)}</div>` : '');
    }
    hintEl.hidden = false;
  }

  /**
   * 从表单收集记录。
   * @param {object} e els() 的返回值
   * @param {string} url 投递链接。content script 传 location.href；
   *   Side Panel **必须**传目标标签页的 URL（来自 SCAN_CURRENT_PAGE 的返回），
   *   绝不能用 panel 自己的 location——那是 chrome-extension:// 页面地址，存进记录就成了废数据。
   */
  function collect(e, url) {
    const val = (el) => (el && typeof el.value === 'string' ? el.value : '');
    return {
      company: val(e.company).trim() || '待确认公司',
      position: val(e.position).trim() || '待确认岗位',
      city: val(e.city).trim(),
      stage: val(e.stage) || '已投递',
      // 企业性质：收录时一并选掉，网页端就不用再打开编辑弹窗补填（''=未设置）
      companyType: val(e.companyType),
      applicationDate: val(e.date) || new Date().toISOString().slice(0, 10),
      applicationUrl: String(url || ''),
      recentSchedule: '已完成网申投递',
      nextAction: '关注招聘动态与邮件通知'
    };
  }

  /**
   * 保存链路（两端共用）：优先推送到网页版管理器（人工确认入库 + 云同步），
   * 管理器未打开或页面未就绪时回落到暂存箱，打开网页版后逐条确认。
   *
   * @param {object} record collect() 的产物
   * @param {object} deps { send, toast, onDone }
   *   send(message, onResult, onError) —— content 侧传 safeSendMessage，panel 侧传同签名封装
   *   toast(text) —— 两端各自的提示实现
   *   onDone(saved: boolean, where: 'tracker'|'pending') —— 保存结果回调，用于收起表单 / 刷新暂存箱
   */
  function save(record, deps) {
    const d = deps || {};
    const send = typeof d.send === 'function' ? d.send : () => {};
    const toast = typeof d.toast === 'function' ? d.toast : () => {};
    const onDone = typeof d.onDone === 'function' ? d.onDone : () => {};
    const MSG = root.AJA.MSG || {};
    const label = `${record.company} - ${record.position}`;

    const saveToPending = () => {
      send({ type: MSG.SAVE_JOB_RECORD, record }, (res) => {
        if (res && res.ok) {
          toast(res.updated ? `已更新暂存箱：${label}（共 ${res.total} 条）` : `已存入暂存箱：${label}（共 ${res.total} 条）`);
          onDone(true, 'pending');
        } else {
          toast(`保存失败：${(res && res.message) || '未知错误'}`);
          onDone(false, 'pending');
        }
      }, (errMsg) => {
        toast(`保存失败：${errMsg}`);
        onDone(false, 'pending');
      });
    };

    send({ type: MSG.PUSH_TO_TRACKER, record }, (res) => {
      if (res && res.ok) {
        toast(`已推送到网页版管理器，请确认：${label}`);
        onDone(true, 'tracker');
        return;
      }
      // 管理器未打开或页面未就绪 → 存入暂存箱
      if (res && (res.reason === 'tracker-not-open' || res.reason === 'tracker-not-ready')) {
        saveToPending();
        return;
      }
      toast(`保存失败：${(res && res.message) || '未知错误'}`);
      onDone(false, 'tracker');
    }, () => {
      // 扩展上下文失效（如刚重载）：走暂存箱回落
      saveToPending();
    });
  }

  root.AJA.CaptureForm = {
    html, css, fillOptions, els, fillForm, firstEmptyField, fillFromPending, renderDetectHint, collect, save,
    DETECT_SOURCE_LABELS, detectSourceLabel
  };
})();
